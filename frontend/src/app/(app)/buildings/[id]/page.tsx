"use client";

import {
  ArrowLeft,
  ArrowRight,
  Brain,
  Droplets,
  Gauge,
  Lightbulb,
  Thermometer,
  Users,
  Wind,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";

import {
  AnomalyCard,
  EvidenceList,
  InterventionCard,
  RecommendationCard,
} from "@/components/cards/domain-cards";
import {
  ActualVsExpectedChart,
  CHART_COLOURS,
  HourProfileChart,
  type ActualExpectedPoint,
} from "@/components/charts/primitives";
import { useAppState } from "@/components/providers/app-state";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  LoadingPanel,
  Panel,
  PanelHeader,
  Segmented,
  Skeleton,
  StatusDot,
} from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { compact, dateShort, num, pct, signedPct } from "@/lib/format";
import type { BuildingDetail, Recommendation, SeriesPoint } from "@/lib/types";
import { useApi, useMutation } from "@/lib/use-api";
import { cn } from "@/lib/utils";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  zap: Zap,
  droplets: Droplets,
  wind: Wind,
  lightbulb: Lightbulb,
};

export default function BuildingDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  const { range } = useAppState();

  const { data, error, loading, refetch } = useApi<BuildingDetail>(
    Number.isFinite(id) ? `/api/buildings/${id}?days=${range}` : null,
    [id, range],
  );

  const [chartMetric, setChartMetric] = React.useState<
    "energy" | "water" | "occupancy" | "temperature" | "runtime"
  >("energy");

  const apply = useMutation(async (rec: Recommendation) => {
    await api.post(`/api/recommendations/${rec.id}/apply`, {});
    await refetch({ quiet: true });
  });
  const [applyingId, setApplyingId] = React.useState<number | null>(null);

  if (!Number.isFinite(id)) {
    return (
      <div className="pt-10">
        <ErrorState
          error={{
            message: `"${params?.id}" is not a valid building id.`,
            hint: "Pick a building from the portfolio.",
          }}
        />
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" asChild>
            <Link href="/buildings">Back to buildings</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-4 pt-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/buildings">
            <ArrowLeft /> Buildings
          </Link>
        </Button>
        <ErrorState error={error} onRetry={() => refetch()} />
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-[340px]" />
      </div>
    );
  }

  if (!data) return null;

  const { building, stats } = data;
  const statusTone =
    building.status === "CRITICAL"
      ? "critical"
      : building.status === "WARNING"
        ? "medium"
        : "mint";

  const openAnomalies = data.anomalies.filter(
    (a) => a.status === "OPEN" || a.status === "DIAGNOSED",
  );
  const primaryAnomaly = openAnomalies[0] ?? data.anomalies[0] ?? null;
  const primaryRecommendation =
    data.recommendations.find((r) => r.anomaly_id === primaryAnomaly?.id) ?? null;

  return (
    <div className="space-y-5">
      {/* ---- header ---- */}
      <header>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-3">
          <Link href="/buildings">
            <ArrowLeft /> Buildings
          </Link>
        </Button>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <StatusDot
                tone={statusTone as "mint" | "medium" | "critical"}
                pulse={building.status !== "NORMAL"}
              />
              <span className="num text-[11px] text-ink-muted">{building.code}</span>
              <Badge tone="neutral">{building.category}</Badge>
            </div>
            <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink">
              {building.name}
            </h1>
            <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-ink-muted">
              {building.description}
            </p>
          </div>
          <Button variant="secondary" size="sm" asChild>
            <Link href="/digital-twin">
              View in twin <ArrowRight />
            </Link>
          </Button>
        </div>
      </header>

      {/* ---- building information ---- */}
      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-[rgb(var(--line)/0.1)] bg-[rgb(var(--line)/0.07)] sm:grid-cols-4 lg:grid-cols-7">
        <Fact label="Area" value={`${num(building.area_sqm)}`} unit="m2" />
        <Fact label="Floors" value={num(building.floors)} />
        <Fact
          label="Capacity"
          value={num(building.occupancy_capacity)}
          unit="people"
        />
        <Fact
          label="Operating hours"
          value={`${String(building.operating_hours_start).padStart(2, "0")}-${String(
            building.operating_hours_end,
          ).padStart(2, "0")}`}
        />
        <Fact label="Built" value={num(building.year_built)} />
        <Fact
          label="Peak demand"
          value={num(stats.peak_demand_kw as number, 1)}
          unit="kW"
        />
        <Fact
          label="Avg occupancy"
          value={pct(stats.avg_occupancy_pct as number, 0)}
        />
      </section>

      {/* ---- resource cards ---- */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.subsystems.map((sub, index) => {
          const Icon = ICONS[sub.icon] ?? Gauge;
          const bad = sub.deviation_pct > 3;
          return (
            <Panel
              key={sub.key}
              className="p-5 animate-fade-up"
              style={{ animationDelay: `${index * 45}ms` }}
            >
              <div className="flex items-start justify-between">
                <div className="eyebrow">{sub.label}</div>
                <Icon
                  className={cn(
                    "size-4",
                    sub.key === "water" ? "text-aqua" : "text-mint",
                  )}
                />
              </div>
              <div className="num mt-3 text-[24px] font-semibold leading-none text-ink">
                {compact(sub.value, 1)}
                <span className="ml-1 text-[12px] font-normal text-ink-muted">
                  {sub.unit}
                </span>
              </div>
              <div className="mt-2 text-[11px] text-ink-muted">{sub.secondary}</div>
              {sub.deviation_pct !== 0 ? (
                <div
                  className={cn(
                    "num mt-2 text-[11px]",
                    bad ? "text-high" : "text-mint",
                  )}
                >
                  {signedPct(sub.deviation_pct)} vs expected
                </div>
              ) : (
                <div className="mt-2 text-[11px] text-ink-muted">{sub.detail}</div>
              )}
            </Panel>
          );
        })}
      </section>

      <p className="text-[11px] leading-relaxed text-ink-muted">
        {stats.apportionment_note as string}
      </p>

      {/* ---- charts ---- */}
      <Panel>
        <PanelHeader
          eyebrow="Telemetry"
          title="Actual against expected"
          subtitle="Shaded bands mark the exact intervals the detector flagged."
          action={
            <Segmented
              size="sm"
              options={[
                { value: "energy", label: "Energy" },
                { value: "water", label: "Water" },
                { value: "occupancy", label: "Occupancy" },
                { value: "temperature", label: "Temperature" },
                { value: "runtime", label: "Runtime" },
              ]}
              value={chartMetric}
              onChange={setChartMetric}
            />
          }
        />
        <div className="px-2 pb-5">
          <BuildingChart
            metric={chartMetric}
            energy={data.energy_series}
            water={data.water_series}
          />
        </div>
      </Panel>

      {/* ---- AI analysis ---- */}
      <section className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <Panel className="flex flex-col">
          <PanelHeader
            eyebrow="AI analysis"
            title={
              primaryAnomaly ? (
                <span className="flex items-center gap-2">
                  <Brain className="size-4 text-iris" />
                  Diagnosis
                </span>
              ) : (
                "No anomaly to diagnose"
              )
            }
            subtitle={
              primaryAnomaly
                ? "Produced by a deterministic rule engine over measured evidence."
                : undefined
            }
            action={
              primaryAnomaly ? (
                <Badge tone="iris">
                  {pct((primaryAnomaly.confidence ?? 0) * 100, 0)} confidence
                </Badge>
              ) : null
            }
          />

          {primaryAnomaly ? (
            <div className="flex flex-1 flex-col px-5 pb-5">
              <div className="rounded-card border border-critical/20 bg-critical/[0.05] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-ink">
                    Abnormal{" "}
                    {primaryAnomaly.resource_type === "WATER"
                      ? "water"
                      : "electricity"}{" "}
                    consumption detected
                  </span>
                  <Badge
                    tone={
                      primaryAnomaly.severity.toLowerCase() as
                        | "low"
                        | "medium"
                        | "high"
                        | "critical"
                    }
                    dot
                  >
                    {primaryAnomaly.severity}
                  </Badge>
                </div>
                <div className="num mt-2 text-[11px] text-ink-muted">
                  {num(primaryAnomaly.actual_value, 1)} {primaryAnomaly.unit} against{" "}
                  {num(primaryAnomaly.expected_value, 1)} {primaryAnomaly.unit}{" "}
                  expected &middot; {signedPct(primaryAnomaly.deviation_pct)} over{" "}
                  {num(primaryAnomaly.flagged_intervals)} intervals
                </div>
              </div>

              <div className="mt-4">
                <div className="eyebrow mb-1.5">Probable cause</div>
                <p className="font-display text-[15px] font-semibold text-ink">
                  {primaryAnomaly.probable_cause}
                </p>
                <p className="mt-1 text-[11px] text-ink-muted">
                  Affected subsystem: {primaryAnomaly.affected_subsystem}
                </p>
              </div>

              {primaryAnomaly.diagnosis_narrative ? (
                <p className="mt-3 text-[12.5px] leading-relaxed text-ink-soft">
                  {primaryAnomaly.diagnosis_narrative}
                </p>
              ) : null}

              <div className="mt-4">
                <div className="eyebrow mb-2">Evidence</div>
                <EvidenceList evidence={primaryAnomaly.evidence ?? []} />
              </div>

              <div className="mt-4 flex items-center justify-between gap-3 border-t border-[rgb(var(--line)/0.08)] pt-4">
                <span className="text-[11px] text-ink-muted">
                  {primaryAnomaly.narrative_source === "llm"
                    ? "Narrative rewritten by LLM. Cause and confidence from rules."
                    : "Rule-engine output. No LLM involved."}
                </span>
                <Button variant="secondary" size="sm" asChild>
                  <Link href={`/anomalies/${primaryAnomaly.id}`}>
                    Full analysis <ArrowRight />
                  </Link>
                </Button>
              </div>
            </div>
          ) : (
            <div className="px-5 pb-5">
              <EmptyState
                icon={Brain}
                title="Nothing to diagnose"
                description="This building is tracking its expected-consumption baseline across both resources."
                compact
              />
            </div>
          )}
        </Panel>

        <div className="space-y-4">
          {primaryRecommendation ? (
            <RecommendationCard
              recommendation={primaryRecommendation}
              applying={applyingId === primaryRecommendation.id && apply.pending}
              showBuilding={false}
              onApply={async (r) => {
                setApplyingId(r.id);
                await apply.mutate(r);
                setApplyingId(null);
              }}
            />
          ) : null}
          {apply.error ? <ErrorState error={apply.error} compact /> : null}

          <Panel className="p-5">
            <div className="eyebrow mb-3">Load breakdown over {range} days</div>
            <div className="space-y-2.5">
              <LoadRow
                label="HVAC"
                value={stats.hvac_kwh as number}
                total={data.subsystems[0]?.value ?? 1}
                tone="bg-mint"
              />
              <LoadRow
                label="Lighting"
                value={stats.lighting_kwh as number}
                total={data.subsystems[0]?.value ?? 1}
                tone="bg-aqua"
              />
              <LoadRow
                label="Base load"
                value={stats.base_load_kwh as number}
                total={data.subsystems[0]?.value ?? 1}
                tone="bg-iris"
              />
              <LoadRow
                label="Plug and process"
                value={stats.plug_load_kwh as number}
                total={data.subsystems[0]?.value ?? 1}
                tone="bg-medium"
              />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 border-t border-[rgb(var(--line)/0.08)] pt-3.5">
              <MiniFact
                icon={Thermometer}
                label="Avg indoor"
                value={`${num(stats.avg_indoor_temp as number, 1)} C`}
              />
              <MiniFact
                icon={Thermometer}
                label="Avg outdoor"
                value={`${num(stats.avg_outdoor_temp as number, 1)} C`}
              />
              <MiniFact
                icon={Users}
                label="Peak occupancy"
                value={num(stats.peak_occupancy as number)}
              />
              <MiniFact
                icon={Droplets}
                label="Night flow"
                value={`${num(stats.night_flow_lph as number, 1)} L/h`}
              />
            </div>
          </Panel>
        </div>
      </section>

      {/* ---- anomalies + interventions ---- */}
      <section className="grid items-start gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader
            eyebrow="History"
            title={`Anomalies (${data.anomalies.length})`}
          />
          <div className="space-y-2 px-4 pb-5">
            {data.anomalies.length ? (
              data.anomalies.map((anomaly) => (
                <AnomalyCard key={anomaly.id} anomaly={anomaly} />
              ))
            ) : (
              <EmptyState
                title="No anomalies recorded"
                description="This building has stayed within its expected band."
                compact
              />
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="Actions taken"
            title={`Interventions (${data.interventions.length})`}
          />
          <div className="space-y-3 px-4 pb-5">
            {data.interventions.length ? (
              data.interventions.map((intervention) => (
                <InterventionCard key={intervention.id} intervention={intervention} />
              ))
            ) : (
              <EmptyState
                title="No interventions yet"
                description="Applying a recommendation creates one and opens the monitoring period."
                compact
              />
            )}
          </div>
        </Panel>
      </section>
    </div>
  );
}

// --------------------------------------------------------------------------
function BuildingChart({
  metric,
  energy,
  water,
}: {
  metric: "energy" | "water" | "occupancy" | "temperature" | "runtime";
  energy: SeriesPoint[];
  water: SeriesPoint[];
}) {
  const source = metric === "water" ? water : energy;

  if (!source.length) {
    return (
      <EmptyState
        icon={Gauge}
        title="No telemetry in this window"
        description="Widen the date range or seed the database."
      />
    );
  }

  if (metric === "energy" || metric === "water") {
    const data: ActualExpectedPoint[] = source.map((point) => ({
      label: dateShort(point.ts),
      actual: point.actual,
      expected: point.expected,
      is_anomalous: point.is_anomalous,
      occupancy_pct: point.occupancy_pct,
    }));
    return (
      <ActualVsExpectedChart
        data={data}
        resource={metric === "water" ? "WATER" : "ENERGY"}
        unit={metric === "water" ? " L" : " kWh"}
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
    );
  }

  if (metric === "occupancy") {
    const data: ActualExpectedPoint[] = energy.map((point) => ({
      label: dateShort(point.ts),
      actual: point.occupancy_pct ?? 0,
      is_anomalous: point.is_anomalous,
    }));
    return (
      <ActualVsExpectedChart
        data={data}
        resource="ENERGY"
        unit="%"
        height={300}
        showExpected={false}
      />
    );
  }

  if (metric === "temperature") {
    const data = energy.map((point) => ({
      label: dateShort(point.ts),
      actual: point.temperature ?? 0,
      expected: point.outdoor_temperature ?? null,
      is_anomalous: false,
    }));
    return (
      <>
        <ActualVsExpectedChart
          data={data}
          resource="ENERGY"
          unit=" C"
          height={300}
          decimals={1}
        />
        <p className="px-4 text-[11px] text-ink-muted">
          Solid: indoor temperature. Dashed: outdoor temperature.
        </p>
      </>
    );
  }

  // runtime
  const runtimeData = energy.map((point, index) => ({
    hour: dateShort(point.ts),
    hvac: point.hvac_runtime ?? 0,
    lighting: point.lighting_runtime ?? 0,
    pump: water[index]?.pump_runtime ?? 0,
  }));

  return (
    <>
      <HourProfileChart
        data={runtimeData}
        seriesA="lighting"
        seriesB="hvac"
        labelA="Lighting runtime"
        labelB="HVAC runtime"
        colourA={CHART_COLOURS.water}
        colourB={CHART_COLOURS.energy}
        unit=" min/h"
        height={300}
      />
      <p className="px-4 text-[11px] text-ink-muted">
        Equipment runtime in minutes per hour. Runtime is deliberately excluded
        from the expected-consumption model so that it stays available as
        evidence rather than being absorbed into the baseline.
      </p>
    </>
  );
}

function Fact({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className="bg-canvas px-4 py-3.5">
      <div className="eyebrow mb-1">{label}</div>
      <div className="num text-[15px] font-semibold text-ink">
        {value}
        {unit ? (
          <span className="ml-1 text-[10px] font-normal text-ink-muted">{unit}</span>
        ) : null}
      </div>
    </div>
  );
}

function LoadRow({
  label,
  value,
  total,
  tone,
}: {
  label: string;
  value: number;
  total: number;
  tone: string;
}) {
  const share = total > 0 ? (value / total) * 100 : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="text-ink-soft">{label}</span>
        <span className="num text-ink-muted">
          {compact(value, 1)} kWh &middot; {pct(share, 0)}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[rgb(var(--line)/0.07)]">
        <div
          className={cn("h-full rounded-full transition-all duration-700", tone)}
          style={{ width: `${Math.max(0, Math.min(100, share))}%` }}
        />
      </div>
    </div>
  );
}

function MiniFact({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-3.5 text-ink-muted" />
      <div>
        <div className="text-[10px] text-ink-muted">{label}</div>
        <div className="num text-[12px] font-medium text-ink-soft">{value}</div>
      </div>
    </div>
  );
}
