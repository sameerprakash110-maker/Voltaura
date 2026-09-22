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

/** Formats recent timestamp into seconds / minutes relative time. */
export function timeAgo(value: string | Date | null | undefined): string {
  if (!value) return "Never";
  const d = parseApiDate(value);
  const diffMs = Date.now() - d.getTime();
  if (Number.isNaN(diffMs)) return "--";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec} seconds ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return min === 1 ? "1 min ago" : `${min} mins ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr === 1 ? "1 hour ago" : `${hr} hours ago`;
  const days = Math.floor(hr / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/** Formats uptime seconds into concise human-readable form (e.g. "23h 40m"). */
export function formatUptime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return "--";
  if (seconds < 60) return `${seconds}s`;
  const min = Math.floor(seconds / 60);
  if (min < 60) return `${min}m ${seconds % 60}s`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  if (hr < 24) return `${hr}h ${remMin}m`;
  const days = Math.floor(hr / 24);
  const remHr = hr % 24;
  return `${days}d ${remHr}h`;
}

/** Translates hardware error codes to readable explanations. */
export function sensorErrorDescription(code: string): string {
  switch (code) {
    case "E_ULTRASONIC_TIMEOUT":
      return "HC-SR04 ultrasonic echo timed out (no reflection detected or out of range).";
    case "E_ULTRASONIC_BELOW_MIN":
      return "HC-SR04 measured distance is below 2.0 cm acoustic minimum.";
    case "E_ULTRASONIC_BLIND_ZONE":
      return "Water surface entered sensor transducer ringing deadband (<10.0 cm).";
    case "E_FLOW_OVER_RANGE":
      return "YF-S201 flow rate exceeded maximum rated 30.0 L/min.";
    case "E_FLOW_ANOMALY":
      return "YF-S201 pulse train exceeded 60.0 L/min (electrical contact chatter or floating input).";
    case "E_TDS_DISCONNECTED":
      return "TDS probe voltage <20 mV (probe in dry air or disconnected).";
    case "E_TDS_OVER_VOLTAGE":
      return "TDS probe voltage >3200 mV (probe short-circuit or ADC saturation).";
    case "E_TURBIDITY_DISCONNECTED":
      return "Turbidity sensor voltage <50 mV (IR LED unpowered or disconnected).";
    case "E_TURBIDITY_OVER_VOLTAGE":
      return "Turbidity sensor voltage >3250 mV (missing voltage divider or ADC saturation).";
    default:
      return `Hardware alert: ${code}`;
  }
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
