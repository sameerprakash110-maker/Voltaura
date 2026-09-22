"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import {
  api,
  getAuthToken,
  setAuthToken,
  setUnauthorizedHandler,
} from "@/lib/api";

/**
 * Session state.
 *
 * The token is the only thing persisted; the user record is always re-fetched
 * from /api/auth/me on load. That means a revoked or expired session is caught
 * on the first request after a refresh rather than trusting stale local state.
 */

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: string;
  last_login_at: string | null;
}

export interface OtpChallenge {
  sent: boolean;
  email: string;
  delivery: "email" | "console" | string;
  expires_at: string;
  expires_in_seconds: number;
  code_length: number;
  resend_after_seconds: number;
  message: string;
  debug_code?: string | null;
}

interface SessionResponse {
  access_token: string;
  token_type: string;
  expires_at: string;
  user: AuthUser;
}

interface AuthState {
  user: AuthUser | null;
  /** True until the stored token has been checked against the API. */
  loading: boolean;
  requestOtp: (email: string) => Promise<OtpChallenge>;
  verifyOtp: (email: string, code: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
}

const Context = React.createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = React.useState<AuthUser | null>(null);
  const [loading, setLoading] = React.useState(true);

  // Restore a session from the stored token, once, on mount.
  React.useEffect(() => {
    let alive = true;
    const token = getAuthToken();
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get<AuthUser>("/api/auth/me")
      .then((me) => {
        if (alive) setUser(me);
      })
      .catch(() => {
        setAuthToken(null);
        if (alive) setUser(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Any 401 from a data route drops the session and returns to the login page.
  React.useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      router.replace("/login");
    });
    return () => setUnauthorizedHandler(null);
  }, [router]);

  const requestOtp = React.useCallback(async (email: string) => {
    return api.post<OtpChallenge>("/api/auth/request-otp", { email });
  }, []);

  const verifyOtp = React.useCallback(async (email: string, code: string) => {
    const session = await api.post<SessionResponse>("/api/auth/verify-otp", {
      email,
      code,
    });
    setAuthToken(session.access_token);
    setUser(session.user);
    return session.user;
  }, []);

  const logout = React.useCallback(async () => {
    try {
      await api.post("/api/auth/logout", {});
    } catch {
      /* the local session is cleared regardless of what the server says */
    }
    setAuthToken(null);
    setUser(null);
    router.replace("/login");
  }, [router]);

  const value = React.useMemo<AuthState>(
    () => ({ user, loading, requestOtp, verifyOtp, logout }),
    [user, loading, requestOtp, verifyOtp, logout],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAuth(): AuthState {
  const ctx = React.useContext(Context);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

/**
 * Route guard.
 *
 * Renders nothing until the session has been resolved, so a protected screen
 * never flashes before the redirect.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  React.useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="label animate-pulse">
          {loading ? "Restoring session" : "Redirecting to sign in"}
        </span>
      </div>
    );
  }

  return <>{children}</>;
}
