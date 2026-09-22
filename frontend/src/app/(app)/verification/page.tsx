"use client";

import Link from "next/link";
import * as React from "react";

import { VerifiedImpact } from "@/components/domain/verification";
import {
  BeforeAfterChart,
  CHART_COLOURS,
  ChartFrame,
  HourProfileChart,
  LegendKey,
} from "@/components/charts/primitives";
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingPanel,
  Segmented,
} from "@/components/ui/primitives";
import {
  Metric,
  PageHeader,
  Section,
  StatusText,
} from "@/components/ui/structure";
import {
  compact,
  date,
  dateShort,
  hourLabel,
  num,
  pct,
} from "@/lib/format";
import type { SettingsPayload, Verification, VerificationStatus } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";

type Filter = VerificationStatus | "ALL";

/**
 * Savings verification.
 *
 * The most analytical page in the product, and the one that has to survive
 * being argued with. Each result leads with the measurement, then shows the
 * two charts that make it checkable, then the statistics that decide whether
 * it passes. Nothing is hidden behind a summary.
 */
export default function VerificationPage() {
  const [filter, setFilter] = React.useState<Filter>("ALL");
  const { data, error, loading, refetch } = useApi<Verification[]>(
    `/api/verification?status=${filter}&latest_only=true`,
    [filter],
  );
  const settings = useApi<SettingsPayload>("/api/settings");
  const symbol = settings.data?.economics.currency_symbol ?? "₹";

  const totals = React.useMemo(() => {
    const verified = (data ?? []).filter((v) => v.status === "VERIFIED");
    return {
      count: verified.length,
      energy: verified
        .filter((v) => v.resource_type === "ENERGY")
        .reduce((s, v) => s + v.absolute_saving, 0),
      water: verified
        .filter((v) => v.resource_type === "WATER")
        .reduce((s, v) => s + v.absolute_saving, 0),
      money: verified.reduce((s, v) => s + v.financial_saving_per_year, 0),
      co2: verified.reduce((s, v) => s + v.co2_reduction_per_year, 0),
    };
  }, [data]);

  return (
    <div className="space-y-8">
      <PageHeader
        label="Intelligence"
        title="Verification"
        description="Each result compares consumption after a measure against what the building would have used over the same period under the same weather and occupancy. A saving is marked verified only when the reduction clears the configured minimum and holds across the whole monitoring window."
      />

      {/* ---- portfolio total ---- */}
      <section className="grid gap-x-8 gap-y-6 border-y border-[rgb(var(--line)/0.08)] py-6 sm:grid-cols-3 lg:grid-cols-5">
        <Metric label="Verified" value={num(totals.count)} size="lg" tone="mint" />
        <Metric
          label="Energy saved"
          value={compact(totals.energy, 1)}
          unit="kWh/wk"
          size="lg"
          tone="mint"
        />
        <Metric
          label="Water saved"
          value={compact(totals.water / 1000, 1)}
          unit="kL/wk"
          size="lg"
          tone="mint"
        />
        <Metric
          label="Financial"
          value={`${symbol}${compact(totals.money, 1)}`}
          unit="per year"
          size="lg"
          tone="mint"
        />
        <Metric
          label="CO₂ avoided"
          value={compact(totals.co2 / 1000, 2)}
          unit="t per year"
          size="lg"
          tone="mint"
        />
      </section>

      <div className="flex flex-wrap items-center gap-2.5">
        <span className="label">Result</span>
        <Segmented
          size="sm"
          options={[
            { value: "ALL", label: "All" },
            { value: "VERIFIED", label: "Verified" },
            { value: "NOT_VERIFIED", label: "Not verified" },
            { value: "INSUFFICIENT_DATA", label: "Collecting" },
          ]}
          value={filter}
          onChange={setFilter}
        />
        <span className="ml-auto text-[11px] text-ink-muted">
          Raise the minimum reduction in{" "}
          <Link
            href="/settings"
            className="text-ink-soft underline underline-offset-2"
          >
            Settings
          </Link>{" "}
          and re-run to watch the same data fail.
        </span>
      </div>

      {error ? <ErrorState error={error} onRetry={() => refetch()} /> : null}
      {loading && !data ? <LoadingPanel rows={4} /> : null}

      <div className="space-y-12">
        {data?.map((verification) => (
          <VerificationResult
            key={verification.id}
            verification={verification}
            currencySymbol={symbol}
          />
        ))}
      </div>

      {data?.length === 0 ? (
        <EmptyState
          title="No verification results"
          description="Apply a recommendation, collect post-intervention telemetry, then run verification."
          action={
            <Button variant="secondary" size="sm" asChild className="mt-2">
              <Link href="/recommendations">Go to recommendations</Link>
            </Button>
          }
        />
      ) : null}
    </div>
  );
}

