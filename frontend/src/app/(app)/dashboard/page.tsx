"use client";

import { ArrowRight, RefreshCw } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { AnomalyTable, SeverityBar } from "@/components/domain/anomaly-table";
import { BuildingComparison } from "@/components/domain/building-comparison";
import { RecommendationList } from "@/components/domain/recommendation-list";
import {
  CampusHeadline,
  ResourceSummary,
  kpiValue,
} from "@/components/domain/resource-summary";
import {
  VerificationTable,
  VerifiedImpact,
} from "@/components/domain/verification";
import {
  CHART_COLOURS,
  CampusChart,
  ChartFrame,
  LegendKey,
} from "@/components/charts/primitives";
import { PipelineRail } from "@/components/layout/pipeline-rail";
import { useAppState } from "@/components/providers/app-state";
import { LiveTelemetryPanel } from "@/components/telemetry/live-telemetry-panel";
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingPanel,
  Segmented,
  Skeleton,
} from "@/components/ui/primitives";
import { Metric, Section } from "@/components/ui/structure";
import { api } from "@/lib/api";
import { dateTime, num, telemetryStamp } from "@/lib/format";
import type { Dashboard, Recommendation } from "@/lib/types";
import { useApi, useMutation } from "@/lib/use-api";

/**
 * Campus command centre.
 *
 * Read top to bottom this page answers, in order: what is the campus consuming,
 * how far has the loop carried today's findings, what does the telemetry look
 * like against the model, which blocks are driving the load, what is open, what
 * should be done, and what has already been proved. Every figure comes from
 * /api/dashboard exactly as the backend computed it.
 */
