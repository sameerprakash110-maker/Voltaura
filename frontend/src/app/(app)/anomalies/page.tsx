"use client";

import { RefreshCw } from "lucide-react";
import * as React from "react";

import { AnomalyTable, SeverityBar } from "@/components/domain/anomaly-table";
import { useAppState } from "@/components/providers/app-state";
import {
  Button,
  ErrorState,
  LoadingPanel,
  Segmented,
} from "@/components/ui/primitives";
import { Metric, PageHeader, Section } from "@/components/ui/structure";
import { api } from "@/lib/api";
import { compact, num } from "@/lib/format";
import type { Anomaly, AnomalyStatus, ResourceFilter, Severity } from "@/lib/types";
import { useApi, useMutation } from "@/lib/use-api";

type SeverityFilter = Severity | "ALL";
type StatusFilter = AnomalyStatus | "ALL";

/**
 * Anomaly monitor.
 *
 * A monitoring surface, not a notification feed. The summary line establishes
 * the size of the queue, the severity rule shows its shape, and everything
 * else is a table an operator can work down.
 */
export default function AnomaliesPage() {
  const { resource, setResource } = useAppState();
  const [severity, setSeverity] = React.useState<SeverityFilter>("ALL");
  const [status, setStatus] = React.useState<StatusFilter>("ALL");

  const query = `/api/anomalies?resource=${resource}&severity=${severity}&status=${status}`;
  const { data, error, loading, refetch } = useApi<Anomaly[]>(query, [
    resource,
    severity,
    status,
  ]);

  const rerun = useMutation(async () => {
    await api.post("/api/anomalies/detect", {});
    await refetch({ quiet: true });
  });

  const counts = React.useMemo(() => {
    const list = data ?? [];
    return {
      total: list.length,
      critical: list.filter((a) => a.severity === "CRITICAL").length,
      open: list.filter((a) => a.status === "OPEN" || a.status === "DIAGNOSED")
        .length,
      excessEnergy: list
        .filter((a) => a.resource_type === "ENERGY")
        .reduce((sum, a) => sum + a.excess_total, 0),
      excessWater: list
        .filter((a) => a.resource_type === "WATER")
        .reduce((sum, a) => sum + a.excess_total, 0),
    };
  }, [data]);

  return (
    <div className="space-y-8">
      <PageHeader
        label="Intelligence"
        title="Anomaly Monitor"
        description="Deviations from what each building was expected to consume. Related intervals are grouped into a single event, so a three-week leak appears once rather than ninety times."
        actions={
          <Button
            variant="secondary"
            size="sm"
            loading={rerun.pending}
            onClick={() => rerun.mutate()}
          >
            <RefreshCw /> Re-run detection
          </Button>
        }
      />

      {rerun.error ? <ErrorState error={rerun.error} compact /> : null}

      {/* ---- queue state ---- */}
      <section className="grid gap-x-8 gap-y-6 border-y border-[rgb(var(--line)/0.08)] py-6 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Events" value={num(counts.total)} size="lg" />
        <Metric
          label="Open"
          value={num(counts.open)}
          size="lg"
          tone={counts.open > 0 ? "medium" : "muted"}
        />
        <Metric
          label="Critical"
          value={num(counts.critical)}
          size="lg"
          tone={counts.critical > 0 ? "critical" : "muted"}
        />
        <div>
          <Metric
            label="Measured excess"
            value={compact(counts.excessEnergy, 1)}
            unit="kWh"
            size="lg"
          />
          <div className="num mt-2 text-[11px] text-ink-muted">
            {compact(counts.excessWater / 1000, 1)} kL water
          </div>
        </div>
      </section>

      {data?.length ? <SeverityBar anomalies={data} className="max-w-lg" /> : null}

      {/* ---- filters ---- */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <FilterGroup label="Resource">
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
        </FilterGroup>
        <FilterGroup label="Severity">
          <Segmented
            size="sm"
            options={[
              { value: "ALL", label: "Any" },
              { value: "CRITICAL", label: "Critical" },
              { value: "HIGH", label: "High" },
              { value: "MEDIUM", label: "Medium" },
            ]}
            value={severity}
            onChange={setSeverity}
          />
        </FilterGroup>
        <FilterGroup label="Status">
          <Segmented
            size="sm"
            options={[
              { value: "ALL", label: "Any" },
              { value: "OPEN", label: "Open" },
              { value: "DIAGNOSED", label: "Diagnosed" },
              { value: "ACTIONED", label: "Actioned" },
              { value: "RESOLVED", label: "Resolved" },
            ]}
            value={status}
            onChange={setStatus}
          />
        </FilterGroup>
      </div>

      {/* ---- events ---- */}
      <Section
        label="Events"
        title={`${counts.total} anomaly ${counts.total === 1 ? "event" : "events"}`}
        description="Sorted by severity, then by the size of the deviation."
      >
        {error ? <ErrorState error={error} onRetry={() => refetch()} compact /> : null}
        {loading && !data ? (
          <LoadingPanel rows={5} />
        ) : (
          <AnomalyTable
            anomalies={data ?? []}
            emptyTitle={
              severity === "ALL" && status === "ALL"
                ? "No anomalies detected"
                : "Nothing matches these filters"
            }
            emptyDescription={
              severity === "ALL" && status === "ALL"
                ? "Every building is tracking its expected-consumption baseline."
                : "Try widening the severity or status filter."
            }
          />
        )}
      </Section>
    </div>
  );
}

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="label">{label}</span>
      {children}
    </div>
  );
}
