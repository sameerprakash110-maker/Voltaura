"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, api } from "./api";

interface State<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
}

/**
 * Minimal data hook: fetch on mount, refetch on demand, cancel on unmount.
 *
 * `refetch({ quiet: true })` re-fetches without flipping back to the loading
 * skeleton, which keeps the screen stable after a mutation instead of making
 * the whole page flash.
 */
export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [state, setState] = useState<State<T>>({
    data: null,
    error: null,
    loading: path !== null,
  });
  const alive = useRef(true);
  const requestId = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const run = useCallback(
    async (options?: { quiet?: boolean }) => {
      if (!path) {
        setState({ data: null, error: null, loading: false });
        return null;
      }
      const id = ++requestId.current;
      if (!options?.quiet) {
        setState((prev) => ({ ...prev, loading: true, error: null }));
      }
      try {
        const data = await api.getCached<T>(path);
        // Ignore a response that a newer request has already superseded.
        if (!alive.current || id !== requestId.current) return data;
        setState({ data, error: null, loading: false });
        return data;
      } catch (error) {
        if (!alive.current || id !== requestId.current) return null;
        setState((prev) => ({
          data: prev.data,
          error:
            error instanceof ApiError
              ? error
              : new ApiError(String(error), { status: 0, path: path ?? "" }),
          loading: false,
        }));
        return null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path, ...deps],
  );

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  return { ...state, refetch: run };
}

/** Imperative mutation helper with pending + error state for buttons. */
export function useMutation<TResult, TInput = void>(
  fn: (input: TInput) => Promise<TResult>,
) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const mutate = useCallback(
    async (input: TInput): Promise<TResult | null> => {
      setPending(true);
      setError(null);
      try {
        return await fn(input);
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err
            : new ApiError(String(err), { status: 0, path: "" }),
        );
        return null;
      } finally {
        setPending(false);
      }
    },
    [fn],
  );

  return { mutate, pending, error, reset: () => setError(null) };
}
