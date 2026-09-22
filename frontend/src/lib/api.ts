/**
 * API client.
 *
 * Every failure mode the backend can present is turned into a typed ApiError
 * carrying a message a human can act on, because "something went wrong" is not
 * an acceptable state for an operations tool. The distinction that matters
 * most is `offline` (the backend is not running) versus a real HTTP error,
 * since the fixes are completely different.
 */

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://127.0.0.1:8000";

/**
 * Session token.
 *
 * Held in a module variable so every request picks it up without threading it
 * through call sites, and mirrored into localStorage so a refresh keeps the
 * session. Clearing it also drops the GET cache, so one user's data can never
 * be served to the next.
 */
const TOKEN_STORAGE_KEY = "voltaura.session.v1";

let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
  if (typeof window === "undefined") return;
  try {
    if (token) window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    /* private browsing: the session simply does not survive a refresh */
  }
  invalidateGetCache();
}

export function getAuthToken(): string | null {
  if (authToken) return authToken;
  if (typeof window === "undefined") return null;
  try {
    authToken = window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    authToken = null;
  }
  return authToken;
}

/** Fired when the API rejects our token, so the app can bounce to /login. */
type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler;
}

export class ApiError extends Error {
  readonly status: number;
  readonly offline: boolean;
  readonly hint?: string;
  readonly path: string;

  constructor(
    message: string,
    options: { status: number; offline?: boolean; hint?: string; path: string },
  ) {
    super(message);
    this.name = "ApiError";
    this.status = options.status;
    this.offline = options.offline ?? false;
    this.hint = options.hint;
    this.path = options.path;
  }
}

function extractDetail(body: unknown, fallback: string): string {
  if (typeof body === "string" && body.trim()) return body;
  if (body && typeof body === "object") {
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
    // FastAPI validation errors arrive as a list of {loc, msg}.
    if (Array.isArray(detail)) {
      const parts = detail
        .map((d) => {
          if (d && typeof d === "object") {
            const loc = Array.isArray((d as { loc?: unknown[] }).loc)
              ? (d as { loc: unknown[] }).loc.slice(1).join(".")
              : "";
            const msg = (d as { msg?: string }).msg ?? "";
            return loc ? `${loc}: ${msg}` : msg;
          }
          return String(d);
        })
        .filter(Boolean);
      if (parts.length) return parts.join("; ");
    }
  }
  return fallback;
}

async function request<T>(
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const { timeoutMs = 300_000, ...rest } = init ?? {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...rest,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {}),
        ...(rest.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch (error) {
    clearTimeout(timer);
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new ApiError(
      aborted
        ? "The request timed out. The analysis may still be running on the server."
        : "Cannot reach the VOLTAURA API.",
      {
        status: 0,
        offline: true,
        path,
        hint: aborted
          ? "Long analysis runs can exceed the client timeout. Try again in a moment."
          : `Start the backend:  uvicorn app.main:app --reload --app-dir backend  (expected at ${API_BASE})`,
      },
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* keep the raw text */
  }

  if (!response.ok) {
    // An expired or revoked token invalidates every screen at once, so the
    // app is told immediately rather than letting each panel fail on its own.
    if (response.status === 401 && !path.startsWith("/api/auth/")) {
      setAuthToken(null);
      onUnauthorized?.();
    }
    throw new ApiError(
      extractDetail(body, `Request failed with status ${response.status}`),
      {
        status: response.status,
        path,
        hint:
          body && typeof body === "object"
            ? (body as { hint?: string }).hint
            : undefined,
      },
    );
  }

  return body as T;
}

const getCache = new Map<string, { expires: number; value: unknown }>();
const getInflight = new Map<string, Promise<unknown>>();
const GET_CACHE_MS = 15_000;

function invalidateGetCache() {
  getCache.clear();
}

async function cachedGet<T>(path: string): Promise<T> {
  const now = Date.now();
  const cached = getCache.get(path);
  if (cached && cached.expires > now) return cached.value as T;
  const pending = getInflight.get(path);
  if (pending) return pending as Promise<T>;
  const requestPromise = request<T>(path).then((value) => {
    getCache.set(path, { expires: Date.now() + GET_CACHE_MS, value });
    getInflight.delete(path);
    return value;
  }).catch((error) => {
    getInflight.delete(path);
    throw error;
  });
  getInflight.set(path, requestPromise);
  return requestPromise;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  getCached: <T>(path: string) => cachedGet<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }).then((value) => {
      invalidateGetCache();
      return value;
    }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body ?? {}) }).then((value) => {
      invalidateGetCache();
      return value;
    }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) }).then((value) => {
      invalidateGetCache();
      return value;
    }),
};

/** Absolute URL for links the browser should navigate to, such as downloads. */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}
