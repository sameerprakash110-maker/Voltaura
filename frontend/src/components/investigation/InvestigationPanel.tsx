"use client";

import {
  CircleAlert,
  CircleHelp,
  CircleCheck,
  FlaskConical,
  Search,
  XCircle,
} from "lucide-react";

import {
  Badge,
  EmptyState,
  ErrorState,
  Panel,
  PanelHeader,
  Skeleton,
} from "@/components/ui/primitives";
import type {
  InvestigationEvidence,
  InvestigationHypothesis,
  InvestigationProbe,
  InvestigationResponse,
  InvestigationUnknown,
} from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function statusLabel(status?: string | null): string {
  return status?.trim() || "UNKNOWN";
}

function statusTone(status?: string | null): "mint" | "medium" | "critical" | "neutral" {
  switch (status?.trim().toUpperCase()) {
    case "SUPPORTED":
      return "mint";
    case "WEAK":
      return "medium";
    case "CONTRADICTED":
      return "critical";
    default:
      return "neutral";
  }
}

function SectionLabel({
  icon: Icon,
  label,
  tone,
}: {
  icon: typeof CircleCheck;
  label: string;
  tone: "supporting" | "contradiction" | "unknown";
}) {
  const toneClass = {
    supporting: "text-mint",
    contradiction: "text-critical",
    unknown: "text-medium",
  }[tone];

  return (
    <div className={cn("mb-3 flex items-center gap-2", toneClass)}>
      <Icon className="size-3.5" />
      <span className="eyebrow !text-current">{label}</span>
    </div>
  );
}

function HypothesisCard({ hypothesis }: { hypothesis: InvestigationHypothesis }) {
  return (
    <div className="rounded-card border border-[rgb(var(--line)/0.09)] bg-surface/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="text-[13px] font-medium text-ink">{hypothesis.name}</div>
        <Badge tone={statusTone(hypothesis.status)}>{statusLabel(hypothesis.status)}</Badge>
      </div>
      <div className="mt-2 flex items-center gap-2 text-[11px] text-ink-muted">
        <span className="eyebrow">Confidence</span>
        <span className="num text-ink-soft">{Math.round(hypothesis.confidence * 100)}%</span>
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">
        {hypothesis.reasoning}
      </p>
    </div>
  );
}

function EvidenceList({
  items,
  contradiction = false,
}: {
  items: InvestigationEvidence[];
  contradiction?: boolean;
}) {
  if (!items.length) {
    return <p className="text-[12px] text-ink-muted">No recorded items.</p>;
  }

  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div
          key={`${item.label}-${index}`}
          className="rounded-card border border-[rgb(var(--line)/0.08)] bg-surface/45 px-3.5 py-3"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <span className="text-[12px] font-medium text-ink">{item.label}</span>
            <span className={cn("num text-[11px]", contradiction ? "text-critical" : "text-mint")}>
              {displayValue(item.value)}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">{item.meaning}</p>
          {item.hypothesis ? (
            <div className="mt-2 text-[10px] text-ink-muted">
              Hypothesis: <span className="text-ink-soft">{item.hypothesis}</span>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function UnknownList({ items }: { items: InvestigationUnknown[] }) {
  if (!items.length) {
    return <p className="text-[12px] text-ink-muted">No unknowns remain.</p>;
  }

  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div
          key={`${item.label}-${index}`}
          className="rounded-card border border-medium/18 bg-medium/[0.04] px-3.5 py-3"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-medium text-ink">{item.label}</span>
            <Badge tone="medium">{statusLabel(item.status)}</Badge>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
            {item.why_it_matters}
          </p>
        </div>
      ))}
    </div>
  );
}

