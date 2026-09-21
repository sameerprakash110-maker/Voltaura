"use client";

import { BadgeCheck, Leaf, Sigma, Wallet } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import {
  BeforeAfterChart,
  CHART_COLOURS,
  HourProfileChart,
} from "@/components/charts/primitives";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  LoadingPanel,
  Panel,
  PanelHeader,
  Segmented,
} from "@/components/ui/primitives";
import {
  compact,
  date,
  dateShort,
  hourLabel,
  num,
  pValue as fmtP,
  pct,
} from "@/lib/format";
import type { SettingsPayload, Verification, VerificationStatus } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";

type Filter = VerificationStatus | "ALL";

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
    <div className="space-y-5">
      <header>
        <div className="eyebrow mb-1.5">Savings verification</div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
          Measured, not estimated
        </h1>
        <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-ink-muted">
          Each result compares post-intervention consumption against a baseline
          model evaluated on the post period&apos;s own occupancy and weather.
          A saving is only marked verified when it clears the configured
          threshold <em>and</em> is statistically significant. Raise the
          threshold in{" "}
          <Link href="/settings" className="text-ink-soft underline underline-offset-2">
            Settings
          </Link>{" "}
          and re-run to watch the same data fail.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-[rgb(var(--line)/0.1)] bg-[rgb(var(--line)/0.07)] lg:grid-cols-5">
        <Stat label="Verified" value={num(totals.count)} icon={BadgeCheck} tone="mint" />
        <Stat
          label="Energy saved"
          value={compact(totals.energy, 1)}
          unit="kWh/wk"
          tone="mint"
        />
        <Stat
          label="Water saved"
          value={compact(totals.water / 1000, 1)}
          unit="kL/wk"
          tone="mint"
        />
        <Stat
          label="Financial"
          value={`${symbol}${compact(totals.money, 1)}`}
          unit="per year"
          icon={Wallet}
          tone="mint"
        />
        <Stat
          label="CO2 avoided"
          value={compact(totals.co2 / 1000, 2)}
          unit="t per year"
          icon={Leaf}
          tone="mint"
        />
      </section>

      <Segmented
        size="sm"
        options={[
          { value: "ALL", label: "All results" },
          { value: "VERIFIED", label: "Verified" },
          { value: "NOT_VERIFIED", label: "Not verified" },
          { value: "INSUFFICIENT_DATA", label: "Collecting" },
        ]}
        value={filter}
        onChange={setFilter}
      />

      {error ? <ErrorState error={error} onRetry={() => refetch()} /> : null}
      {loading && !data ? (
        <Panel>
          <LoadingPanel rows={3} />
        </Panel>
      ) : null}

      <div className="space-y-4">
        {data?.map((verification) => (
          <VerificationDetail
            key={verification.id}
            verification={verification}
            currencySymbol={symbol}
          />
        ))}
      </div>

      {data?.length === 0 ? (
        <Panel>
          <EmptyState
            icon={BadgeCheck}
            title="No verification results"
            description="Apply a recommendation, collect post-intervention telemetry, then run verification."
            action={
              <Button variant="secondary" size="sm" asChild>
                <Link href="/recommendations">Go to recommendations</Link>
              </Button>
            }
          />
        </Panel>
      ) : null}
    </div>
  );
}

