"use client";

import Link from "next/link";
import * as React from "react";

import { num } from "@/lib/format";
import type { PipelineStage } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The operational pipeline, rendered as a rail.
 *
 * This is the recurring motif of the whole interface. It exists because the
 * single hardest thing to communicate in thirty seconds is that VOLTAURA does
 * not stop at detection: it carries a finding all the way to a verified
 * saving. Showing the live count at each stage makes that claim checkable
 * rather than rhetorical.
 *
 * Drawn as nodes on a continuous line rather than as a row of cards, because
 * the point being made is about sequence, not about five separate facts.
 */

const STAGE_META: Record<string, { href: string; tone: string; ring: string }> = {
  data: { href: "/buildings", tone: "bg-ink-faint", ring: "border-ink-faint/50" },
  monitor: { href: "/digital-twin", tone: "bg-ink-faint", ring: "border-ink-faint/50" },
  detect: { href: "/anomalies", tone: "bg-high", ring: "border-high/60" },
  diagnose: { href: "/anomalies", tone: "bg-iris", ring: "border-iris/60" },
  recommend: { href: "/recommendations", tone: "bg-aqua", ring: "border-aqua/60" },
  intervene: { href: "/interventions", tone: "bg-aqua", ring: "border-aqua/60" },
  verify: { href: "/verification", tone: "bg-mint", ring: "border-mint/60" },
};

function meta(key: string) {
  return (
    STAGE_META[key] ?? {
      href: "/dashboard",
      tone: "bg-ink-faint",
      ring: "border-ink-faint/50",
    }
  );
}

export function PipelineRail({
  stages,
  active,
  className,
}: {
  stages: PipelineStage[];
  active?: string;
  className?: string;
}) {
  return (
    <ol
      className={cn(
        "flex min-w-max items-start gap-0 overflow-x-auto pb-1",
        className,
      )}
    >
      {stages.map((stage, index) => {
        const m = meta(stage.key);
        const isActive = active === stage.key;
        const isLast = index === stages.length - 1;

        return (
          <li key={stage.key} className="min-w-[124px] flex-1 shrink-0">
            <Link href={m.href} className="group block pr-5">
              {/* node + connector */}
              <div className="relative flex h-2.5 items-center" aria-hidden>
                <span
                  className={cn(
                    "relative z-10 size-2 shrink-0 rounded-full border transition-colors",
                    isActive || stage.value > 0
                      ? cn(m.tone, "border-transparent")
                      : cn("bg-canvas", m.ring),
                  )}
                />
                {!isLast ? (
                  <span className="h-px flex-1 bg-[rgb(var(--line)/0.12)]" />
                ) : null}
              </div>

              <div
                className={cn(
                  "label mt-2.5 transition-colors",
                  isActive ? "text-ink-soft" : "group-hover:text-ink-soft",
                )}
              >
                {stage.label}
              </div>
              <div
                className={cn(
                  "num mt-1.5 text-[20px] font-semibold leading-none transition-colors",
                  stage.value > 0 ? "text-ink" : "text-ink-faint",
                )}
              >
                {num(stage.value)}
              </div>
              <div className="mt-1.5 max-w-[118px] text-[10.5px] leading-[1.35] text-ink-muted">
                {stage.caption}
              </div>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

/** Static version for the landing page, where there is no live data yet. */
export const STATIC_LOOP = [
  { key: "data", label: "Data", caption: "Smart-meter telemetry" },
  { key: "monitor", label: "Monitor", caption: "Continuous baseline" },
  { key: "detect", label: "Detect", caption: "Two agreeing tests" },
  { key: "diagnose", label: "Diagnose", caption: "Evidence-based cause" },
  { key: "recommend", label: "Recommend", caption: "Costed measure" },
  { key: "intervene", label: "Intervene", caption: "Applied on site" },
  { key: "verify", label: "Verify", caption: "Measured saving" },
];

export function StaticPipeline({ className }: { className?: string }) {
  return (
    <ol className={cn("flex min-w-max items-start", className)}>
      {STATIC_LOOP.map((stage, index) => {
        const m = meta(stage.key);
        const isLast = index === STATIC_LOOP.length - 1;
        return (
          <li key={stage.key} className="min-w-[118px] flex-1 pr-5">
            <div className="relative flex h-2.5 items-center" aria-hidden>
              <span
                className={cn(
                  "relative z-10 size-2 shrink-0 rounded-full border bg-canvas",
                  m.ring,
                )}
              />
              {!isLast ? (
                <span className="h-px flex-1 bg-[rgb(var(--line)/0.12)]" />
              ) : null}
            </div>
            <div className="label mt-2.5 text-ink-soft">{stage.label}</div>
            <div className="mt-1.5 max-w-[112px] text-[10.5px] leading-[1.35] text-ink-muted">
              {stage.caption}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
