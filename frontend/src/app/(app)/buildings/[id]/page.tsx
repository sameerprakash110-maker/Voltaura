"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";

import { AnomalyTable } from "@/components/domain/anomaly-table";
import { EvidenceList } from "@/components/domain/evidence";
import { InterventionRecord } from "@/components/domain/intervention";
import { RecommendationList } from "@/components/domain/recommendation-list";
import {
  ActualVsExpectedChart,
  CHART_COLOURS,
  ChartFrame,
  HourProfileChart,
  LegendKey,
  type ActualExpectedPoint,
} from "@/components/charts/primitives";
import { useAppState } from "@/components/providers/app-state";
import {
  Button,
  EmptyState,
  ErrorState,
  Segmented,
  Skeleton,
} from "@/components/ui/primitives";
import {
  KeyValue,
  Metric,
  MiniBar,
  Num,
  Section,
  StatusText,
  Table,
} from "@/components/ui/structure";
import { api } from "@/lib/api";
import { compact, dateShort, num, pct, signedPct } from "@/lib/format";
import type { BuildingDetail, Recommendation, SeriesPoint } from "@/lib/types";
import { useApi, useMutation } from "@/lib/use-api";
import { cn } from "@/lib/utils";

/**
 * Building engineering report.
 *
 * Reads as a document rather than as a dashboard: specification, current
 * state, measured performance, diagnosis, what was done about it, and what
 * that produced. One vertical spine, no side-by-side cards competing for the
 * same attention.
 */
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
      <div className="space-y-4 pt-8">
        <ErrorState
          error={{
            message: `"${params?.id}" is not a valid building id.`,
            hint: "Pick a building from the portfolio.",
          }}
        />
        <Button variant="secondary" size="sm" asChild>
          <Link href="/buildings">Back to portfolio</Link>
        </Button>
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
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-[320px] w-full" />
      </div>
    );
  }

  if (!data) return null;

  const { building, stats } = data;

  const openAnomalies = data.anomalies.filter(
    (a) => a.status === "OPEN" || a.status === "DIAGNOSED",
  );
  const primaryAnomaly = openAnomalies[0] ?? data.anomalies[0] ?? null;
  const primaryRecommendation =
    data.recommendations.find((r) => r.anomaly_id === primaryAnomaly?.id) ?? null;
  const verifiedInterventions = data.interventions.filter(
    (i) => i.verification_status !== null,
  );

  const energyTotal = data.subsystems[0]?.value ?? 1;

  return (
    <div className="space-y-9">
      {/* ================= header ================= */}
      <header>
        <BackLink />
        <div className="mt-4 flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <span className="num text-[11px] text-ink-faint">{building.code}</span>
              <StatusText status={building.status} />
            </div>
            <h1 className="mt-2 text-[26px] font-semibold leading-none tracking-[-0.03em] text-ink">
              {building.name}
            </h1>
            <p className="mt-2 text-[12.5px] text-ink-muted">{building.category}</p>
            <p className="mt-3 max-w-2xl text-[12.5px] leading-relaxed text-ink-soft">
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

      {/* ================= specification ================= */}
      <section className="grid gap-x-6 gap-y-5 border-y border-[rgb(var(--line)/0.08)] py-5 grid-cols-2 sm:grid-cols-4 lg:grid-cols-7">
        <KeyValue label="Area" value={`${num(building.area_sqm)} m²`} />
        <KeyValue label="Floors" value={num(building.floors)} />
        <KeyValue
          label="Capacity"
          value={`${num(building.occupancy_capacity)} people`}
        />
        <KeyValue
          label="Operating hours"
          value={`${String(building.operating_hours_start).padStart(2, "0")}–${String(
            building.operating_hours_end,
          ).padStart(2, "0")}`}
        />
        <KeyValue label="Built" value={String(building.year_built)} />
        <KeyValue
          label="Peak demand"
          value={`${num(stats.peak_demand_kw as number, 1)} kW`}
        />
        <KeyValue
          label="Avg occupancy"
          value={pct(stats.avg_occupancy_pct as number, 0)}
        />
      </section>

      {/* ================= current state ================= */}
      <Section
        label="Current state"
        title={`Measured over the last ${data.range_days} days`}
        description={stats.apportionment_note as string}
      >
        <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2 xl:grid-cols-6">
          {data.subsystems.map((sub) => (
            <Metric
              key={sub.key}
              label={sub.label}
              value={compact(sub.value, 1)}
              unit={sub.unit}
              size="lg"
              tone={sub.key === "water" ? "ink" : "ink"}
              caption={sub.secondary}
              delta={
                sub.deviation_pct !== 0 ? (
                  <span
                    className={cn(
                      "num text-[11.5px] font-medium",
                      sub.deviation_pct > 3 ? "text-high" : "text-mint",
                    )}
                  >
                    {signedPct(sub.deviation_pct)} vs expected
                  </span>
                ) : undefined
              }
            />
          ))}
          <Metric
            label="Occupancy now"
            value={num(building.occupancy_now)}
            unit={`of ${building.occupancy_capacity}`}
            size="lg"
            caption={pct(building.occupancy_pct_now, 0)}
          />
          <Metric
            label="Indoor temperature"
            value={num(building.temperature_now, 1)}
            unit="°C"
            size="lg"
            caption={`outdoor ${num(stats.avg_outdoor_temp as number, 1)} °C avg`}
          />
        </div>
      </Section>

      {/* ================= resource performance ================= */}
      <Section
        label="Resource performance"
        title="Measured consumption against modelled baseline"
        description="Shaded bands mark the intervals flagged as abnormal."
        actions={
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
      >
        <BuildingChart
          metric={chartMetric}
          energy={data.energy_series}
          water={data.water_series}
        />
      </Section>

      {/* ================= load breakdown ================= */}
      <Section
        label="Load breakdown"
        title={`Where the ${data.range_days}-day electrical load went`}
      >
        <div className="grid gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Table minWidth={420}>
            <thead>
              <tr>
                <th className="w-[26%]">End use</th>
                <th className="text-right">kWh</th>
                <th className="w-[40%]">Share</th>
                <th className="pr-0 text-right">%</th>
              </tr>
            </thead>
            <tbody>
              <LoadRow label="HVAC" value={stats.hvac_kwh as number} total={energyTotal} tone="mint" />
              <LoadRow
                label="Lighting"
                value={stats.lighting_kwh as number}
                total={energyTotal}
                tone="aqua"
              />
              <LoadRow
                label="Base load"
                value={stats.base_load_kwh as number}
                total={energyTotal}
                tone="iris"
              />
              <LoadRow
                label="Plug and process"
                value={stats.plug_load_kwh as number}
                total={energyTotal}
                tone="medium"
              />
            </tbody>
          </Table>

          <div className="grid grid-cols-2 gap-x-6 gap-y-5 border-t border-[rgb(var(--line)/0.08)] pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
            <KeyValue
              label="Avg indoor"
              value={`${num(stats.avg_indoor_temp as number, 1)} °C`}
            />
            <KeyValue
              label="Avg outdoor"
              value={`${num(stats.avg_outdoor_temp as number, 1)} °C`}
            />
            <KeyValue
              label="Peak occupancy"
              value={num(stats.peak_occupancy as number)}
            />
            <KeyValue
              label="Night flow"
              value={`${num(stats.night_flow_lph as number, 1)} L/h`}
            />
          </div>
        </div>
      </Section>

      {/* ================= diagnosis ================= */}
      <Section
        label="AI diagnosis"
        title={primaryAnomaly ? "Probable cause" : "Nothing to diagnose"}
        description={
          primaryAnomaly
            ? "Based on the measured evidence for this building. Confidence reflects how much of that evidence points to this cause rather than to a competing one."
            : undefined
        }
        actions={
          primaryAnomaly ? (
            <span className="num text-[11px] text-ink-muted">
              {pct((primaryAnomaly.confidence ?? 0) * 100, 0)} confidence
            </span>
          ) : null
        }
      >
        {primaryAnomaly ? (
          <div className="grid gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div>
              <h3 className="text-[17px] font-semibold leading-snug tracking-[-0.02em] text-ink">
                {primaryAnomaly.probable_cause}
              </h3>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                <StatusText status={primaryAnomaly.severity} />
                <span className="text-[11px] text-ink-muted">
                  {primaryAnomaly.affected_subsystem}
                </span>
                <span className="num text-[11px] text-ink-muted">
                  {num(primaryAnomaly.actual_value, 1)} vs{" "}
                  {num(primaryAnomaly.expected_value, 1)} {primaryAnomaly.unit}{" "}
                  expected · {signedPct(primaryAnomaly.deviation_pct)} over{" "}
                  {num(primaryAnomaly.flagged_intervals)} intervals
                </span>
              </div>

              {primaryAnomaly.diagnosis_narrative ? (
                <p className="mt-4 max-w-prose text-[12.5px] leading-relaxed text-ink-soft">
                  {primaryAnomaly.diagnosis_narrative}
                </p>
              ) : null}

              <div className="mt-5">
                <Button variant="secondary" size="sm" asChild>
                  <Link href={`/anomalies/${primaryAnomaly.id}`}>
                    Full analysis <ArrowRight />
                  </Link>
                </Button>
              </div>
            </div>

            <div>
              <div className="label mb-3">
                Evidence ·{" "}
                {(primaryAnomaly.evidence ?? []).filter((e) => e.satisfied).length} of{" "}
                {(primaryAnomaly.evidence ?? []).length} conditions met
              </div>
              <EvidenceList evidence={primaryAnomaly.evidence ?? []} />
            </div>
          </div>
        ) : (
          <EmptyState
            title="No anomaly to diagnose"
            description="This building is tracking its expected-consumption baseline across both resources."
            compact
          />
        )}
      </Section>

      {/* ================= recommendation ================= */}
      {primaryRecommendation ? (
        <Section label="Recommended action" title="Evidence-based measure">
          {apply.error ? <ErrorState error={apply.error} compact /> : null}
          <RecommendationList
            recommendations={[primaryRecommendation]}
            showBuilding={false}
            applyingId={apply.pending ? applyingId : null}
            onApply={async (rec) => {
              setApplyingId(rec.id);
              await apply.mutate(rec);
              setApplyingId(null);
            }}
          />
        </Section>
      ) : null}

      {/* ================= anomaly history ================= */}
      <Section
        label="History"
        title={`${data.anomalies.length} recorded ${
          data.anomalies.length === 1 ? "anomaly" : "anomalies"
        }`}
      >
        <AnomalyTable
          anomalies={data.anomalies}
          dense
          emptyTitle="No anomalies recorded"
          emptyDescription="This building has stayed within its expected band."
        />
      </Section>

      {/* ================= interventions ================= */}
      <Section
        label="Interventions"
        title={`${data.interventions.length} ${
          data.interventions.length === 1 ? "measure" : "measures"
        } applied`}
      >
        {data.interventions.length ? (
          <div className="divide-y divide-[rgb(var(--line)/0.08)]">
            {data.interventions.map((intervention) => (
              <InterventionRecord key={intervention.id} intervention={intervention} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No interventions yet"
            description="Applying a recommendation creates one and opens the monitoring period."
            compact
          />
        )}
      </Section>

      {/* ================= verification ================= */}
      <Section
        label="Verification"
        title="Measured outcome of the measures applied here"
      >
        {verifiedInterventions.length ? (
          <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2 xl:grid-cols-4">
            {verifiedInterventions.map((intervention) => (
              <Metric
                key={intervention.id}
                label={intervention.title}
                value={
                  intervention.verified_saving_pct !== null
                    ? `−${pct(intervention.verified_saving_pct)}`
                    : "—"
                }
                size="lg"
                tone={
                  intervention.verification_status === "VERIFIED" ? "mint" : "muted"
                }
                caption={
                  intervention.verified_saving !== null
                    ? `${compact(intervention.verified_saving, 1)} ${
                        intervention.expected_saving_unit ?? ""
                      }/wk measured`
                    : undefined
                }
                delta={<StatusText status={intervention.verification_status} />}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="Nothing verified for this block yet"
            description="A saving is measured only after its monitoring period completes."
            compact
          />
        )}
      </Section>
    </div>
  );
}

// --------------------------------------------------------------------------
function BackLink() {
  return (
    <Link
      href="/buildings"
      className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-muted transition-colors hover:text-ink-soft"
    >
      <ArrowLeft className="size-3" /> Portfolio
    </Link>
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
  tone: "mint" | "aqua" | "iris" | "medium";
}) {
  const share = total > 0 ? (value / total) * 100 : 0;
  return (
    <tr>
      <td className="text-ink-soft">{label}</td>
      <td className="text-right">
        <Num tone="ink">{compact(value, 1)}</Num>
      </td>
      <td>
        <MiniBar value={share} tone={tone} width={132} />
      </td>
      <td className="pr-0 text-right">
        <Num>{pct(share, 0)}</Num>
      </td>
    </tr>
  );
}

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
      <ChartFrame
        title={metric === "water" ? "Water · litres" : "Energy · kWh"}
        legend={
          <>
            <LegendKey
              colour={metric === "water" ? CHART_COLOURS.water : CHART_COLOURS.energy}
              label="Metered"
            />
            <LegendKey colour={CHART_COLOURS.expected} label="Expected" dashed />
            <LegendKey colour={CHART_COLOURS.critical} label="Flagged interval" band />
          </>
        }
      >
        <ActualVsExpectedChart
          data={data}
          resource={metric === "water" ? "WATER" : "ENERGY"}
          unit={metric === "water" ? " L" : " kWh"}
          height={320}
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
    );
  }

  if (metric === "occupancy") {
    const data: ActualExpectedPoint[] = energy.map((point) => ({
      label: dateShort(point.ts),
      actual: point.occupancy_pct ?? 0,
      is_anomalous: point.is_anomalous,
    }));
    return (
      <ChartFrame title="Occupancy · percent of capacity">
        <ActualVsExpectedChart
          data={data}
          resource="ENERGY"
          unit="%"
          height={320}
          showExpected={false}
        />
      </ChartFrame>
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
      <ChartFrame
        title="Temperature · °C"
        legend={
          <>
            <LegendKey colour={CHART_COLOURS.energy} label="Indoor" />
            <LegendKey colour={CHART_COLOURS.expected} label="Outdoor" dashed />
          </>
        }
      >
        <ActualVsExpectedChart
          data={data}
          resource="ENERGY"
          unit=" °C"
          height={320}
          decimals={1}
        />
      </ChartFrame>
    );
  }

  const runtimeData = energy.map((point, index) => ({
    hour: dateShort(point.ts),
    hvac: point.hvac_runtime ?? 0,
    lighting: point.lighting_runtime ?? 0,
    pump: water[index]?.pump_runtime ?? 0,
  }));

  return (
    <ChartFrame
      title="Equipment runtime · minutes per hour"
      legend={
        <>
          <LegendKey colour={CHART_COLOURS.energy} label="HVAC" />
          <LegendKey colour={CHART_COLOURS.water} label="Lighting" dashed />
          <span className="text-[10.5px] text-ink-faint">
            Equipment runtime is kept out of the baseline so it stays usable as
            evidence.
          </span>
        </>
      }
    >
      <HourProfileChart
        data={runtimeData}
        seriesA="lighting"
        seriesB="hvac"
        labelA="Lighting runtime"
        labelB="HVAC runtime"
        colourA={CHART_COLOURS.water}
        colourB={CHART_COLOURS.energy}
        unit=" min/h"
        height={320}
      />
    </ChartFrame>
  );
}
