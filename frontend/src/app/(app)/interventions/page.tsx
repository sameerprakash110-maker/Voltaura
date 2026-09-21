"use client";

import { Wrench } from "lucide-react";
import * as React from "react";

import { InterventionCard } from "@/components/cards/domain-cards";
import {
  Badge,
  EmptyState,
  ErrorState,
  LoadingPanel,
  Panel,
  PanelHeader,
  Segmented,
} from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { dateTime, num } from "@/lib/format";
import type { Intervention, InterventionStatus } from "@/lib/types";
import { useApi, useMutation } from "@/lib/use-api";
import { cn } from "@/lib/utils";

type StatusFilter = InterventionStatus | "ALL";

const LIFECYCLE: InterventionStatus[] = [
  "PLANNED",
  "ACTIVE",
  "MONITORING",
  "COMPLETED",
  "VERIFIED",
];

export default function InterventionsPage() {
  const [status, setStatus] = React.useState<StatusFilter>("ALL");
  const { data, error, loading, refetch } = useApi<Intervention[]>(
    `/api/interventions?status=${status}`,
    [status],
  );

  const [busyId, setBusyId] = React.useState<number | null>(null);

  const monitor = useMutation(async (intervention: Intervention) => {
    await api.post(`/api/interventions/${intervention.id}/monitor`, { days: 14 });
    await refetch({ quiet: true });
  });

  const verify = useMutation(async (intervention: Intervention) => {
    await api.post(`/api/verification/${intervention.id}/run`, {});
    await refetch({ quiet: true });
  });

  const counts = React.useMemo(() => {
    const list = data ?? [];
    return LIFECYCLE.reduce<Record<string, number>>(
      (acc, s) => ({ ...acc, [s]: list.filter((i) => i.status === s).length }),
      {},
    );
  }, [data]);

  return (
    <div className="space-y-5">
      <header>
        <div className="eyebrow mb-1.5">Intervention tracking</div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
          Measures applied on site
        </h1>
        <p className="mt-1.5 max-w-2xl text-[13px] text-ink-muted">
          Applying a recommendation creates an intervention and closes the
          underlying fault from that moment, so the telemetry that follows
          genuinely reflects the change.
        </p>
      </header>

      {/* ---- lifecycle ---- */}
      <Panel className="px-5 py-4">
        <div className="eyebrow mb-3">Lifecycle</div>
        <div className="flex flex-wrap items-center gap-1.5">
          {LIFECYCLE.map((stage, index) => (
            <React.Fragment key={stage}>
              <div
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-3 py-1.5",
                  counts[stage]
                    ? "border-mint/25 bg-mint/[0.07]"
                    : "border-[rgb(var(--line)/0.1)] bg-surface/40",
                )}
              >
                <span
                  className={cn(
                    "text-[11px] font-medium",
                    counts[stage] ? "text-ink" : "text-ink-muted",
                  )}
                >
                  {stage}
                </span>
                <span
                  className={cn(
                    "num text-[11px]",
                    counts[stage] ? "text-mint" : "text-ink-muted",
                  )}
                >
                  {num(counts[stage] ?? 0)}
                </span>
              </div>
              {index < LIFECYCLE.length - 1 ? (
                <span className="h-px w-4 bg-[rgb(var(--line)/0.14)]" />
              ) : null}
            </React.Fragment>
          ))}
        </div>
      </Panel>

      <Segmented
        size="sm"
        options={[
          { value: "ALL", label: "All" },
          { value: "ACTIVE", label: "Active" },
          { value: "MONITORING", label: "Monitoring" },
          { value: "VERIFIED", label: "Verified" },
        ]}
        value={status}
        onChange={setStatus}
      />

      {error ? <ErrorState error={error} onRetry={() => refetch()} /> : null}
      {monitor.error ? <ErrorState error={monitor.error} compact /> : null}
      {verify.error ? <ErrorState error={verify.error} compact /> : null}

      {loading && !data ? (
        <Panel>
          <LoadingPanel rows={3} />
        </Panel>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {data?.map((intervention) => (
          <InterventionCard
            key={intervention.id}
            intervention={intervention}
            busy={busyId === intervention.id && (monitor.pending || verify.pending)}
            busyLabel="Collecting..."
            onMonitor={async (i) => {
              setBusyId(i.id);
              await monitor.mutate(i);
              setBusyId(null);
            }}
            onVerify={async (i) => {
              setBusyId(i.id);
              await verify.mutate(i);
              setBusyId(null);
            }}
          />
        ))}
      </div>

      {data?.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Wrench}
            title="No interventions"
            description="Apply a recommendation to create one and open its monitoring period."
          />
        </Panel>
      ) : null}

      {/* ---- timeline ---- */}
      {data?.length ? (
        <Panel>
          <PanelHeader
            eyebrow="Audit trail"
            title="Intervention timeline"
            subtitle="Every status change, in order, with the note recorded at the time."
          />
          <div className="px-5 pb-5">
            <ol className="relative space-y-5 border-l border-[rgb(var(--line)/0.12)] pl-5">
              {data
                .flatMap((intervention) =>
                  (intervention.timeline ?? []).map((entry) => ({
                    ...entry,
                    intervention,
                  })),
                )
                .sort(
                  (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
                )
                .slice(0, 14)
                .map((entry, index) => (
                  <li key={index} className="relative">
                    <span
                      className={cn(
                        "absolute -left-[26px] top-1 size-2.5 rounded-full border-2 border-canvas",
                        entry.status === "VERIFIED"
                          ? "bg-mint"
                          : entry.status === "MONITORING" || entry.status === "ACTIVE"
                            ? "bg-aqua"
                            : "bg-ink-muted",
                      )}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        tone={
                          entry.status === "VERIFIED"
                            ? "mint"
                            : entry.status === "MONITORING" || entry.status === "ACTIVE"
                              ? "aqua"
                              : "neutral"
                        }
                      >
                        {entry.status}
                      </Badge>
                      <span className="text-[12px] font-medium text-ink">
                        {entry.intervention.title}
                      </span>
                      <span className="num text-[10px] text-ink-muted">
                        {dateTime(entry.at)}
                      </span>
                    </div>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">
                      {entry.note}
                    </p>
                  </li>
                ))}
            </ol>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
