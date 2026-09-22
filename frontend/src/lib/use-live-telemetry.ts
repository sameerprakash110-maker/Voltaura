"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, api } from "./api";
import type { AggregatedReadingItem, RawTelemetryItem } from "./types";

interface LiveTelemetryState {
  latest: RawTelemetryItem | null;
  history: RawTelemetryItem[];
  aggregates: AggregatedReadingItem[];
  loading: boolean;
  refreshing: boolean;
  error: ApiError | null;
  isWaiting: boolean;
  lastPolledAt: Date | null;
}

const DEFAULT_POLL_INTERVAL_MS = 10_000;

/**
 * High-frequency live telemetry polling hook (10s cadence).
 *
 * Guarantees:
 *   - Auto-cleanup on unmount with no interval leaks.
 *   - Deduplicated in-flight requests.
 *   - Soft background refetch without flickering or reloading.
 *   - Clean distinction between 404 (waiting for hardware) and true API errors.
 *   - Strict preservation of null vs zero metrics.
 */
export function useLiveTelemetry(
  buildingId: number | null,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
) {
  const [state, setState] = useState<LiveTelemetryState>({
    latest: null,
    history: [],
    aggregates: [],
    loading: buildingId !== null,
    refreshing: false,
    error: null,
    isWaiting: false,
    lastPolledAt: null,
  });

  const alive = useRef(true);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const fetchTelemetry = useCallback(
    async (options?: { isInitial?: boolean }) => {
      if (!buildingId) {
        if (alive.current) {
          setState({
            latest: null,
            history: [],
            aggregates: [],
            loading: false,
            refreshing: false,
            error: null,
            isWaiting: true,
            lastPolledAt: null,
          });
        }
        return;
      }

      if (inFlightRef.current) return;
      inFlightRef.current = true;

      if (options?.isInitial) {
        setState((prev) => ({ ...prev, loading: true, error: null }));
      } else {
        setState((prev) => ({ ...prev, refreshing: true }));
      }

      try {
        // Direct un-cached GET requests to ensure 10s live updates
        const [latestRes, historyRes, aggRes] = await Promise.allSettled([
          api.get<RawTelemetryItem>(`/api/telemetry/latest?building_id=${buildingId}`),
          api.get<RawTelemetryItem[]>(`/api/telemetry/history?building_id=${buildingId}&limit=30`),
          api.get<AggregatedReadingItem[]>(`/api/telemetry/aggregates?building_id=${buildingId}&limit=24`),
        ]);

        if (!alive.current) return;

        let latest: RawTelemetryItem | null = null;
        let isWaiting = false;
        let apiError: ApiError | null = null;

        if (latestRes.status === "fulfilled") {
          latest = latestRes.value;
        } else {
          const err = latestRes.reason;
          if (err instanceof ApiError && err.status === 404) {
            // 404 means no telemetry found for this building yet (Waiting state)
            isWaiting = true;
            latest = null;
          } else {
            apiError =
              err instanceof ApiError
                ? err
                : new ApiError(String(err), { status: 0, path: "/api/telemetry/latest" });
          }
        }

        const history: RawTelemetryItem[] =
          historyRes.status === "fulfilled" && Array.isArray(historyRes.value)
            ? historyRes.value
            : [];

        const aggregates: AggregatedReadingItem[] =
          aggRes.status === "fulfilled" && Array.isArray(aggRes.value)
            ? aggRes.value
            : [];

        setState({
          latest,
          history,
          aggregates,
          loading: false,
          refreshing: false,
          error: apiError,
          isWaiting,
          lastPolledAt: new Date(),
        });
      } catch (err) {
        if (!alive.current) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          refreshing: false,
          error:
            err instanceof ApiError
              ? err
              : new ApiError(String(err), { status: 0, path: "/api/telemetry" }),
        }));
      } finally {
        inFlightRef.current = false;
      }
    },
    [buildingId],
  );

  // Initial fetch and polling loop setup
  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (!buildingId) {
      setState({
        latest: null,
        history: [],
        aggregates: [],
        loading: false,
        refreshing: false,
        error: null,
        isWaiting: true,
        lastPolledAt: null,
      });
      return;
    }

    // Initial fetch
    void fetchTelemetry({ isInitial: true });

    // Periodic 10-second polling
    timerRef.current = setInterval(() => {
      void fetchTelemetry({ isInitial: false });
    }, pollIntervalMs);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [buildingId, pollIntervalMs, fetchTelemetry]);

  return {
    ...state,
    refetch: () => fetchTelemetry({ isInitial: false }),
  };
}
