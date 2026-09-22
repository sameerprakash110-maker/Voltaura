"use client";

import * as React from "react";

import type { Health, RangeDays, ResourceFilter } from "@/lib/types";
import { api } from "@/lib/api";

/**
 * Cross-page app state.
 *
 * The date range and resource filter follow the user between screens, because
 * an analyst who narrowed to "water, last 7 days" on the dashboard expects the
 * anomaly list to agree. Both persist to localStorage so a demo survives a
 * refresh.
 */

type Theme = "dark" | "light";

interface AppState {
  range: RangeDays;
  setRange: (range: RangeDays) => void;
  resource: ResourceFilter;
  setResource: (resource: ResourceFilter) => void;
  theme: Theme;
  toggleTheme: () => void;
  health: Health | null;
  healthError: boolean;
  refreshHealth: () => Promise<void>;
  demoMode: boolean;
  setDemoMode: (on: boolean) => void;
}

const Context = React.createContext<AppState | null>(null);

const STORAGE_KEY = "voltaura.prefs.v1";

interface StoredPrefs {
  range?: RangeDays;
  resource?: ResourceFilter;
  theme?: Theme;
  demoMode?: boolean;
}

function readPrefs(): StoredPrefs {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [range, setRangeState] = React.useState<RangeDays>(30);
  const [resource, setResourceState] = React.useState<ResourceFilter>("ALL");
  const [theme, setTheme] = React.useState<Theme>("dark");
  const [demoMode, setDemoModeState] = React.useState(true);
  const [health, setHealth] = React.useState<Health | null>(null);
  const [healthError, setHealthError] = React.useState(false);

  // Hydrate from storage after mount so server and client markup match.
  React.useEffect(() => {
    const prefs = readPrefs();
    if (prefs.range) setRangeState(prefs.range);
    if (prefs.resource) setResourceState(prefs.resource);
    if (prefs.theme) setTheme(prefs.theme);
    if (typeof prefs.demoMode === "boolean") setDemoModeState(prefs.demoMode);
  }, []);

  const persist = React.useCallback((patch: StoredPrefs) => {
    if (typeof window === "undefined") return;
    try {
      const next = { ...readPrefs(), ...patch };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* private browsing: preferences simply do not persist */
    }
  }, []);

  React.useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const refreshHealth = React.useCallback(async () => {
    try {
      const data = await api.get<Health>("/api/health");
      setHealth(data);
      setHealthError(false);
    } catch {
      setHealth(null);
      setHealthError(true);
    }
  }, []);

  React.useEffect(() => {
    void refreshHealth();
    const timer = setInterval(() => void refreshHealth(), 30_000);
    return () => clearInterval(timer);
  }, [refreshHealth]);

  const value = React.useMemo<AppState>(
    () => ({
      range,
      setRange: (next) => {
        setRangeState(next);
        persist({ range: next });
      },
      resource,
      setResource: (next) => {
        setResourceState(next);
        persist({ resource: next });
      },
      theme,
      toggleTheme: () => {
        const next: Theme = theme === "dark" ? "light" : "dark";
        setTheme(next);
        persist({ theme: next });
      },
      health,
      healthError,
      refreshHealth,
      demoMode,
      setDemoMode: (on) => {
        setDemoModeState(on);
        persist({ demoMode: on });
      },
    }),
    [range, resource, theme, health, healthError, refreshHealth, demoMode, persist],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAppState(): AppState {
  const ctx = React.useContext(Context);
  if (!ctx) {
    throw new Error("useAppState must be used inside AppStateProvider");
  }
  return ctx;
}
