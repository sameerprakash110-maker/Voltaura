/**
 * Formatting helpers.
 *
 * One rule runs through this file: a number on screen should carry only the
 * precision it actually has. Metered totals get thousands separators and no
 * decimals; percentages get one; statistical values keep their significance.
 */

import type { Severity, VerificationStatus } from "./types";

const INT = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const ONE_DP = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const TWO_DP = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function num(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  if (decimals === 0) return INT.format(value);
  if (decimals === 1) return ONE_DP.format(value);
  if (decimals === 2) return TWO_DP.format(value);
  return value.toFixed(decimals);
}

/** Large magnitudes collapse to k / M so KPI tiles never wrap. */
export function compact(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(decimals)}M`;
  if (abs >= 10_000) return `${(value / 1000).toFixed(decimals)}k`;
  return num(value, abs < 100 && !Number.isInteger(value) ? 1 : 0);
}

export function pct(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return `${value.toFixed(decimals)}%`;
}

export function signedPct(
  value: number | null | undefined,
  decimals = 1,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}%`;
}

export function money(
  value: number | null | undefined,
  symbol = "₹",
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return `${symbol}${compact(value, 1)}`;
}

export function moneyExact(
  value: number | null | undefined,
  symbol = "₹",
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return `${symbol}${INT.format(value)}`;
}

/** p-values need scientific notation once they get small. */
export function pValue(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  if (value < 0.0001) return value.toExponential(1);
  if (value < 0.01) return value.toFixed(4);
  return value.toFixed(3);
}

/**
 * Backend timestamps are stored as naive UTC datetimes for SQLite portability.
 * Treat only timezone-less ISO timestamps as UTC; timezone-aware values are
 * left untouched so they are never converted twice.
 */
function parseApiDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  const timezoneSuffix = /(?:Z|[+-]\d{2}:?\d{2})$/i;
  const isoDateTime = /^\d{4}-\d{2}-\d{2}T/;
  return new Date(
    isoDateTime.test(value) && !timezoneSuffix.test(value) ? `${value}Z` : value,
  );
}

export function date(value: string | Date | null | undefined): string {
  if (!value) return "--";
  const d = parseApiDate(value);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function dateShort(value: string | Date | null | undefined): string {
  if (!value) return "--";
  const d = parseApiDate(value);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export function dateTime(value: string | Date | null | undefined): string {
  if (!value) return "--";
  const d = parseApiDate(value);
  if (Number.isNaN(d.getTime())) return "--";
  return `${d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  })} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

export function duration(hours: number): string {
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = Math.floor(hours / 24);
  const rest = Math.round(hours % 24);
  return rest ? `${days}d ${rest}h` : `${days}d`;
}

export function relativeDays(value: string | null | undefined): string {
  if (!value) return "--";
  const then = parseApiDate(value).getTime();
  if (Number.isNaN(then)) return "--";
  const days = Math.round((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

/** Hour label for profile charts: 0 -> "00", 13 -> "13". */
export function hourLabel(hour: number): string {
  return String(hour).padStart(2, "0");
}

export function unitLabel(unit: string): string {
  return unit === "L" ? "L" : unit;
}

// --------------------------------------------------------------------------
// Semantic token lookups
// --------------------------------------------------------------------------
export const SEVERITY_TOKENS: Record<
  Severity,
  { text: string; bg: string; border: string; dot: string; label: string }
> = {
  LOW: {
    text: "text-low",
    bg: "bg-low/10",
    border: "border-low/25",
    dot: "bg-low",
    label: "Low",
  },
  MEDIUM: {
    text: "text-medium",
    bg: "bg-medium/10",
    border: "border-medium/25",
    dot: "bg-medium",
    label: "Medium",
  },
  HIGH: {
    text: "text-high",
    bg: "bg-high/10",
    border: "border-high/25",
    dot: "bg-high",
    label: "High",
  },
  CRITICAL: {
    text: "text-critical",
    bg: "bg-critical/10",
    border: "border-critical/25",
    dot: "bg-critical",
    label: "Critical",
  },
};

export const VERIFICATION_TOKENS: Record<
  VerificationStatus,
  { text: string; bg: string; border: string; label: string }
> = {
  VERIFIED: {
    text: "text-mint",
    bg: "bg-mint/10",
    border: "border-mint/30",
    label: "Verified",
  },
  NOT_VERIFIED: {
    text: "text-critical",
    bg: "bg-critical/10",
    border: "border-critical/25",
    label: "Not verified",
  },
  INCONCLUSIVE: {
    text: "text-medium",
    bg: "bg-medium/10",
    border: "border-medium/25",
    label: "Inconclusive",
  },
  INSUFFICIENT_DATA: {
    text: "text-ink-soft",
    bg: "bg-ink-soft/10",
    border: "border-ink-soft/20",
    label: "Collecting data",
  },
};

export const RESOURCE_TOKENS = {
  ENERGY: {
    text: "text-mint",
    bg: "bg-mint/10",
    border: "border-mint/25",
    stroke: "rgb(var(--mint))",
    label: "Energy",
    unit: "kWh",
  },
  WATER: {
    text: "text-aqua",
    bg: "bg-aqua/10",
    border: "border-aqua/25",
    stroke: "rgb(var(--aqua))",
    label: "Water",
    unit: "L",
  },
} as const;

export const CAUSE_LABELS: Record<string, string> = {
  HVAC_SCHEDULING_INEFFICIENCY: "HVAC scheduling",
  LIGHTING_CONTROL_INEFFICIENCY: "Lighting control",
  PROBABLE_WATER_LEAKAGE: "Water leakage",
  PUMP_OPERATION_INEFFICIENCY: "Pump operation",
  BASE_LOAD_EQUIPMENT_FAULT: "Base-load fault",
  ELEVATED_COOLING_DEMAND: "Cooling demand",
  OCCUPANCY_DRIVEN_DEMAND: "Occupancy driven",
  UNEXPLAINED_DEVIATION: "Unclassified",
};
