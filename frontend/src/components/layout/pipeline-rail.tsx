"use client";

import {
  Activity,
  BadgeCheck,
  Database,
  Lightbulb,
  Radar,
  Stethoscope,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { cn } from "@/lib/utils";
import { num } from "@/lib/format";
import type { PipelineStage } from "@/lib/types";

/**
 * The product loop, rendered as data.
 *
 * This rail is the recurring motif of the whole interface. It exists because
 * the single hardest thing to communicate in thirty seconds is that VOLTAURA
 * does not stop at detection: it carries a finding all the way to a verified
 * saving. Showing the live count at each stage makes that claim checkable
 * rather than rhetorical.
 */

const STAGE_META: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; href: string; tone: string }
> = {
  data: { icon: Database, href: "/buildings", tone: "text-ink-soft" },
  monitor: { icon: Activity, href: "/digital-twin", tone: "text-ink-soft" },
  detect: { icon: Radar, href: "/anomalies", tone: "text-high" },
  diagnose: { icon: Stethoscope, href: "/anomalies", tone: "text-iris" },
  recommend: { icon: Lightbulb, href: "/recommendations", tone: "text-aqua" },
  intervene: { icon: Wrench, href: "/interventions", tone: "text-aqua" },
  verify: { icon: BadgeCheck, href: "/verification", tone: "text-mint" },
};

export function PipelineRail({
  stages,
  active,
  compact = false,
  className,
}: {
  stages: PipelineStage[];
  active?: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-x-auto",
        compact ? "" : "panel px-4 py-4",
        className,
      )}
    >
      <ol className="flex min-w-max items-stretch gap-0.5">
        {stages.map((stage, index) => {
          const meta = STAGE_META[stage.key] ?? {
            icon: Activity,
            href: "/dashboard",
            tone: "text-ink-soft",
          };
          const Icon = meta.icon;
          const isActive = active === stage.key;
          const isLast = index === stages.length - 1;

          return (
            <li key={stage.key} className="flex items-stretch">
              <Link
                href={meta.href}
                className={cn(
                  "group flex flex-col justify-start rounded-lg px-2.5 py-2 transition-colors duration-150",
                  isActive
                    ? "bg-[rgb(var(--line)/0.07)]"
                    : "hover:bg-[rgb(var(--line)/0.045)]",
                )}
              >
                <div className="flex items-center gap-1.5">
                  <Icon
                    className={cn(
                      "size-3.5 shrink-0 transition-colors",
                      isActive ? meta.tone : "text-ink-muted",
                    )}
                  />
                  <span
                    className={cn(
                      "text-2xs font-medium uppercase tracking-[0.1em]",
                      isActive ? "text-ink" : "text-ink-muted",
                    )}
                  >
                    {stage.label}
                  </span>
                </div>
                <div className="mt-1 pl-[20px]">
                  <span
                    className={cn(
                      "num text-sm font-semibold",
                      isActive ? "text-ink" : "text-ink-soft",
                    )}
                  >
                    {num(stage.value)}
                  </span>
                  {!compact ? (
                    <span className="mt-0.5 block max-w-[104px] text-[10px] leading-[1.25] text-ink-muted">
                      {stage.caption}
                    </span>
                  ) : null}
                </div>
              </Link>

              {!isLast ? (
                <div className="flex items-center px-1" aria-hidden>
                  <svg width="18" height="8" viewBox="0 0 18 8" fill="none">
                    <path
                      d="M0 4 H12"
                      stroke="rgb(var(--line) / 0.22)"
                      strokeWidth="1"
                      strokeDasharray="3 3"
                    />
                    <path
                      d="M11 1 L15 4 L11 7"
                      stroke="rgb(var(--line) / 0.3)"
                      strokeWidth="1"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Static version for the landing page, where there is no live data yet. */
export const STATIC_LOOP = [
  { key: "data", label: "Data", caption: "Smart-meter telemetry" },
  { key: "monitor", label: "Monitor", caption: "Continuous baseline" },
  { key: "detect", label: "Detect", caption: "Isolation Forest + residual" },
  { key: "diagnose", label: "Diagnose", caption: "Evidence-based rules" },
  { key: "recommend", label: "Recommend", caption: "Costed measure" },
  { key: "intervene", label: "Intervene", caption: "Applied on site" },
  { key: "verify", label: "Verify", caption: "Measured saving" },
];

export function StaticPipeline({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-1 gap-y-3", className)}>
      {STATIC_LOOP.map((stage, index) => {
        const meta = STAGE_META[stage.key];
        const Icon = meta.icon;
        const isLast = index === STATIC_LOOP.length - 1;
        return (
          <React.Fragment key={stage.key}>
            <div className="flex flex-col gap-1.5 rounded-lg border border-[rgb(var(--line)/0.1)] bg-surface/50 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <Icon className={cn("size-3.5", meta.tone)} />
                <span className="text-2xs font-medium uppercase tracking-[0.12em] text-ink">
                  {stage.label}
                </span>
              </div>
              <span className="pl-[22px] text-[10px] text-ink-muted">
                {stage.caption}
              </span>
            </div>
            {!isLast ? (
              <svg width="16" height="8" viewBox="0 0 16 8" fill="none" aria-hidden>
                <path
                  d="M0 4 H10"
                  stroke="rgb(var(--line) / 0.25)"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
                <path
                  d="M9 1.5 L12.5 4 L9 6.5"
                  stroke="rgb(var(--line) / 0.35)"
                  strokeWidth="1"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : null}
          </React.Fragment>
        );
      })}
    </div>
  );
}
