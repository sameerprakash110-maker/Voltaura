"use client";

import * as React from "react";

import {
  ErrorState,
  EmptyState,
  Skeleton,
} from "@/components/ui/primitives";
import {
  MiniBar,
  Num,
  Section,
  StatusText,
  Table,
} from "@/components/ui/structure";
import type {
  InvestigationEvidence,
  InvestigationHypothesis,
  InvestigationProbe,
  InvestigationResponse,
  InvestigationUnknown,
} from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";

/**
 * Evidence-first investigation.
 *
 * The investigator returns competing hypotheses with the evidence for and
 * against each, plus what it still does not know. That structure is the point,
 * so it is rendered as structure: a ranked table of hypotheses, two facing
 * columns of evidence, and an explicit list of unknowns. Contradictions are
 * given equal visual weight to support, because an investigation that only
 * shows its supporting evidence is not an investigation.
 */

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

function confidenceTone(
  status?: string | null,
): "mint" | "medium" | "critical" | "muted" {
  switch (status?.trim().toUpperCase()) {
    case "SUPPORTED":
      return "mint";
    case "WEAK":
      return "medium";
    case "CONTRADICTED":
      return "critical";
    default:
      return "muted";
  }
}

/**
 * Tool identifiers are how the investigator names its own steps; a reader only
 * needs to know which check ran, so they are shown as words.
 */
