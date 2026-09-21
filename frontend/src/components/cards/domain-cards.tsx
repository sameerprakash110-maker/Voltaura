"use client";

import {
  ArrowRight,
  BadgeCheck,
  Clock,
  Droplets,
  Leaf,
  Wallet,
  Zap,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Badge, Button, Progress } from "@/components/ui/primitives";
import {
  CAUSE_LABELS,
  RESOURCE_TOKENS,
  SEVERITY_TOKENS,
  VERIFICATION_TOKENS,
  compact,
  date,
  dateShort,
  num,
  pct,
  relativeDays,
  signedPct,
} from "@/lib/format";
import type {
  Anomaly,
  Intervention,
  Recommendation,
  Verification,
} from "@/lib/types";
import { cn } from "@/lib/utils";

// --------------------------------------------------------------------------
// Anomaly
// --------------------------------------------------------------------------
export function AnomalyCard({
  anomaly,
  compact: isCompact = false,
}: {
  anomaly: Anomaly;
  compact?: boolean;
}) {
  const severity = SEVERITY_TOKENS[anomaly.severity];
  const resource = RESOURCE_TOKENS[anomaly.resource_type];
  const Icon = anomaly.resource_type === "WATER" ? Droplets : Zap;

  return (
    <Link
      href={`/anomalies/${anomaly.id}`}
      className="group flex items-start gap-3.5 rounded-card border border-[rgb(var(--line)/0.09)] bg-surface/50 p-4 transition-all duration-150 hover:border-[rgb(var(--line)/0.18)] hover:bg-surface"
    >
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg border",
          resource.border,
          resource.bg,
          resource.text,
        )}
      >
        <Icon className="size-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium text-ink">
            {anomaly.building_name}
          </span>
          <Badge
            tone={anomaly.severity.toLowerCase() as "low" | "medium" | "high" | "critical"}
            dot
            pulse={anomaly.severity === "CRITICAL"}
          >
            {severity.label}
          </Badge>
          {anomaly.is_persistent ? (
            <Badge tone="neutral">Persistent</Badge>
          ) : null}
        </div>

        <p className="mt-1 text-[12px] leading-relaxed text-ink-soft">
          {anomaly.probable_cause ?? "Awaiting diagnosis"}
          {anomaly.confidence ? (
            <span className="text-ink-muted">
              {" "}
              &middot; {pct(anomaly.confidence * 100, 0)} confidence
            </span>
          ) : null}
        </p>

        {!isCompact ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-muted">
            <span className="num">
              {num(anomaly.actual_value, 1)} vs {num(anomaly.expected_value, 1)}{" "}
              {anomaly.unit} expected
            </span>
            <span className="num">
              {num(anomaly.flagged_intervals)} intervals over{" "}
              {num(anomaly.occurrence_days)} days
            </span>
          </div>
        ) : null}
      </div>

      <div className="shrink-0 text-right">
        <div className={cn("num text-[15px] font-semibold", severity.text)}>
          {signedPct(anomaly.deviation_pct, 0)}
        </div>
        <div className="num mt-0.5 text-[10px] text-ink-muted">
          +{compact(anomaly.excess_total, 1)} {anomaly.unit}
        </div>
      </div>

      <ArrowRight className="mt-1 size-3.5 shrink-0 text-ink-muted transition-all duration-150 group-hover:translate-x-0.5 group-hover:text-ink-soft" />
    </Link>
  );
}

