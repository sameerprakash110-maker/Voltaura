"use client";

import { FileJson, FileSpreadsheet, Printer } from "lucide-react";
import * as React from "react";

import { VerificationTable } from "@/components/domain/verification";
import {
  CHART_COLOURS,
  ChartFrame,
  ComparisonBars,
  LegendKey,
} from "@/components/charts/primitives";
import { useAppState } from "@/components/providers/app-state";
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingPanel,
} from "@/components/ui/primitives";
import {
  KeyValue,
  Metric,
  MiniBar,
  Num,
  Section,
  Table,
} from "@/components/ui/structure";
import { apiUrl } from "@/lib/api";
import { compact, date, dateTime, num, pct } from "@/lib/format";
import type { ReportSummary } from "@/lib/types";
import { useApi } from "@/lib/use-api";

/**
 * Campus report.
 *
 * Laid out as a document with numbered sections rather than as a screen, so
 * that printing it or exporting it produces something a sustainability officer
 * can put in front of a committee. Every figure is the backend's; the export
 * buttons hand over the same data as CSV or JSON.
 */
export default function ReportsPage() {
  const { range } = useAppState();
  const { data, error, loading, refetch } = useApi<ReportSummary>(
    `/api/reports/summary?days=${range}`,
    [range],
  );

  if (error && !data) {
    return (
      <div className="pt-8">
        <ErrorState error={error} onRetry={() => refetch()} />
      </div>
    );
  }

  const symbol = data?.economics.currency_symbol ?? "₹";
  const totals = data?.totals ?? {};

  return (
    <div className="space-y-10">
      {/* ================= masthead ================= */}
      <header className="border-b border-[rgb(var(--line)/0.14)] pb-6">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
          <div>
            <div className="label">VOLTAURA · Sustainability report</div>
            <h1 className="mt-2.5 text-[26px] font-semibold leading-none tracking-[-0.03em] text-ink">
              Campus Resource Report
            </h1>
            <p className="mt-3 text-[12px] text-ink-muted">
              {data ? (
                <>
                  Reporting period{" "}
                  <span className="num text-ink-soft">
                    {date(data.period_start)} — {date(data.period_end)}
                  </span>{" "}
                  · generated{" "}
                  <span className="num text-ink-soft">
                    {dateTime(data.generated_at)}
                  </span>
                </>
              ) : (
                "Assembling report"
              )}
            </p>
          </div>

          <div className="flex items-center gap-2 print:hidden">
            <Button variant="secondary" size="sm" asChild>
              <a
                href={apiUrl(`/api/reports/export?days=${range}&format=csv`)}
                download
              >
                <FileSpreadsheet /> CSV
              </a>
            </Button>
            <Button variant="secondary" size="sm" asChild>
              <a
                href={apiUrl(`/api/reports/export?days=${range}&format=json`)}
                download
              >
                <FileJson /> JSON
              </a>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => window.print()}
              title="Print or save as PDF"
            >
              <Printer /> Print
            </Button>
          </div>
        </div>
      </header>

      {loading && !data ? <LoadingPanel rows={6} /> : null}

      {data ? (
        <>
          {/* ================= 01 campus overview ================= */}
          <Section label="01 · Campus overview" title="What was measured">
            <div className="grid gap-x-8 gap-y-6 sm:grid-cols-3 lg:grid-cols-6">
              <Metric
                label="Energy consumed"
                value={compact(totals.total_energy_consumed ?? 0, 1)}
                unit="kWh"
                size="lg"
              />
              <Metric
                label="Water consumed"
                value={compact(totals.total_water_consumed_kl ?? 0, 1)}
                unit="kL"
                size="lg"
              />
              <Metric
                label="Blocks"
                value={num(data.by_building.length)}
                size="lg"
              />
              <Metric
                label="Anomalies detected"
                value={num(totals.anomalies_detected ?? 0)}
                unit="events"
                size="lg"
              />
              <Metric
                label="Interventions applied"
                value={num(totals.interventions_applied ?? 0)}
                size="lg"
              />
              <Metric
                label="Verification rate"
                value={pct(totals.verification_rate_pct ?? 0, 0)}
                size="lg"
                tone="mint"
                caption={`${num(totals.interventions_verified ?? 0)} of ${num(
                  totals.interventions_applied ?? 0,
                )} verified`}
              />
            </div>
          </Section>

          {/* ================= 02 verified savings ================= */}
          <Section
            label="02 · Verified savings"
            title="Measured against an adjusted baseline"
            description="Only measures with a confirmed reduction contribute to these totals. Estimates from open recommendations are excluded."
          >
            <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
              <Metric
                label="Energy saved"
                value={compact(totals.energy_saved_per_year ?? 0, 1)}
                unit="kWh/yr"
                size="lg"
                tone="mint"
                caption={`${compact(totals.energy_saved_per_week ?? 0, 1)} kWh per week`}
              />
              <Metric
                label="Water saved"
                value={compact(totals.water_saved_per_year_kl ?? 0, 1)}
                unit="kL/yr"
                size="lg"
                tone="mint"
                caption={`${compact(totals.water_saved_per_week_kl ?? 0, 1)} kL per week`}
              />
              <Metric
                label="Financial saving"
                value={`${symbol}${compact(totals.financial_saving_per_year ?? 0, 1)}`}
                unit="/yr"
                size="lg"
                tone="mint"
                caption={`At ${data.economics.electricity_tariff} ${data.economics.currency}/kWh`}
              />
              <Metric
                label="CO₂ reduction"
                value={num(totals.co2_reduction_per_year_tonnes ?? 0, 2)}
                unit="t/yr"
                size="lg"
                tone="mint"
                caption={`At ${data.economics.grid_emission_factor} kg CO₂e/kWh`}
              />
            </div>
          </Section>

          {/* ================= 03 building comparison ================= */}
          <Section
            label="03 · Building comparison"
            title="Consumption by block"
            description={`Metered totals over the ${range}-day reporting period, with verified savings alongside.`}
          >
            <div className="space-y-6">
              <ChartFrame
                title="Energy · kWh"
                legend={
                  <>
                    <LegendKey
                      colour={CHART_COLOURS.energy}
                      label="Has verified savings"
                    />
                    <LegendKey colour={CHART_COLOURS.water} label="No verified savings yet" />
                  </>
                }
              >
                <ComparisonBars
                  data={data.by_building as unknown as Array<Record<string, unknown>>}
                  dataKey="energy_kwh"
                  unit=" kWh"
                  height={220}
                  colourFor={(row) =>
                    (row.verified_money_year as number) > 0
                      ? CHART_COLOURS.energy
                      : CHART_COLOURS.water
                  }
                />
              </ChartFrame>

              <Table minWidth={820}>
                <thead>
                  <tr>
                    <th className="w-[24%]">Block</th>
                    <th className="text-right">Area m²</th>
                    <th className="text-right">Energy kWh</th>
                    <th className="w-[12%]">Share</th>
                    <th className="text-right">Water kL</th>
                    <th className="text-right">Intensity</th>
                    <th className="text-right">Anomalies</th>
                    <th className="pr-0 text-right">Verified saving</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_building.map((row) => {
                    const peak = Math.max(
                      1,
                      ...data.by_building.map((b) => b.energy_kwh),
                    );
                    return (
                      <tr key={row.building_id}>
                        <td>
                          <span className="font-medium text-ink">{row.name}</span>
                          <span className="num ml-2 text-[10.5px] text-ink-faint">
                            {row.code}
                          </span>
                        </td>
                        <td className="text-right">
                          <Num>{num(row.area_sqm)}</Num>
                        </td>
                        <td className="text-right">
                          <Num tone="ink">{compact(row.energy_kwh, 1)}</Num>
                        </td>
                        <td>
                          <MiniBar
                            value={(row.energy_kwh / peak) * 100}
                            width={72}
                            tone={row.verified_money_year > 0 ? "mint" : "muted"}
                          />
                        </td>
                        <td className="text-right">
                          <Num>{compact(row.water_kl, 1)}</Num>
                        </td>
                        <td className="text-right">
                          <Num>{num(row.energy_intensity, 1)}</Num>
                        </td>
                        <td className="text-right">
                          <Num tone={row.anomalies > 0 ? "high" : "muted"}>
                            {row.anomalies > 0 ? num(row.anomalies) : "—"}
                          </Num>
                        </td>
                        <td className="pr-0 text-right">
                          {row.verified_money_year > 0 ? (
                            <Num tone="mint">
                              {symbol}
                              {compact(row.verified_money_year, 1)}/yr
                            </Num>
                          ) : (
                            <span className="text-ink-faint">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          </Section>

          {/* ================= 04 anomalies ================= */}
          <Section
            label="04 · Anomalies"
            title="What was found"
            description="Consolidated events, broken down by how severe they were, what caused them and which resource they affected."
          >
            <div className="grid gap-x-10 gap-y-8 lg:grid-cols-3">
              <Breakdown
                title="By severity"
                entries={data.anomaly_breakdown.by_severity}
                colours={{
                  CRITICAL: "critical",
                  HIGH: "high",
                  MEDIUM: "medium",
                  LOW: "muted",
                }}
              />
              <Breakdown
                title="By probable cause"
                entries={data.anomaly_breakdown.by_cause}
              />
              <Breakdown
                title="By resource"
                entries={data.by_resource.anomalies}
                colours={{ ENERGY: "mint", WATER: "aqua" }}
              />
            </div>
          </Section>

          {/* ================= 05 verified interventions ================= */}
          <Section
            label="05 · Verified interventions"
            title={`${data.verified_interventions.length} ${
              data.verified_interventions.length === 1 ? "measure" : "measures"
            } with measured savings`}
          >
            {data.verified_interventions.length ? (
              <VerificationTable
                verifications={data.verified_interventions}
                currencySymbol={symbol}
              />
            ) : (
              <EmptyState
                title="No verified interventions yet"
                description="Verified savings appear here once a measure's reduction is confirmed over its monitoring period."
                compact
              />
            )}
          </Section>

          {/* ================= 06 methodology ================= */}
          <Section
            label="06 · Methodology"
            title="How every figure in this report was produced"
            description="Included so the numbers can be audited rather than taken on trust."
          >
            <div className="space-y-6">
              <Table minWidth={620}>
                <thead>
                  <tr>
                    <th className="w-[26%]">Stage</th>
                    <th className="pr-0">Method</th>
                  </tr>
                </thead>
                <tbody>
                  {data.methodology.map((item) => (
                    <tr key={item.stage}>
                      <td className="align-top font-medium text-ink">
                        {item.stage}
                      </td>
                      <td className="pr-0 align-top leading-relaxed text-ink-soft">
                        {item.method}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>

              <div className="grid gap-x-8 gap-y-5 border-t border-[rgb(var(--line)/0.08)] pt-5 grid-cols-2 sm:grid-cols-4">
                <KeyValue
                  label="Electricity tariff"
                  value={`${symbol}${data.economics.electricity_tariff}/kWh`}
                />
                <KeyValue
                  label="Water tariff"
                  value={`${symbol}${data.economics.water_tariff_per_kl}/kL`}
                />
                <KeyValue
                  label="Grid emission factor"
                  value={`${data.economics.grid_emission_factor} kg CO₂e/kWh`}
                />
                <KeyValue
                  label="Water emission factor"
                  value={`${data.economics.water_emission_factor} kg CO₂e/kL`}
                />
              </div>

              <p className="max-w-3xl text-[11px] leading-relaxed text-ink-muted">
                Savings are annualised from verified weekly measurements. Only
                interventions that cleared both verification gates contribute.
                Estimated savings from open recommendations are excluded
                entirely.
              </p>
            </div>
          </Section>
        </>
      ) : null}
    </div>
  );
}

// --------------------------------------------------------------------------
function Breakdown({
  title,
  entries,
  colours,
}: {
  title: string;
  entries: Record<string, number>;
  colours?: Record<string, "mint" | "aqua" | "medium" | "high" | "critical" | "iris" | "muted">;
}) {
  const items = Object.entries(entries ?? {});
  const total = items.reduce((sum, [, count]) => sum + count, 0) || 1;

  if (!items.length) {
    return (
      <div>
        <div className="label mb-3">{title}</div>
        <p className="text-[11px] text-ink-muted">No data</p>
      </div>
    );
  }

  return (
    <div>
      <div className="label mb-3">{title}</div>
      <ul className="space-y-2.5">
        {items
          .sort((a, b) => b[1] - a[1])
          .map(([key, count]) => (
            <li key={key}>
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <span className="text-[11.5px] text-ink-soft">{key}</span>
                <span className="num text-[11px] text-ink-muted">
                  {num(count)} · {pct((count / total) * 100, 0)}
                </span>
              </div>
              <MiniBar
                value={(count / total) * 100}
                tone={colours?.[key] ?? "iris"}
                width="100%"
              />
            </li>
          ))}
      </ul>
    </div>
  );
}
