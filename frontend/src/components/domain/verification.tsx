"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Num, StatusText, Table } from "@/components/ui/structure";
import { compact, dateShort, num, pct } from "@/lib/format";
import type { Verification } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Verified impact.
 *
 * This is the product's whole argument, so it is the one place in the
 * interface where a figure is allowed to be large. The reading order is fixed:
 * what consumption would have been, what it actually was, the difference, and
 * only then the money -- because the money is a consequence of the measurement
 * and should never appear to be the measurement.
 */
export function VerifiedImpact({
  verification,
  currencySymbol = "₹",
  className,
}: {
  verification: Verification;
  currencySymbol?: string;
  className?: string;
}) {
  const verified = verification.status === "VERIFIED";
  const reduced = verification.saving_pct >= 0;

  return (
    <div className={className}>
      <div className="grid gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,1fr)_auto]">
        {/* before / after */}
        <div className="grid grid-cols-2 gap-x-8 sm:grid-cols-3">
          <Reading
            label="Baseline measured"
            value={num(verification.baseline_value)}
            unit={`${verification.unit}/wk`}
          />
          <Reading
            label="Adjusted baseline"
            value={num(verification.adjusted_baseline_value)}
            unit={`${verification.unit}/wk`}
            tone="text-iris"
            note="Model evaluated on the post period's own drivers"
          />
          <Reading
            label="After"
            value={num(verification.post_value)}
            unit={`${verification.unit}/wk`}
            tone={verified ? "text-mint" : "text-ink"}
          />
        </div>

        {/* the result */}
        <div className="border-t border-[rgb(var(--line)/0.1)] pt-5 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0">
          <div className="flex items-baseline gap-2.5">
            <span
              className={cn(
                "num text-readout font-semibold leading-none",
                verified ? "text-mint" : "text-ink-soft",
              )}
            >
              {reduced ? "−" : "+"}
              {pct(Math.abs(verification.saving_pct))}
            </span>
            <span className="label">reduction</span>
          </div>

          <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <span className="num text-[15px] font-semibold text-ink">
              {currencySymbol}
              {compact(verification.financial_saving_per_year, 1)}
              <span className="ml-1 text-[10.5px] font-medium text-ink-muted">
                /yr
              </span>
            </span>
            <span className="num text-[13px] text-ink-soft">
              {compact(Math.abs(verification.absolute_saving), 1)}
              <span className="ml-1 text-[10.5px] text-ink-muted">
                {verification.unit}/wk
              </span>
            </span>
            <span className="num text-[13px] text-ink-soft">
              {compact(verification.co2_reduction_per_year, 1)}
              <span className="ml-1 text-[10.5px] text-ink-muted">kg CO₂/yr</span>
            </span>
          </div>

          <div className="mt-4 flex items-center gap-2">
            {verified ? (
              <span className="flex size-4 items-center justify-center rounded-sm border border-mint/40 bg-mint/10 text-mint">
                <Check className="size-2.5" strokeWidth={3} />
              </span>
            ) : null}
            <StatusText status={verification.status} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Reading({
  label,
  value,
  unit,
  tone = "text-ink",
  note,
}: {
  label: string;
  value: string;
  unit: string;
  tone?: string;
  note?: string;
}) {
  return (
    <div>
      <div className="label mb-2">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span className={cn("num text-[22px] font-semibold leading-none", tone)}>
          {value}
        </span>
        <span className="text-[10.5px] font-medium text-ink-muted">{unit}</span>
      </div>
      {note ? (
        <p className="mt-2 max-w-[22ch] text-[10.5px] leading-snug text-ink-faint">
          {note}
        </p>
      ) : null}
    </div>
  );
}

// --------------------------------------------------------------------------
// Compact list, for the dashboard and for report roll-ups
// --------------------------------------------------------------------------
export function VerificationTable({
  verifications,
  currencySymbol = "₹",
  className,
}: {
  verifications: Verification[];
  currencySymbol?: string;
  className?: string;
}) {
  return (
    <Table className={className} minWidth={640}>
      <thead>
        <tr>
          <th className="w-[38%]">Intervention</th>
          <th>Block</th>
          <th className="text-right">Baseline</th>
          <th className="text-right">After</th>
          <th className="text-right">Saving</th>
          <th className="text-right">Value</th>
          <th className="pr-0 text-right">Status</th>
        </tr>
      </thead>
      <tbody>
        {verifications.map((verification) => {
          const verified = verification.status === "VERIFIED";
          return (
            <tr
              key={verification.id}
              className="group relative transition-colors hover:bg-[rgb(var(--line)/0.025)]"
            >
              <td>
                <Link
                  href={`/verification#v${verification.id}`}
                  className="font-medium text-ink before:absolute before:inset-0 before:content-['']"
                >
                  {verification.intervention_title}
                </Link>
                <div className="num mt-0.5 text-[10.5px] text-ink-faint">
                  from {dateShort(verification.post_start)}
                </div>
              </td>
              <td className="text-ink-soft">{verification.building_code}</td>
              <td className="text-right">
                <Num>{num(verification.adjusted_baseline_value)}</Num>
              </td>
              <td className="text-right">
                <Num tone={verified ? "mint" : "muted"}>
                  {num(verification.post_value)}
                </Num>
              </td>
              <td className="text-right">
                <Num tone={verified ? "mint" : "muted"}>
                  {verification.saving_pct >= 0 ? "−" : "+"}
                  {pct(Math.abs(verification.saving_pct))}
                </Num>
              </td>
              <td className="text-right">
                <Num tone={verified ? "mint" : "muted"}>
                  {verified
                    ? `${currencySymbol}${compact(verification.financial_saving_per_year, 1)}`
                    : "—"}
                </Num>
              </td>
              <td className="pr-0 text-right">
                <StatusText status={verification.status} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