function ProbeList({ probes }: { probes: InvestigationProbe[] }) {
  if (!probes.length) {
    return <p className="text-[12px] text-ink-muted">No probes recorded.</p>;
  }

  return (
    <div className="space-y-2">
      {probes.map((probe, index) => (
        <div
          key={`${probe.tool}-${index}`}
          className="grid gap-2 rounded-card border border-[rgb(var(--line)/0.08)] bg-surface/45 px-3.5 py-3 md:grid-cols-[1.3fr_1fr_auto] md:items-center"
        >
          <div>
            <div className="text-[12px] font-medium text-ink">{probe.tool}</div>
            <div className="mt-1 font-mono text-[10px] text-ink-muted">
              {displayValue(probe.arguments)}
            </div>
          </div>
          <Badge tone={probe.selector === "deterministic" ? "aqua" : "iris"}>
            {probe.selector}
          </Badge>
          <span className="text-[11px] text-ink-muted">{statusLabel(probe.status)}</span>
        </div>
      ))}
    </div>
  );
}

function InvestigationContent({ data }: { data: InvestigationResponse }) {
  const probes = data.probes_taken ?? [];

  return (
    <div className="space-y-5 px-5 pb-5">
      <div className="rounded-card border border-aqua/18 bg-aqua/[0.04] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="eyebrow text-aqua">Investigation summary</span>
          <Badge tone={statusTone(data.status)} dot>
            {statusLabel(data.status)}
          </Badge>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
          {data.investigation_summary || "No investigation summary was returned."}
        </p>
      </div>

      <section>
        <SectionLabel icon={CircleHelp} label="Hypotheses" tone="unknown" />
        {data.hypotheses.length ? (
          <div className="grid gap-3 lg:grid-cols-3">
            {data.hypotheses.map((hypothesis) => (
              <HypothesisCard key={hypothesis.name} hypothesis={hypothesis} />
            ))}
          </div>
        ) : (
          <p className="text-[12px] text-ink-muted">No hypotheses returned.</p>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-card border border-mint/18 bg-mint/[0.025] p-4">
          <SectionLabel icon={CircleCheck} label="Supporting evidence" tone="supporting" />
          <EvidenceList items={data.supporting_evidence} />
        </section>
        <section className="rounded-card border border-critical/18 bg-critical/[0.025] p-4">
          <SectionLabel icon={XCircle} label="Contradictions" tone="contradiction" />
          <EvidenceList items={data.contradictions} contradiction />
        </section>
      </div>

      <section className="rounded-card border border-medium/18 bg-medium/[0.025] p-4">
        <SectionLabel icon={CircleAlert} label="Unknown information" tone="unknown" />
        <UnknownList items={data.unknowns} />
      </section>

      <section>
        <SectionLabel icon={FlaskConical} label="Investigation steps / probes" tone="supporting" />
        <ProbeList probes={probes} />
      </section>

      {data.next_probe ? (
        <div className="rounded-card border border-iris/20 bg-iris/[0.04] p-4">
          <div className="flex items-center gap-2 text-iris">
            <Search className="size-3.5" />
            <span className="eyebrow !text-current">Next probe</span>
          </div>
          <div className="mt-2 font-mono text-[11px] leading-relaxed text-ink-soft">
            {displayValue(data.next_probe)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function InvestigationPanel({ anomalyId }: { anomalyId: number }) {
  const { data, error, loading, refetch } = useApi<InvestigationResponse>(
    `/api/anomalies/${anomalyId}/investigation`,
    [anomalyId],
  );

  return (
    <Panel id="investigation" className="scroll-mt-24">
      <PanelHeader
        eyebrow="Evidence-first investigation"
        title="What the measured context supports"
        subtitle="A deterministic review of competing hypotheses, evidence, contradictions, and remaining unknowns."
        action={<Badge tone="aqua">Deterministic</Badge>}
      />

      {loading && !data ? (
        <div className="space-y-3 px-5 pb-5">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : error && !data ? (
        <div className="px-5 pb-5">
          <ErrorState error={error} onRetry={() => refetch()} compact />
        </div>
      ) : !data ? (
        <EmptyState
          icon={Search}
          title="No investigation data"
          description="This anomaly does not have an investigation result yet."
          compact
        />
      ) : (
        <InvestigationContent data={data} />
      )}
    </Panel>
  );
}
