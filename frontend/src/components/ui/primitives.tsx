"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { AlertTriangle, Loader2, PlugZap, RefreshCw } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

// --------------------------------------------------------------------------
// Button
// --------------------------------------------------------------------------
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-150 disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-mint text-[rgb(6_18_14)] hover:bg-mint/90 active:scale-[0.985] shadow-[0_1px_0_0_rgb(255_255_255/0.18)_inset]",
        secondary:
          "border bg-surface/70 text-ink hover:bg-elevated hover:border-[rgb(var(--line)/0.2)]",
        ghost: "text-ink-soft hover:bg-surface/80 hover:text-ink",
        outline:
          "border border-mint/35 text-mint hover:bg-mint/10 hover:border-mint/55",
        danger:
          "border border-critical/35 text-critical hover:bg-critical/10 hover:border-critical/55",
      },
      size: {
        sm: "h-8 px-3 text-xs [&_svg]:size-3.5",
        md: "h-9 px-4 [&_svg]:size-4",
        lg: "h-11 px-6 text-[0.95rem] [&_svg]:size-[18px]",
        icon: "size-9 [&_svg]:size-4",
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
// Panel
// --------------------------------------------------------------------------
export function Panel({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("panel", className)} {...props}>
      {children}
    </div>
  );
}

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
        "flex items-start justify-between gap-4 px-5 pb-4 pt-5",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? <div className="eyebrow mb-1.5">{eyebrow}</div> : null}
        <h2 className="font-display text-[0.95rem] font-semibold leading-tight text-ink">
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">{subtitle}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

// --------------------------------------------------------------------------
// Badge
// --------------------------------------------------------------------------
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-md border px-2 py-[3px] text-2xs font-medium",
  {
    variants: {
      tone: {
        neutral: "border-[rgb(var(--line)/0.14)] bg-surface/80 text-ink-soft",
        mint: "border-mint/28 bg-mint/10 text-mint",
        aqua: "border-aqua/28 bg-aqua/10 text-aqua",
        iris: "border-iris/28 bg-iris/10 text-iris",
        low: "border-low/25 bg-low/10 text-low",
        medium: "border-medium/25 bg-medium/10 text-medium",
        high: "border-high/25 bg-high/10 text-high",
        critical: "border-critical/25 bg-critical/10 text-critical",
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
export function StatusDot({
  tone,
  pulse = false,
  className,
}: {
  tone: "mint" | "medium" | "critical" | "aqua" | "muted";
  pulse?: boolean;
  className?: string;
}) {
  const colour = {
    mint: "bg-mint",
    medium: "bg-medium",
    critical: "bg-critical",
    aqua: "bg-aqua",
    muted: "bg-ink-muted",
  }[tone];

  return (
    <span className={cn("relative flex size-2", className)}>
      {pulse ? (
        <span
          className={cn(
            "absolute inline-flex size-full animate-pulse-ring rounded-full",
            colour,
          )}
        />
      ) : null}
      <span className={cn("relative inline-flex size-2 rounded-full", colour)} />
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
      className={cn(
        "shimmer rounded-md bg-[rgb(var(--line)/0.055)]",
        className,
      )}
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
    <div className={cn("space-y-3 p-5", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-2.5 w-2/3" />
          </div>
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
        "flex flex-col items-center justify-center gap-3 rounded-card border border-critical/20 bg-critical/[0.04] text-center",
        compact ? "px-4 py-6" : "px-6 py-12",
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-lg border border-critical/25 bg-critical/10 text-critical">
        <Icon className="size-5" />
      </div>
      <div className="max-w-md space-y-1.5">
        <p className="text-sm font-medium text-ink">
          {error.offline ? "Backend unavailable" : "Something went wrong"}
        </p>
        <p className="text-xs leading-relaxed text-ink-soft">{error.message}</p>
        {error.hint ? (
          <p className="mt-2 rounded-md border border-[rgb(var(--line)/0.12)] bg-surface/70 px-3 py-2 font-mono text-[11px] leading-relaxed text-ink-muted">
            {error.hint}
          </p>
        ) : null}
      </div>
      {onRetry ? (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          <RefreshCw /> Try again
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
        "flex flex-col items-center justify-center gap-3 text-center",
        compact ? "px-4 py-8" : "px-6 py-14",
      )}
    >
      {Icon ? (
        <div className="flex size-10 items-center justify-center rounded-lg border border-[rgb(var(--line)/0.12)] bg-surface/70 text-ink-muted">
          <Icon className="size-5" />
        </div>
      ) : null}
      <div className="max-w-sm space-y-1">
        <p className="text-sm font-medium text-ink">{title}</p>
        {description ? (
          <p className="text-xs leading-relaxed text-ink-muted">{description}</p>
        ) : null}
      </div>
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
        "inline-flex items-center gap-0.5 rounded-lg border border-[rgb(var(--line)/0.12)] bg-surface/60 p-0.5",
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
              "rounded-[6px] font-medium transition-all duration-150",
              size === "sm" ? "px-2.5 py-1 text-2xs" : "px-3 py-1.5 text-xs",
              active
                ? "bg-elevated text-ink shadow-[0_1px_0_0_rgb(var(--line)/0.12)]"
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
  tone?: "mint" | "aqua" | "medium";
  className?: string;
}) {
  const colour = { mint: "bg-mint", aqua: "bg-aqua", medium: "bg-medium" }[tone];
  return (
    <div
      className={cn(
        "h-1.5 w-full overflow-hidden rounded-full bg-[rgb(var(--line)/0.08)]",
        className,
      )}
    >
      <div
        className={cn("h-full rounded-full transition-all duration-700", colour)}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

// --------------------------------------------------------------------------
// Tooltip-ish info marker
// --------------------------------------------------------------------------
export function InfoHint({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <span className="flex size-3.5 cursor-help items-center justify-center rounded-full border border-[rgb(var(--line)/0.2)] text-[9px] font-semibold text-ink-muted">
        i
      </span>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-60 -translate-x-1/2 rounded-lg border border-[rgb(var(--line)/0.14)] bg-elevated px-3 py-2 text-[11px] leading-relaxed text-ink-soft opacity-0 shadow-lift transition-opacity duration-150 group-hover:opacity-100">
        {text}
      </span>
    </span>
  );
}
