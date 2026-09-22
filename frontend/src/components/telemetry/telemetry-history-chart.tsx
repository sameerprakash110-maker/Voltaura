"use client";

import * as React from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AXIS, CHART_COLOURS, ChartTooltip } from "@/components/charts/primitives";
import { Segmented } from "@/components/ui/primitives";
import type { AggregatedReadingItem, RawTelemetryItem } from "@/lib/types";

interface TelemetryHistoryChartProps {
  history: RawTelemetryItem[];
  aggregates: AggregatedReadingItem[];
  height?: number;
}

type ChartView = "hydraulics" | "quality" | "volume";

export function TelemetryHistoryChart({
  history,
  aggregates,
  height = 240,
}: TelemetryHistoryChartProps) {
  const [view, setView] = React.useState<ChartView>("hydraulics");

  // Format raw packets for time series (reversed to chronological order)
  const rawData = React.useMemo(() => {
    return [...history]
      .reverse()
      .map((item) => {
        const timeStr = item.device_timestamp || item.received_at;
        const d = new Date(timeStr);
        const label = !Number.isNaN(d.getTime())
          ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
          : `#${item.id}`;

        return {
          id: item.id,
          label,
          water_level_pct: item.water_level_pct,
          flow_rate_lpm: item.flow_rate_lpm,
          tds_ppm: item.tds_ppm,
          turbidity_ntu: item.turbidity_ntu,
        };
      });
  }, [history]);

  // Format hourly aggregates
  const aggData = React.useMemo(() => {
    return [...aggregates]
      .reverse()
      .map((item) => {
        const d = new Date(item.ts);
        const label = !Number.isNaN(d.getTime())
          ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
          : item.ts;

        return {
          id: item.id,
          label,
          water_liters: item.water_liters,
          flow_lph: item.flow_lph,
          source: item.source,
        };
      });
  }, [aggregates]);

  const gradientId = React.useId();

  return (
    <div className="space-y-3">
      {/* Chart Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-ink-muted">
          {view === "hydraulics" && "Recent Water Level & Flow Rate (High-Frequency Edge Telemetry)"}
          {view === "quality" && "Recent Water Purity (TDS) & Clarity (Turbidity)"}
          {view === "volume" && "Hourly Aggregated Consumption (Liters)"}
        </span>
        <Segmented
          size="sm"
          options={[
            { value: "hydraulics", label: "Level & Flow" },
            { value: "quality", label: "Water Quality" },
            { value: "volume", label: "Hourly Volume" },
          ]}
          value={view}
          onChange={(v) => setView(v as ChartView)}
        />
      </div>

      {/* Chart Canvas */}
      <div style={{ height }}>
        {view === "hydraulics" && (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rawData} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id={`${gradientId}-level`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART_COLOURS.water} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={CHART_COLOURS.water} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={AXIS.stroke} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" {...AXIS} tickLine={false} />
              <YAxis
                yAxisId="left"
                domain={[0, 100]}
                unit="%"
                {...AXIS}
                tickLine={false}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                unit=" L/m"
                {...AXIS}
                tickLine={false}
              />
              <Tooltip
                content={
                  <ChartTooltip
                    unit=""
                    decimals={2}
                  />
                }
              />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="water_level_pct"
                name="Water Level (%)"
                stroke={CHART_COLOURS.water}
                strokeWidth={2}
                fill={`url(#${gradientId}-level)`}
                connectNulls
              />
              <ReferenceLine
                yAxisId="left"
                y={20}
                stroke="rgb(var(--critical))"
                strokeDasharray="4 4"
                strokeWidth={1.5}
                label={{
                  value: "20% Alert Threshold",
                  position: "insideBottomLeft",
                  fill: "rgb(var(--critical))",
                  fontSize: 10,
                  fontWeight: 600,
                }}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="flow_rate_lpm"
                name="Flow Rate (L/min)"
                stroke={CHART_COLOURS.energy}
                strokeWidth={1.5}
                dot={false}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}

        {view === "quality" && (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rawData} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
              <CartesianGrid stroke={AXIS.stroke} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" {...AXIS} tickLine={false} />
              <YAxis
                yAxisId="left"
                unit=" ppm"
                {...AXIS}
                tickLine={false}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                unit=" NTU"
                {...AXIS}
                tickLine={false}
              />
              <Tooltip
                content={
                  <ChartTooltip
                    unit=""
                    decimals={1}
                  />
                }
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="tds_ppm"
                name="TDS (ppm)"
                stroke={CHART_COLOURS.adjusted}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="turbidity_ntu"
                name="Turbidity (NTU)"
                stroke={CHART_COLOURS.medium}
                strokeWidth={1.5}
                dot={false}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}

        {view === "volume" && (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={aggData} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
              <CartesianGrid stroke={AXIS.stroke} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" {...AXIS} tickLine={false} />
              <YAxis unit=" L" {...AXIS} tickLine={false} />
              <Tooltip
                content={
                  <ChartTooltip
                    unit=" L"
                    decimals={1}
                  />
                }
              />
              <Bar
                dataKey="water_liters"
                name="Hourly Consumption"
                fill={CHART_COLOURS.water}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
