"use client";

import Link from "next/link";
import * as React from "react";

import { Num, StatusText, Table } from "@/components/ui/structure";
import { EmptyState } from "@/components/ui/primitives";
import {
  CAUSE_LABELS,
  compact,
  dateTime,
  duration,
  num,
  pct,
  signedPct,
} from "@/lib/format";
import type { Anomaly, Severity } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Anomaly monitor.
 *
 * A facility manager works a queue, so anomalies are a queue: one row each,
 * sorted by the list the API returned, scannable down any single column.
 * Severity is carried by a 2px rule on the leading edge of the row rather than
 * by a badge, which keeps six status colours off the screen at once.
 */

const SEVERITY_RULE: Record<Severity, string> = {
  LOW: "border-l-low/50",
  MEDIUM: "border-l-medium",
  HIGH: "border-l-high",
  CRITICAL: "border-l-critical",
};

export function causeLabel(code: string | null | undefined): string {
  if (!code) return "Undiagnosed";
  return CAUSE_LABELS[code] ?? code;
}

export function AnomalyTable({
  anomalies,
  emptyTitle = "No anomalies",
  emptyDescription,
  dense = false,
  className,
}: {
  anomalies: Anomaly[];
  emptyTitle?: string;
  emptyDescription?: string;
  dense?: boolean;
  className?: string;
}) {
  if (!anomalies.length) {
    return <EmptyState title={emptyTitle} description={emptyDescription} compact />;
  }

  return (
    <Table className={className} minWidth={dense ? 620 : 860}>
      <thead>
        <tr>
          <th className="pl-3">Detected</th>
          <th>Block</th>
          <th>Resource</th>
          <th className="text-right">Deviation</th>
          {!dense ? <th className="text-right">Excess</th> : null}
          <th>Probable cause</th>
          {!dense ? <th className="text-right">Confidence</th> : null}
          {!dense ? <th className="text-right">Duration</th> : null}
          <th className="pr-0 text-right">Status</th>
        </tr>
      </thead>
      <tbody>
        {anomalies.map((anomaly) => (
          <tr
            key={anomaly.id}
            className="group relative transition-colors hover:bg-[rgb(var(--line)/0.025)]"
          >
            <td
              className={cn(
                "border-l-2 pl-3",
                SEVERITY_RULE[anomaly.severity] ?? "border-l-transparent",
              )}
            >
              <Link
                href={`/anomalies/${anomaly.id}`}
                className="num text-[11.5px] text-ink-soft before:absolute before:inset-0 before:content-['']"
              >
                {dateTime(anomaly.detected_at)}
              </Link>
            </td>
            <td>
              <span className="font-medium text-ink">{anomaly.building_code}</span>
              {!dense ? (
                <span className="ml-2 text-[11px] text-ink-muted">
                  {anomaly.building_name}
                </span>
              ) : null}
            </td>
            <td>
              <span
                className={cn(
                  "text-[10.5px] font-medium uppercase tracking-[0.09em]",
                  anomaly.resource_type === "WATER" ? "text-aqua" : "text-mint",
                )}
              >
                {anomaly.resource_type}
              </span>
            </td>
            <td className="text-right">
              <Num tone={anomaly.deviation_pct > 0 ? "critical" : "mint"}>
                {signedPct(anomaly.deviation_pct, 0)}
              </Num>
            </td>
            {!dense ? (
              <td className="text-right">
                <Num>
                  {compact(anomaly.excess_total, 1)}
                  <span className="ml-1 text-[10px] text-ink-faint">
                    {anomaly.unit}
                  </span>
                </Num>
              </td>
            ) : null}
            <td>
              <span className="text-ink-soft">{causeLabel(anomaly.cause_code)}</span>
              {anomaly.is_persistent ? (
                <span className="ml-2 text-[10px] uppercase tracking-[0.08em] text-ink-faint">
                  persistent
                </span>
              ) : null}
            </td>
            {!dense ? (
              <td className="text-right">
                <Num>
                  {anomaly.confidence !== null
                    ? pct(anomaly.confidence * 100, 0)
                    : "—"}
                </Num>
              </td>
            ) : null}
            {!dense ? (
              <td className="text-right">
                <Num>{duration(anomaly.duration_hours)}</Num>
              </td>
            ) : null}
            <td className="pr-0 text-right">
              <StatusText status={anomaly.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/**
 * Severity distribution as a single stacked rule.
 *
 * Reads as one bar rather than four counters, which is the right shape for
 * "how bad is the queue right now".
 */
export function SeverityBar({
  anomalies,
  className,
}: {
  anomalies: Anomaly[];
  className?: string;
}) {
  const order: Severity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
  const counts = order.map((severity) => ({
    severity,
    count: anomalies.filter((a) => a.severity === severity).length,
  }));
  const total = counts.reduce((sum, entry) => sum + entry.count, 0);

  if (!total) return null;

  const fill: Record<Severity, string> = {
    CRITICAL: "bg-critical",
    HIGH: "bg-high",
    MEDIUM: "bg-medium",
    LOW: "bg-low",
  };

  return (
    <div className={className}>
      <div className="flex h-[3px] w-full overflow-hidden">
        {counts
          .filter((entry) => entry.count > 0)
          .map((entry) => (
            <span
              key={entry.severity}
              className={fill[entry.severity]}
              style={{ width: `${(entry.count / total) * 100}%` }}
            />
          ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {counts
          .filter((entry) => entry.count > 0)
          .map((entry) => (
            <span
              key={entry.severity}
              className="flex items-center gap-1.5 text-[10.5px] text-ink-muted"
            >
              <span className={cn("size-1.5 rounded-full", fill[entry.severity])} />
              {entry.severity.toLowerCase()}
              <span className="num text-ink-soft">{num(entry.count)}</span>
            </span>
          ))}
      </div>
    </div>
  );
}
