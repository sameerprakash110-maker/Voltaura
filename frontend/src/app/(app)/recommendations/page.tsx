"use client";

import { Lightbulb, Wallet } from "lucide-react";
import * as React from "react";

import { RecommendationCard } from "@/components/cards/domain-cards";
import { useAppState } from "@/components/providers/app-state";
import {
  EmptyState,
  ErrorState,
  LoadingPanel,
  Panel,
  Segmented,
} from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { compact, num } from "@/lib/format";
import type { Recommendation, ResourceFilter, SettingsPayload } from "@/lib/types";
import { useApi, useMutation } from "@/lib/use-api";

type StatusFilter = "PENDING" | "APPLIED" | "ALL";

export default function RecommendationsPage() {
  const { resource, setResource } = useAppState();
  const [status, setStatus] = React.useState<StatusFilter>("PENDING");

  const query = `/api/recommendations?resource=${resource}&status=${status}`;
  const { data, error, loading, refetch } = useApi<Recommendation[]>(query, [
    resource,
    status,
  ]);
  const settings = useApi<SettingsPayload>("/api/settings");
  const symbol = settings.data?.economics.currency_symbol ?? "₹";

  const apply = useMutation(async (rec: Recommendation) => {
    await api.post(`/api/recommendations/${rec.id}/apply`, {});
    await refetch({ quiet: true });
  });
  const [applyingId, setApplyingId] = React.useState<number | null>(null);

  const totals = React.useMemo(() => {
    const list = (data ?? []).filter((r) => r.status === "PENDING");
    return {
      count: list.length,
      energy: list
        .filter((r) => r.resource_type === "ENERGY")
        .reduce((s, r) => s + r.expected_saving_per_week, 0),
      water: list
        .filter((r) => r.resource_type === "WATER")
        .reduce((s, r) => s + r.expected_saving_per_week, 0),
      money: list.reduce((s, r) => s + r.estimated_cost_saving_per_week, 0),
      co2: list.reduce((s, r) => s + r.estimated_co2_reduction_per_week, 0),
    };
  }, [data]);

  return (
    <div className="space-y-5">
      <header>
        <div className="eyebrow mb-1.5">AI recommendations</div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
          Evidence-based measures
        </h1>
        <p className="mt-1.5 max-w-2xl text-[13px] text-ink-muted">
          One measure per diagnosed cause. The prose is a fixed template; every
          number is derived from the measured excess across the fault footprint,
          discounted by a stated recoverable fraction.
        </p>
      </header>

      {/* ---- opportunity summary ---- */}
      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-[rgb(var(--line)/0.1)] bg-[rgb(var(--line)/0.07)] lg:grid-cols-4">
        <Stat label="Open recommendations" value={num(totals.count)} />
        <Stat
          label="Energy opportunity"
          value={compact(totals.energy, 1)}
          unit="kWh/wk"
          tone="mint"
        />
        <Stat
          label="Water opportunity"
          value={compact(totals.water / 1000, 1)}
          unit="kL/wk"
          tone="aqua"
        />
        <Stat
          label="Value at stake"
          value={`${symbol}${compact(totals.money * 52, 1)}`}
          unit="per year"
          tone="mint"
        />
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          size="sm"
          options={[
            { value: "ALL", label: "All resources" },
            { value: "ENERGY", label: "Energy" },
            { value: "WATER", label: "Water" },
          ]}
          value={resource}
          onChange={(v) => setResource(v as ResourceFilter)}
        />
        <Segmented
          size="sm"
          options={[
            { value: "PENDING", label: "Open" },
            { value: "APPLIED", label: "Applied" },
            { value: "ALL", label: "All" },
          ]}
          value={status}
          onChange={setStatus}
        />
      </div>

      {error ? <ErrorState error={error} onRetry={() => refetch()} /> : null}
      {apply.error ? <ErrorState error={apply.error} compact /> : null}

      {loading && !data ? (
        <Panel>
          <LoadingPanel rows={4} />
        </Panel>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {data?.map((recommendation) => (
          <RecommendationCard
            key={recommendation.id}
            recommendation={recommendation}
            currencySymbol={symbol}
            applying={applyingId === recommendation.id && apply.pending}
            onApply={async (r) => {
              setApplyingId(r.id);
              await apply.mutate(r);
              setApplyingId(null);
            }}
          />
        ))}
      </div>

      {data?.length === 0 ? (
        <Panel>
          <EmptyState
            icon={status === "PENDING" ? Wallet : Lightbulb}
            title={
              status === "PENDING"
                ? "No open recommendations"
                : "Nothing matches these filters"
            }
            description={
              status === "PENDING"
                ? "Every diagnosed anomaly has already been actioned. Re-run detection from the Anomalies page to look again."
                : "Try a different resource or status filter."
            }
          />
        </Panel>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: "mint" | "aqua";
}) {
  return (
    <div className="bg-canvas px-5 py-4">
      <div className="eyebrow mb-1.5">{label}</div>
      <div
        className={`num text-[20px] font-semibold ${
          tone === "mint" ? "text-mint" : tone === "aqua" ? "text-aqua" : "text-ink"
        }`}
      >
        {value}
        {unit ? (
          <span className="ml-1 text-[10px] font-normal text-ink-muted">{unit}</span>
        ) : null}
      </div>
    </div>
  );
}
