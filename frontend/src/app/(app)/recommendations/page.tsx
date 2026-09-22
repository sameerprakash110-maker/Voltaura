"use client";

import * as React from "react";

import { RecommendationList } from "@/components/domain/recommendation-list";
import { useAppState } from "@/components/providers/app-state";
import {
  EmptyState,
  ErrorState,
  LoadingPanel,
  Segmented,
} from "@/components/ui/primitives";
import { Metric, PageHeader, Section } from "@/components/ui/structure";
import { api } from "@/lib/api";
import { compact, num } from "@/lib/format";
import type { Recommendation, ResourceFilter, SettingsPayload } from "@/lib/types";
import { useApi, useMutation } from "@/lib/use-api";

type StatusFilter = "PENDING" | "APPLIED" | "ALL";

/**
 * Recommendations.
 *
 * Organised around the decision rather than the object: what is wrong, what
 * the evidence says, what to do, what it is worth. The opportunity total at the
 * top is the sum of everything still open, so the page states its own stake
 * before asking for a decision on any single measure.
 */
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
    <div className="space-y-8">
      <PageHeader
        label="Intelligence"
        title="Recommended Actions"
        description="One measure per diagnosed cause. The prose is a fixed template; every number is derived from the measured excess across the fault footprint, discounted by a stated recoverable fraction."
      />

      {/* ---- what is on the table ---- */}
      <section className="grid gap-x-8 gap-y-6 border-y border-[rgb(var(--line)/0.08)] py-6 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Open recommendations" value={num(totals.count)} size="lg" />
        <Metric
          label="Energy opportunity"
          value={compact(totals.energy, 1)}
          unit="kWh/wk"
          size="lg"
          tone="mint"
        />
        <Metric
          label="Water opportunity"
          value={compact(totals.water / 1000, 1)}
          unit="kL/wk"
          size="lg"
          tone="aqua"
        />
        <Metric
          label="Value at stake"
          value={`${symbol}${compact(totals.money * 52, 1)}`}
          unit="per year"
          size="lg"
          tone="mint"
          caption="Estimated, not yet verified"
        />
      </section>

      {/* ---- filters ---- */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="flex items-center gap-2.5">
          <span className="label">Resource</span>
          <Segmented
            size="sm"
            options={[
              { value: "ALL", label: "All" },
              { value: "ENERGY", label: "Energy" },
              { value: "WATER", label: "Water" },
            ]}
            value={resource}
            onChange={(v) => setResource(v as ResourceFilter)}
          />
        </div>
        <div className="flex items-center gap-2.5">
          <span className="label">Status</span>
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
      </div>

      {error ? <ErrorState error={error} onRetry={() => refetch()} /> : null}
      {apply.error ? <ErrorState error={apply.error} compact /> : null}

      <Section
        label="Measures"
        title={`${data?.length ?? 0} ${
          (data?.length ?? 0) === 1 ? "recommendation" : "recommendations"
        }`}
      >
        {loading && !data ? <LoadingPanel rows={4} /> : null}

        {data?.length ? (
          <RecommendationList
            recommendations={data}
            currencySymbol={symbol}
            applyingId={apply.pending ? applyingId : null}
            onApply={async (rec) => {
              setApplyingId(rec.id);
              await apply.mutate(rec);
              setApplyingId(null);
            }}
          />
        ) : data ? (
          <EmptyState
            title={
              status === "PENDING"
                ? "No open recommendations"
                : "Nothing matches these filters"
            }
            description={
              status === "PENDING"
                ? "Every diagnosed anomaly has already been actioned. Re-run detection from the Anomaly Monitor to look again."
                : "Try a different resource or status filter."
            }
          />
        ) : null}
      </Section>
    </div>
  );
}
