"use client";

import Link from "next/link";
import * as React from "react";

import { Delta, Metric } from "@/components/ui/structure";
import { compact, num } from "@/lib/format";
import type { Kpi } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Campus-level readouts.
 *
 * The five KPIs the API returns are not five equal facts, so they are not
 * rendered as five equal tiles. Consumption is what the campus *is*, and it
 * gets the display sizes; anomalies, verified savings and avoided carbon are
 * what the product *did*, and they sit underneath at supporting weight.
 *
 * Every figure here comes from /api/dashboard untouched -- this file chooses
 * type size and position, nothing else.
 */

/**
 * Value formatting, kept byte-identical to what the product shipped before the
 * redesign so no number on screen changes: collapse to k/M past ten thousand,
 * otherwise one decimal only when the value actually has one.
 */
export function kpiValue(kpi: Kpi): string {
  return Math.abs(kpi.value) >= 10000
    ? compact(kpi.value, 1)
    : num(kpi.value, kpi.value % 1 === 0 ? 0 : 1);
}

function byKey(kpis: Kpi[], key: string): Kpi | undefined {
  return kpis.find((kpi) => kpi.key === key);
}

// --------------------------------------------------------------------------
// Primary: metered consumption
// --------------------------------------------------------------------------
export function ResourceSummary({
  kpis,
  className,
}: {
  kpis: Kpi[];
  className?: string;
}) {
  const energy = byKey(kpis, "energy");
  const water = byKey(kpis, "water");
  const primary = [energy, water].filter(Boolean) as Kpi[];
  const secondary = kpis.filter((kpi) => !["energy", "water"].includes(kpi.key));

  return (
    <div className={cn("grid gap-x-10 gap-y-7 xl:grid-cols-[minmax(0,420px)_1fr]", className)}>
      {/* the two metered totals, at display size */}
      <div className="grid grid-cols-2 divide-x divide-[rgb(var(--line)/0.08)]">
        {primary.map((kpi, index) => (
          <div key={kpi.key} className={index === 0 ? "pr-6" : "pl-6"}>
            <Metric
              size="hero"
              label={kpi.key === "energy" ? "Energy" : "Water"}
              value={kpiValue(kpi)}
              unit={kpi.unit}
              tone={kpi.key === "energy" ? "ink" : "ink"}
              delta={
                <Delta value={kpi.change_pct} goodDirection={kpi.good_direction} />
              }
              caption={kpi.change_pct !== null ? "vs previous period" : undefined}
            />
          </div>
        ))}
      </div>

      {/* what the loop produced from it */}
      <div className="grid grid-cols-3 divide-x divide-[rgb(var(--line)/0.08)]">
        {secondary.map((kpi, index) => (
          <div key={kpi.key} className={index === 0 ? "pr-5" : "px-5 last:pr-0"}>
            <Metric
              size="lg"
              label={kpi.label}
              value={kpiValue(kpi)}
              unit={kpi.unit}
              tone={
                kpi.key === "anomalies"
                  ? kpi.value > 0
                    ? "high"
                    : "muted"
                  : "mint"
              }
              delta={
                kpi.change_pct !== null ? (
                  <Delta value={kpi.change_pct} goodDirection={kpi.good_direction} />
                ) : undefined
              }
              caption={kpi.caption}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// The one-line state of the campus
// --------------------------------------------------------------------------
export function CampusHeadline({
  openAnomalies,
  verifiedInterventions,
  verifiedSavings,
  className,
}: {
  openAnomalies: number;
  verifiedInterventions: number;
  verifiedSavings: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px]",
        className,
      )}
    >
      <HeadlineFact
        href="/anomalies"
        value={num(openAnomalies)}
        label={openAnomalies === 1 ? "active anomaly" : "active anomalies"}
        tone={openAnomalies > 0 ? "text-high" : "text-ink-soft"}
      />
      <span className="h-3 w-px bg-[rgb(var(--line)/0.12)]" />
      <HeadlineFact
        href="/interventions"
        value={num(verifiedInterventions)}
        label={
          verifiedInterventions === 1
            ? "verified intervention"
            : "verified interventions"
        }
        tone="text-mint"
      />
      <span className="h-3 w-px bg-[rgb(var(--line)/0.12)]" />
      <HeadlineFact
        href="/verification"
        value={verifiedSavings}
        label="verified savings"
        tone="text-mint"
      />
    </div>
  );
}

function HeadlineFact({
  href,
  value,
  label,
  tone,
}: {
  href: string;
  value: string;
  label: string;
  tone: string;
}) {
  return (
    <Link href={href} className="group flex items-baseline gap-1.5">
      <span className={cn("num text-[15px] font-semibold", tone)}>{value}</span>
      <span className="text-[11px] uppercase tracking-[0.09em] text-ink-muted transition-colors group-hover:text-ink-soft">
        {label}
      </span>
    </Link>
  );
}
