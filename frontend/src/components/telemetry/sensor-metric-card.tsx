"use client";

import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Droplets,
  Gauge,
  HelpCircle,
  Radio,
  Sparkles,
  Waves,
} from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export interface SensorMetricCardProps {
  label: string;
  metricKey: "water_level" | "flow_rate" | "tds" | "turbidity";
  primaryValue: number | null | undefined;
  primaryUnit: string;
  secondaryValue?: number | string | null | undefined;
  secondaryUnit?: string;
  secondaryLabel?: string;
  hasError?: boolean;
  errorMessage?: string;
  progressPct?: number | null;
  className?: string;
}

/**
 * SensorMetricCard renders an edge sensor metric.
 *
 * CRITICAL RULE (docs/TELEMETRY_CONTRACT.md):
 *   null / undefined  = UNAVAILABLE (never convert to zero)
 *   0 or 0.0          = VALID MEASURED ZERO (never convert to unavailable)
 */
export function SensorMetricCard({
  label,
  metricKey,
  primaryValue,
  primaryUnit,
  secondaryValue,
  secondaryUnit,
  secondaryLabel,
  hasError = false,
  errorMessage,
  progressPct,
  className,
}: SensorMetricCardProps) {
  const isPrimaryNull = primaryValue === null || primaryValue === undefined;
  const isPrimaryZero = primaryValue === 0;

  // Determine icon and theme tone
  const config = React.useMemo(() => {
    switch (metricKey) {
      case "water_level":
        return {
          icon: Waves,
          color: "text-aqua",
          borderHover: "hover:border-aqua/30",
          progressColor: "bg-aqua",
        };
      case "flow_rate":
        return {
          icon: Gauge,
          color: "text-mint",
          borderHover: "hover:border-mint/30",
          progressColor: "bg-mint",
        };
      case "tds":
        return {
          icon: Sparkles,
          color: "text-iris",
          borderHover: "hover:border-iris/30",
          progressColor: "bg-iris",
        };
      case "turbidity":
        return {
          icon: Droplets,
          color: "text-high",
          borderHover: "hover:border-high/30",
          progressColor: "bg-high",
        };
    }
  }, [metricKey]);

  const Icon = config.icon;

  // Formatting preserving exact precision
  const formattedPrimary = React.useMemo(() => {
    if (isPrimaryNull) return null;
    if (metricKey === "water_level") return primaryValue.toFixed(1);
    if (metricKey === "flow_rate") return primaryValue.toFixed(2);
    if (metricKey === "tds") return Math.round(primaryValue).toString();
    if (metricKey === "turbidity") return primaryValue.toFixed(2);
    return primaryValue.toString();
  }, [isPrimaryNull, metricKey, primaryValue]);

  return (
    <div
      className={cn(
        "relative flex flex-col justify-between rounded-xl border border-[rgb(var(--line)/0.12)] bg-surface/80 p-4 transition-all duration-150 backdrop-blur-sm",
        config.borderHover,
        hasError && "border-critical/35 bg-critical/5",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow text-ink-muted">{label}</span>
        <div className="flex items-center gap-1.5">
          {hasError ? (
            <Badge tone="critical" className="gap-1 px-1.5 py-0.5 text-[10px]">
              <AlertCircle className="size-3" /> Error
            </Badge>
          ) : isPrimaryNull ? (
            <Badge tone="neutral" className="gap-1 px-1.5 py-0.5 text-[10px]">
              <HelpCircle className="size-3" /> Unavailable
            </Badge>
          ) : (
            <Badge tone="neutral" className="gap-1 px-1.5 py-0.5 text-[10px]">
              <CheckCircle2 className="size-3 text-mint" /> Active
            </Badge>
          )}
          <Icon className={cn("size-4 shrink-0", config.color)} />
        </div>
      </div>

      {/* Primary Value Display */}
      <div className="mt-3">
        {isPrimaryNull ? (
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-medium text-ink-muted">Unavailable</span>
          </div>
        ) : (
          <div className="flex items-baseline gap-1.5">
            <span
              className={cn(
                "num text-2xl font-bold tracking-tight text-ink",
                isPrimaryZero && "text-ink-soft",
              )}
            >
              {formattedPrimary}
            </span>
            <span className="text-xs font-normal text-ink-muted">{primaryUnit}</span>
          </div>
        )}

        {/* Optional Progress Bar (e.g. Tank Water Level) */}
        {progressPct !== undefined && progressPct !== null && !isPrimaryNull ? (
          <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-[rgb(var(--line)/0.1)]">
            <div
              className={cn("h-full rounded-full transition-all duration-300", config.progressColor)}
              style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }}
            />
          </div>
        ) : null}
      </div>

      {/* Secondary Value / Context */}
      <div className="mt-3 border-t border-[rgb(var(--line)/0.08)] pt-2 text-[11px] text-ink-muted">
        {hasError && errorMessage ? (
          <span className="text-critical">{errorMessage}</span>
        ) : secondaryValue !== undefined && secondaryValue !== null ? (
          <div className="flex items-center justify-between">
            <span>{secondaryLabel || "Secondary"}:</span>
            <span className="num font-medium text-ink-soft">
              {typeof secondaryValue === "number"
                ? secondaryValue.toFixed(1)
                : secondaryValue}{" "}
              {secondaryUnit}
            </span>
          </div>
        ) : isPrimaryZero && metricKey === "flow_rate" ? (
          <span className="text-mint">No fluid motion (valve closed / idle)</span>
        ) : isPrimaryNull ? (
          <span>Sensor uninstalled or read timeout</span>
        ) : (
          <span className="text-ink-muted">Normal operational range</span>
        )}
      </div>
    </div>
  );
}