// --------------------------------------------------------------------------
// Recommendation
// --------------------------------------------------------------------------
export function RecommendationCard({
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
  const resource = RESOURCE_TOKENS[recommendation.resource_type];
  const applied = recommendation.status === "APPLIED";
  const dismissed = recommendation.status === "DISMISSED";

  const difficultyTone =
    recommendation.implementation_difficulty === "LOW"
      ? "mint"
      : recommendation.implementation_difficulty === "HIGH"
        ? "critical"
        : "medium";

  return (
    <div className="panel flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              tone={
                recommendation.priority.toLowerCase() as
                  | "low"
                  | "medium"
                  | "high"
                  | "critical"
              }
            >
              {recommendation.priority} priority
            </Badge>
            <Badge tone={recommendation.resource_type === "WATER" ? "aqua" : "mint"}>
              {resource.label}
            </Badge>
            <Badge tone={difficultyTone as "mint" | "medium" | "critical"}>
              {recommendation.implementation_difficulty} effort
            </Badge>
            {applied ? (
              <Badge tone="aqua" dot>
                Applied
              </Badge>
            ) : null}
          </div>

          <h3 className="mt-2.5 font-display text-[15px] font-semibold leading-snug text-ink">
            {recommendation.title}
          </h3>
          {showBuilding ? (
            <p className="mt-1 text-[11px] text-ink-muted">
              {recommendation.building_name}
            </p>
          ) : null}
        </div>
      </div>

      <p className="mt-3 text-[12.5px] leading-relaxed text-ink-soft">
        {recommendation.reason}
      </p>

      {/* the prize, stated as an estimate because that is what it is */}
      <div className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-card border border-[rgb(var(--line)/0.09)] bg-[rgb(var(--line)/0.07)]">
        <SavingCell
          icon={recommendation.resource_type === "WATER" ? Droplets : Zap}
          value={`${compact(recommendation.expected_saving_per_week, 1)}`}
          unit={`${recommendation.expected_saving_unit}/wk`}
          label="Resource"
        />
        <SavingCell
          icon={Wallet}
          value={`${currencySymbol}${compact(recommendation.estimated_cost_saving_per_week, 1)}`}
          unit="/wk"
          label="Cost"
        />
        <SavingCell
          icon={Leaf}
          value={compact(recommendation.estimated_co2_reduction_per_week, 1)}
          unit="kg/wk"
          label="CO2"
        />
      </div>

      <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-muted">
        <span className="mt-[3px] shrink-0 rounded border border-medium/25 bg-medium/10 px-1 py-px text-[9px] font-semibold uppercase tracking-wider text-medium">
          Est
        </span>
        Projected from the measured excess. Verified only after the intervention
        is monitored.
      </p>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-[rgb(var(--line)/0.08)] pt-4">
        {recommendation.anomaly_id ? (
          <Link
            href={`/anomalies/${recommendation.anomaly_id}`}
            className="text-[11px] text-ink-muted transition-colors hover:text-ink-soft"
          >
            View evidence &rarr;
          </Link>
        ) : (
          <span />
        )}

        {applied ? (
          recommendation.intervention_id ? (
            <Button variant="secondary" size="sm" asChild>
              <Link href={`/interventions#i${recommendation.intervention_id}`}>
                Track intervention <ArrowRight />
              </Link>
            </Button>
          ) : null
        ) : dismissed ? (
          <Badge tone="neutral">Dismissed</Badge>
        ) : (
          <Button
            variant="primary"
            size="sm"
            loading={applying}
            onClick={() => onApply?.(recommendation)}
          >
            Apply Intervention
          </Button>
        )}
      </div>
    </div>
  );
}

