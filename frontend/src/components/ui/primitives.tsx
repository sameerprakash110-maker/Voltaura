"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { AlertTriangle, Loader2, PlugZap, RefreshCw } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Controls and states.
 *
 * Everything here is deliberately quiet. A control should be legible and
 * reachable without competing with the data it sits next to, which in practice
 * means hairlines instead of fills, 4-6px corners instead of pills, and a
 * single accent colour used only where it carries meaning.
 */

// --------------------------------------------------------------------------
// Button
// --------------------------------------------------------------------------
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-mint text-[rgb(6_16_13)] hover:bg-mint/88",
        secondary:
          "border border-[rgb(var(--line)/0.14)] bg-surface text-ink hover:border-[rgb(var(--line)/0.26)] hover:bg-elevated",
        ghost: "text-ink-muted hover:bg-[rgb(var(--line)/0.06)] hover:text-ink",
        outline:
          "border border-mint/35 text-mint hover:border-mint/60 hover:bg-mint/[0.08]",
        danger:
          "border border-critical/30 text-critical hover:border-critical/55 hover:bg-critical/[0.08]",
      },
      size: {
        sm: "h-7 px-2.5 text-[11.5px] [&_svg]:size-3",
        md: "h-8 px-3 text-[12.5px] [&_svg]:size-3.5",
        lg: "h-10 px-5 text-[13.5px] [&_svg]:size-4",
        icon: "size-7 [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild, loading, children, disabled, ...props },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="animate-spin" />
            {children}
          </>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";

// --------------------------------------------------------------------------
// Surface
//
// Used only where content genuinely needs containment: a chart plot, a table
// body, an inspector floating over the 3D scene. Never for a single metric.
// --------------------------------------------------------------------------
export function Surface({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("surface", className)} {...props}>
      {children}
    </div>
  );
}

/** Retained name so older call sites keep the same geometry. */
export const Panel = Surface;

export function PanelHeader({
  title,
  subtitle,
  eyebrow,
  action,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  eyebrow?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 border-b border-[rgb(var(--line)/0.07)] px-4 py-3.5",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? <div className="label mb-1.5">{eyebrow}</div> : null}
        <h2 className="text-[13px] font-semibold leading-tight tracking-[-0.01em] text-ink">
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-1 max-w-prose text-[11.5px] leading-relaxed text-ink-muted">
            {subtitle}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

// --------------------------------------------------------------------------
// Badge
//
// Reserved for a state that has no natural column of its own. Where a state
// does have a column, use StatusText instead: it carries the same information
// with no chrome at all.
// --------------------------------------------------------------------------
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-[2px] text-[10px] font-medium leading-[15px] tracking-[0.01em]",
  {
    variants: {
      tone: {
        neutral: "border-[rgb(var(--line)/0.14)] text-ink-muted",
        mint: "border-mint/30 bg-mint/[0.07] text-mint",
        aqua: "border-aqua/30 bg-aqua/[0.07] text-aqua",
        iris: "border-iris/30 bg-iris/[0.07] text-iris",
        low: "border-low/28 text-low",
        medium: "border-medium/32 bg-medium/[0.07] text-medium",
        high: "border-high/32 bg-high/[0.07] text-high",
        critical: "border-critical/32 bg-critical/[0.07] text-critical",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
  pulse?: boolean;
}

export function Badge({
  className,
  tone,
  dot,
  pulse,
  children,
  ...props
}: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot ? (
        <span className="relative flex size-1.5">
          {pulse ? (
            <span className="absolute inline-flex size-full animate-pulse-ring rounded-full bg-current" />
          ) : null}
          <span className="relative inline-flex size-1.5 rounded-full bg-current" />
        </span>
      ) : null}
      {children}
    </span>
  );
}

// --------------------------------------------------------------------------
// Status dot
// --------------------------------------------------------------------------
const DOT_COLOUR = {
  mint: "bg-mint",
  medium: "bg-medium",
  high: "bg-high",
  critical: "bg-critical",
  aqua: "bg-aqua",
  iris: "bg-iris",
  muted: "bg-ink-muted",
} as const;

export type DotTone = keyof typeof DOT_COLOUR;

export function StatusDot({
  tone,
  pulse = false,
  className,
}: {
  tone: DotTone;
  pulse?: boolean;
  className?: string;
}) {
  const colour = DOT_COLOUR[tone];
  return (
    <span className={cn("relative flex size-1.5", className)}>
      {pulse ? (
        <span
          className={cn(
            "absolute inline-flex size-full animate-pulse-ring rounded-full",
            colour,
          )}
        />
      ) : null}
      <span className={cn("relative inline-flex size-1.5 rounded-full", colour)} />
    </span>
  );
}

// --------------------------------------------------------------------------
// Skeletons and states
// --------------------------------------------------------------------------
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("shimmer rounded-sm bg-[rgb(var(--line)/0.05)]", className)}
      {...props}
    />
  );
}

