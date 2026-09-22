"use client";

import { BadgeCheck } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Button, Progress } from "@/components/ui/primitives";
import { StatusText } from "@/components/ui/structure";
import { compact, date, dateTime, num, pct } from "@/lib/format";
import type { Intervention, InterventionStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Interventions.
 *
 * An intervention is a commitment with a clock on it, so the record leads with
 * where it is in its monitoring period and what it is expected to return. The
 * verified figure, when it exists, replaces the estimate rather than sitting
 * next to it -- once something is measured the projection stops being the
 * interesting number.
 */

export const LIFECYCLE: InterventionStatus[] = [
  "PLANNED",
  "ACTIVE",
  "MONITORING",
  "COMPLETED",
  "VERIFIED",
];

export function InterventionRecord({
  intervention,
  onMonitor,
  onVerify,
  busy = false,
  busyLabel,
}: {
  intervention: Intervention;
  onMonitor?: (i: Intervention) => void;
  onVerify?: (i: Intervention) => void;
  busy?: boolean;
  busyLabel?: string;
}) {
  const verified = intervention.status === "VERIFIED";
  const needsData = !intervention.ready_for_verification && !verified;

  return (
    <article
      id={`i${intervention.id}`}
      className="grid scroll-mt-20 gap-x-8 gap-y-5 py-6 first:pt-0 lg:grid-cols-[164px_minmax(0,1fr)_208px]"
    >
      {/* ---- identity ---- */}
      <div>
        <div className="flex items-center gap-2">
          <span className="num text-[10.5px] text-ink-faint">
            #{intervention.id}
          </span>
          <StatusText status={intervention.status} />
        </div>
        <div className="mt-2 text-[13px] font-semibold tracking-[-0.01em] text-ink">
          {intervention.building_name}
        </div>
        <div
          className={cn(
            "mt-2 text-[10.5px] font-medium uppercase tracking-[0.09em]",
            intervention.resource_type === "WATER" ? "text-aqua" : "text-mint",
          )}
        >
          {intervention.resource_type}
        </div>
        <div className="num mt-2 text-[10.5px] text-ink-faint">
          {date(intervention.implemented_at)} · {intervention.owner}
        </div>
      </div>

      {/* ---- what was done ---- */}
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold leading-snug tracking-[-0.015em] text-ink">
          {intervention.title}
        </h3>
        <p className="mt-3 max-w-prose text-[12.5px] leading-relaxed text-ink-soft">
          {intervention.description}
        </p>

        {!verified ? (
          <div className="mt-5 max-w-sm">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="label">Post-intervention monitoring</span>
              <span className="num text-[11px] text-ink-soft">
                {num(intervention.elapsed_days, 1)} /{" "}
                {intervention.monitoring_days_required} d
              </span>
            </div>
            <Progress value={intervention.progress_pct} tone="aqua" />
          </div>
        ) : null}

        {intervention.notes ? (
          <p className="mt-4 text-[11px] leading-relaxed text-ink-muted">
            {intervention.notes}
          </p>
        ) : null}
      </div>

      {/* ---- result or action ---- */}
      <div className="flex flex-col gap-4">
        {verified && intervention.verified_saving !== null ? (
          <div>
            <div className="label mb-2">Measured</div>
            <div className="num text-[26px] font-semibold leading-none text-mint">
              −{pct(intervention.verified_saving_pct ?? 0)}
            </div>
            <div className="num mt-2 text-[11px] text-ink-muted">
              {compact(intervention.verified_saving, 1)}{" "}
              {intervention.expected_saving_unit ?? ""}/wk
            </div>
          </div>
        ) : intervention.expected_saving_per_week !== null ? (
          <div>
            <div className="label mb-2">Expected</div>
            <div className="num text-[20px] font-semibold leading-none text-ink">
              {compact(intervention.expected_saving_per_week, 1)}
              <span className="ml-1 text-[10.5px] font-medium text-ink-muted">
                {intervention.expected_saving_unit}/wk
              </span>
            </div>
            {intervention.verification_status ? (
              <div className="mt-2">
                <StatusText status={intervention.verification_status} />
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center gap-2">
          {intervention.verification_id ? (
            <Button variant="secondary" size="sm" asChild>
              <Link href={`/verification#v${intervention.verification_id}`}>
                View proof
              </Link>
            </Button>
          ) : null}

          {!verified && needsData && onMonitor ? (
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              onClick={() => onMonitor(intervention)}
            >
              {busy ? (busyLabel ?? "Collecting…") : "Collect 14d + verify"}
            </Button>
          ) : null}

          {!verified && !needsData && onVerify ? (
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              onClick={() => onVerify(intervention)}
            >
              <BadgeCheck /> Run verification
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

// --------------------------------------------------------------------------
// Lifecycle rail: how the portfolio is distributed across the loop
// --------------------------------------------------------------------------
export function LifecycleRail({
  counts,
  className,
}: {
  counts: Record<string, number>;
  className?: string;
}) {
  return (
    <ol className={cn("flex min-w-max items-start", className)}>
      {LIFECYCLE.map((stage, index) => {
        const value = counts[stage] ?? 0;
        const isLast = index === LIFECYCLE.length - 1;
        return (
          <li key={stage} className="min-w-[118px] flex-1 pr-5">
            <div className="relative flex h-2.5 items-center" aria-hidden>
              <span
                className={cn(
                  "relative z-10 size-2 shrink-0 rounded-full border",
                  value > 0
                    ? stage === "VERIFIED"
                      ? "border-transparent bg-mint"
                      : "border-transparent bg-aqua"
                    : "border-ink-faint/50 bg-canvas",
                )}
              />
              {!isLast ? (
                <span className="h-px flex-1 bg-[rgb(var(--line)/0.12)]" />
              ) : null}
            </div>
            <div className="label mt-2.5">{stage}</div>
            <div
              className={cn(
                "num mt-1.5 text-[20px] font-semibold leading-none",
                value > 0 ? "text-ink" : "text-ink-faint",
              )}
            >
              {num(value)}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// --------------------------------------------------------------------------
// Operational timeline: the audit trail, in order
// --------------------------------------------------------------------------
export interface TimelineRow {
  status: string;
  note: string;
  at: string;
  title?: string;
  href?: string;
}

export function OperationalTimeline({
  entries,
  className,
}: {
  entries: TimelineRow[];
  className?: string;
}) {
  return (
    <ol className={cn("relative", className)}>
      {entries.map((entry, index) => {
        const isLast = index === entries.length - 1;
        const tone =
          entry.status === "VERIFIED"
            ? "bg-mint"
            : entry.status === "MONITORING" || entry.status === "ACTIVE"
              ? "bg-aqua"
              : "bg-ink-faint";

        return (
          <li key={`${entry.at}-${index}`} className="relative flex gap-4 pb-5 last:pb-0">
            {/* node + connector */}
            <div className="relative flex w-2 shrink-0 justify-center" aria-hidden>
              <span className={cn("relative z-10 mt-[5px] size-2 rounded-full", tone)} />
              {!isLast ? (
                <span className="absolute left-1/2 top-[13px] h-full w-px -translate-x-1/2 bg-[rgb(var(--line)/0.12)]" />
              ) : null}
            </div>

            <div className="min-w-0 flex-1 pb-0.5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <StatusText status={entry.status} />
                {entry.title ? (
                  entry.href ? (
                    <Link
                      href={entry.href}
                      className="text-[12.5px] font-medium text-ink underline-offset-2 hover:underline"
                    >
                      {entry.title}
                    </Link>
                  ) : (
                    <span className="text-[12.5px] font-medium text-ink">
                      {entry.title}
                    </span>
                  )
                ) : null}
                <span className="num ml-auto text-[10.5px] text-ink-faint">
                  {dateTime(entry.at)}
                </span>
              </div>
              {entry.note ? (
                <p className="mt-1 max-w-prose text-[11.5px] leading-relaxed text-ink-muted">
                  {entry.note}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