function SavingCell({
  icon: Icon,
  value,
  unit,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  unit: string;
  label: string;
}) {
  return (
    <div className="bg-surface px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <Icon className="size-3 text-ink-muted" />
        <span className="text-[9px] uppercase tracking-[0.1em] text-ink-muted">
          {label}
        </span>
      </div>
      <div className="num mt-1 text-[13px] font-semibold text-ink">
        {value}
        <span className="ml-0.5 text-[10px] font-normal text-ink-muted">{unit}</span>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Intervention
// --------------------------------------------------------------------------
const INTERVENTION_TONE: Record<
  string,
  "neutral" | "aqua" | "mint" | "medium"
> = {
  PLANNED: "neutral",
  ACTIVE: "aqua",
  MONITORING: "aqua",
  COMPLETED: "medium",
  VERIFIED: "mint",
};

export function InterventionCard({
  intervention,
  onMonitor,
  onVerify,
  busy = false,
  busyLabel,
}: {
  intervention: Intervention;
  onMonitor?: (i: Intervention) => void;
  onVerify?: (i: Intervention) => void;
  busy?: boolean;
  busyLabel?: string;
}) {
  const resource = RESOURCE_TOKENS[intervention.resource_type];
  const verified = intervention.status === "VERIFIED";
  const needsData = !intervention.ready_for_verification && !verified;

  return (
    <div
      id={`i${intervention.id}`}
      className="panel scroll-mt-24 p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={INTERVENTION_TONE[intervention.status] ?? "neutral"} dot
                   pulse={intervention.status === "MONITORING" || intervention.status === "ACTIVE"}>
              {intervention.status}
            </Badge>
            <Badge tone={intervention.resource_type === "WATER" ? "aqua" : "mint"}>
              {resource.label}
            </Badge>
            <span className="num text-[11px] text-ink-muted">
              #{intervention.id}
            </span>
          </div>
          <h3 className="mt-2.5 font-display text-[15px] font-semibold text-ink">
            {intervention.title}
          </h3>
          <p className="mt-1 text-[11px] text-ink-muted">
            {intervention.building_name} &middot; applied{" "}
            {date(intervention.implemented_at)} &middot; {intervention.owner}
          </p>
        </div>

        {verified && intervention.verified_saving !== null ? (
          <div className="text-right">
            <div className="num text-xl font-semibold text-mint">
              -{pct(intervention.verified_saving_pct ?? 0)}
            </div>
            <div className="num text-[10px] text-ink-muted">
              {compact(intervention.verified_saving, 1)}{" "}
              {intervention.expected_saving_unit ?? ""}/wk measured
            </div>
          </div>
        ) : null}
      </div>

      <p className="mt-3 text-[12.5px] leading-relaxed text-ink-soft">
        {intervention.description}
      </p>

      {/* monitoring progress */}
      {!verified ? (
        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between text-[11px]">
            <span className="flex items-center gap-1.5 text-ink-muted">
              <Clock className="size-3" />
              Post-intervention monitoring
            </span>
            <span className="num text-ink-soft">
              {num(intervention.elapsed_days, 1)} / {intervention.monitoring_days_required}d
            </span>
          </div>
          <Progress value={intervention.progress_pct} tone="aqua" />
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[rgb(var(--line)/0.08)] pt-4">
        <div className="flex items-center gap-3 text-[11px] text-ink-muted">
          {intervention.expected_saving_per_week !== null ? (
            <span className="num">
              Est. {compact(intervention.expected_saving_per_week, 1)}{" "}
              {intervention.expected_saving_unit}/wk
            </span>
          ) : null}
          {intervention.verification_status ? (
            <Badge
              tone={
                intervention.verification_status === "VERIFIED"
                  ? "mint"
                  : intervention.verification_status === "NOT_VERIFIED"
                    ? "critical"
                    : "neutral"
              }
            >
              {VERIFICATION_TOKENS[intervention.verification_status].label}
            </Badge>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {intervention.verification_id ? (
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/verification#v${intervention.verification_id}`}>
                View proof
              </Link>
            </Button>
          ) : null}

          {!verified && needsData && onMonitor ? (
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              onClick={() => onMonitor(intervention)}
            >
              {busy ? busyLabel ?? "Collecting..." : "Collect 14d + verify"}
            </Button>
          ) : null}

          {!verified && !needsData && onVerify ? (
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              onClick={() => onVerify(intervention)}
            >
              <BadgeCheck /> Run verification
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Verification summary row
// --------------------------------------------------------------------------
export function VerificationSummary({
  verification,
  currencySymbol = "₹",
}: {
  verification: Verification;
  currencySymbol?: string;
}) {
  const tokens = VERIFICATION_TOKENS[verification.status];
  const positive = verification.status === "VERIFIED";

  return (
    <Link
      href={`/verification#v${verification.id}`}
      className="group flex items-center gap-4 rounded-card border border-[rgb(var(--line)/0.09)] bg-surface/50 p-4 transition-all duration-150 hover:border-[rgb(var(--line)/0.18)] hover:bg-surface"
    >
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg border",
          tokens.border,
          tokens.bg,
          tokens.text,
        )}
      >
        <BadgeCheck className="size-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[13px] font-medium text-ink">
            {verification.intervention_title}
          </span>
          <Badge
            tone={
              positive ? "mint" : verification.status === "NOT_VERIFIED" ? "critical" : "neutral"
            }
          >
            {tokens.label}
          </Badge>
        </div>
        <div className="num mt-1 text-[11px] text-ink-muted">
          {verification.building_name} &middot;{" "}
          {num(verification.adjusted_baseline_value)} &rarr;{" "}
          {num(verification.post_value)} {verification.unit}/wk &middot;{" "}
          {dateShort(verification.post_start)} onwards
        </div>
      </div>

      <div className="shrink-0 text-right">
        <div
          className={cn(
            "num text-[15px] font-semibold",
            positive ? "text-mint" : "text-ink-soft",
          )}
        >
          {verification.saving_pct > 0 ? "-" : "+"}
          {pct(Math.abs(verification.saving_pct))}
        </div>
        {positive ? (
          <div className="num mt-0.5 text-[10px] text-ink-muted">
            {currencySymbol}
            {compact(verification.financial_saving_per_year, 1)}/yr
          </div>
        ) : null}
      </div>
    </Link>
  );
}

// --------------------------------------------------------------------------
// Evidence list
// --------------------------------------------------------------------------
export function EvidenceList({
  evidence,
  className,
}: {
  evidence: { label: string; value: string; criterion: string; satisfied: boolean; detail?: string }[];
  className?: string;
}) {
  return (
    <ul className={cn("space-y-px overflow-hidden rounded-card border border-[rgb(var(--line)/0.09)] bg-[rgb(var(--line)/0.06)]", className)}>
      {evidence.map((item, index) => (
        <li key={index} className="bg-surface px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2.5">
              <span
                className={cn(
                  "mt-[3px] flex size-3.5 shrink-0 items-center justify-center rounded-full border text-[8px] font-bold",
                  item.satisfied
                    ? "border-mint/40 bg-mint/15 text-mint"
                    : "border-[rgb(var(--line)/0.2)] bg-transparent text-ink-muted",
                )}
              >
                {item.satisfied ? "✓" : "–"}
              </span>
              <div className="min-w-0">
                <div className="text-[12.5px] font-medium text-ink">{item.label}</div>
                <div className="mt-0.5 text-[11px] text-ink-muted">
                  Criterion: {item.criterion}
                </div>
                {item.detail ? (
                  <div className="mt-1 text-[11px] leading-relaxed text-ink-muted/80">
                    {item.detail}
                  </div>
                ) : null}
              </div>
            </div>
            <span
              className={cn(
                "num shrink-0 text-[13px] font-semibold",
                item.satisfied ? "text-ink" : "text-ink-muted",
              )}
            >
              {item.value}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function causeLabel(code: string | null | undefined): string {
  if (!code) return "Undiagnosed";
  return CAUSE_LABELS[code] ?? code;
}

export { relativeDays };
