"use client";

import { Radar, RefreshCw, ShieldCheck } from "lucide-react";
import * as React from "react";

import { AnomalyCard } from "@/components/cards/domain-cards";
import { useAppState } from "@/components/providers/app-state";
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
import { api } from "@/lib/api";
import { compact, num } from "@/lib/format";
import type { Anomaly, ResourceFilter, Severity } from "@/lib/types";
import { useApi, useMutation } from "@/lib/use-api";

type SeverityFilter = Severity | "ALL";
type StatusFilter = "ALL" | "OPEN" | "DIAGNOSED" | "ACTIONED";

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
      open: list.filter((a) => a.status === "OPEN" || a.status === "DIAGNOSED").length,
      excessEnergy: list
        .filter((a) => a.resource_type === "ENERGY")
        .reduce((sum, a) => sum + a.excess_total, 0),
      excessWater: list
        .filter((a) => a.resource_type === "WATER")
        .reduce((sum, a) => sum + a.excess_total, 0),
    };
  }, [data]);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow mb-1.5">Anomaly centre</div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
            Detected anomalies
          </h1>
          <p className="mt-1.5 max-w-2xl text-[13px] text-ink-muted">
            An Isolation Forest and an hour-normalised residual test must both
            agree before an interval is flagged. Flagged intervals are then
            consolidated into events, so a three-week leak appears once rather
            than ninety times.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          loading={rerun.pending}
          onClick={() => rerun.mutate()}
        >
          <RefreshCw /> Re-run detection
        </Button>
      </header>

      {rerun.error ? <ErrorState error={rerun.error} compact /> : null}

      {/* ---- summary ---- */}
      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-[rgb(var(--line)/0.1)] bg-[rgb(var(--line)/0.07)] sm:grid-cols-4">
        <Stat label="Events" value={num(counts.total)} />
        <Stat label="Open" value={num(counts.open)} tone="medium" />
        <Stat label="Critical" value={num(counts.critical)} tone="critical" />
        <Stat
          label="Measured excess"
          value={`${compact(counts.excessEnergy, 1)} kWh`}
          sub={`${compact(counts.excessWater / 1000, 1)} kL water`}
        />
      </section>

      {/* ---- filters ---- */}
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
            { value: "ALL", label: "Any severity" },
            { value: "CRITICAL", label: "Critical" },
            { value: "HIGH", label: "High" },
            { value: "MEDIUM", label: "Medium" },
          ]}
          value={severity}
          onChange={setSeverity}
        />
        <Segmented
          size="sm"
          options={[
            { value: "ALL", label: "Any status" },
            { value: "DIAGNOSED", label: "Diagnosed" },
            { value: "ACTIONED", label: "Actioned" },
          ]}
          value={status}
          onChange={setStatus}
        />
      </div>

      {/* ---- list ---- */}
      <Panel>
        <PanelHeader
          eyebrow="Events"
          title={`${counts.total} anomaly ${counts.total === 1 ? "event" : "events"}`}
          subtitle="Sorted by severity, then by the size of the deviation."
          action={
            data?.length ? (
              <Badge tone="neutral">
                {data[0]?.detector ?? "isolation_forest+rf_residual"}
              </Badge>
            ) : null
          }
        />
        <div className="space-y-2 px-4 pb-5">
          {loading && !data ? <LoadingPanel rows={4} /> : null}
          {error ? <ErrorState error={error} onRetry={() => refetch()} compact /> : null}
          {data?.length ? (
            data.map((anomaly) => <AnomalyCard key={anomaly.id} anomaly={anomaly} />)
          ) : data ? (
            <EmptyState
              icon={severity === "ALL" && status === "ALL" ? ShieldCheck : Radar}
              title={
                severity === "ALL" && status === "ALL"
                  ? "No anomalies detected"
                  : "Nothing matches these filters"
              }
              description={
                severity === "ALL" && status === "ALL"
                  ? "Every building is tracking its expected-consumption baseline."
                  : "Try widening the severity or status filter."
              }
            />
          ) : null}
        </div>
      </Panel>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "medium" | "critical";
}) {
  return (
    <div className="bg-canvas px-5 py-4">
      <div className="eyebrow mb-1.5">{label}</div>
      <div
        className={`num text-[20px] font-semibold ${
          tone === "critical"
            ? "text-critical"
            : tone === "medium"
              ? "text-medium"
              : "text-ink"
        }`}
      >
        {value}
      </div>
      {sub ? <div className="num mt-0.5 text-[10px] text-ink-muted">{sub}</div> : null}
    </div>
  );
}