function VerificationDetail({
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
    <Panel id={`v${verification.id}`} className="scroll-mt-24">
      <PanelHeader
        eyebrow={`${verification.building_name} · ${verification.resource_type === "WATER" ? "Water" : "Energy"}`}
        title={verification.intervention_title ?? "Intervention"}
        subtitle={`Baseline ${date(verification.baseline_start)} to ${date(
          verification.baseline_end,
        )} · Post-intervention ${date(verification.post_start)} to ${date(
          verification.post_end,
        )}`}
        action={
          <Badge
            tone={verified ? "mint" : insufficient ? "neutral" : "critical"}
            dot
            pulse={insufficient}
          >
            {verification.status.replace(/_/g, " ")}
          </Badge>
        }
      />

      <div className="px-5 pb-5">
        {/* headline comparison */}
        <div
          className={cn(
            "grid gap-px overflow-hidden rounded-card border bg-[rgb(var(--line)/0.07)] sm:grid-cols-4",
            verified ? "border-mint/22" : "border-[rgb(var(--line)/0.09)]",
          )}
        >
          <Cell
            label="Baseline (measured)"
            value={num(verification.baseline_value)}
            unit={`${verification.unit}/week`}
          />
          <Cell
            label="Adjusted baseline"
            value={num(verification.adjusted_baseline_value)}
            unit={`${verification.unit}/week`}
            tone="iris"
            hint="Baseline model evaluated on the post period's own drivers"
          />
          <Cell
            label="Post-intervention"
            value={num(verification.post_value)}
            unit={`${verification.unit}/week`}
            tone={verified ? "mint" : undefined}
          />
          <Cell
            label="Saving"
            value={`${verification.saving_pct >= 0 ? "-" : "+"}${pct(
              Math.abs(verification.saving_pct),
            )}`}
            unit={`${compact(Math.abs(verification.absolute_saving), 1)} ${verification.unit}/week`}
            tone={verified ? "mint" : "critical"}
            large
          />
        </div>

        {/* explanation */}
        <div
          className={cn(
            "mt-4 rounded-card border p-4",
            verified
              ? "border-mint/22 bg-mint/[0.05]"
              : insufficient
                ? "border-[rgb(var(--line)/0.1)] bg-surface/50"
                : "border-critical/20 bg-critical/[0.05]",
          )}
        >
          <p className="text-[12.5px] leading-relaxed text-ink-soft">
            {verification.explanation}
          </p>
        </div>

        {!insufficient ? (
          <>
            {/* statistics */}
            <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-[rgb(var(--line)/0.09)] bg-[rgb(var(--line)/0.07)] lg:grid-cols-6">
              <Cell
                label="Financial"
                value={`${currencySymbol}${compact(verification.financial_saving_per_year, 1)}`}
                unit="per year"
                tone={verified ? "mint" : undefined}
                small
              />
              <Cell
                label="CO2"
                value={compact(verification.co2_reduction_per_year, 1)}
                unit="kg per year"
                tone={verified ? "mint" : undefined}
                small
              />
              <Cell
                label="p-value"
                value={fmtP(verification.p_value)}
                unit={`alpha ${verification.threshold_pct ? "0.05" : "0.05"}`}
                small
              />
              <Cell
                label="Threshold"
                value={pct(verification.threshold_pct, 0)}
                unit="minimum reduction"
                small
              />
              <Cell
                label="Baseline R2"
                value={num(verification.baseline_model_r2 ?? 0, 3)}
                unit={`CV(RMSE) ${pct(verification.baseline_model_cvrmse ?? 0)}`}
                small
              />
              <Cell
                label="Window"
                value={`${num(verification.baseline_days, 0)} / ${num(verification.post_days, 0)}`}
                unit="baseline / post days"
                small
              />
            </div>

            {/* charts */}
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="rounded-card border border-[rgb(var(--line)/0.09)] bg-surface/40 p-4">
                <div className="eyebrow mb-3">Daily totals, before and after</div>
                {chartData.length ? (
                  <BeforeAfterChart
                    data={chartData}
                    unit={` ${verification.unit}`}
                    height={230}
                  />
                ) : (
                  <EmptyState title="No series data" compact />
                )}
                <div className="mt-2 flex flex-wrap gap-4 text-[10px] text-ink-muted">
                  <LegendSwatch colour="bg-critical" label="Baseline measured" />
                  <LegendSwatch colour="bg-mint" label="Post measured" />
                  <LegendSwatch colour="bg-iris" label="Adjusted baseline" dashed />
                </div>
              </div>

              <div className="rounded-card border border-[rgb(var(--line)/0.09)] bg-surface/40 p-4">
                <div className="eyebrow mb-3">Hour-of-day profile</div>
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
                    height={230}
                  />
                ) : (
                  <EmptyState title="No profile data" compact />
                )}
                <p className="mt-2 text-[10px] leading-relaxed text-ink-muted">
                  Shows exactly which hours the measure changed, which is how a
                  schedule fix or a repaired pipe proves itself.
                </p>
              </div>
            </div>

            <p className="mt-4 text-[11px] leading-relaxed text-ink-muted">
              Method: {verification.method}. Unadjusted before/after difference
              for comparison:{" "}
              <span className="num">{pct(verification.series.raw_saving_pct ?? 0)}</span>
              . The adjusted figure is the one reported, because it removes the
              effect of weather and occupancy changing between the two periods.
            </p>
          </>
        ) : null}
      </div>
    </Panel>
  );
}

function Cell({
  label,
  value,
  unit,
  tone,
  large,
  small,
  hint,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: "mint" | "critical" | "iris";
  large?: boolean;
  small?: boolean;
  hint?: string;
}) {
  return (
    <div className="bg-surface px-4 py-3.5" title={hint}>
      <div className="eyebrow mb-1.5">{label}</div>
      <div
        className={cn(
          "num font-semibold leading-none",
          large ? "text-[22px]" : small ? "text-[14px]" : "text-[17px]",
          tone === "mint"
            ? "text-mint"
            : tone === "critical"
              ? "text-critical"
              : tone === "iris"
                ? "text-iris"
                : "text-ink",
        )}
      >
        {value}
      </div>
      {unit ? <div className="mt-1 text-[10px] text-ink-muted">{unit}</div> : null}
    </div>
  );
}

function LegendSwatch({
  colour,
  label,
  dashed,
}: {
  colour: string;
  label: string;
  dashed?: boolean;
}) {
  return (
    <span className="flex items-center gap-1.5">
      {dashed ? (
        <span className="flex h-px w-4 items-center">
          <span className={cn("h-px w-full border-t border-dashed", colour.replace("bg-", "border-"))} />
        </span>
      ) : (
        <span className={cn("size-2 rounded-[2px]", colour)} />
      )}
      {label}
    </span>
  );
}

function Stat({
  label,
  value,
  unit,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  unit?: string;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: "mint";
}) {
  return (
    <div className="bg-canvas px-5 py-4">
      <div className="mb-1.5 flex items-center gap-1.5">
        {Icon ? <Icon className="size-3 text-ink-muted" /> : null}
        <span className="eyebrow">{label}</span>
      </div>
      <div
        className={cn(
          "num text-[20px] font-semibold",
          tone === "mint" ? "text-mint" : "text-ink",
        )}
      >
        {value}
        {unit ? (
          <span className="ml-1 text-[10px] font-normal text-ink-muted">{unit}</span>
        ) : null}
      </div>
    </div>
  );
}
