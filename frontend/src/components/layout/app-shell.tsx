"use client";

import {
  Activity,
  BadgeCheck,
  Boxes,
  FileBarChart,
  Gauge,
  Lightbulb,
  Menu,
  Moon,
  Radar,
  Settings2,
  Sun,
  Wrench,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

import { VOLTAURAMark } from "@/components/brand/mark";
import { DemoLauncher } from "@/components/demo/demo-launcher";
import { Badge, Button, Segmented, StatusDot } from "@/components/ui/primitives";
import { useAppState } from "@/components/providers/app-state";
import { dateTime } from "@/lib/format";
import type { RangeDays, ResourceFilter } from "@/lib/types";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: Gauge, group: "Overview" },
  { href: "/digital-twin", label: "Digital Twin", icon: Boxes, group: "Overview" },
  { href: "/buildings", label: "Buildings", icon: Activity, group: "Overview" },
  { href: "/anomalies", label: "Anomalies", icon: Radar, group: "Loop" },
  { href: "/recommendations", label: "Recommendations", icon: Lightbulb, group: "Loop" },
  { href: "/interventions", label: "Interventions", icon: Wrench, group: "Loop" },
  { href: "/verification", label: "Verification", icon: BadgeCheck, group: "Loop" },
  { href: "/reports", label: "Reports", icon: FileBarChart, group: "Output" },
  { href: "/settings", label: "Settings", icon: Settings2, group: "Output" },
];

const GROUPS = ["Overview", "Loop", "Output"];

const RANGE_OPTIONS: { value: RangeDays; label: string }[] = [
  { value: 7, label: "7D" },
  { value: 30, label: "30D" },
  { value: 90, label: "90D" },
];

const RESOURCE_OPTIONS: { value: ResourceFilter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "ENERGY", label: "Energy" },
  { value: "WATER", label: "Water" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  React.useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <div className="ambient relative min-h-screen">
      {/* ---- sidebar ------------------------------------------------ */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[236px] flex-col border-r border-[rgb(var(--line)/0.09)] bg-canvas/95 backdrop-blur-xl transition-transform duration-300 lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-[rgb(var(--line)/0.09)] px-5">
          <Link href="/" className="flex items-center gap-2.5">
            <VOLTAURAMark className="size-[26px]" />
            <div className="leading-none">
              <div className="font-display text-[15px] font-semibold tracking-tight text-ink">
                VOLTAURA
              </div>
              <div className="mt-0.5 text-[9px] uppercase tracking-[0.18em] text-ink-muted">
                AI-Powered Digital Twin
              </div>
            </div>
          </Link>
          <button
            onClick={() => setMobileOpen(false)}
            className="text-ink-muted hover:text-ink lg:hidden"
            aria-label="Close navigation"
          >
            <X className="size-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
          {GROUPS.map((group) => (
            <div key={group}>
              <div className="eyebrow mb-2 px-2">{group}</div>
              <ul className="space-y-0.5">
                {NAV.filter((item) => item.group === group).map((item) => {
                  const Icon = item.icon;
                  const active =
                    pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={cn(
                          "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors duration-150",
                          active
                            ? "bg-[rgb(var(--line)/0.07)] text-ink"
                            : "text-ink-muted hover:bg-[rgb(var(--line)/0.04)] hover:text-ink-soft",
                        )}
                      >
                        {active ? (
                          <span className="absolute inset-y-1.5 left-0 w-[2px] rounded-full bg-mint" />
                        ) : null}
                        <Icon
                          className={cn(
                            "size-[15px] shrink-0",
                            active ? "text-mint" : "",
                          )}
                        />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <BackendStatus />
      </aside>

      {mobileOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      {/* ---- main --------------------------------------------------- */}
      <div className="relative z-10 lg:pl-[236px]">
        <TopBar onMenu={() => setMobileOpen(true)} />
        <main className="mx-auto w-full max-w-[1560px] px-4 pb-16 pt-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { range, setRange, resource, setResource, theme, toggleTheme, health } =
    useAppState();

  return (
    <header className="sticky top-0 z-30 border-b border-[rgb(var(--line)/0.09)] bg-canvas/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-[1560px] items-center gap-3 px-4 sm:px-6 lg:px-8">
        <button
          onClick={onMenu}
          className="text-ink-soft hover:text-ink lg:hidden"
          aria-label="Open navigation"
        >
          <Menu className="size-5" />
        </button>

        <div className="hidden min-w-0 flex-1 items-center gap-2 md:flex">
          {health?.data_end ? (
            <span className="truncate text-[11px] text-ink-muted">
              Telemetry current to{" "}
              <span className="num text-ink-soft">{dateTime(health.data_end)}</span>
            </span>
          ) : null}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Segmented
            options={RESOURCE_OPTIONS}
            value={resource}
            onChange={setResource}
            size="sm"
            className="hidden sm:inline-flex"
          />
          <Segmented
            options={RANGE_OPTIONS}
            value={range}
            onChange={setRange}
            size="sm"
          />
          <DemoLauncher />
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            aria-label="Toggle colour theme"
            title={theme === "dark" ? "Switch to light" : "Switch to dark"}
          >
            {theme === "dark" ? <Sun /> : <Moon />}
          </Button>
        </div>
      </div>
    </header>
  );
}

function BackendStatus() {
  const { health, healthError } = useAppState();

  const tone = healthError
    ? "critical"
    : health?.seeded
      ? "mint"
      : "medium";
  const label = healthError
    ? "API offline"
    : health?.seeded
      ? "API connected"
      : "Database empty";

  return (
    <div className="border-t border-[rgb(var(--line)/0.09)] px-4 py-3.5">
      <div className="flex items-center gap-2">
        <StatusDot tone={tone as "mint" | "medium" | "critical"} pulse={!healthError} />
        <span className="text-[11px] font-medium text-ink-soft">{label}</span>
      </div>
      {health?.seeded ? (
        <p className="mt-1.5 text-[10px] leading-relaxed text-ink-muted">
          <span className="num">{health.energy_readings.toLocaleString()}</span> energy
          and <span className="num">{health.water_readings.toLocaleString()}</span> water
          intervals across{" "}
          <span className="num">{health.buildings}</span> buildings
        </p>
      ) : (
        <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-ink-muted">
          {healthError ? "uvicorn app.main:app --app-dir backend" : "python scripts/seed.py"}
        </p>
      )}
      {health?.llm_enabled ? (
        <Badge tone="iris" className="mt-2">
          LLM narratives on
        </Badge>
      ) : null}
    </div>
  );
}
