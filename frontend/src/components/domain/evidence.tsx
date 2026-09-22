"use client";

import * as React from "react";

import { CAUSE_LABELS } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Evidence.
 *
 * The diagnosis engine works by testing named conditions against measured
 * values, so the evidence is shown the way the engine holds it: a satisfied
 * flag, the criterion that was tested, and the value it was tested against.
 * Nothing is summarised away, because the point of the table is that a reader
 * can disagree with it.
 */
export function EvidenceList({
  evidence,
  className,
}: {
  evidence: {
    label: string;
    value: string;
    criterion: string;
    satisfied: boolean;
    detail?: string;
  }[];
  className?: string;
}) {
  if (!evidence.length) {
    return (
      <p className={cn("text-[11.5px] text-ink-muted", className)}>
        No evidence recorded.
      </p>
    );
  }

  return (
    <ul className={cn("divide-y divide-[rgb(var(--line)/0.07)]", className)}>
      {evidence.map((item, index) => (
        <li key={index} className="flex items-start gap-3 py-2.5 first:pt-0">
          <span
            className={cn(
              "mt-[3px] flex size-3 shrink-0 items-center justify-center rounded-[2px] border text-[8px] font-bold leading-none",
              item.satisfied
                ? "border-mint/45 bg-mint/12 text-mint"
                : "border-[rgb(var(--line)/0.16)] text-ink-faint",
            )}
            aria-hidden
          >
            {item.satisfied ? "✓" : "–"}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-4">
              <span
                className={cn(
                  "text-[12px] font-medium",
                  item.satisfied ? "text-ink" : "text-ink-muted",
                )}
              >
                {item.label}
              </span>
              <span
                className={cn(
                  "num shrink-0 text-[12px] font-medium",
                  item.satisfied ? "text-ink" : "text-ink-faint",
                )}
              >
                {item.value}
              </span>
            </div>
            <div className="num mt-0.5 text-[10.5px] text-ink-faint">
              {item.criterion}
            </div>
            {item.detail ? (
              <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
                {item.detail}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function causeLabel(code: string | null | undefined): string {
  if (!code) return "Undiagnosed";
  return CAUSE_LABELS[code] ?? code;
}
