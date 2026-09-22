"use client";

import {
  Activity,
  Building2,
  Clock,
  Cpu,
  Layers,
  Radio,
  RefreshCw,
  Signal,
  SignalHigh,
  SignalLow,
  SignalMedium,
  Wifi,
} from "lucide-react";
import * as React from "react";

import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Panel,
  PanelHeader,
  Skeleton,
} from "@/components/ui/primitives";
import { dateTime, formatUptime, num, timeAgo } from "@/lib/format";
import type { Building, RawTelemetryItem } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { useLiveTelemetry } from "@/lib/use-live-telemetry";
import { cn } from "@/lib/utils";

import { SensorHealthGrid } from "./sensor-health-grid";
import { SensorMetricCard } from "./sensor-metric-card";
import { TelemetryHistoryChart } from "./telemetry-history-chart";

export interface LiveTelemetryPanelProps {
  initialBuildingId?: number;
  className?: string;
  showBuildingSelector?: boolean;
}

export function LiveTelemetryPanel({
  initialBuildingId,
  className,
  showBuildingSelector = true,
}: LiveTelemetryPanelProps) {
  // Load campus buildings list for building selection
  const buildingsApi = useApi<Building[]>("/api/buildings?days=7");
  const buildings = buildingsApi.data || [];

  // Active building ID state (defaults to passed prop, or building 4 if available, or first building)
  const [selectedBuildingId, setSelectedBuildingId] = React.useState<number>(() => {
    if (initialBuildingId) return initialBuildingId;
    return 4; // Default to Central Library (LIB) where node is registered
  });

  // Sync if initialBuildingId changes
  React.useEffect(() => {
    if (initialBuildingId && initialBuildingId !== selectedBuildingId) {
      setSelectedBuildingId(initialBuildingId);
    }
  }, [initialBuildingId, selectedBuildingId]);

  // Connect live polling hook (10s cadence)
  const {
    latest,
    history,
    aggregates,
    loading,
    refreshing,
    error,
    isWaiting,
    lastPolledAt,
    refetch,
  } = useLiveTelemetry(selectedBuildingId, 10_000);

  // Local ticker to update "X seconds ago" smoothly every second
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const activeBuilding = React.useMemo(() => {
    return buildings.find((b) => b.id === selectedBuildingId) || null;
  }, [buildings, selectedBuildingId]);

  // Determine timestamp to display (prefer device timestamp if valid, else received_at)
  const activeTimestamp = latest?.device_timestamp || latest?.received_at || null;
  const isEsp32Source = latest?.source?.toLowerCase() === "esp32";

  // Wi-Fi signal indicator icon
  const RssiIcon = React.useMemo(() => {
    const rssi = latest?.rssi_dbm;
    if (rssi === null || rssi === undefined) return Wifi;
    if (rssi >= -65) return SignalHigh;
    if (rssi >= -75) return SignalMedium;
    return SignalLow;
  }, [latest?.rssi_dbm]);

  return (
    <Panel className={cn("overflow-hidden border-aqua/20 bg-canvas/90", className)}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[rgb(var(--line)/0.09)] px-5 py-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="eyebrow text-aqua">Physical Edge Telemetry</span>
            {latest ? (
              isEsp32Source ? (
                <Badge tone="aqua" dot pulse>
                  Live ESP32 Node
                </Badge>
              ) : (
                <Badge tone="neutral" dot>
                  Simulator Feed
                </Badge>
              )
            ) : isWaiting ? (
              <Badge tone="neutral">Waiting for Edge Node</Badge>
            ) : null}
          </div>
          <h3 className="font-display text-base font-semibold text-ink">
            {activeBuilding ? `${activeBuilding.name} (${activeBuilding.code})` : "Water Node Monitoring"}
          </h3>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Building Selection Dropdown */}
          {showBuildingSelector && buildings.length > 0 ? (
            <div className="flex items-center gap-1.5 rounded-lg border border-[rgb(var(--line)/0.12)] bg-surface/80 px-2.5 py-1 text-xs">
              <Building2 className="size-3.5 text-ink-muted" />
              <select
                value={selectedBuildingId}
                onChange={(e) => setSelectedBuildingId(Number(e.target.value))}
                className="bg-transparent font-medium text-ink outline-none cursor-pointer"
              >
                {buildings.map((b) => (
                  <option key={b.id} value={b.id} className="bg-canvas text-ink">
                    {b.name} ({b.code})
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {/* Refresh Button */}
          <Button
            variant="secondary"
            size="sm"
            loading={refreshing}
            onClick={() => refetch()}
            className="h-7 px-2.5 text-xs"
          >
            <RefreshCw className={cn("size-3", refreshing && "animate-spin")} />
            <span>Refresh</span>
          </Button>
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* Loading State */}
        {loading && !latest ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-[rgb(var(--line)/0.1)] bg-surface/60 p-4"
                >
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="mt-3 h-7 w-28" />
                  <Skeleton className="mt-3 h-2 w-full" />
                </div>
              ))}
            </div>
            <Skeleton className="h-44 w-full rounded-xl" />
          </div>
        ) : error && !latest ? (
          /* Error State with Retry */
          <div className="py-4">
            <ErrorState
              error={error}
              onRetry={() => refetch()}
              compact
            />
          </div>
        ) : !latest || isWaiting ? (
          /* Empty / Waiting for Node State */
          <EmptyState
            icon={Radio}
            title="Waiting for ESP32 telemetry"
            description={
              activeBuilding
                ? `No live telemetry packets received yet for ${activeBuilding.name}. When the physical ESP32 node powers on and transmits to /api/telemetry, real-time sensor metrics will appear here automatically.`
                : "No edge packets found for this facility."
            }
          />
        ) : (
          /* Live Sensor Data Presentation */
          <>
            {/* Metadata and Diagnostics Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[rgb(var(--line)/0.09)] bg-surface/50 px-3.5 py-2 text-xs text-ink-muted">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <Cpu className="size-3.5 text-mint" />
                  <span>Device:</span>
                  <span className="font-mono font-medium text-ink">
                    {latest.device_id}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <RssiIcon className="size-3.5 text-aqua" />
                  <span>Wi-Fi Signal:</span>
                  <span className="num font-medium text-ink">
                    {latest.rssi_dbm !== null ? `${latest.rssi_dbm} dBm` : "Offline"}
                  </span>
                </div>

                {latest.uptime_seconds !== null ? (
                  <div className="flex items-center gap-1.5">
                    <Clock className="size-3.5 text-ink-muted" />
                    <span>Uptime:</span>
                    <span className="num font-medium text-ink">
                      {formatUptime(latest.uptime_seconds)}
                    </span>
                  </div>
                ) : null}

                {latest.free_heap_bytes !== null ? (
                  <div className="flex items-center gap-1.5">
                    <Layers className="size-3.5 text-ink-muted" />
                    <span>Heap:</span>
                    <span className="num font-medium text-ink">
                      {Math.round(latest.free_heap_bytes / 1024)} kB
                    </span>
                  </div>
                ) : null}
              </div>

              {/* Ticking Last Updated Indicator */}
              <div className="flex items-center gap-1.5 text-ink-soft">
                <Activity className="size-3.5 text-aqua animate-pulse" />
                <span>Last update:</span>
                <span className="font-medium text-ink">
                  {timeAgo(activeTimestamp)}
                </span>
                {activeTimestamp ? (
                  <span className="text-[10px] text-ink-muted">
                    ({dateTime(activeTimestamp)})
                  </span>
                ) : null}
              </div>
            </div>

            {/* 4 Sensor Metric Cards (Strict null vs zero) */}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {/* 1. Water Level (HC-SR04) */}
              <SensorMetricCard
                label="Tank Water Level"
                metricKey="water_level"
                primaryValue={latest.water_level_pct}
                primaryUnit="%"
                secondaryValue={latest.water_level_cm}
                secondaryUnit="cm"
                secondaryLabel="Water Depth"
                progressPct={latest.water_level_pct}
                hasError={latest.sensor_errors.some((e) => e.startsWith("E_ULTRASONIC"))}
              />

              {/* 2. Flow Rate (YF-S201) */}
              <SensorMetricCard
                label="Water Flow Rate"
                metricKey="flow_rate"
                primaryValue={latest.flow_rate_lpm}
                primaryUnit="L/min"
                secondaryValue={latest.volume_liters}
                secondaryUnit="L"
                secondaryLabel="Interval Volume"
                hasError={latest.sensor_errors.some((e) => e.startsWith("E_FLOW"))}
              />

              {/* 3. Water Purity (TDS Probe) */}
              <SensorMetricCard
                label="Dissolved Solids (TDS)"
                metricKey="tds"
                primaryValue={latest.tds_ppm}
                primaryUnit="ppm"
                secondaryValue={latest.tds_voltage_mv}
                secondaryUnit="mV"
                secondaryLabel="ADC Voltage"
                hasError={latest.sensor_errors.some((e) => e.startsWith("E_TDS"))}
              />

              {/* 4. Water Clarity (Turbidity Sensor) */}
              <SensorMetricCard
                label="Water Turbidity"
                metricKey="turbidity"
                primaryValue={latest.turbidity_ntu}
                primaryUnit="NTU"
                secondaryValue={latest.turbidity_voltage_mv}
                secondaryUnit="mV"
                secondaryLabel="ADC Voltage"
                hasError={latest.sensor_errors.some((e) => e.startsWith("E_TURBIDITY"))}
              />
            </div>

            {/* Sensor Status & Diagnostic Warnings */}
            <SensorHealthGrid telemetry={latest} />

            {/* Historical Telemetry Visualizations */}
            <div className="border-t border-[rgb(var(--line)/0.09)] pt-4">
              <TelemetryHistoryChart
                history={history}
                aggregates={aggregates}
                height={220}
              />
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}
