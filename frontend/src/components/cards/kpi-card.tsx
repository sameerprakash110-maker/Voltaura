"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import * as React from "react";

import { InfoHint } from "@/components/ui/primitives";
import { compact, num } from "@/lib/format";
import type { Kpi } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * KPI tile.
 *
 * The change indicator is coloured by whether the movement is *good*, not by
 * its sign: energy falling 4% is green, anomalies rising 50% is red. Getting
 * this backwards is the most common way a sustainability dashboard misleads
 * the person reading it.
 */
export function KpiCard({ kpi, index = 0 }: { kpi: Kpi; index?: number }) {
  const { change_pct, good_direction, direction } = kpi;

  const isGood =
    change_pct === null || Math.abs(change_pct) < 0.05
      ? null
      : good_direction === "down"
        ? change_pct < 0
        : change_pct > 0;

  const Arrow =
    direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : Minus;

  return (
    <div
      className="panel group relative overflow-hidden p-5 transition-colors duration-200 hover:border-[rgb(var(--line)/0.16)] animate-fade-up"
      style={{ animationDelay: `${index * 45}ms` }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="eyebrow">{kpi.label}</div>
        {kpi.caption ? <InfoHint text={kpi.caption} /> : null}
      </div>

      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="num text-[28px] font-semibold leading-none tracking-tight text-ink">
          {Math.abs(kpi.value) >= 10000 ? compact(kpi.value, 1) : num(kpi.value, kpi.value % 1 === 0 ? 0 : 1)}
        </span>
        <span className="text-[12px] font-medium text-ink-muted">{kpi.unit}</span>
      </div>

      <div className="mt-3 flex items-center gap-2">
        {change_pct !== null ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
              isGood === null
                ? "bg-[rgb(var(--line)/0.07)] text-ink-muted"
                : isGood
                  ? "bg-mint/10 text-mint"
                  : "bg-critical/10 text-critical",
            )}
          >
            <Arrow className="size-3" />
            {Math.abs(change_pct).toFixed(1)}%
          </span>
        ) : null}
        <span className="truncate text-[11px] text-ink-muted">
          {change_pct !== null ? "vs previous period" : kpi.caption}
        </span>
      </div>

      {/* measured/estimated is a first-class distinction in this product */}
      <div className="pointer-events-none absolute right-4 top-4 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <span className="rounded border border-[rgb(var(--line)/0.12)] bg-surface px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-ink-muted">
          {kpi.measured ? "Measured" : "Estimated"}
        </span>
      </div>
    </div>
  );
}
