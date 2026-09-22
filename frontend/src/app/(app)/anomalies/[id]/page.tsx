"use client";

import { ArrowLeft, ArrowRight, BadgeCheck, Wrench } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import * as React from "react";

import { EvidenceList } from "@/components/domain/evidence";
import { VerifiedImpact } from "@/components/domain/verification";
import { InvestigationPanel } from "@/components/investigation/InvestigationPanel";
import {
  ActualVsExpectedChart,
  BeforeAfterChart,
  CHART_COLOURS,
  ChartFrame,
  HourProfileChart,
  LegendKey,
  type ActualExpectedPoint,
} from "@/components/charts/primitives";
import {
  Button,
  ErrorState,
  Progress,
  Skeleton,
} from "@/components/ui/primitives";
import {
  KeyValue,
  Metric,
  Num,
  Section,
  StatusText,
  Table,
} from "@/components/ui/structure";
import { api } from "@/lib/api";
import {
  compact,
  date,
  dateShort,
  duration,
  hourLabel,
  num,
  pct,
  signedPct,
} from "@/lib/format";
import type {
  AnomalyDetail,
  Evidence,
  Intervention,
  Verification,
} from "@/lib/types";
import { useApi, useMutation } from "@/lib/use-api";
import { cn } from "@/lib/utils";

/**
 * Anomaly analysis.
 *
 * The page is the loop for a single event: what was measured, why the engine
 * thinks it happened, what it proposes, and -- if the measure has been applied
 * -- what the telemetry since then actually shows. Every step stays on one
 * page so the chain from deviation to verified saving can be read end to end
 * without trusting a summary.
 */

type Stage = "diagnosed" | "recommended" | "intervened" | "verified";

type RecommendationEvidence = Partial<Evidence> & {
  source?: string;
  category?: "supporting" | "contradiction" | "unknown" | string;
  hypothesis?: string;
  status?: string;
  description?: string;
  measured_value?: unknown;
  reference?: unknown;
  baseline?: unknown;
};

