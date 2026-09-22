"use client";

import {
  BadgeCheck,
  Boxes,
  Building2,
  FileBarChart,
  LayoutGrid,
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
import { Button, Segmented, StatusDot } from "@/components/ui/primitives";
import { useAppState } from "@/components/providers/app-state";
import { telemetryStamp } from "@/lib/format";
import type { RangeDays, ResourceFilter } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Command-centre shell.
 *
 * Navigation is grouped by what the operator is doing, not by what the code is
 * organised into: COMMAND is the live picture, INTELLIGENCE is the analytical
 * loop that turns a deviation into a verified saving, OUTPUT is what leaves the
 * building. The active item is marked with an accent rule against the sidebar
 * edge rather than a pill, so the list stays a list.
 */

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_GROUPS: { group: string; items: NavItem[] }[] = [
  {
    group: "Command",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutGrid },
      { href: "/digital-twin", label: "Digital Twin", icon: Boxes },
      { href: "/buildings", label: "Buildings", icon: Building2 },
    ],
  },
  {
    group: "Intelligence",
    items: [
      { href: "/anomalies", label: "Anomalies", icon: Radar },
      { href: "/recommendations", label: "Recommendations", icon: Lightbulb },
      { href: "/interventions", label: "Interventions", icon: Wrench },
      { href: "/verification", label: "Verification", icon: BadgeCheck },
    ],
  },
  {
    group: "Output",
    items: [{ href: "/reports", label: "Reports", icon: FileBarChart }],
  },
  {
    group: "System",
    items: [{ href: "/settings", label: "Settings", icon: Settings2 }],
  },
];

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
    <div className="relative min-h-screen">
      {/* ---- sidebar ------------------------------------------------ */}
      <aside
        data-chrome
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[226px] flex-col border-r border-[rgb(var(--line)/0.08)] bg-canvas transition-transform duration-200 lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-12 items-center justify-between border-b border-[rgb(var(--line)/0.08)] pl-4 pr-3">
          <Link href="/" className="flex items-center gap-2.5">
            <VOLTAURAMark className="size-[22px]" />
            <div className="leading-none">
              <div className="text-[14px] font-semibold tracking-[-0.01em] text-ink">
                VOLTAURA
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

        <nav className="flex-1 overflow-y-auto py-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.group} className="mb-5 last:mb-0">
              <div className="label mb-1.5 px-4">{group.group}</div>
              <ul>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active =
                    pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "relative flex h-[30px] items-center gap-2.5 pl-4 pr-3 text-[12.5px] transition-colors duration-150",
                          active
                            ? "bg-[rgb(var(--line)/0.045)] font-medium text-ink"
                            : "text-ink-muted hover:bg-[rgb(var(--line)/0.025)] hover:text-ink-soft",
                        )}
                      >
                        {active ? (
                          <span className="absolute inset-y-0 left-0 w-[2px] bg-mint" />
                        ) : null}
                        <Icon
                          className={cn(
                            "size-[14px] shrink-0",
                            active ? "text-mint" : "text-ink-faint",
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

        <SystemStatus />
      </aside>

      {mobileOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      {/* ---- main --------------------------------------------------- */}
      <div className="relative z-10 lg:pl-[226px] print:pl-0">
        <TopBar onMenu={() => setMobileOpen(true)} />
        <main className="mx-auto w-full max-w-[1600px] px-5 pb-16 pt-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
function TopBar({ onMenu }: { onMenu: () => void }) {
  const { range, setRange, resource, setResource, theme, toggleTheme, health, healthError } =
    useAppState();

  return (
    <header
      data-chrome
      className="sticky top-0 z-30 border-b border-[rgb(var(--line)/0.08)] bg-canvas/92 backdrop-blur-md"
    >
      <div className="mx-auto flex h-12 w-full max-w-[1600px] items-center gap-4 px-5 sm:px-6 lg:px-8">
        <button
          onClick={onMenu}
          className="text-ink-soft hover:text-ink lg:hidden"
          aria-label="Open navigation"
        >
          <Menu className="size-[18px]" />
        </button>

        {/* System clock: reads as instrumentation, not as a page subtitle. */}
        <div className="hidden min-w-0 items-center gap-2.5 md:flex">
          <StatusDot
            tone={healthError ? "critical" : "mint"}
            pulse={!healthError}
          />
          <span className="label">Telemetry</span>
          <span className="num text-[11.5px] text-ink-soft">
            {health?.data_end ? telemetryStamp(health.data_end) : "— — —"}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2.5">
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
          <span className="hidden h-4 w-px bg-[rgb(var(--line)/0.12)] sm:block" />
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

// --------------------------------------------------------------------------
function SystemStatus() {
  const { health, healthError } = useAppState();

  const tone = healthError ? "critical" : health?.seeded ? "mint" : "medium";
  const label = healthError
    ? "API offline"
    : health?.seeded
      ? "API connected"
      : "Database empty";

  return (
    <div className="border-t border-[rgb(var(--line)/0.08)] px-4 py-3.5">
      <div className="flex items-center gap-2">
        <StatusDot tone={tone} pulse={!healthError} />
        <span className="text-[11.5px] font-medium text-ink-soft">{label}</span>
      </div>

      {health?.seeded ? (
        <dl className="mt-2.5 space-y-1">
          <StatusRow
            label="Intervals"
            value={(health.energy_readings + health.water_readings).toLocaleString()}
          />
          <StatusRow label="Buildings" value={String(health.buildings)} />
          <StatusRow
            label="Narratives"
            value={health.llm_enabled ? "LLM" : "Rules"}
          />
        </dl>
      ) : (
        <p className="mt-2 font-mono text-[10px] leading-relaxed text-ink-muted">
          {healthError
            ? "uvicorn app.main:app --app-dir backend"
            : "python scripts/seed.py"}
        </p>
      )}

      <p className="mt-3.5 border-t border-[rgb(var(--line)/0.07)] pt-3 text-[9px] uppercase leading-[1.5] tracking-[0.13em] text-ink-faint">
        Detect. Understand.
        <br />
        Act. Verify.
      </p>
    </div>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[10.5px] text-ink-faint">{label}</dt>
      <dd className="num text-[10.5px] text-ink-muted">{value}</dd>
    </div>
  );
}