// --------------------------------------------------------------------------
function VerificationResult({
  verification,
  currencySymbol,
}: {
  verification: Verification;
  currencySymbol: string;
}) {
  const verified = verification.status === "VERIFIED";
  const insufficient = verification.status === "INSUFFICIENT_DATA";

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

  return (
    <Section
      id={`v${verification.id}`}
      label={`${verification.building_name} · ${
        verification.resource_type === "WATER" ? "Water" : "Energy"
      }`}
      title={verification.intervention_title ?? "Intervention"}
      description={`Baseline ${date(verification.baseline_start)} to ${date(
        verification.baseline_end,
      )} · Post-intervention ${date(verification.post_start)} to ${date(
        verification.post_end,
      )}`}
      actions={<StatusText status={verification.status} />}
      bodyClassName="space-y-7"
    >
      {/* ---- the measurement ---- */}
      <VerifiedImpact
        verification={verification}
        currencySymbol={currencySymbol}
      />

      {/* ---- what the engine concluded ---- */}
      <p
        className={cn(
          "max-w-3xl border-l-2 pl-4 text-[12.5px] leading-relaxed text-ink-soft",
          verified
            ? "border-mint/50"
            : insufficient
              ? "border-[rgb(var(--line)/0.16)]"
              : "border-critical/50",
        )}
      >
        {verification.explanation}
      </p>

      {!insufficient ? (
        <>
          {/* ---- charts dominate ---- */}
          <div className="grid gap-5 xl:grid-cols-2">
            <ChartFrame
              title="Daily totals, before and after"
              meta={`${num(verification.baseline_days, 0)} baseline / ${num(
                verification.post_days,
                0,
              )} post days`}
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
              {chartData.length ? (
                <BeforeAfterChart
                  data={chartData}
                  unit={` ${verification.unit}`}
                  height={280}
                />
              ) : (
                <EmptyState title="No series data" compact />
              )}
            </ChartFrame>

            <ChartFrame
              title="Hour-of-day profile"
              meta={verification.unit}
              legend={
                <>
                  <LegendKey colour={CHART_COLOURS.critical} label="Before" dashed />
                  <LegendKey colour={CHART_COLOURS.post} label="After" />
                  <span className="text-[10.5px] text-ink-faint">
                    Shows which hours the measure actually changed.
                  </span>
                </>
              }
            >
              {profile.length ? (
                <HourProfileChart
                  data={profile}
                  seriesA="before"
                  seriesB="after"
                  labelA="Before"
                  labelB="After"
                  colourA={CHART_COLOURS.critical}
                  colourB={CHART_COLOURS.post}
                  unit={` ${verification.unit}`}
                  height={280}
                />
              ) : (
                <EmptyState title="No profile data" compact />
              )}
            </ChartFrame>
          </div>

          {/* ---- what decided the verdict ---- */}
          <div className="grid gap-x-8 gap-y-5 border-t border-[rgb(var(--line)/0.08)] pt-5 sm:grid-cols-3">
            <Metric
              label="Confidence"
              value={
                verification.confidence_pct !== null
                  ? pct(verification.confidence_pct, 1)
                  : "—"
              }
              size="sm"
              caption="that the reduction is real, not normal variation"
            />
            <Metric
              label="Minimum reduction"
              value={pct(verification.threshold_pct, 0)}
              size="sm"
              caption="required before a saving counts"
            />
            <Metric
              label="Monitoring window"
              value={`${num(verification.baseline_days, 0)} / ${num(
                verification.post_days,
                0,
              )}`}
              size="sm"
              caption="days before / after the measure"
            />
          </div>

          <p className="max-w-3xl text-[11px] leading-relaxed text-ink-muted">
            The adjusted figure is the one reported, because it removes the
            effect of weather and occupancy changing between the two periods.
          </p>
        </>
      ) : null}
    </Section>
  );
}
