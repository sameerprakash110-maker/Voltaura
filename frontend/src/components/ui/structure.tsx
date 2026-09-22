"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Structure.
 *
 * These are the devices the whole product uses to build hierarchy: a page
 * header, a section rule, a metric, a data table and a proportional bar. There
 * are deliberately no card components here. A section is a label, a rule and
 * its content -- nothing is boxed unless boxing it tells the reader something.
 */

// --------------------------------------------------------------------------
// Page header
// --------------------------------------------------------------------------
export function PageHeader({
  label,
  title,
  description,
  actions,
  meta,
  className,
}: {
  label?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-x-8 gap-y-4", className)}>
      <div className="min-w-0">
        {label ? <div className="label mb-2">{label}</div> : null}
        <h1 className="text-[22px] font-semibold leading-none tracking-[-0.025em] text-ink">
          {title}
        </h1>
        {description ? (
          <p className="mt-2.5 max-w-2xl text-[12.5px] leading-relaxed text-ink-muted">
            {description}
          </p>
        ) : null}
        {meta ? <div className="mt-2.5">{meta}</div> : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}

// --------------------------------------------------------------------------
// Section
//
// The primary layout unit. A label, an optional title and controls, a hairline
// rule, then the content sitting directly on the canvas.
// --------------------------------------------------------------------------
export function Section({
  label,
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  id,
}: {
  label?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("scroll-mt-20", className)}>
      {label || title || actions ? (
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-[rgb(var(--line)/0.1)] pb-2.5">
          <div className="min-w-0">
            {label ? <div className="label">{label}</div> : null}
            {title ? (
              <h2
                className={cn(
                  "text-[14px] font-semibold leading-tight tracking-[-0.015em] text-ink",
                  label ? "mt-1.5" : "",
                )}
              >
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className="mt-1.5 max-w-2xl text-[11.5px] leading-relaxed text-ink-muted">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2 pb-0.5">
              {actions}
            </div>
          ) : null}
        </div>
      ) : null}
      {children ? <div className={cn("pt-4", bodyClassName)}>{children}</div> : null}
    </section>
  );
}

export function Rule({ className }: { className?: string }) {
  return <div className={cn("border-t border-[rgb(var(--line)/0.1)]", className)} />;
}

// --------------------------------------------------------------------------
// Metric
//
// A measured quantity, with no container. Size carries importance: `hero` for
// the one figure a page is about, `lg` for primary readings, `md` for
// supporting ones, `sm` inside dense groups.
// --------------------------------------------------------------------------
const METRIC_SIZE = {
  sm: "text-[15px]",
  md: "text-[19px]",
  lg: "text-[26px]",
  hero: "text-readout",
} as const;

const METRIC_TONE = {
  ink: "text-ink",
  mint: "text-mint",
  aqua: "text-aqua",
  iris: "text-iris",
  medium: "text-medium",
  high: "text-high",
  critical: "text-critical",
  muted: "text-ink-soft",
} as const;

export function Metric({
  label,
  value,
  unit,
  caption,
  delta,
  size = "md",
  tone = "ink",
  className,
  href,
}: {
  label?: React.ReactNode;
  value: React.ReactNode;
  unit?: React.ReactNode;
  caption?: React.ReactNode;
  delta?: React.ReactNode;
  size?: keyof typeof METRIC_SIZE;
  tone?: keyof typeof METRIC_TONE;
  className?: string;
  href?: string;
}) {
  const body = (
    <>
      {label ? <div className="label mb-2">{label}</div> : null}
      <div className="flex items-baseline gap-1.5">
        <span
          className={cn(
            "num font-semibold leading-none",
            METRIC_SIZE[size],
            METRIC_TONE[tone],
          )}
        >
          {value}
        </span>
        {unit ? (
          <span className="text-[11px] font-medium text-ink-muted">{unit}</span>
        ) : null}
      </div>
      {delta || caption ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          {delta}
          {caption ? (
            <span className="text-[11px] leading-snug text-ink-muted">{caption}</span>
          ) : null}
        </div>
      ) : null}
    </>
  );

  if (href) {
    return (
      <a href={href} className={cn("group block", className)}>
        {body}
      </a>
    );
  }
  return <div className={className}>{body}</div>;
}

/**
 * Change indicator.
 *
 * Coloured by whether the movement is *good*, not by its sign: energy falling
 * 4% is green, anomalies rising 50% is red. Getting this backwards is the most
 * common way a sustainability dashboard misleads the person reading it.
 */