function probeLabel(tool: string): string {
  const words = tool
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter((word) => word && !/^(get|fetch|check|read)$/i.test(word));
  const label = (words.length ? words : [tool]).join(" ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function nextProbeLabel(probe: Record<string, unknown> | null): string {
  if (!probe) return "";
  const tool = probe.tool ?? probe.name;
  return typeof tool === "string" ? probeLabel(tool) : displayValue(probe);
}

// --------------------------------------------------------------------------
function HypothesisTable({ hypotheses }: { hypotheses: InvestigationHypothesis[] }) {
  if (!hypotheses.length) {
    return <p className="text-[11.5px] text-ink-muted">No hypotheses returned.</p>;
  }

  return (
    <Table minWidth={640}>
      <thead>
        <tr>
          <th className="w-[24%]">Hypothesis</th>
          <th className="w-[14%]">Confidence</th>
          <th className="text-right">Score</th>
          <th className="w-[12%]">Status</th>
          <th className="pr-0">Reasoning</th>
        </tr>
      </thead>
      <tbody>
        {hypotheses.map((hypothesis) => (
          <tr key={hypothesis.name}>
            <td className="align-top font-medium text-ink">{hypothesis.name}</td>
            <td className="align-top">
              <MiniBar
                value={hypothesis.confidence * 100}
                tone={confidenceTone(hypothesis.status)}
                width={72}
              />
            </td>
            <td className="align-top text-right">
              <Num tone="ink">{Math.round(hypothesis.confidence * 100)}%</Num>
            </td>
            <td className="align-top">
              <StatusText status={statusLabel(hypothesis.status)} />
            </td>
            <td className="pr-0 align-top leading-relaxed text-ink-muted">
              {hypothesis.reasoning}
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function EvidenceColumn({
  title,
  items,
  contradiction = false,
}: {
  title: string;
  items: InvestigationEvidence[];
  contradiction?: boolean;
}) {
  return (
    <div>
      <div
        className={cn("label mb-3", contradiction ? "text-critical" : "text-mint")}
      >
        {title}
      </div>
      {items.length ? (
        <ul className="divide-y divide-[rgb(var(--line)/0.07)]">
          {items.map((item, index) => (
            <li key={`${item.label}-${index}`} className="py-2.5 first:pt-0">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <span className="text-[12px] font-medium text-ink-soft">
                  {item.label}
                </span>
                <span
                  className={cn(
                    "num text-[11.5px]",
                    contradiction ? "text-critical" : "text-mint",
                  )}
                >
                  {displayValue(item.value)}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
                {item.meaning}
              </p>
              {item.hypothesis ? (
                <p className="mt-1 text-[10px] text-ink-faint">
                  Hypothesis: {item.hypothesis}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11.5px] text-ink-muted">No recorded items.</p>
      )}
    </div>
  );
}

function UnknownList({ items }: { items: InvestigationUnknown[] }) {
  if (!items.length) {
    return <p className="text-[11.5px] text-ink-muted">No unknowns remain.</p>;
  }

  return (
    <ul className="divide-y divide-[rgb(var(--line)/0.07)]">
      {items.map((item, index) => (
        <li key={`${item.label}-${index}`} className="py-2.5 first:pt-0">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <span className="text-[12px] font-medium text-ink-soft">
              {item.label}
            </span>
            <StatusText status={statusLabel(item.status)} />
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
            {item.why_it_matters}
          </p>
        </li>
      ))}
    </ul>
  );
}

function ProbeTable({ probes }: { probes: InvestigationProbe[] }) {
  if (!probes.length) {
    return <p className="text-[11.5px] text-ink-muted">No probes recorded.</p>;
  }

  return (
    <Table minWidth={360}>
      <thead>
        <tr>
          <th>Check</th>
          <th className="w-[22%] pr-0 text-right">Result</th>
        </tr>
      </thead>
      <tbody>
        {probes.map((probe, index) => (
          <tr key={`${probe.tool}-${index}`}>
            <td className="text-ink-soft">{probeLabel(probe.tool)}</td>
            <td className="pr-0 text-right">
              <StatusText status={statusLabel(probe.status)} />
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

// --------------------------------------------------------------------------
function InvestigationContent({ data }: { data: InvestigationResponse }) {
  const probes = data.probes_taken ?? [];

  return (
    <div className="space-y-7">
      <p className="max-w-3xl border-l-2 border-aqua/50 pl-4 text-[12.5px] leading-relaxed text-ink-soft">
        {data.investigation_summary || "No investigation summary was returned."}
      </p>

      <div>
        <div className="label mb-3">Hypotheses</div>
        <HypothesisTable hypotheses={data.hypotheses} />
      </div>

      <div className="grid gap-x-10 gap-y-7 xl:grid-cols-2">
        <EvidenceColumn title="Supporting evidence" items={data.supporting_evidence} />
        <EvidenceColumn
          title="Contradictions"
          items={data.contradictions}
          contradiction
        />
      </div>

      <div>
        <div className="label mb-3 text-medium">Unknown information</div>
        <UnknownList items={data.unknowns} />
      </div>

      <div>
        <div className="label mb-3">Checks run</div>
        <ProbeTable probes={probes} />
      </div>

      {data.next_probe ? (
        <div>
          <div className="label mb-2 text-iris">Suggested next check</div>
          <p className="max-w-3xl text-[11px] leading-relaxed text-ink-soft">
            {nextProbeLabel(data.next_probe)}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function InvestigationPanel({ anomalyId }: { anomalyId: number }) {
  const [started, setStarted] = React.useState(false);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setStarted(true), 0);
    return () => window.clearTimeout(timer);
  }, []);
  const { data, error, loading, refetch } = useApi<InvestigationResponse>(
    started ? `/api/anomalies/${anomalyId}/investigation` : null,
    [anomalyId],
  );

  return (
    <Section
      id="investigation"
      label="Evidence-first investigation"
      title="What the measured context supports"
      description="Competing explanations, the evidence for and against each, and what is still unknown."
      actions={
        data?.status ? <StatusText status={statusLabel(data.status)} /> : null
      }
    >
      {(!started || loading) && !data ? (
        <div className="space-y-3">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : error && !data ? (
        <ErrorState error={error} onRetry={() => refetch()} compact />
      ) : !data ? (
        <EmptyState
          title="No investigation data"
          description="This anomaly does not have an investigation result yet."
          compact
        />
      ) : (
        <InvestigationContent data={data} />
      )}
    </Section>
  );
}
