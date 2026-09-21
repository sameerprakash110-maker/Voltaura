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
      headers: { "Content-Type": "application/json", ...(rest.headers ?? {}) },
      cache: "no-store",
    });
  } catch (error) {
    clearTimeout(timer);
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new ApiError(
      aborted
        ? "The request timed out. The analysis may still be running on the server."
        : "Cannot reach the EcoTwin API.",
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

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
};

/** Absolute URL for links the browser should navigate to, such as downloads. */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}