export default function DashboardPage() {
  const { range, resource } = useAppState();
  const { data, error, loading, refetch } = useApi<Dashboard>(
    `/api/dashboard?days=${range}&resource=${resource}`,
    [range, resource],
  );

  const [chartResource, setChartResource] = React.useState<"ALL" | "ENERGY" | "WATER">(
    "ALL",
  );
  const [loadMetric, setLoadMetric] = React.useState<
    "energy_kwh" | "water_liters" | "energy_intensity"
  >("energy_kwh");

  const apply = useMutation(async (rec: Recommendation) => {
    await api.post(`/api/recommendations/${rec.id}/apply`, {});
    await refetch({ quiet: true });
  });
  const [applyingId, setApplyingId] = React.useState<number | null>(null);

  React.useEffect(() => {
    setChartResource(resource);
  }, [resource]);

  if (error && !data) {
    return (
      <div className="pt-8">
        <ErrorState error={error} onRetry={() => refetch()} />
      </div>
    );
  }

  const symbol = data?.economics.currency_symbol ?? "₹";
  const savingsKpi = data?.kpis.find((kpi) => kpi.key === "savings");
  const anomalyKpi = data?.kpis.find((kpi) => kpi.key === "anomalies");
  const verifiedStage = data?.pipeline.stages.find((stage) => stage.key === "verify");
  const headlineVerification =
    data?.verifications.find((v) => v.status === "VERIFIED") ?? null;

  return (
    <div className="space-y-9">
      {/* ================= hero ================= */}
      <header className="flex flex-wrap items-start justify-between gap-x-10 gap-y-5">
        <div className="min-w-0">
          <div className="label">VOLTAURA</div>
          <h1 className="mt-2 text-[26px] font-semibold leading-none tracking-[-0.03em] text-ink">
            Campus Command Centre
          </h1>
          <p className="mt-2.5 max-w-xl text-[12.5px] leading-relaxed text-ink-muted">
            Real-time resource intelligence across the RIT campus.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span className="label">Telemetry</span>
            <span className="num text-[11.5px] text-ink-soft">
              {data ? telemetryStamp(data.data_end) : "— — —"}
            </span>
            {data ? (
              <>
                <span className="h-3 w-px bg-[rgb(var(--line)/0.12)]" />
                <span className="num text-[11px] text-ink-muted">
                  last {data.range_days} days ·{" "}
                  {data.interval === "hour" ? "hourly" : "daily"} resolution
                </span>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col items-start gap-4 lg:items-end">
          <Button
            variant="secondary"
            size="sm"
            loading={loading && !!data}
            onClick={() => refetch()}
          >
            <RefreshCw /> Refresh
          </Button>
          {data ? (
            <CampusHeadline
              openAnomalies={Number(anomalyKpi?.value ?? 0)}
              verifiedInterventions={verifiedStage?.value ?? 0}
              verifiedSavings={
                savingsKpi ? `${symbol}${kpiValue(savingsKpi)}` : "—"
              }
            />
          ) : null}
        </div>
      </header>

      {/* ================= resource performance ================= */}
      <Section label="Resource performance" title="Metered across the campus">
        {data ? (
          <ResourceSummary kpis={data.kpis} />
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i}>
                <Skeleton className="h-2.5 w-20" />
                <Skeleton className="mt-3 h-8 w-24" />
                <Skeleton className="mt-3 h-2.5 w-28" />
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ================= pipeline ================= */}
      <Section
        label="Operational pipeline"
        title="Detect → Diagnose → Recommend → Intervene → Verify"
        description="Live counts at each stage of the loop, not a diagram."
      >
        {data ? (
          <PipelineRail stages={data.pipeline.stages} active="detect" />
        ) : (
          <Skeleton className="h-20 w-full" />
        )}
      </Section>

      {/* ================= live edge telemetry ================= */}
      {/* Carries its own header, so it sits directly on the page. */}
      <LiveTelemetryPanel />

      {/* ================= telemetry ================= */}
      <Section
        label="Resource performance"
        title="Measured consumption against modelled baseline"
        description="The dashed line is what the model expected given occupancy, weather and schedule. The gap between the two is the waste."
        actions={
          <Segmented
            size="sm"
            options={[
              { value: "ALL", label: "Both" },
              { value: "ENERGY", label: "Energy" },
              { value: "WATER", label: "Water" },
            ]}
            value={chartResource}
            onChange={setChartResource}
          />
        }
      >
        <ChartFrame
          title={
            chartResource === "WATER"
              ? "Water · litres"
              : chartResource === "ENERGY"
                ? "Energy · kWh"
                : "Energy kWh (left) · Water litres (right)"
          }
          meta={
            data
              ? `${dateTime(data.data_start)} — ${dateTime(data.data_end)}`
              : undefined
          }
          legend={
            <>
              {chartResource !== "WATER" ? (
                <LegendKey colour={CHART_COLOURS.energy} label="Energy metered" />
              ) : null}
              {chartResource !== "ENERGY" ? (
                <LegendKey colour={CHART_COLOURS.water} label="Water metered" />
              ) : null}
              <LegendKey
                colour={CHART_COLOURS.expected}
                label="Model expectation"
                dashed
              />
            </>
          }
        >
          {data ? (
            data.series.length ? (
              <CampusChart
                data={data.series as unknown as Array<Record<string, unknown>>}
                showEnergy={chartResource !== "WATER"}
                showWater={chartResource !== "ENERGY"}
                height={320}
              />
            ) : (
              <div className="px-3">
                <EmptyState
                  title="No telemetry in this window"
                  description="Seed the database to load 90 days of hourly readings."
                />
              </div>
            )
          ) : (
            <Skeleton className="h-[320px] w-full" />
          )}
        </ChartFrame>
      </Section>

      {/* ================= building load ================= */}
      <Section
        label="Building resource load"
        title="Where the consumption sits"
        description="Ranked by the selected metric over the current window. Deviation compares metered consumption against the model's expectation for the same conditions."
        actions={
          <Segmented
            size="sm"
            options={[
              { value: "energy_kwh", label: "kWh" },
              { value: "water_liters", label: "kL" },
              { value: "energy_intensity", label: "kWh/m²" },
            ]}
            value={loadMetric}
            onChange={setLoadMetric}
          />
        }
      >
        {data ? (
          data.buildings.length ? (
            <BuildingComparison rows={data.buildings} metric={loadMetric} />
          ) : (
            <EmptyState
              title="No buildings"
              description="Run python scripts/seed.py to create the demo campus."
              compact
            />
          )
        ) : (
          <LoadingPanel rows={6} />
        )}
      </Section>

      {/* ================= anomalies ================= */}
      <Section
        label="Anomaly queue"
        title="Open deviations from modelled baselines"
        description="Deviations from each building's expected consumption, grouped into events and diagnosed against the measured evidence."
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link href="/anomalies">
              All anomalies <ArrowRight />
            </Link>
          </Button>
        }
      >
        {data ? (
          <>
            {data.anomalies.length ? (
              <SeverityBar anomalies={data.anomalies} className="mb-5 max-w-md" />
            ) : null}
            <AnomalyTable
              anomalies={data.anomalies.slice(0, 6)}
              emptyTitle="No active anomalies"
              emptyDescription="Every building is tracking its expected-consumption baseline."
            />
          </>
        ) : (
          <LoadingPanel rows={4} />
        )}
      </Section>

      {/* ================= recommendations ================= */}
      <Section
        label="Recommended actions"
        title="Highest-value measures"
        description="One measure per diagnosed cause, sized from the measured excess and ranked by severity and value."
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link href="/recommendations">
              All recommendations <ArrowRight />
            </Link>
          </Button>
        }
      >
        {apply.error ? <ErrorState error={apply.error} compact /> : null}
        {data ? (
          data.recommendations.length ? (
            <RecommendationList
              recommendations={data.recommendations.slice(0, 2)}
              currencySymbol={symbol}
              applyingId={apply.pending ? applyingId : null}
              onApply={async (rec) => {
                setApplyingId(rec.id);
                await apply.mutate(rec);
                setApplyingId(null);
              }}
            />
          ) : (
            <EmptyState
              title="No open recommendations"
              description="Every diagnosed anomaly has already been actioned."
              compact
            />
          )
        ) : (
          <LoadingPanel rows={3} />
        )}
      </Section>

      {/* ================= verified impact ================= */}
      <Section
        label="Verified impact"
        title="VOLTAURA does not just predict savings. It proves them."
        description="Consumption after each measure, measured against what the building would have used under the same weather and occupancy. Only a reduction that clears the minimum and holds across the whole monitoring period is marked verified."
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link href="/verification">
              Full analysis <ArrowRight />
            </Link>
          </Button>
        }
      >
        {data ? (
          data.verifications.length ? (
            <div className="space-y-7">
              {headlineVerification ? (
                <VerifiedImpact
                  verification={headlineVerification}
                  currencySymbol={symbol}
                />
              ) : null}
              <div className="border-t border-[rgb(var(--line)/0.08)] pt-5">
                <VerificationTable
                  verifications={data.verifications}
                  currencySymbol={symbol}
                />
              </div>
            </div>
          ) : (
            <EmptyState
              title="Nothing verified yet"
              description="Run verification on an intervention once its monitoring period completes."
              compact
            />
          )
        ) : (
          <LoadingPanel rows={3} />
        )}
      </Section>

      {/* ================= interventions in flight ================= */}
      {data?.interventions.length ? (
        <Section label="In flight" title="Interventions under monitoring">
          <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
            {data.interventions.slice(0, 4).map((intervention) => (
              <Metric
                key={intervention.id}
                size="sm"
                label={intervention.building_code ?? intervention.building_name ?? ""}
                value={`${num(intervention.elapsed_days, 1)} / ${intervention.monitoring_days_required}`}
                unit="days"
                caption={intervention.title}
                tone={intervention.status === "VERIFIED" ? "mint" : "ink"}
              />
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}