export function LoadingPanel({
  rows = 3,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3 py-1", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

/**
 * Error state.
 *
 * Distinguishes "the backend is not running" from every other failure,
 * because those need different actions from the person reading the screen.
 */
export function ErrorState({
  error,
  onRetry,
  compact = false,
}: {
  error: { message: string; offline?: boolean; hint?: string; status?: number };
  onRetry?: () => void;
  compact?: boolean;
}) {
  const Icon = error.offline ? PlugZap : AlertTriangle;
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-md border border-critical/22 bg-critical/[0.035]",
        compact ? "px-4 py-3.5" : "px-5 py-5",
      )}
    >
      <Icon className="mt-px size-4 shrink-0 text-critical" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-[12.5px] font-medium text-ink">
          {error.offline ? "Backend unavailable" : "Something went wrong"}
        </p>
        <p className="text-[11.5px] leading-relaxed text-ink-soft">{error.message}</p>
        {error.hint ? (
          <p className="mt-2 overflow-x-auto rounded border border-[rgb(var(--line)/0.1)] bg-canvas px-2.5 py-1.5 font-mono text-[10.5px] leading-relaxed text-ink-muted">
            {error.hint}
          </p>
        ) : null}
      </div>
      {onRetry ? (
        <Button size="sm" variant="secondary" onClick={onRetry} className="shrink-0">
          <RefreshCw /> Retry
        </Button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-2 border-l-2 border-[rgb(var(--line)/0.1)] pl-4",
        compact ? "py-3" : "py-6",
      )}
    >
      <div className="flex items-center gap-2">
        {Icon ? <Icon className="size-3.5 text-ink-faint" /> : null}
        <p className="text-[12.5px] font-medium text-ink-soft">{title}</p>
      </div>
      {description ? (
        <p className="max-w-md text-[11.5px] leading-relaxed text-ink-muted">
          {description}
        </p>
      ) : null}
      {action}
    </div>
  );
}

// --------------------------------------------------------------------------
// Segmented control
// --------------------------------------------------------------------------
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  size = "md",
  className,
}: {
  options: { value: T; label: React.ReactNode; title?: string }[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex items-center rounded border border-[rgb(var(--line)/0.12)] bg-canvas p-px",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            role="tab"
            aria-selected={active}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-sm font-medium transition-colors duration-150",
              size === "sm"
                ? "px-2 py-[3px] text-[11px]"
                : "px-2.5 py-1 text-[11.5px]",
              active
                ? "bg-[rgb(var(--line)/0.1)] text-ink"
                : "text-ink-muted hover:text-ink-soft",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// --------------------------------------------------------------------------
// Progress
// --------------------------------------------------------------------------
export function Progress({
  value,
  tone = "mint",
  className,
}: {
  value: number;
  tone?: "mint" | "aqua" | "medium" | "iris";
  className?: string;
}) {
  const colour = {
    mint: "bg-mint",
    aqua: "bg-aqua",
    medium: "bg-medium",
    iris: "bg-iris",
  }[tone];
  return (
    <div
      className={cn(
        "h-[3px] w-full overflow-hidden rounded-sm bg-[rgb(var(--line)/0.08)]",
        className,
      )}
    >
      <div
        className={cn("h-full transition-[width] duration-500", colour)}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}