export function Delta({
  value,
  goodDirection = "down",
  suffix = "%",
  className,
}: {
  value: number | null | undefined;
  goodDirection?: "up" | "down";
  suffix?: string;
  className?: string;
}) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;

  const flat = Math.abs(value) < 0.05;
  const isGood = flat ? null : goodDirection === "down" ? value < 0 : value > 0;
  const Arrow = flat ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      className={cn(
        "num inline-flex items-center gap-0.5 text-[11.5px] font-medium",
        isGood === null
          ? "text-ink-muted"
          : isGood
            ? "text-mint"
            : "text-critical",
        className,
      )}
    >
      <Arrow className="size-3" />
      {Math.abs(value).toFixed(1)}
      {suffix}
    </span>
  );
}

// --------------------------------------------------------------------------
// Status
//
// The default way a state is shown in this product: the word itself, coloured.
// No pill, no dot, no icon.
// --------------------------------------------------------------------------
const STATUS_TONE: Record<string, string> = {
  NORMAL: "text-ink-muted",
  OK: "text-ink-muted",
  CLEAR: "text-ink-muted",
  WARNING: "text-medium",
  CRITICAL: "text-critical",
  HIGH: "text-high",
  MEDIUM: "text-medium",
  LOW: "text-low",
  OPEN: "text-high",
  DIAGNOSED: "text-medium",
  ACTIONED: "text-aqua",
  RESOLVED: "text-mint",
  DISMISSED: "text-ink-faint",
  VERIFIED: "text-mint",
  NOT_VERIFIED: "text-critical",
  INCONCLUSIVE: "text-medium",
  INSUFFICIENT_DATA: "text-ink-muted",
  PLANNED: "text-ink-muted",
  ACTIVE: "text-aqua",
  MONITORING: "text-aqua",
  COMPLETED: "text-ink-soft",
  PENDING: "text-medium",
  APPLIED: "text-aqua",
  MODIFIED: "text-medium",
};

export function StatusText({
  status,
  className,
}: {
  status: string | null | undefined;
  className?: string;
}) {
  if (!status) return <span className="text-ink-faint">—</span>;
  const key = status.toUpperCase();
  return (
    <span
      className={cn(
        "text-[10.5px] font-semibold uppercase tracking-[0.09em]",
        STATUS_TONE[key] ?? "text-ink-soft",
        className,
      )}
    >
      {key.replace(/_/g, " ")}
    </span>
  );
}

// --------------------------------------------------------------------------
// Data table
// --------------------------------------------------------------------------
export function Table({
  children,
  className,
  minWidth,
}: {
  children: React.ReactNode;
  className?: string;
  minWidth?: number;
}) {
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table
        className={cn("data-table", className)}
        style={minWidth ? { minWidth } : undefined}
      >
        {children}
      </table>
    </div>
  );
}

/** Right-aligned numeric cell content, so columns of figures line up. */
export function Num({
  children,
  className,
  tone,
}: {
  children: React.ReactNode;
  className?: string;
  tone?: keyof typeof METRIC_TONE;
}) {
  return (
    <span
      className={cn("num", tone ? METRIC_TONE[tone] : "text-ink-soft", className)}
    >
      {children}
    </span>
  );
}

// --------------------------------------------------------------------------
// Proportional bar
//
// Used only where the proportion itself is the information -- a share of
// campus load, a split of a breakdown. Never as decoration behind a number.
// --------------------------------------------------------------------------
export function MiniBar({
  value,
  tone = "mint",
  className,
  width = 72,
}: {
  value: number;
  tone?: "mint" | "aqua" | "medium" | "high" | "critical" | "iris" | "muted";
  className?: string;
  width?: number | string;
}) {
  const colour = {
    mint: "bg-mint",
    aqua: "bg-aqua",
    medium: "bg-medium",
    high: "bg-high",
    critical: "bg-critical",
    iris: "bg-iris",
    muted: "bg-ink-faint",
  }[tone];

  return (
    <span
      className={cn("inline-block h-[3px] shrink-0 bg-[rgb(var(--line)/0.08)]", className)}
      style={{ width }}
      aria-hidden
    >
      <span
        className={cn("block h-full transition-[width] duration-500", colour)}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </span>
  );
}

// --------------------------------------------------------------------------
// Key/value pair
// --------------------------------------------------------------------------
export function KeyValue({
  label,
  value,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="label mb-1.5">{label}</div>
      <div className="num text-[12.5px] text-ink-soft">{value}</div>
    </div>
  );
}

/**
 * A run of metrics separated by hairlines rather than gaps between cards.
 * Columns are set by the caller so each page can tune its own density.
 */
export function MetricRow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid divide-x divide-[rgb(var(--line)/0.08)] [&>*]:px-5 [&>*:first-child]:pl-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
