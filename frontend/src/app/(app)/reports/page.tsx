"use client";

import { Download, FileJson, FileSpreadsheet, Leaf, Wallet } from "lucide-react";
import * as React from "react";

import { ComparisonBars } from "@/components/charts/primitives";
import { useAppState } from "@/components/providers/app-state";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  LoadingPanel,
  Panel,
  PanelHeader,
} from "@/components/ui/primitives";
import { apiUrl } from "@/lib/api";
import { compact, date, dateTime, num, pct } from "@/lib/format";
import type { ReportSummary } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";

export default function ReportsPage() {
  const { range } = useAppState();
  const { data, error, loading, refetch } = useApi<ReportSummary>(
    `/api/reports/summary?days=${range}`,
    [range],
  );

  if (error && !data) {
    return (
      <div className="pt-10">
        <ErrorState error={error} onRetry={() => refetch()} />
      </div>
    );
  }

  const symbol = data?.economics.currency_symbol ?? "₹";
  const totals = data?.totals ?? {};

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow mb-1.5">Sustainability reporting</div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
            Campus report
          </h1>
          <p className="mt-1.5 text-[13px] text-ink-muted">
            {data ? (
              <>
                {date(data.period_start)} to {date(data.period_end)} &middot;
                generated <span className="num">{dateTime(data.generated_at)}</span>
              </>
            ) : (
              "Assembling report"
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" asChild>
            <a href={apiUrl(`/api/reports/export?days=${range}&format=csv`)} download>
              <FileSpreadsheet /> CSV
            </a>
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <a href={apiUrl(`/api/reports/export?days=${range}&format=json`)} download>
              <FileJson /> JSON
            </a>
          </Button>
        </div>
      </header>

      {loading && !data ? (
        <Panel>
          <LoadingPanel rows={5} />
        </Panel>
      ) : null}

      {data ? (
        <>
          {/* ---- headline ---- */}
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <Headline
              label="Energy saved"
              value={compact(totals.energy_saved_per_year ?? 0, 1)}
              unit="kWh/yr"
              sub={`${compact(totals.energy_saved_per_week ?? 0, 1)} kWh/week verified`}
              tone="mint"
            />
            <Headline
              label="Water saved"
              value={compact(totals.water_saved_per_year_kl ?? 0, 1)}
              unit="kL/yr"
              sub={`${compact(totals.water_saved_per_week_kl ?? 0, 1)} kL/week verified`}
              tone="mint"
            />
            <Headline
              label="Financial saving"
              value={`${symbol}${compact(totals.financial_saving_per_year ?? 0, 1)}`}
              unit="/yr"
              sub={`At ${data.economics.electricity_tariff} ${data.economics.currency}/kWh`}
              tone="mint"
              icon={Wallet}
            />
            <Headline
              label="CO2 reduction"
              value={num(totals.co2_reduction_per_year_tonnes ?? 0, 2)}
              unit="t/yr"
              sub={`At ${data.economics.grid_emission_factor} kg/kWh`}
              tone="mint"
              icon={Leaf}
            />
            <Headline
              label="Anomalies detected"
              value={num(totals.anomalies_detected ?? 0)}
              unit="events"
              sub={`${num(totals.total_energy_consumed ?? 0)} kWh analysed`}
            />
            <Headline
              label="Interventions verified"
              value={`${num(totals.interventions_verified ?? 0)}/${num(totals.interventions_applied ?? 0)}`}
              unit=""
              sub={`Verification rate ${pct(totals.verification_rate_pct ?? 0, 0)}`}
            />
          </section>

          {/* ---- by building ---- */}
          <Panel>
            <PanelHeader
              eyebrow="Consumption"
              title="By building"
              subtitle={`Metered totals over the ${range}-day reporting period, with verified savings alongside.`}
            />
            <div className="px-2 pb-4">
              <ComparisonBars
                data={data.by_building as unknown as Array<Record<string, unknown>>}
                dataKey="energy_kwh"
                unit=" kWh"
                height={210}
                colourFor={(row) =>
                  (row.verified_money_year as number) > 0
                    ? "rgb(var(--mint))"
                    : "rgb(var(--aqua))"
                }
              />
            </div>
            <div className="overflow-x-auto px-5 pb-5">
              <table className="w-full min-w-[720px] text-left">
                <thead>
                  <tr className="border-b border-[rgb(var(--line)/0.1)]">
                    {[
                      "Building",
                      "Area",
                      "Energy",
                      "Water",
                      "Intensity",
                      "Anomalies",
                      "Verified saving",
                    ].map((h) => (
                      <th key={h} className="eyebrow pb-2 pr-4 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.by_building.map((row) => (
                    <tr
                      key={row.building_id}
                      className="border-b border-[rgb(var(--line)/0.06)] last:border-0"
                    >
                      <td className="py-2.5 pr-4">
                        <div className="text-[12.5px] font-medium text-ink">
                          {row.name}
                        </div>
                        <div className="num text-[10px] text-ink-muted">
                          {row.code}
                        </div>
                      </td>
                      <td className="num py-2.5 pr-4 text-[12px] text-ink-soft">
                        {num(row.area_sqm)} m2
                      </td>
                      <td className="num py-2.5 pr-4 text-[12px] text-ink-soft">
                        {compact(row.energy_kwh, 1)} kWh
                      </td>
                      <td className="num py-2.5 pr-4 text-[12px] text-ink-soft">
                        {compact(row.water_kl, 1)} kL
                      </td>
                      <td className="num py-2.5 pr-4 text-[12px] text-ink-soft">
                        {num(row.energy_intensity, 1)} kWh/m2
                      </td>
                      <td className="num py-2.5 pr-4 text-[12px] text-ink-soft">
                        {num(row.anomalies)}
                      </td>
                      <td className="py-2.5 pr-4">
                        {row.verified_money_year > 0 ? (
                          <span className="num text-[12px] font-medium text-mint">
                            {symbol}
                            {compact(row.verified_money_year, 1)}/yr
                          </span>
                        ) : (
                          <span className="text-[12px] text-ink-muted">--</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* ---- anomaly breakdown + verified list ---- */}
          <section className="grid gap-4 xl:grid-cols-2">
            <Panel>
              <PanelHeader eyebrow="Detection" title="Anomaly breakdown" />
              <div className="space-y-5 px-5 pb-5">
                <Breakdown
                  title="By severity"
                  entries={data.anomaly_breakdown.by_severity}
                  colours={{
                    CRITICAL: "bg-critical",
                    HIGH: "bg-high",
                    MEDIUM: "bg-medium",
                    LOW: "bg-low",
                  }}
                />
                <Breakdown
                  title="By probable cause"
                  entries={data.anomaly_breakdown.by_cause}
                />
                <Breakdown
                  title="By resource"
                  entries={data.by_resource.anomalies}
                  colours={{ ENERGY: "bg-mint", WATER: "bg-aqua" }}
                />
              </div>
            </Panel>

            <Panel>
              <PanelHeader
                eyebrow="Verified interventions"
                title={`${data.verified_interventions.length} measures with measured savings`}
              />
              <div className="space-y-2 px-5 pb-5">
                {data.verified_interventions.length ? (
                  data.verified_interventions.map((v) => (
                    <div
                      key={v.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-mint/18 bg-mint/[0.04] p-3.5"
                    >
                      <div className="min-w-0">
                        <div className="text-[12.5px] font-medium text-ink">
                          {v.intervention_title}
                        </div>
                        <div className="num mt-0.5 text-[10px] text-ink-muted">
                          {v.building_name} &middot; {num(v.adjusted_baseline_value)}{" "}
                          &rarr; {num(v.post_value)} {v.unit}/wk
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="num text-[15px] font-semibold text-mint">
                          -{pct(v.saving_pct)}
                        </div>
                        <div className="num text-[10px] text-ink-muted">
                          {symbol}
                          {compact(v.financial_saving_per_year, 1)}/yr
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyState
                    title="No verified interventions yet"
                    description="Verified savings appear here once an intervention clears both the threshold and significance gates."
                    compact
                  />
                )}
              </div>
            </Panel>
          </section>

          {/* ---- methodology ---- */}
          <Panel>
            <PanelHeader
              eyebrow="Methodology"
              title="How every figure in this report was produced"
              subtitle="Included so the numbers can be audited rather than taken on trust."
            />
            <div className="grid gap-px overflow-hidden border-t border-[rgb(var(--line)/0.08)] bg-[rgb(var(--line)/0.07)] sm:grid-cols-2">
              {data.methodology.map((item) => (
                <div key={item.stage} className="bg-surface p-5">
                  <div className="mb-2 flex items-center gap-2">
                    <Badge tone="iris">{item.stage}</Badge>
                  </div>
                  <p className="text-[12px] leading-relaxed text-ink-soft">
                    {item.method}
                  </p>
                </div>
              ))}
            </div>
            <div className="divider-y grid grid-cols-2 gap-4 px-5 py-4 sm:grid-cols-4">
              <Assumption
                label="Electricity tariff"
                value={`${symbol}${data.economics.electricity_tariff}/kWh`}
              />
              <Assumption
                label="Water tariff"
                value={`${symbol}${data.economics.water_tariff_per_kl}/kL`}
              />
              <Assumption
                label="Grid emission factor"
                value={`${data.economics.grid_emission_factor} kg CO2e/kWh`}
              />
              <Assumption
                label="Water emission factor"
                value={`${data.economics.water_emission_factor} kg CO2e/kL`}
              />
            </div>
          </Panel>

          <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
            <p className="text-[11px] text-ink-muted">
              Savings are annualised from verified weekly measurements. Only
              interventions that cleared both verification gates contribute.
            </p>
            <Button variant="outline" size="sm" asChild>
              <a href={apiUrl(`/api/reports/export?days=${range}&format=csv`)} download>
                <Download /> Export full report
              </a>
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Headline({
  label,
  value,
  unit,
  sub,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  unit: string;
  sub: string;
  tone?: "mint";
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Panel className="p-5">
      <div className="mb-2 flex items-center justify-between">
        <span className="eyebrow">{label}</span>
        {Icon ? <Icon className="size-3.5 text-ink-muted" /> : null}
      </div>
      <div
        className={cn(
          "num text-[22px] font-semibold leading-none",
          tone === "mint" ? "text-mint" : "text-ink",
        )}
      >
        {value}
        {unit ? (
          <span className="ml-1 text-[11px] font-normal text-ink-muted">{unit}</span>
        ) : null}
      </div>
      <div className="mt-2 text-[10.5px] leading-relaxed text-ink-muted">{sub}</div>
    </Panel>
  );
}

function Breakdown({
  title,
  entries,
  colours,
}: {
  title: string;
  entries: Record<string, number>;
  colours?: Record<string, string>;
}) {
  const items = Object.entries(entries ?? {});
  const total = items.reduce((sum, [, count]) => sum + count, 0) || 1;

  if (!items.length) {
    return (
      <div>
        <div className="eyebrow mb-2">{title}</div>
        <p className="text-[11px] text-ink-muted">No data</p>
      </div>
    );
  }

  return (
    <div>
      <div className="eyebrow mb-2.5">{title}</div>
      <div className="space-y-2">
        {items
          .sort((a, b) => b[1] - a[1])
          .map(([key, count]) => (
            <div key={key}>
              <div className="mb-1 flex items-center justify-between text-[11.5px]">
                <span className="text-ink-soft">{key}</span>
                <span className="num text-ink-muted">
                  {num(count)} &middot; {pct((count / total) * 100, 0)}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[rgb(var(--line)/0.07)]">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-700",
                    colours?.[key] ?? "bg-iris",
                  )}
                  style={{ width: `${(count / total) * 100}%` }}
                />
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

function Assumption({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="eyebrow mb-1">{label}</div>
      <div className="num text-[12px] text-ink-soft">{value}</div>
    </div>
  );
}
