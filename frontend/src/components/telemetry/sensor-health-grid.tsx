"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Droplets,
  Gauge,
  Sparkles,
  Waves,
  Wifi,
  WifiOff,
  XCircle,
} from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/primitives";
import { sensorErrorDescription } from "@/lib/format";
import type { RawTelemetryItem } from "@/lib/types";
import { cn } from "@/lib/utils";

interface SensorHealthGridProps {
  telemetry: RawTelemetryItem | null;
  className?: string;
}

export function SensorHealthGrid({ telemetry, className }: SensorHealthGridProps) {
  if (!telemetry) return null;

  const errors = telemetry.sensor_errors || [];

  // Determine individual sensor health from errors & values
  const hasUltrasonicError = errors.some((e) => e.startsWith("E_ULTRASONIC"));
  const ultrasonicOk = !hasUltrasonicError && telemetry.water_level_pct !== null;

  const hasFlowError = errors.some((e) => e.startsWith("E_FLOW"));
  const flowOk = !hasFlowError && telemetry.flow_rate_lpm !== null;

  const hasTdsError = errors.some((e) => e.startsWith("E_TDS"));
  const tdsOk = !hasTdsError && telemetry.tds_ppm !== null;

  const hasTurbidityError = errors.some((e) => e.startsWith("E_TURBIDITY"));
  const turbidityOk = !hasTurbidityError && telemetry.turbidity_ntu !== null;

  const hasRssi = telemetry.rssi_dbm !== null && telemetry.rssi_dbm !== undefined;
  const isOnline = true; // Telemetry arrived from backend

  return (
    <div className={cn("space-y-3", className)}>
      {/* Sensor Error Warnings */}
      {errors.length > 0 ? (
        <div className="rounded-lg border border-critical/30 bg-critical/10 p-3 text-xs">
          <div className="flex items-center gap-2 font-semibold text-critical">
            <AlertTriangle className="size-4 shrink-0" />
            <span>Active Sensor Diagnostics Alert ({errors.length})</span>
          </div>
          <ul className="mt-2 space-y-1 pl-6 list-disc text-ink-soft">
            {errors.map((err, idx) => (
              <li key={idx}>
                <span className="font-mono text-[11px] font-semibold text-critical mr-1">
                  {err}:
                </span>
                <span>{sensorErrorDescription(err)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Compact Sensor Status Grid */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {/* Node Connection */}
        <StatusItem
          label="ESP32 Node"
          icon={Cpu}
          status={isOnline ? "OK" : "Offline"}
          isGood={isOnline}
          subtext={
            hasRssi ? `${telemetry.rssi_dbm} dBm` : telemetry.source.toUpperCase()
          }
        />

        {/* HC-SR04 Level */}
        <StatusItem
          label="HC-SR04"
          icon={Waves}
          status={ultrasonicOk ? "OK" : hasUltrasonicError ? "Error" : "Timeout"}
          isGood={ultrasonicOk}
          subtext="Ultrasonic Level"
        />

        {/* YF-S201 Flow */}
        <StatusItem
          label="YF-S201"
          icon={Gauge}
          status={flowOk ? "OK" : hasFlowError ? "Error" : "Unavailable"}
          isGood={flowOk}
          subtext="Turbine Flow"
        />

        {/* TDS Probe */}
        <StatusItem
          label="TDS Probe"
          icon={Sparkles}
          status={tdsOk ? "OK" : hasTdsError ? "Error" : "Unavailable"}
          isGood={tdsOk}
          subtext="Dissolved Solids"
        />

        {/* Turbidity Sensor */}
        <StatusItem
          label="Turbidity"
          icon={Droplets}
          status={turbidityOk ? "OK" : hasTurbidityError ? "Error" : "Unavailable"}
          isGood={turbidityOk}
          subtext="Optical Clarity"
        />
      </div>
    </div>
  );
}

function StatusItem({
  label,
  icon: Icon,
  status,
  isGood,
  subtext,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  status: string;
  isGood: boolean;
  subtext: string;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-[rgb(var(--line)/0.1)] bg-surface/60 p-2.5">
      <div
        className={cn(
          "flex size-7 items-center justify-center rounded-md shrink-0",
          isGood
            ? "bg-mint/10 text-mint"
            : "bg-critical/10 text-critical",
        )}
      >
        <Icon className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="flex items-center justify-between gap-1">
          <span className="truncate text-[11px] font-medium text-ink">
            {label}
          </span>
          <span
            className={cn(
              "num text-[10px] font-semibold",
              isGood ? "text-mint" : "text-critical",
            )}
          >
            {status}
          </span>
        </div>
        <div className="truncate text-[10px] text-ink-muted">{subtext}</div>
      </div>
    </div>
  );
}
