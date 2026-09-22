"use client";

import * as React from "react";

import {
  InterventionRecord,
  LIFECYCLE,
  LifecycleRail,
  OperationalTimeline,
  type TimelineRow,
} from "@/components/domain/intervention";
import {
  EmptyState,
  ErrorState,
  LoadingPanel,
  Segmented,
} from "@/components/ui/primitives";
import { PageHeader, Section } from "@/components/ui/structure";
import { api } from "@/lib/api";
import type { Intervention, InterventionStatus } from "@/lib/types";
import { useApi, useMutation } from "@/lib/use-api";

type StatusFilter = InterventionStatus | "ALL";

/**
 * Interventions.
 *
 * Applying a recommendation creates an intervention and closes the underlying
 * fault from that moment, so the telemetry that follows genuinely reflects the
 * change. The page is built around that clock: where each measure sits in its
 * monitoring period, and the audit trail of how it got there.
 */
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

  const trail = React.useMemo<TimelineRow[]>(() => {
    return (data ?? [])
      .flatMap((intervention) =>
        (intervention.timeline ?? []).map((entry) => ({
          status: entry.status,
          note: entry.note,
          at: entry.at,
          title: intervention.title,
          href: `#i${intervention.id}`,
        })),
      )
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 14);
  }, [data]);

  return (
    <div className="space-y-8">
      <PageHeader
        label="Intelligence"
        title="Interventions"
        description="Measures applied on site, each with a post-intervention monitoring period that must complete before its saving can be measured."
      />

      {/* ---- lifecycle ---- */}
      <Section
        label="Lifecycle"
        title="Detected → Applied → Monitoring → Verified"
        actions={
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
        }
      >
        <LifecycleRail counts={counts} />
      </Section>

      {error ? <ErrorState error={error} onRetry={() => refetch()} /> : null}
      {monitor.error ? <ErrorState error={monitor.error} compact /> : null}
      {verify.error ? <ErrorState error={verify.error} compact /> : null}

      {/* ---- records ---- */}
      <Section
        label="Records"
        title={`${data?.length ?? 0} ${
          (data?.length ?? 0) === 1 ? "intervention" : "interventions"
        }`}
      >
        {loading && !data ? <LoadingPanel rows={3} /> : null}

        {data?.length ? (
          <div className="divide-y divide-[rgb(var(--line)/0.08)]">
            {data.map((intervention) => (
              <InterventionRecord
                key={intervention.id}
                intervention={intervention}
                busy={busyId === intervention.id && (monitor.pending || verify.pending)}
                busyLabel="Collecting…"
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
        ) : data ? (
          <EmptyState
            title="No interventions"
            description="Apply a recommendation to create one and open its monitoring period."
          />
        ) : null}
      </Section>

      {/* ---- audit trail ---- */}
      {trail.length ? (
        <Section
          label="Audit trail"
          title="Every status change, in order"
          description="With the note recorded at the time, so the sequence can be checked rather than taken on trust."
        >
          <OperationalTimeline entries={trail} className="max-w-3xl" />
        </Section>
      ) : null}
    </div>
  );
}
