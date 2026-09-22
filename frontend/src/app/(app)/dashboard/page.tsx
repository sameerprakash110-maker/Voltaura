"use client";

import {
  ArrowRight,
  BadgeCheck,
  Droplets,
  Lightbulb,
  Radar,
  RefreshCw,
  Wrench,
  Zap,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";

import {
  AnomalyCard,
  InterventionCard,
  RecommendationCard,
  VerificationSummary,
} from "@/components/cards/domain-cards";
import { KpiCard } from "@/components/cards/kpi-card";
import { CampusChart, ComparisonBars } from "@/components/charts/primitives";
import { PipelineRail } from "@/components/layout/pipeline-rail";
import { useAppState } from "@/components/providers/app-state";
import { LiveTelemetryPanel } from "@/components/telemetry/live-telemetry-panel";
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
} from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { compact, dateTime, num, pct, signedPct } from "@/lib/format";
import type { Dashboard, Recommendation } from "@/lib/types";
import { useApi, useMutation } from "@/lib/use-api";
import { cn } from "@/lib/utils";

export default function DashboardPage() {
  const { range, resource } = useAppState();
  const { data, error, loading, refetch } = useApi<Dashboard>(
    `/api/dashboard?days=${range}&resource=${resource}`,
    [range, resource],
  );
  const [chartResource, setChartResource] = React.useState<"ALL" | "ENERGY" | "WATER">(
    "ALL",
  );
  const [comparisonMetric, setComparisonMetric] = React.useState<
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
      <div className="pt-10">
        <ErrorState error={error} onRetry={() => refetch()} />
      </div>
    );
  }

  const symbol = data?.economics.currency_symbol ?? "₹";

  return (
    <div className="space-y-5">
      {/* ---- header ------------------------------------------------ */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow mb-1.5">Sustainability command centre</div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
            Campus overview
          </h1>
          <p className="mt-1.5 text-[13px] text-ink-muted">
            {data ? (
              <>
                Last {data.range_days} days &middot;{" "}
                {data.interval === "hour" ? "hourly" : "daily"} resolution &middot;
                telemetry to{" "}
                <span className="num">{dateTime(data.data_end)}</span>
              </>
            ) : (
              "Loading telemetry window"
            )}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          loading={loading && !!data}
          onClick={() => refetch()}
        >
          <RefreshCw /> Refresh
        </Button>
      </header>

      {/* ---- KPIs -------------------------------------------------- */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {data
          ? data.kpis.map((kpi, index) => (
              <KpiCard key={kpi.key} kpi={kpi} index={index} />
            ))
          : Array.from({ length: 5 }).map((_, i) => (
              <Panel key={i} className="p-5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="mt-3 h-7 w-20" />
                <Skeleton className="mt-3 h-3 w-28" />
              </Panel>
            ))}
      </section>

      {/* ---- the loop, as live counts ------------------------------ */}
      {data ? (
        <section>
          <PipelineRail stages={data.pipeline.stages} active="detect" />
        </section>
      ) : null}

      {/* ---- live physical edge telemetry -------------------------- */}
      <section>
        <LiveTelemetryPanel />
      </section>

      {/* ---- charts ------------------------------------------------ */}
      <section className="grid items-start gap-4 xl:grid-cols-[1.55fr_1fr]">
        <Panel>
          <PanelHeader
            eyebrow="Campus resource overview"
            title="Metered consumption against expected"
            subtitle="The dashed line is what the model expected given occupancy, weather and schedule. The gap is the waste."
            action={
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
          />
          <div className="px-2 pb-4">
            {data ? (
              data.series.length ? (
                <CampusChart
                  data={data.series as unknown as Array<Record<string, unknown>>}
                  showEnergy={chartResource !== "WATER"}
                  showWater={chartResource !== "ENERGY"}
                  height={300}
                />
              ) : (
                <EmptyState
                  icon={Zap}
                  title="No telemetry in this window"
                  description="Seed the database to load 90 days of hourly readings."
                />
              )
            ) : (
              <div className="px-3">
                <Skeleton className="h-[300px] w-full" />
              </div>
            )}
          </div>
          <ChartLegend resource={chartResource} />
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="Building comparison"
            title="Where the consumption sits"
            action={
              <Segmented
                size="sm"
                options={[
                  { value: "energy_kwh", label: "kWh" },
                  { value: "water_liters", label: "L" },
                  { value: "energy_intensity", label: "kWh/m2" },
                ]}
                value={comparisonMetric}
                onChange={setComparisonMetric}
              />
            }
          />
          <div className="px-2 pb-2">
            {data ? (
              <ComparisonBars
                data={data.buildings as unknown as Array<Record<string, unknown>>}
                dataKey={comparisonMetric}
                unit={
                  comparisonMetric === "water_liters"
                    ? " L"
                    : comparisonMetric === "energy_intensity"
                      ? " kWh/m2"
                      : " kWh"
                }
                height={236}
                colourFor={(row) =>
                  row.status === "CRITICAL"
                    ? "rgb(var(--critical))"
                    : row.status === "WARNING"
                      ? "rgb(var(--medium))"
                      : comparisonMetric === "water_liters"
                        ? "rgb(var(--aqua))"
                        : "rgb(var(--mint))"
                }
              />
            ) : (
              <div className="px-3">
                <Skeleton className="h-[236px] w-full" />
              </div>
            )}
          </div>
          <div className="divider-y px-5 py-3">
            <div className="space-y-2">
              {data?.buildings.map((building) => (
                <Link
                  key={building.building_id}
                  href={`/buildings/${building.building_id}`}
                  className="group flex items-center justify-between gap-3 text-[12px]"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        building.status === "CRITICAL"
                          ? "bg-critical"
                          : building.status === "WARNING"
                            ? "bg-medium"
                            : "bg-mint",
                      )}
                    />
                    <span className="text-ink-soft transition-colors group-hover:text-ink">
                      {building.name}
                    </span>
                  </span>
                  <span className="num flex items-center gap-2 text-ink-muted">
                    {building.open_anomalies > 0 ? (
                      <span className="text-critical">
                        {building.open_anomalies} open
                      </span>
                    ) : null}
                    <span
                      className={cn(
                        building.deviation_pct > 3
                          ? "text-high"
                          : building.deviation_pct < -3
                            ? "text-mint"
                            : "",
                      )}
                    >
                      {signedPct(building.deviation_pct)}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </Panel>
      </section>

      {/* ---- anomalies + recommendations --------------------------- */}
      <section className="grid items-start gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader
            eyebrow="Anomaly centre"
            title="Active anomalies"
            subtitle="Detected by consensus of two independent detectors, then diagnosed."
            action={
              <Button variant="ghost" size="sm" asChild>
                <Link href="/anomalies">
                  All <ArrowRight />
                </Link>
              </Button>
            }
          />
          <div className="space-y-2 px-4 pb-5">
            {loading && !data ? <LoadingPanel rows={3} /> : null}
            {data?.anomalies.length ? (
              data.anomalies
                .slice(0, 4)
                .map((anomaly) => <AnomalyCard key={anomaly.id} anomaly={anomaly} />)
            ) : data ? (
              <EmptyState
                icon={Radar}
                title="No active anomalies"
                description="Every building is tracking its expected-consumption baseline."
                compact
              />
            ) : null}
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="AI recommendations"
            title="Highest-value actions"
            subtitle="Each measure is sized from the measured excess and ranked by severity and value."
            action={
              <Button variant="ghost" size="sm" asChild>
                <Link href="/recommendations">
                  All <ArrowRight />
                </Link>
              </Button>
            }
          />
          <div className="space-y-3 px-4 pb-5">
            {loading && !data ? <LoadingPanel rows={2} /> : null}
            {data?.recommendations.length ? (
              data.recommendations.slice(0, 2).map((rec) => (
                <RecommendationCard
                  key={rec.id}
                  recommendation={rec}
                  currencySymbol={symbol}
                  applying={applyingId === rec.id && apply.pending}
                  onApply={async (r) => {
                    setApplyingId(r.id);
                    await apply.mutate(r);
                    setApplyingId(null);
                  }}
                />
              ))
            ) : data ? (
              <EmptyState
                icon={Lightbulb}
                title="No open recommendations"
                description="Every diagnosed anomaly has already been actioned."
                compact
              />
            ) : null}
            {apply.error ? (
              <ErrorState error={apply.error} compact />
            ) : null}
          </div>
        </Panel>
      </section>

      {/* ---- interventions + verification -------------------------- */}
      <section className="grid items-start gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader
            eyebrow="Intervention tracking"
            title="Recent interventions"
            action={
              <Button variant="ghost" size="sm" asChild>
                <Link href="/interventions">
                  All <ArrowRight />
                </Link>
              </Button>
            }
          />
          <div className="space-y-3 px-4 pb-5">
            {data?.interventions.length ? (
              data.interventions.slice(0, 2).map((intervention) => (
                <InterventionCard key={intervention.id} intervention={intervention} />
              ))
            ) : data ? (
              <EmptyState
                icon={Wrench}
                title="No interventions yet"
                description="Apply a recommendation to open a monitoring period."
                compact
              />
            ) : (
              <LoadingPanel rows={2} />
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="Savings verification"
            title="Measured, not estimated"
            subtitle="Post-intervention consumption against a weather- and occupancy-adjusted baseline."
            action={
              <Button variant="ghost" size="sm" asChild>
                <Link href="/verification">
                  All <ArrowRight />
                </Link>
              </Button>
            }
          />
          <div className="space-y-2 px-4 pb-5">
            {data?.verifications.length ? (
              data.verifications.map((verification) => (
                <VerificationSummary
                  key={verification.id}
                  verification={verification}
                  currencySymbol={symbol}
                />
              ))
            ) : data ? (
              <EmptyState
                icon={BadgeCheck}
                title="Nothing verified yet"
                description="Run verification on an intervention once its monitoring period completes."
                compact
              />
            ) : (
              <LoadingPanel rows={2} />
            )}
          </div>

          {data?.verifications.length ? (
            <div className="divider-y px-5 py-4">
              <div className="grid grid-cols-3 gap-4">
                <MiniStat
                  label="Energy"
                  value={`${compact(
                    data.verifications
                      .filter((v) => v.status === "VERIFIED" && v.resource_type === "ENERGY")
                      .reduce((sum, v) => sum + v.absolute_saving, 0),
                    1,
                  )}`}
                  unit="kWh/wk"
                />
                <MiniStat
                  label="Water"
                  value={`${compact(
                    data.verifications
                      .filter((v) => v.status === "VERIFIED" && v.resource_type === "WATER")
                      .reduce((sum, v) => sum + v.absolute_saving, 0) / 1000,
                    1,
                  )}`}
                  unit="kL/wk"
                />
                <MiniStat
                  label="Value"
                  value={`${symbol}${compact(
                    data.verifications
                      .filter((v) => v.status === "VERIFIED")
                      .reduce((sum, v) => sum + v.financial_saving_per_year, 0),
                    1,
                  )}`}
                  unit="/yr"
                />
              </div>
            </div>
          ) : null}
        </Panel>
      </section>
    </div>
  );
}

function ChartLegend({ resource }: { resource: "ALL" | "ENERGY" | "WATER" }) {
  return (
    <div className="divider-y flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3">
      {resource !== "WATER" ? (
        <LegendItem colour="bg-mint" label="Energy metered" icon={Zap} />
      ) : null}
      {resource !== "ENERGY" ? (
        <LegendItem colour="bg-aqua" label="Water metered" icon={Droplets} />
      ) : null}
      <span className="flex items-center gap-1.5 text-[11px] text-ink-muted">
        <span className="flex h-px w-5 items-center">
          <span className="h-px w-full border-t border-dashed border-ink-soft" />
        </span>
        Model expectation
      </span>
      <Badge tone="neutral" className="ml-auto">
        Actual vs expected
      </Badge>
    </div>
  );
}

function LegendItem({
  colour,
  label,
  icon: Icon,
}: {
  colour: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-ink-muted">
      <Icon className="size-3" />
      <span className={cn("size-2 rounded-[2px]", colour)} />
      {label}
    </span>
  );
}

function MiniStat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <div>
      <div className="eyebrow mb-1">{label}</div>
      <div className="num text-[15px] font-semibold text-mint">
        {value}
        <span className="ml-0.5 text-[10px] font-normal text-ink-muted">{unit}</span>
      </div>
    </div>
  );
}
