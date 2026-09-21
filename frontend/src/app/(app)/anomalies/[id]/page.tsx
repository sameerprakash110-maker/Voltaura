"use client";

import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Brain,
  CheckCircle2,
  Clock,
  Droplets,
  Leaf,
  Radar,
  Sparkles,
  Wallet,
  Wrench,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import * as React from "react";

import { EvidenceList } from "@/components/cards/domain-cards";
import { InvestigationPanel } from "@/components/investigation/InvestigationPanel";
import {
  ActualVsExpectedChart,
  BeforeAfterChart,
  CHART_COLOURS,
  HourProfileChart,
  type ActualExpectedPoint,
} from "@/components/charts/primitives";
import {
  Badge,
  Button,
  ErrorState,
  Panel,
  PanelHeader,
  Progress,
  Skeleton,
} from "@/components/ui/primitives";
import { api } from "@/lib/api";
import {
  compact,
  date,
  dateShort,
  hourLabel,
  num,
  pValue as fmtP,
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
  const existing = useApi<Intervention[]>("/api/interventions");
  React.useEffect(() => {
    if (!data?.recommendation || !existing.data) return;
    const match = existing.data.find(
      (i) => i.recommendation_id === data.recommendation?.id,
    );
    if (match) setIntervention(match);
  }, [data?.recommendation, existing.data]);

  const verificationQuery = useApi<Verification[]>(
    intervention ? `/api/verification?latest_only=true` : null,
    [intervention?.id],
  );
  React.useEffect(() => {
    if (!intervention || !verificationQuery.data) return;
    const match = verificationQuery.data.find(
      (v) => v.intervention_id === intervention.id,
    );
    if (match) setVerification(match);
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

  const stage: Stage = verification?.status === "VERIFIED"
    ? "verified"
    : intervention
      ? "intervened"
      : data?.recommendation
        ? "recommended"
        : "diagnosed";

  if (!Number.isFinite(id)) {
    return (
      <div className="pt-10">
        <ErrorState
          error={{ message: `"${params?.id}" is not a valid anomaly id.` }}
        />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-4 pt-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/anomalies">
            <ArrowLeft /> Anomalies
          </Link>
        </Button>
        <ErrorState error={error} onRetry={() => refetch()} />
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-[320px] w-full" />
      </div>
    );
  }

  if (!data) return null;

  const { anomaly, recommendation, series, hourly_profile, context } = data;
  const isWater = anomaly.resource_type === "WATER";
  const Icon = isWater ? Droplets : Zap;

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
    <div className="space-y-5">
      {/* ---- header ---- */}
      <header>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-3">
          <Link href="/anomalies">
            <ArrowLeft /> Anomalies
          </Link>
        </Button>

        {isDemo ? (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-card border border-iris/22 bg-iris/[0.06] px-4 py-3">
            <Sparkles className="size-3.5 text-iris" />
            <span className="text-[12px] text-ink-soft">
              Demo scenario. Everything below was produced by the detection and
              diagnosis pipeline from the seeded telemetry -- work down the page
              to apply the intervention and verify the saving.
            </span>
          </div>
        ) : null}

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div
              className={cn(
                "flex size-11 shrink-0 items-center justify-center rounded-lg border",
                isWater
                  ? "border-aqua/25 bg-aqua/10 text-aqua"
                  : "border-mint/25 bg-mint/10 text-mint",
              )}
            >
              <Icon className="size-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  tone={
                    anomaly.severity.toLowerCase() as
                      | "low"
                      | "medium"
                      | "high"
                      | "critical"
                  }
                  dot
                  pulse={anomaly.severity === "CRITICAL"}
                >
                  {anomaly.severity}
                </Badge>
                <Badge tone={isWater ? "aqua" : "mint"}>
                  {isWater ? "Water" : "Energy"}
                </Badge>
                {anomaly.is_persistent ? (
                  <Badge tone="neutral">Persistent</Badge>
                ) : null}
                <span className="num text-[11px] text-ink-muted">
                  #{anomaly.id}
                </span>
              </div>
              <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink">
                {anomaly.probable_cause ?? "Undiagnosed deviation"}
              </h1>
              <p className="mt-1 text-[13px] text-ink-muted">
                <Link
                  href={`/buildings/${anomaly.building_id}`}
                  className="text-ink-soft underline-offset-2 hover:underline"
                >
                  {anomaly.building_name}
                </Link>{" "}
                &middot; {date(anomaly.start_ts)} to {date(anomaly.end_ts)} &middot;{" "}
                {num(anomaly.flagged_intervals)} affected intervals
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* ---- loop stepper ---- */}
      <LoopStepper stage={stage} />

      {/* ---- key figures ---- */}
      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-[rgb(var(--line)/0.1)] bg-[rgb(var(--line)/0.07)] lg:grid-cols-5">
        <Figure
          label="Metered"
          value={num(anomaly.actual_value, 1)}
          unit={`${anomaly.unit}/interval`}
        />
        <Figure
          label="Expected"
          value={num(anomaly.expected_value, 1)}
          unit={`${anomaly.unit}/interval`}
          muted
        />
        <Figure
          label="Deviation"
          value={signedPct(anomaly.deviation_pct, 0)}
          tone="critical"
        />
        <Figure
          label="Total excess"
          value={compact(anomaly.excess_total, 1)}
          unit={anomaly.unit}
          tone="critical"
        />
        <Figure
          label="Confidence"
          value={pct((anomaly.confidence ?? 0) * 100, 0)}
          unit="rule engine"
          tone="iris"
        />
      </section>

      {/* ---- diagnosis ---- */}
      <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Panel className="flex flex-col">
          <PanelHeader
            eyebrow="Root-cause analysis"
            title={
              <span className="flex items-center gap-2">
                <Brain className="size-4 text-iris" />
                Why this is happening
              </span>
            }
            subtitle={`Affected subsystem: ${anomaly.affected_subsystem}`}
            action={
              <Badge tone={anomaly.narrative_source === "llm" ? "iris" : "neutral"}>
                {anomaly.narrative_source === "llm" ? "LLM narrative" : "Rule engine"}
              </Badge>
            }
          />
          <div className="flex-1 px-5 pb-5">
            <p className="text-[13px] leading-relaxed text-ink-soft">
              {anomaly.diagnosis_narrative}
            </p>

            <div className="mt-4">
              <div className="eyebrow mb-2">
                Evidence ({(anomaly.evidence ?? []).filter((e) => e.satisfied).length} of{" "}
                {(anomaly.evidence ?? []).length} conditions met)
              </div>
              <EvidenceList evidence={anomaly.evidence ?? []} />
            </div>

            <p className="mt-3 text-[11px] leading-relaxed text-ink-muted">
              Confidence is the satisfied share of rule weight, discounted when a
              competing explanation scores closely and when the sample is small.
              It is capped below certainty because a rule engine can establish a
              signature, never a fact about the physical world.
            </p>
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="Measured context"
            title="The anomaly against normal behaviour"
            subtitle="Every comparison uses the same hours of day on non-flagged days."
          />
          <div className="px-5 pb-5">
            <ContextGrid context={context} isWater={isWater} />
          </div>
        </Panel>
      </section>

      {/* ---- charts ---- */}
      <section className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Panel>
          <PanelHeader
            eyebrow="Telemetry"
            title="Metered against expected"
            subtitle="Shaded bands are the intervals the detector flagged."
          />
          <div className="px-2 pb-5">
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
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="Hour-of-day signature"
            title="When the waste happens"
            subtitle="Affected intervals against the same hours on normal days."
          />
          <div className="px-2 pb-5">
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
          </div>
        </Panel>
      </section>

      {/* ---- deterministic investigation ---- */}
      <InvestigationPanel anomalyId={anomaly.id} />

      {/* ---- recommendation ---- */}
      {recommendation ? (
        <Panel id="recommendation" className="scroll-mt-24">
          <PanelHeader
            eyebrow="Step 2 of 4 - Recommendation"
            title={recommendation.title}
            subtitle={recommendation.description}
            action={
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
            }
          />
          <div className="px-5 pb-5">
            <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
                <div>
                  <div className="eyebrow mb-1.5">Reason</div>
                <p className="text-[12.5px] leading-relaxed text-ink-soft">
                  {recommendation.reason}
                </p>

                <div className="eyebrow mb-1.5 mt-4">Implementation</div>
                <p className="text-[12.5px] leading-relaxed text-ink-soft">
                  {recommendation.implementation}
                </p>

                  <p className="mt-3 text-[11px] text-ink-muted">
                    {recommendation.payback_note}
                  </p>

                  <RecommendationEvidenceBridge evidence={recommendation.evidence} />
                </div>

              <div>
                <div className="eyebrow mb-2">Expected saving</div>
                <div className="grid grid-cols-3 gap-px overflow-hidden rounded-card border border-[rgb(var(--line)/0.09)] bg-[rgb(var(--line)/0.07)]">
                  <SavingTile
                    icon={isWater ? Droplets : Zap}
                    value={compact(recommendation.expected_saving_per_week, 1)}
                    unit={`${recommendation.expected_saving_unit}/wk`}
                  />
                  <SavingTile
                    icon={Wallet}
                    value={`₹${compact(
                      recommendation.estimated_cost_saving_per_week,
                      1,
                    )}`}
                    unit="/wk"
                  />
                  <SavingTile
                    icon={Leaf}
                    value={compact(
                      recommendation.estimated_co2_reduction_per_week,
                      1,
                    )}
                    unit="kg CO2/wk"
                  />
                </div>

                <div className="mt-3 flex items-start gap-2 rounded-lg border border-medium/20 bg-medium/[0.05] px-3 py-2.5">
                  <span className="mt-px shrink-0 rounded border border-medium/30 bg-medium/15 px-1 py-px text-[9px] font-semibold uppercase tracking-wider text-medium">
                    Estimated
                  </span>
                  <span className="text-[11px] leading-relaxed text-ink-muted">
                    Projected from the measured excess across the fault footprint.
                    The verified figure comes from post-intervention telemetry.
                  </span>
                </div>

                {!intervention ? (
                  <Button
                    variant="primary"
                    size="lg"
                    className="mt-4 w-full"
                    loading={applyMutation.pending}
                    onClick={() => applyMutation.mutate(recommendation.id)}
                  >
                    <Wrench /> Apply Intervention
                  </Button>
                ) : (
                  <div className="mt-4 space-y-2">
                    <div className="flex items-center gap-2 rounded-lg border border-mint/22 bg-mint/[0.06] px-3.5 py-3">
                      <CheckCircle2 className="size-4 text-mint" />
                      <span className="text-[12px] text-ink-soft">
                        Applied as intervention #{intervention.id}
                      </span>
                    </div>
                    <Button variant="secondary" size="sm" className="w-full" asChild>
                      <Link href={`/interventions#i${intervention.id}`}>
                        View intervention lifecycle <ArrowRight />
                      </Link>
                    </Button>
                  </div>
                )}
                {applyMutation.error ? (
                  <ErrorState error={applyMutation.error} compact />
                ) : null}
              </div>
            </div>
          </div>
        </Panel>
      ) : null}

      {/* ---- intervention + verification ---- */}
      {intervention ? (
        <Panel id="verification" className="scroll-mt-24">
          <PanelHeader
            eyebrow={
              verification?.status === "VERIFIED"
                ? "Step 4 of 4 - Verified"
                : "Step 3 of 4 - Post-intervention monitoring"
            }
            title={
              verification?.status === "VERIFIED"
                ? "Saving verified against an adjusted baseline"
                : "Collect telemetry, then verify"
            }
            subtitle={
              verification?.status === "VERIFIED"
                ? undefined
                : "The measure has been applied and the underlying fault closed. Verification needs post-intervention telemetry before it can return a verdict."
            }
            action={
              verification ? (
                <Badge
                  tone={
                    verification.status === "VERIFIED"
                      ? "mint"
                      : verification.status === "NOT_VERIFIED"
                        ? "critical"
                        : "neutral"
                  }
                  dot
                >
                  {verification.status.replace("_", " ")}
                </Badge>
              ) : (
                <Badge tone="aqua" dot pulse>
                  {intervention.status}
                </Badge>
              )
            }
          />

          <div className="px-5 pb-5">
            <InterventionLifecycle intervention={intervention} />

            {verification ? (
              <VerificationResultSummary verification={verification} />
            ) : null}

            {verification?.status !== "VERIFIED" ? (
              <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.1fr]">
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-[11px]">
                    <span className="flex items-center gap-1.5 text-ink-muted">
                      <Clock className="size-3" />
                      Monitoring progress
                    </span>
                    <span className="num text-ink-soft">
                      {num(intervention.elapsed_days, 1)} /{" "}
                      {intervention.monitoring_days_required} days
                    </span>
                  </div>
                  <Progress value={intervention.progress_pct} tone="aqua" />

                  <p className="mt-4 text-[12px] leading-relaxed text-ink-soft">
                    {verification?.explanation ??
                      "Verification compares post-intervention consumption against a baseline model evaluated on the new period's own occupancy and weather. It needs enough telemetry to cover weekday, weekend and weather variation."}
                  </p>
                </div>

                <div className="rounded-card border border-[rgb(var(--line)/0.09)] bg-surface/50 p-4">
                  <div className="flex items-center gap-2">
                    <Activity className="size-3.5 text-aqua" />
                    <span className="text-[12px] font-medium text-ink">
                      Demo mode: fast-forward the meters
                    </span>
                  </div>
                  <p className="mt-2 text-[11.5px] leading-relaxed text-ink-muted">
                    In a real deployment you would simply wait a fortnight for
                    the meters to report. Here the built-in building simulator
                    generates those hours with the fault now closed, and the
                    identical M&amp;V engine measures the result.
                  </p>
                  <Button
                    variant="primary"
                    className="mt-4 w-full"
                    loading={monitorMutation.pending}
                    onClick={() => monitorMutation.mutate(intervention.id)}
                  >
                    {monitorMutation.pending ? (
                      "Collecting telemetry and verifying..."
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
                    <ErrorState error={monitorMutation.error} compact />
                  ) : null}
                </div>
              </div>
            ) : null}

            {verification ? <VerificationInterpretation verification={verification} /> : null}
          </div>
        </Panel>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
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

function displayEvidenceValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function RecommendationEvidenceBridge({
  evidence,
}: {
  evidence: Evidence[];
}) {
  const items = evidence as RecommendationEvidence[];
  const supporting = items.filter((item) => item.category !== "contradiction" && item.category !== "unknown");
  const contradictions = items.filter((item) => item.category === "contradiction");
  const unknowns = items.filter((item) => item.category === "unknown");

  if (!items.length) return null;

  const renderItem = (item: RecommendationEvidence, index: number) => (
    <div
      key={`${item.label ?? item.description ?? "evidence"}-${index}`}
      className="rounded-lg border border-[rgb(var(--line)/0.08)] bg-surface/45 px-3 py-2.5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="text-[11px] font-medium text-ink">
          {item.label ?? item.description ?? "Investigation evidence"}
        </span>
        {item.measured_value !== undefined || item.value !== undefined ? (
          <span className="num text-[10px] text-ink-soft">
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
        <div className="mt-1 text-[9.5px] text-ink-muted">
          Hypothesis: <span className="text-ink-soft">{item.hypothesis}</span>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="mt-5 rounded-card border border-aqua/18 bg-aqua/[0.025] p-4">
      <div className="eyebrow mb-1 text-aqua">Evidence informing this recommendation</div>
      <p className="mb-3 text-[11px] leading-relaxed text-ink-muted">
        The recommendation keeps the existing root-cause decision and carries
        forward the measured investigation evidence below.
      </p>
      <div className="space-y-2">{supporting.map(renderItem)}</div>
      {contradictions.length ? (
        <div className="mt-3 rounded-lg border border-critical/18 bg-critical/[0.04] p-2.5">
          <div className="eyebrow mb-2 text-critical">Contradictions retained</div>
          <div className="space-y-2">{contradictions.map(renderItem)}</div>
        </div>
      ) : null}
      {unknowns.length ? (
        <div className="mt-3 rounded-lg border border-medium/18 bg-medium/[0.04] p-2.5">
          <div className="eyebrow mb-2 text-medium">Unknowns retained</div>
          <div className="space-y-2">{unknowns.map(renderItem)}</div>
        </div>
      ) : null}
    </div>
  );
}

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
    <div className="mb-4 rounded-card border border-[rgb(var(--line)/0.09)] bg-surface/40 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="eyebrow">Intervention lifecycle</div>
          <div className="mt-1 text-[12px] text-ink-soft">
            Intervention #{intervention.id} · {intervention.status}
          </div>
        </div>
        <Link
          href={`/interventions#i${intervention.id}`}
          className="text-[11px] text-aqua hover:text-ink-soft"
        >
          Open intervention <ArrowRight className="ml-1 inline size-3" />
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {INTERVENTION_LIFECYCLE.map((status, index) => (
          <React.Fragment key={status}>
            <Badge
              tone={
                index < current
                  ? "mint"
                  : index === current
                    ? status === "VERIFIED" ? "mint" : "aqua"
                    : "neutral"
              }
              dot={index === current}
            >
              {status}
            </Badge>
            {index < INTERVENTION_LIFECYCLE.length - 1 ? (
              <span className="h-px w-3 bg-[rgb(var(--line)/0.14)]" />
            ) : null}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function verificationTone(status: Verification["status"]): "mint" | "aqua" | "critical" | "medium" {
  if (status === "VERIFIED") return "mint";
  if (status === "INSUFFICIENT_DATA") return "aqua";
  if (status === "INCONCLUSIVE") return "medium";
  return "critical";
}

function VerificationResultSummary({ verification }: { verification: Verification }) {
  return (
    <div className="mb-4 rounded-card border border-[rgb(var(--line)/0.09)] bg-surface/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="eyebrow">Latest verification result</div>
          <div className="mt-1 text-[12px] text-ink-soft">
            Measured against the adjusted baseline; no frontend recalculation is applied.
          </div>
        </div>
        <Badge tone={verificationTone(verification.status)} dot>
          {verification.status.replace(/_/g, " ")}
        </Badge>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[rgb(var(--line)/0.08)] bg-[rgb(var(--line)/0.06)] lg:grid-cols-5">
        <VerificationMetric label="Baseline" value={num(verification.baseline_value)} unit={verification.unit} />
        <VerificationMetric label="Adjusted baseline" value={num(verification.adjusted_baseline_value)} unit={verification.unit} />
        <VerificationMetric label="Post-intervention" value={num(verification.post_value)} unit={verification.unit} />
        <VerificationMetric label="Saving" value={pct(verification.saving_pct)} unit={`${compact(Math.abs(verification.absolute_saving), 1)} ${verification.unit}/wk`} />
        <VerificationMetric label="p-value" value={fmtP(verification.p_value)} unit={`threshold ${pct(verification.threshold_pct, 0)}`} />
      </div>
      <div className="mt-3 grid gap-2 text-[11px] text-ink-muted sm:grid-cols-2">
        <span>Financial: <strong className="text-ink-soft">{compact(verification.financial_saving_per_year, 1)} / year</strong></span>
        <span>Carbon: <strong className="text-ink-soft">{compact(verification.co2_reduction_per_year, 1)} kg / year</strong></span>
      </div>
    </div>
  );
}

function VerificationMetric({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <div className="bg-surface px-3 py-2.5">
      <div className="eyebrow mb-1">{label}</div>
      <div className="num text-[13px] font-semibold text-ink">{value}</div>
      <div className="mt-0.5 text-[9px] text-ink-muted">{unit}</div>
    </div>
  );
}

function VerificationInterpretation({ verification }: { verification: Verification }) {
  const message = verification.status === "INSUFFICIENT_DATA"
    ? "More post-intervention telemetry is required. This is not a failed intervention."
    : verification.status === "INCONCLUSIVE"
      ? "A measured reduction exists, but it did not satisfy the statistical significance requirement."
      : verification.status === "NOT_VERIFIED"
        ? "The measured result did not meet the verification threshold."
        : "The measured saving cleared both the threshold and significance gates.";

  return (
    <div className={cn(
      "rounded-card border p-4",
      verification.status === "VERIFIED"
        ? "border-mint/20 bg-mint/[0.04]"
        : verification.status === "INSUFFICIENT_DATA"
          ? "border-aqua/20 bg-aqua/[0.04]"
          : verification.status === "INCONCLUSIVE"
            ? "border-medium/20 bg-medium/[0.04]"
            : "border-critical/20 bg-critical/[0.04]",
    )}>
      <div className="text-[12px] font-medium text-ink">{message}</div>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-soft">
        {verification.explanation}
      </p>
    </div>
  );
}

// --------------------------------------------------------------------------
function LoopStepper({ stage }: { stage: Stage }) {
  const steps: { key: Stage; label: string; icon: React.ComponentType<{ className?: string }> }[] =
    [
      { key: "diagnosed", label: "Detected & diagnosed", icon: Radar },
      { key: "recommended", label: "Recommendation", icon: Brain },
      { key: "intervened", label: "Intervention applied", icon: Wrench },
      { key: "verified", label: "Saving verified", icon: BadgeCheck },
    ];
  const order: Stage[] = ["diagnosed", "recommended", "intervened", "verified"];
  const currentIndex = order.indexOf(stage);

  return (
    <div className="panel flex flex-wrap items-center gap-2 px-4 py-3">
      {steps.map((step, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;
        const Icon = step.icon;
        return (
          <React.Fragment key={step.key}>
            <div
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-1.5 transition-colors",
                active
                  ? "bg-mint/10 text-mint"
                  : done
                    ? "text-mint"
                    : "text-ink-muted",
              )}
            >
              {done ? (
                <CheckCircle2 className="size-3.5" />
              ) : (
                <Icon className="size-3.5" />
              )}
              <span className="text-[11.5px] font-medium">{step.label}</span>
            </div>
            {index < steps.length - 1 ? (
              <span
                className={cn(
                  "h-px w-5",
                  index < currentIndex ? "bg-mint/40" : "bg-[rgb(var(--line)/0.14)]",
                )}
              />
            ) : null}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function VerifiedResult({ verification }: { verification: Verification }) {
  const chartData = React.useMemo(() => {
    const map = new Map<
      string,
      { date: string; baseline?: number; post?: number; adjusted?: number }
    >();
    verification.series.baseline.forEach((p) => {
      map.set(p.date, { ...(map.get(p.date) ?? { date: p.date }), baseline: p.value });
    });
    verification.series.post.forEach((p) => {
      map.set(p.date, { ...(map.get(p.date) ?? { date: p.date }), post: p.value });
    });
    verification.series.adjusted_baseline.forEach((p) => {
      map.set(p.date, { ...(map.get(p.date) ?? { date: p.date }), adjusted: p.value });
    });
    return Array.from(map.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((row) => ({ ...row, date: dateShort(row.date) }));
  }, [verification]);

  const profile = (verification.hourly_profile.hours ?? []).map((hour, index) => ({
    hour: hourLabel(hour),
    before: verification.hourly_profile.baseline?.[index] ?? null,
    after: verification.hourly_profile.post?.[index] ?? null,
  }));

  return (
    <div className="space-y-4">
      {/* headline */}
      <div className="rounded-card border border-mint/25 bg-mint/[0.06] p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-lg border border-mint/30 bg-mint/15 text-mint">
              <BadgeCheck className="size-5" />
            </div>
            <div>
              <div className="num text-[26px] font-semibold leading-none text-mint">
                {compact(verification.absolute_saving, 1)}
                <span className="ml-1 text-[13px] font-normal text-ink-soft">
                  {verification.unit}/week saved
                </span>
              </div>
              <div className="num mt-1.5 text-[12px] text-ink-muted">
                {num(verification.adjusted_baseline_value)} &rarr;{" "}
                {num(verification.post_value)} {verification.unit}/week
              </div>
            </div>
          </div>
          <div className="num text-right">
            <div className="text-[30px] font-semibold leading-none text-mint">
              -{pct(verification.saving_pct)}
            </div>
            <div className="mt-1 text-[11px] text-ink-muted">
              against the adjusted baseline
            </div>
          </div>
        </div>

        <p className="mt-4 border-t border-mint/15 pt-3.5 text-[12.5px] leading-relaxed text-ink-soft">
          {verification.explanation}
        </p>
      </div>

      {/* value */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-[rgb(var(--line)/0.09)] bg-[rgb(var(--line)/0.07)] lg:grid-cols-4">
        <Figure
          label="Financial saving"
          value={`₹${compact(verification.financial_saving_per_year, 1)}`}
          unit="per year"
          tone="mint"
        />
        <Figure
          label="CO2 avoided"
          value={compact(verification.co2_reduction_per_year, 1)}
          unit="kg per year"
          tone="mint"
        />
        <Figure
          label="Significance"
          value={`p = ${fmtP(verification.p_value)}`}
          unit={`threshold ${pct(verification.threshold_pct, 0)}`}
        />
        <Figure
          label="Baseline model fit"
          value={`R2 ${num(verification.baseline_model_r2 ?? 0, 3)}`}
          unit={`CV(RMSE) ${pct(verification.baseline_model_cvrmse ?? 0)}`}
        />
      </div>

      {/* charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-card border border-[rgb(var(--line)/0.09)] bg-surface/40 p-4">
          <div className="eyebrow mb-3">Before and after, daily totals</div>
          <BeforeAfterChart
            data={chartData}
            unit={` ${verification.unit}`}
            height={240}
          />
        </div>
        <div className="rounded-card border border-[rgb(var(--line)/0.09)] bg-surface/40 p-4">
          <div className="eyebrow mb-3">Hour-of-day profile</div>
          <HourProfileChart
            data={profile}
            seriesA="before"
            seriesB="after"
            labelA="Before"
            labelB="After"
            colourA={CHART_COLOURS.critical}
            colourB={CHART_COLOURS.post}
            unit={` ${verification.unit}`}
            height={240}
          />
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-ink-muted">
        Method: {verification.method}. The adjusted baseline is the
        pre-intervention model evaluated on the post period&apos;s own occupancy
        and weather, so the saving is normalised rather than a naive
        before/after difference. Unadjusted difference for comparison:{" "}
        <span className="num">{pct(verification.series.raw_saving_pct)}</span>.
      </p>
    </div>
  );
}

function ContextGrid({
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
        { label: "Night-time flow", value: `${num(asNum("night_flow"), 1)} L/h`, ref: `${num(asNum("night_flow_reference"), 1)} L/h normally` },
        { label: "Flow persistence", value: pct(asNum("flow_persistence") * 100, 0), ref: `${num(asNum("low_occupancy_intervals"))} empty intervals` },
        { label: "Pump runtime", value: `${num(asNum("pump_runtime"), 0)} min/h`, ref: `${num(asNum("pump_reference"), 0)} min/h normally` },
        { label: "Occupancy", value: pct(asNum("occupancy_pct"), 1), ref: `${pct(asNum("occupancy_reference"), 1)} normally` },
        { label: "Off-hours share", value: pct(asNum("offhours_share") * 100, 0), ref: `${context.operating_hours ?? ""}` },
        { label: "Affected intervals", value: num(asNum("n_intervals")), ref: `over ${num(asNum("span_days"), 0)} days` },
      ]
    : [
        { label: "HVAC runtime", value: `${num(asNum("hvac_runtime"), 0)} min/h`, ref: `${num(asNum("hvac_reference"), 0)} min/h normally` },
        { label: "Lighting runtime", value: `${num(asNum("lighting_runtime"), 0)} min/h`, ref: `${num(asNum("lighting_reference"), 0)} min/h normally` },
        { label: "Occupancy", value: pct(asNum("occupancy_pct"), 1), ref: `${pct(asNum("occupancy_reference"), 1)} normally` },
        { label: "Indoor temperature", value: `${num(asNum("indoor_temperature"), 1)} C`, ref: "comfort band 20-27.5 C" },
        { label: "Outdoor temperature", value: `${num(asNum("outdoor_temperature"), 1)} C`, ref: `${num(asNum("outdoor_reference"), 1)} C normally` },
        { label: "Off-hours share", value: pct(asNum("offhours_share") * 100, 0), ref: `${context.operating_hours ?? ""}` },
      ];

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-[rgb(var(--line)/0.09)] bg-[rgb(var(--line)/0.07)]">
      {rows.map((row) => (
        <div key={row.label} className="bg-surface px-4 py-3">
          <div className="eyebrow mb-1">{row.label}</div>
          <div className="num text-[14px] font-semibold text-ink">{row.value}</div>
          <div className="num mt-0.5 text-[10px] text-ink-muted">{row.ref}</div>
        </div>
      ))}
    </div>
  );
}

function Figure({
  label,
  value,
  unit,
  tone,
  muted,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: "critical" | "mint" | "iris";
  muted?: boolean;
}) {
  return (
    <div className="bg-canvas px-4 py-3.5">
      <div className="eyebrow mb-1.5">{label}</div>
      <div
        className={cn(
          "num text-[18px] font-semibold leading-none",
          tone === "critical"
            ? "text-critical"
            : tone === "mint"
              ? "text-mint"
              : tone === "iris"
                ? "text-iris"
                : muted
                  ? "text-ink-soft"
                  : "text-ink",
        )}
      >
        {value}
      </div>
      {unit ? <div className="mt-1 text-[10px] text-ink-muted">{unit}</div> : null}
    </div>
  );
}

function SavingTile({
  icon: Icon,
  value,
  unit,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  unit: string;
}) {
  return (
    <div className="bg-surface px-3 py-3">
      <Icon className="size-3 text-ink-muted" />
      <div className="num mt-1.5 text-[14px] font-semibold text-ink">{value}</div>
      <div className="mt-0.5 text-[9px] text-ink-muted">{unit}</div>
    </div>
  );
}
