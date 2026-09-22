"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/primitives";
import { StatusText } from "@/components/ui/structure";
import { compact, num } from "@/lib/format";
import type { Recommendation } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Recommendations, presented as decisions.
 *
 * Each row answers four questions in a fixed order -- what, why, what it is
 * worth, and what to do about it -- so a reader comparing two measures is
 * always comparing the same fields in the same place. The estimate marker is
 * deliberately conspicuous: nothing here is verified yet, and the product's
 * whole argument rests on that distinction being visible.
 */

export function RecommendationList({
  recommendations,
  currencySymbol = "₹",
  onApply,
  applyingId,
  showBuilding = true,
  className,
}: {
  recommendations: Recommendation[];
  currencySymbol?: string;
  onApply?: (rec: Recommendation) => void;
  applyingId?: number | null;
  showBuilding?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("divide-y divide-[rgb(var(--line)/0.08)]", className)}>
      {recommendations.map((recommendation) => (
        <RecommendationItem
          key={recommendation.id}
          recommendation={recommendation}
          currencySymbol={currencySymbol}
          onApply={onApply}
          applying={applyingId === recommendation.id}
          showBuilding={showBuilding}
        />
      ))}
    </div>
  );
}

export function RecommendationItem({
  recommendation,
  currencySymbol = "₹",
  onApply,
  applying = false,
  showBuilding = true,
}: {
  recommendation: Recommendation;
  currencySymbol?: string;
  onApply?: (rec: Recommendation) => void;
  applying?: boolean;
  showBuilding?: boolean;
}) {
  const applied = recommendation.status === "APPLIED";
  const dismissed = recommendation.status === "DISMISSED";
  const isWater = recommendation.resource_type === "WATER";

  return (
    <article className="grid gap-x-8 gap-y-5 py-6 first:pt-0 lg:grid-cols-[164px_minmax(0,1fr)_212px]">
      {/* ---- who and how urgent ---- */}
      <div>
        <div className="label mb-2">Recommendation</div>
        {showBuilding ? (
          <div className="text-[13px] font-semibold tracking-[-0.01em] text-ink">
            {recommendation.building_name}
          </div>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <StatusText status={recommendation.priority} />
          <span
            className={cn(
              "text-[10.5px] font-medium uppercase tracking-[0.09em]",
              isWater ? "text-aqua" : "text-mint",
            )}
          >
            {recommendation.resource_type}
          </span>
        </div>
        <div className="mt-2 text-[10.5px] text-ink-faint">
          {recommendation.implementation_difficulty.toLowerCase()} effort
        </div>
      </div>

      {/* ---- what and why ---- */}
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold leading-snug tracking-[-0.015em] text-ink">
          {recommendation.title}
        </h3>

        <div className="mt-4">
          <div className="label mb-1.5">Why</div>
          <p className="max-w-prose text-[12.5px] leading-relaxed text-ink-soft">
            {recommendation.reason}
          </p>
        </div>

        <div className="mt-4">
          <div className="label mb-1.5">Implementation</div>
          <p className="max-w-prose text-[12.5px] leading-relaxed text-ink-muted">
            {recommendation.implementation}
          </p>
        </div>

        {recommendation.payback_note ? (
          <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
            {recommendation.payback_note}
          </p>
        ) : null}
      </div>

      {/* ---- what it is worth, and the action ---- */}
      <div className="flex flex-col gap-4">
        <div>
          <div className="label mb-2">Expected impact</div>
          <div className="num text-[22px] font-semibold leading-none text-ink">
            {compact(recommendation.expected_saving_per_week, 1)}
            <span className="ml-1 text-[11px] font-medium text-ink-muted">
              {recommendation.expected_saving_unit}/wk
            </span>
          </div>
          <dl className="mt-3 space-y-1.5">
            <ImpactRow
              label="Cost"
              value={`${currencySymbol}${compact(
                recommendation.estimated_cost_saving_per_week,
                1,
              )}/wk`}
            />
            <ImpactRow
              label="CO₂"
              value={`${compact(recommendation.estimated_co2_reduction_per_week, 1)} kg/wk`}
            />
            <ImpactRow label="Priority score" value={num(recommendation.priority_score, 1)} />
          </dl>
          <p className="mt-3 flex items-start gap-1.5 text-[10.5px] leading-relaxed text-ink-faint">
            <span className="mt-[1px] shrink-0 border border-medium/35 px-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-medium">
              Est
            </span>
            Projected from measured excess. Verified only after monitoring.
          </p>
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-3">
          {applied ? (
            recommendation.intervention_id ? (
              <Button variant="secondary" size="sm" asChild>
                <Link href={`/interventions#i${recommendation.intervention_id}`}>
                  Track intervention <ArrowRight />
                </Link>
              </Button>
            ) : (
              <StatusText status="APPLIED" />
            )
          ) : dismissed ? (
            <StatusText status="DISMISSED" />
          ) : (
            <Button
              variant="primary"
              size="sm"
              loading={applying}
              onClick={() => onApply?.(recommendation)}
            >
              Review intervention <ArrowRight />
            </Button>
          )}

          {recommendation.anomaly_id ? (
            <Link
              href={`/anomalies/${recommendation.anomaly_id}`}
              className="text-[11px] text-ink-muted underline-offset-2 transition-colors hover:text-ink-soft hover:underline"
            >
              Evidence
            </Link>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function ImpactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[11px] text-ink-muted">{label}</dt>
      <dd className="num text-[11.5px] text-ink-soft">{value}</dd>
    </div>
  );
}