export default function AnomalyDetailPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const id = Number(params?.id);
  const isDemo = Boolean(search?.get("demo"));

  const { data, error, loading, refetch } = useApi<AnomalyDetail>(
    Number.isFinite(id) ? `/api/anomalies/${id}` : null,
    [id],
  );

  const [intervention, setIntervention] = React.useState<Intervention | null>(null);
  const [verification, setVerification] = React.useState<Verification | null>(null);

  // Pick up an intervention/verification that already exists for this anomaly.
  const existing = useApi<Intervention | null>(
    Number.isFinite(id) ? `/api/anomalies/${id}/intervention` : null,
    [id],
  );
  React.useEffect(() => {
    if (existing.data !== null) setIntervention(existing.data);
  }, [existing.data]);

  const verificationQuery = useApi<Verification[]>(
    intervention
      ? `/api/verification?intervention_id=${intervention.id}&latest_only=true`
      : null,
    [intervention?.id],
  );
  React.useEffect(() => {
    if (!intervention || !verificationQuery.data) return;
    setVerification(verificationQuery.data[0] ?? null);
  }, [intervention, verificationQuery.data]);

  const applyMutation = useMutation(async (recommendationId: number) => {
    const result = await api.post<Intervention>(
      `/api/recommendations/${recommendationId}/apply`,
      {},
    );
    setIntervention(result);
    await refetch({ quiet: true });
    return result;
  });

  const monitorMutation = useMutation(async (interventionId: number) => {
    const result = await api.post<Verification>(
      `/api/interventions/${interventionId}/monitor`,
      { days: 14 },
    );
    setVerification(result);
    const refreshed = await api.get<Intervention>(
      `/api/interventions/${interventionId}`,
    );
    setIntervention(refreshed);
    return result;
  });

  const stage: Stage =
    verification?.status === "VERIFIED"
      ? "verified"
      : intervention
        ? "intervened"
        : data?.recommendation
          ? "recommended"
          : "diagnosed";

  if (!Number.isFinite(id)) {
    return (
      <div className="pt-8">
        <ErrorState
          error={{ message: `"${params?.id}" is not a valid anomaly id.` }}
        />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-4 pt-4">
        <BackLink />
        <ErrorState error={error} onRetry={() => refetch()} />
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-[320px] w-full" />
      </div>
    );
  }

  if (!data) return null;

  const { anomaly, recommendation, series, hourly_profile, context } = data;
  const isWater = anomaly.resource_type === "WATER";

  const chartData: ActualExpectedPoint[] = series.map((point) => ({
    label: dateShort(point.ts),
    actual: point.actual,
    expected: point.expected,
    is_anomalous: point.is_anomalous,
    occupancy_pct: point.occupancy_pct,
  }));

  const profileData = (hourly_profile.hours ?? []).map((hour, index) => ({
    hour: hourLabel(hour),
    normal: hourly_profile.normal?.[index] ?? null,
    anomalous: hourly_profile.anomalous?.[index] ?? null,
  }));

  return (
    <div className="space-y-9">
      {/* ================= header ================= */}
      <header>
        <BackLink />

        {isDemo ? (
          <p className="mt-4 max-w-3xl border-l-2 border-iris/60 pl-4 text-[12px] leading-relaxed text-ink-soft">
            Demo scenario. Everything below was produced by the detection and
            diagnosis pipeline from the seeded telemetry — work down the page to
            apply the intervention and verify the saving.
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <StatusText status={anomaly.severity} />
          <span
            className={cn(
              "text-[10.5px] font-medium uppercase tracking-[0.09em]",
              isWater ? "text-aqua" : "text-mint",
            )}
          >
            {anomaly.resource_type}
          </span>
          {anomaly.is_persistent ? (
            <span className="text-[10.5px] uppercase tracking-[0.09em] text-ink-faint">
              Persistent
            </span>
          ) : null}
          <span className="num text-[10.5px] text-ink-faint">#{anomaly.id}</span>
        </div>

        <h1 className="mt-2.5 max-w-3xl text-[26px] font-semibold leading-tight tracking-[-0.03em] text-ink">
          {anomaly.probable_cause ?? "Undiagnosed deviation"}
        </h1>

        <p className="mt-2.5 text-[12.5px] text-ink-muted">
          <Link
            href={`/buildings/${anomaly.building_id}`}
            className="text-ink-soft underline-offset-2 hover:underline"
          >
            {anomaly.building_name}
          </Link>{" "}
          · {date(anomaly.start_ts)} to {date(anomaly.end_ts)} ·{" "}
          <span className="num">{num(anomaly.flagged_intervals)}</span> affected
          intervals · {duration(anomaly.duration_hours)}
        </p>
      </header>

      {/* ================= progress through the loop ================= */}
      <LoopRail stage={stage} />

      {/* ================= key figures ================= */}
      <section className="grid gap-x-8 gap-y-6 border-y border-[rgb(var(--line)/0.08)] py-6 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        <Metric
          label="Metered"
          value={num(anomaly.actual_value, 1)}
          unit={`${anomaly.unit}/interval`}
          size="lg"
        />
        <Metric
          label="Expected"
          value={num(anomaly.expected_value, 1)}
          unit={`${anomaly.unit}/interval`}
          size="lg"
          tone="muted"
        />
        <Metric
          label="Deviation"
          value={signedPct(anomaly.deviation_pct, 0)}
          size="lg"
          tone="critical"
        />
        <Metric
          label="Total excess"
          value={compact(anomaly.excess_total, 1)}
          unit={anomaly.unit}
          size="lg"
          tone="critical"
        />
        <Metric
          label="Confidence"
          value={pct((anomaly.confidence ?? 0) * 100, 0)}
          size="lg"
          tone="iris"
        />
      </section>

      {/* ================= diagnosis ================= */}
      <Section
        label="Root-cause analysis"
        title="Why this is happening"
        description={`Affected subsystem: ${anomaly.affected_subsystem}. Confidence reflects how much of the measured evidence points to this cause rather than to a competing one.`}
      >
        <div className="grid gap-x-10 gap-y-7 xl:grid-cols-2">
          <div>
            <p className="max-w-prose text-[13px] leading-relaxed text-ink-soft">
              {anomaly.diagnosis_narrative}
            </p>
            <div className="mt-6">
              <div className="label mb-3">
                Evidence ·{" "}
                {(anomaly.evidence ?? []).filter((e) => e.satisfied).length} of{" "}
                {(anomaly.evidence ?? []).length} conditions met
              </div>
              <EvidenceList evidence={anomaly.evidence ?? []} />
            </div>
          </div>

          <div>
            <div className="label mb-3">
              Measured context · same hours of day on non-flagged days
            </div>
            <ContextTable context={context} isWater={isWater} />
            <p className="mt-4 text-[10.5px] leading-relaxed text-ink-faint">
              Recurred over{" "}
              <span className="num">{num(anomaly.occurrence_days)}</span> days
            </p>
          </div>
        </div>
      </Section>

      {/* ================= telemetry ================= */}
      <Section
        label="Telemetry"
        title="Metered against expected"
        description="Shaded bands are the intervals flagged as abnormal; the hour-of-day view shows when within the day the waste happens."
      >
        <div className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
          <ChartFrame
            title={`${isWater ? "Water" : "Energy"} · ${anomaly.unit}`}
            legend={
              <>
                <LegendKey
                  colour={isWater ? CHART_COLOURS.water : CHART_COLOURS.energy}
                  label="Metered"
                />
                <LegendKey colour={CHART_COLOURS.expected} label="Expected" dashed />
                <LegendKey
                  colour={CHART_COLOURS.critical}
                  label="Flagged interval"
                  band
                />
              </>
            }
          >
            <ActualVsExpectedChart
              data={chartData}
              resource={anomaly.resource_type}
              unit={` ${anomaly.unit}`}
              height={300}
              decimals={0}
              tooltipExtra={(row) => (
                <span className="num text-[10px] text-ink-muted">
                  Occupancy {pct((row.occupancy_pct as number) ?? 0, 0)}
                  {row.is_anomalous ? (
                    <span className="ml-2 text-critical">Flagged</span>
                  ) : null}
                </span>
              )}
            />
          </ChartFrame>

          <ChartFrame
            title="Hour-of-day signature"
            meta={anomaly.unit}
            legend={
              <>
                <LegendKey colour={CHART_COLOURS.baseline} label="Normal days" dashed />
                <LegendKey
                  colour={CHART_COLOURS.critical}
                  label="Affected intervals"
                />
              </>
            }
          >
            <HourProfileChart
              data={profileData}
              seriesA="normal"
              seriesB="anomalous"
              labelA="Normal days"
              labelB="Affected intervals"
              colourA={CHART_COLOURS.baseline}
              colourB={CHART_COLOURS.critical}
              unit={` ${anomaly.unit}`}
              height={300}
              highlightHours={hourly_profile.affected_hours}
            />
          </ChartFrame>
        </div>
      </Section>

      {/* ================= investigation ================= */}
      <InvestigationPanel anomalyId={anomaly.id} />

      {/* ================= recommendation ================= */}
      {recommendation ? (
        <Section
          id="recommendation"
          label="Step 2 of 4 · Recommendation"
          title={recommendation.title}
          description={recommendation.description}
          actions={<StatusText status={recommendation.priority} />}
        >
          <div className="grid gap-x-10 gap-y-7 lg:grid-cols-[1.3fr_1fr]">
            <div>
              <div className="label mb-2">Why</div>
              <p className="max-w-prose text-[12.5px] leading-relaxed text-ink-soft">
                {recommendation.reason}
              </p>

              <div className="label mb-2 mt-5">Implementation</div>
              <p className="max-w-prose text-[12.5px] leading-relaxed text-ink-soft">
                {recommendation.implementation}
              </p>

              {recommendation.payback_note ? (
                <p className="mt-4 text-[11px] leading-relaxed text-ink-muted">
                  {recommendation.payback_note}
                </p>
              ) : null}

              <RecommendationEvidenceBridge evidence={recommendation.evidence} />
            </div>

            <div>
              <div className="label mb-3">Expected saving</div>
              <div className="grid grid-cols-3 gap-x-6">
                <Metric
                  value={compact(recommendation.expected_saving_per_week, 1)}
                  unit={`${recommendation.expected_saving_unit}/wk`}
                  size="md"
                />
                <Metric
                  value={`₹${compact(recommendation.estimated_cost_saving_per_week, 1)}`}
                  unit="/wk"
                  size="md"
                />
                <Metric
                  value={compact(recommendation.estimated_co2_reduction_per_week, 1)}
                  unit="kg CO₂/wk"
                  size="md"
                />
              </div>

              <p className="mt-4 flex items-start gap-2 border-l-2 border-medium/50 pl-3 text-[11px] leading-relaxed text-ink-muted">
                <span className="mt-[1px] shrink-0 border border-medium/35 px-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-medium">
                  Est
                </span>
                Projected from the measured excess across the fault footprint.
                The verified figure comes from post-intervention telemetry.
              </p>

              {!intervention ? (
                <Button
                  variant="primary"
                  size="lg"
                  className="mt-5 w-full"
                  loading={applyMutation.pending}
                  onClick={() => applyMutation.mutate(recommendation.id)}
                >
                  <Wrench /> Apply intervention
                </Button>
              ) : (
                <div className="mt-5 space-y-2.5">
                  <p className="text-[12px] text-mint">
                    Applied as intervention #{intervention.id}
                  </p>
                  <Button variant="secondary" size="sm" asChild>
                    <Link href={`/interventions#i${intervention.id}`}>
                      View intervention lifecycle <ArrowRight />
                    </Link>
                  </Button>
                </div>
              )}
              {applyMutation.error ? (
                <div className="mt-4">
                  <ErrorState error={applyMutation.error} compact />
                </div>
              ) : null}
            </div>
          </div>
        </Section>
      ) : null}

      {/* ================= intervention + verification ================= */}
      {intervention ? (
        <Section
          id="verification"
          label={
            verification?.status === "VERIFIED"
              ? "Step 4 of 4 · Verified"
              : "Step 3 of 4 · Post-intervention monitoring"
          }
          title={
            verification?.status === "VERIFIED"
              ? "Saving verified against an adjusted baseline"
              : "Collect telemetry, then verify"
          }
          description={
            verification?.status === "VERIFIED"
              ? undefined
              : "The measure has been applied and the underlying fault closed. Verification needs post-intervention telemetry before it can return a verdict."
          }
          actions={
            <StatusText status={verification?.status ?? intervention.status} />
          }
          bodyClassName="space-y-7"
        >
          <InterventionLifecycle intervention={intervention} />

          {verification ? (
            <VerifiedImpact verification={verification} />
          ) : null}

          {verification?.status !== "VERIFIED" ? (
            <div className="grid gap-x-10 gap-y-6 lg:grid-cols-2">
              <div>
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="label">Monitoring progress</span>
                  <span className="num text-[11px] text-ink-soft">
                    {num(intervention.elapsed_days, 1)} /{" "}
                    {intervention.monitoring_days_required} days
                  </span>
                </div>
                <Progress value={intervention.progress_pct} tone="aqua" />
                <p className="mt-4 max-w-prose text-[12px] leading-relaxed text-ink-soft">
                  {verification?.explanation ??
                    "Verification compares post-intervention consumption against a baseline model evaluated on the new period's own occupancy and weather. It needs enough telemetry to cover weekday, weekend and weather variation."}
                </p>
              </div>

              <div className="border-t border-[rgb(var(--line)/0.08)] pt-5 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0">
                <div className="label mb-2">Demo mode · fast-forward the meters</div>
                <p className="max-w-prose text-[11.5px] leading-relaxed text-ink-muted">
                  In a real deployment you would simply wait a fortnight for the
                  meters to report. Here the built-in building simulator
                  generates those hours with the fault now closed, and the
                  identical M&amp;V engine measures the result.
                </p>
                <Button
                  variant="primary"
                  className="mt-4"
                  loading={monitorMutation.pending}
                  onClick={() => monitorMutation.mutate(intervention.id)}
                >
                  {monitorMutation.pending ? (
                    "Collecting telemetry and verifying…"
                  ) : (
                    <>
                      <BadgeCheck />
                      {verification?.status === "INSUFFICIENT_DATA"
                        ? "Collect more telemetry and verify"
                        : verification
                          ? "Run monitoring and verify again"
                          : "Collect 14 days and verify"}
                    </>
                  )}
                </Button>
                {monitorMutation.error ? (
                  <div className="mt-4">
                    <ErrorState error={monitorMutation.error} compact />
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {verification ? (
            <VerificationDetail verification={verification} />
          ) : null}
        </Section>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[rgb(var(--line)/0.08)] pt-5">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/buildings/${anomaly.building_id}`}>
            <ArrowLeft /> {anomaly.building_name}
          </Link>
        </Button>
        {verification?.status === "VERIFIED" ? (
          <Button variant="outline" size="sm" asChild>
            <Link href="/verification">
              See all verified savings <ArrowRight />
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
function BackLink() {
  return (
    <Link
      href="/anomalies"
      className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-muted transition-colors hover:text-ink-soft"
    >
      <ArrowLeft className="size-3" /> Anomaly monitor
    </Link>
  );
}

/**
 * Progress through the loop, drawn with the same rail motif the dashboard uses
 * so the two read as the same idea at different scales.
 */
function LoopRail({ stage }: { stage: Stage }) {
  const steps: { key: Stage; label: string; caption: string }[] = [
    { key: "diagnosed", label: "Detected", caption: "Diagnosed against evidence" },
    { key: "recommended", label: "Recommended", caption: "Costed measure issued" },
    { key: "intervened", label: "Intervened", caption: "Applied, fault closed" },
    { key: "verified", label: "Verified", caption: "Saving measured" },
  ];
  const order: Stage[] = ["diagnosed", "recommended", "intervened", "verified"];
  const currentIndex = order.indexOf(stage);

  return (
    <ol className="flex min-w-max items-start overflow-x-auto pb-1">
      {steps.map((step, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;
        const isLast = index === steps.length - 1;
        return (
          <li key={step.key} className="min-w-[150px] flex-1 pr-6">
            <div className="relative flex h-2.5 items-center" aria-hidden>
              <span
                className={cn(
                  "relative z-10 size-2 shrink-0 rounded-full border",
                  done || active
                    ? "border-transparent bg-mint"
                    : "border-ink-faint/50 bg-canvas",
                )}
              />
              {!isLast ? (
                <span
                  className={cn(
                    "h-px flex-1",
                    done ? "bg-mint/40" : "bg-[rgb(var(--line)/0.12)]",
                  )}
                />
              ) : null}
            </div>
            <div
              className={cn(
                "label mt-2.5",
                done || active ? "text-ink-soft" : "text-ink-faint",
              )}
            >
              {step.label}
            </div>
            <div
              className={cn(
                "mt-1.5 max-w-[140px] text-[10.5px] leading-[1.35]",
                active ? "text-ink-soft" : "text-ink-muted",
              )}
            >
              {step.caption}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// --------------------------------------------------------------------------
function displayEvidenceValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Investigation evidence carried into the recommendation.
 *
 * The recommendation keeps the existing root-cause decision and carries the
 * measured investigation evidence forward, including the parts that argue
 * against it -- which is exactly why contradictions and unknowns are listed
 * rather than filtered out.
 */
function RecommendationEvidenceBridge({ evidence }: { evidence: Evidence[] }) {
  const items = evidence as RecommendationEvidence[];
  const supporting = items.filter(
    (item) => item.category !== "contradiction" && item.category !== "unknown",
  );
  const contradictions = items.filter((item) => item.category === "contradiction");
  const unknowns = items.filter((item) => item.category === "unknown");

  if (!items.length) return null;

  const renderItem = (item: RecommendationEvidence, index: number) => (
    <li
      key={`${item.label ?? item.description ?? "evidence"}-${index}`}
      className="py-2 first:pt-0"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <span className="text-[11.5px] font-medium text-ink-soft">
          {item.label ?? item.description ?? "Investigation evidence"}
        </span>
        {item.measured_value !== undefined || item.value !== undefined ? (
          <span className="num text-[11px] text-ink">
            {displayEvidenceValue(item.measured_value ?? item.value)}
          </span>
        ) : null}
      </div>
      {item.description || item.detail ? (
        <p className="mt-1 text-[10.5px] leading-relaxed text-ink-muted">
          {item.description ?? item.detail}
        </p>
      ) : null}
      {item.hypothesis ? (
        <p className="mt-1 text-[10px] text-ink-faint">
          Hypothesis: {item.hypothesis}
        </p>
      ) : null}
    </li>
  );

  return (
    <div className="mt-6 border-t border-[rgb(var(--line)/0.08)] pt-5">
      <div className="label mb-2">Evidence informing this recommendation</div>
      <p className="mb-3 text-[11px] leading-relaxed text-ink-muted">
        The measured evidence behind this recommendation, including anything
        that argues against it.
      </p>
      <ul className="divide-y divide-[rgb(var(--line)/0.06)]">
        {supporting.map(renderItem)}
      </ul>

      {contradictions.length ? (
        <div className="mt-4 border-l-2 border-critical/50 pl-4">
          <div className="label mb-1.5 text-critical">Contradictions retained</div>
          <ul className="divide-y divide-[rgb(var(--line)/0.06)]">
            {contradictions.map(renderItem)}
          </ul>
        </div>
      ) : null}

      {unknowns.length ? (
        <div className="mt-4 border-l-2 border-medium/50 pl-4">
          <div className="label mb-1.5 text-medium">Unknowns retained</div>
          <ul className="divide-y divide-[rgb(var(--line)/0.06)]">
            {unknowns.map(renderItem)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// --------------------------------------------------------------------------
const INTERVENTION_LIFECYCLE: Array<Intervention["status"]> = [
  "PLANNED",
  "ACTIVE",
  "MONITORING",
  "COMPLETED",
  "VERIFIED",
];

function InterventionLifecycle({ intervention }: { intervention: Intervention }) {
  const current = INTERVENTION_LIFECYCLE.indexOf(intervention.status);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <span className="num text-[11px] text-ink-muted">
          Intervention #{intervention.id} · applied {date(intervention.implemented_at)}{" "}
          · {intervention.owner}
        </span>
        <Link
          href={`/interventions#i${intervention.id}`}
          className="text-[11px] text-ink-muted underline-offset-2 transition-colors hover:text-ink-soft hover:underline"
        >
          Open intervention
        </Link>
      </div>
      <ol className="flex min-w-max items-start overflow-x-auto">
        {INTERVENTION_LIFECYCLE.map((status, index) => {
          const done = index < current;
          const active = index === current;
          const isLast = index === INTERVENTION_LIFECYCLE.length - 1;
          return (
            <li key={status} className="min-w-[104px] flex-1 pr-4">
              <div className="relative flex h-2.5 items-center" aria-hidden>
                <span
                  className={cn(
                    "relative z-10 size-2 shrink-0 rounded-full border",
                    done
                      ? "border-transparent bg-mint/60"
                      : active
                        ? "border-transparent bg-mint"
                        : "border-ink-faint/50 bg-canvas",
                  )}
                />
                {!isLast ? (
                  <span
                    className={cn(
                      "h-px flex-1",
                      done ? "bg-mint/35" : "bg-[rgb(var(--line)/0.12)]",
                    )}
                  />
                ) : null}
              </div>
              <div
                className={cn(
                  "label mt-2",
                  done || active ? "text-ink-soft" : "text-ink-faint",
                )}
              >
                {status}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// --------------------------------------------------------------------------
function VerificationDetail({ verification }: { verification: Verification }) {
  const chartData = React.useMemo(() => {
    const map = new Map<
      string,
      { date: string; baseline?: number; post?: number; adjusted?: number }
    >();
    verification.series.baseline?.forEach((p) =>
      map.set(p.date, { ...(map.get(p.date) ?? { date: p.date }), baseline: p.value }),
    );
    verification.series.post?.forEach((p) =>
      map.set(p.date, { ...(map.get(p.date) ?? { date: p.date }), post: p.value }),
    );
    verification.series.adjusted_baseline?.forEach((p) =>
      map.set(p.date, { ...(map.get(p.date) ?? { date: p.date }), adjusted: p.value }),
    );
    return Array.from(map.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((row) => ({ ...row, date: dateShort(row.date) }));
  }, [verification]);

  const profile = (verification.hourly_profile?.hours ?? []).map((hour, index) => ({
    hour: hourLabel(hour),
    before: verification.hourly_profile.baseline?.[index] ?? null,
    after: verification.hourly_profile.post?.[index] ?? null,
  }));

  if (verification.status === "INSUFFICIENT_DATA") return null;

  return (
    <div className="space-y-6">
      <div className="grid gap-5 xl:grid-cols-2">
        <ChartFrame
          title="Daily totals, before and after"
          legend={
            <>
              <LegendKey colour={CHART_COLOURS.critical} label="Baseline measured" />
              <LegendKey colour={CHART_COLOURS.post} label="Post measured" />
              <LegendKey
                colour={CHART_COLOURS.adjusted}
                label="Adjusted baseline"
                dashed
              />
            </>
          }
        >
          <BeforeAfterChart
            data={chartData}
            unit={` ${verification.unit}`}
            height={260}
          />
        </ChartFrame>

        <ChartFrame
          title="Hour-of-day profile"
          meta={verification.unit}
          legend={
            <>
              <LegendKey colour={CHART_COLOURS.critical} label="Before" dashed />
              <LegendKey colour={CHART_COLOURS.post} label="After" />
            </>
          }
        >
          <HourProfileChart
            data={profile}
            seriesA="before"
            seriesB="after"
            labelA="Before"
            labelB="After"
            colourA={CHART_COLOURS.critical}
            colourB={CHART_COLOURS.post}
            unit={` ${verification.unit}`}
            height={260}
          />
        </ChartFrame>
      </div>

      <div className="grid gap-x-8 gap-y-5 border-t border-[rgb(var(--line)/0.08)] pt-5 grid-cols-2 sm:grid-cols-3">
        <KeyValue
          label="Confidence"
          value={
            verification.confidence_pct !== null
              ? pct(verification.confidence_pct, 1)
              : "—"
          }
        />
        <KeyValue
          label="Minimum reduction"
          value={pct(verification.threshold_pct, 0)}
        />
        <KeyValue
          label="Monitoring window"
          value={`${num(verification.baseline_days, 0)} before / ${num(
            verification.post_days,
            0,
          )} after`}
        />
      </div>

      <p className="max-w-3xl text-[11px] leading-relaxed text-ink-muted">
        The comparison is against what the building would have used over the same
        period under the same weather and occupancy, not against a plain
        before-and-after difference.
      </p>
    </div>
  );
}

// --------------------------------------------------------------------------
function ContextTable({
  context,
  isWater,
}: {
  context: Record<string, number | string | number[]>;
  isWater: boolean;
}) {
  const asNum = (key: string): number => {
    const value = context[key];
    return typeof value === "number" ? value : 0;
  };

  const rows = isWater
    ? [
        {
          label: "Night-time flow",
          value: `${num(asNum("night_flow"), 1)} L/h`,
          ref: `${num(asNum("night_flow_reference"), 1)} L/h normally`,
        },
        {
          label: "Flow persistence",
          value: pct(asNum("flow_persistence") * 100, 0),
          ref: `${num(asNum("low_occupancy_intervals"))} empty intervals`,
        },
        {
          label: "Pump runtime",
          value: `${num(asNum("pump_runtime"), 0)} min/h`,
          ref: `${num(asNum("pump_reference"), 0)} min/h normally`,
        },
        {
          label: "Occupancy",
          value: pct(asNum("occupancy_pct"), 1),
          ref: `${pct(asNum("occupancy_reference"), 1)} normally`,
        },
        {
          label: "Off-hours share",
          value: pct(asNum("offhours_share") * 100, 0),
          ref: `${context.operating_hours ?? ""}`,
        },
        {
          label: "Affected intervals",
          value: num(asNum("n_intervals")),
          ref: `over ${num(asNum("span_days"), 0)} days`,
        },
      ]
    : [
        {
          label: "HVAC runtime",
          value: `${num(asNum("hvac_runtime"), 0)} min/h`,
          ref: `${num(asNum("hvac_reference"), 0)} min/h normally`,
        },
        {
          label: "Lighting runtime",
          value: `${num(asNum("lighting_runtime"), 0)} min/h`,
          ref: `${num(asNum("lighting_reference"), 0)} min/h normally`,
        },
        {
          label: "Occupancy",
          value: pct(asNum("occupancy_pct"), 1),
          ref: `${pct(asNum("occupancy_reference"), 1)} normally`,
        },
        {
          label: "Indoor temperature",
          value: `${num(asNum("indoor_temperature"), 1)} °C`,
          ref: "comfort band 20–27.5 °C",
        },
        {
          label: "Outdoor temperature",
          value: `${num(asNum("outdoor_temperature"), 1)} °C`,
          ref: `${num(asNum("outdoor_reference"), 1)} °C normally`,
        },
        {
          label: "Off-hours share",
          value: pct(asNum("offhours_share") * 100, 0),
          ref: `${context.operating_hours ?? ""}`,
        },
      ];

  return (
    <Table minWidth={380}>
      <thead>
        <tr>
          <th className="w-[40%]">Measure</th>
          <th className="text-right">Observed</th>
          <th className="pr-0 text-right">Reference</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <td className="text-ink-soft">{row.label}</td>
            <td className="text-right">
              <Num tone="ink">{row.value}</Num>
            </td>
            <td className="pr-0 text-right">
              <Num>{row.ref}</Num>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
