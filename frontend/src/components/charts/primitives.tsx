"use client";

import * as React from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { compact, num } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Chart primitives.
 *
 * Two conventions hold everywhere in the product, and they are the reason the
 * charts read at a glance:
 *
 *   solid fill  = metered reality
 *   dashed line = what the model expected
 *
 * The gap between them is the waste. Anomalous intervals are shaded rather
 * than recoloured, so the actual series stays continuous and comparable.
 */

export const CHART_COLOURS = {
  energy: "rgb(var(--mint))",
  water: "rgb(var(--aqua))",
  expected: "rgb(var(--ink-soft))",
  baseline: "rgb(var(--ink-soft))",
  post: "rgb(var(--mint))",
  adjusted: "rgb(var(--iris))",
  critical: "rgb(var(--critical))",
  medium: "rgb(var(--medium))",
} as const;

export const AXIS = {
  stroke: "rgb(var(--line) / 0.12)",
  tick: { fill: "rgb(var(--ink-muted))", fontSize: 11 },
};

// --------------------------------------------------------------------------
// Tooltip
// --------------------------------------------------------------------------
interface TooltipEntry {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
  payload?: Record<string, unknown>;
}

export function ChartTooltip({
  active,
  payload,
  label,
  unit = "",
  decimals = 1,
  extra,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  unit?: string;
  decimals?: number;
  extra?: (payload: Record<string, unknown>) => React.ReactNode;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as Record<string, unknown> | undefined;

  return (
    <div className="pointer-events-none min-w-[168px] rounded-lg border border-[rgb(var(--line)/0.14)] bg-elevated/95 px-3 py-2.5 shadow-lift backdrop-blur-xl">
      {label !== undefined ? (
        <div className="mb-2 text-[11px] font-medium text-ink-soft">{label}</div>
      ) : null}
      <div className="space-y-1.5">
        {payload
          .filter((entry) => entry.value !== null && entry.value !== undefined)
          .map((entry, index) => (
            <div
              key={`${entry.dataKey}-${index}`}
              className="flex items-center justify-between gap-4"
            >
              <span className="flex items-center gap-1.5 text-[11px] text-ink-muted">
                <span
                  className="size-2 rounded-[2px]"
                  style={{ background: entry.color }}
                />
                {entry.name}
              </span>
              <span className="num text-[11px] font-medium text-ink">
                {typeof entry.value === "number"
                  ? num(entry.value, decimals)
                  : entry.value}
                {unit ? <span className="ml-0.5 text-ink-muted">{unit}</span> : null}
              </span>
            </div>
          ))}
      </div>
      {extra && row ? (
        <div className="mt-2 border-t border-[rgb(var(--line)/0.1)] pt-2">
          {extra(row)}
        </div>
      ) : null}
    </div>
  );
}

// --------------------------------------------------------------------------
// Actual vs expected
// --------------------------------------------------------------------------
export interface ActualExpectedPoint {
  label: string;
  actual: number;
  expected?: number | null;
  is_anomalous?: boolean;
  [key: string]: unknown;
}

export function ActualVsExpectedChart({
  data,
  resource = "ENERGY",
  unit,
  height = 260,
  showExpected = true,
  decimals = 1,
  tooltipExtra,
}: {
  data: ActualExpectedPoint[];
  resource?: "ENERGY" | "WATER";
  unit?: string;
  height?: number;
  showExpected?: boolean;
  decimals?: number;
  tooltipExtra?: (row: Record<string, unknown>) => React.ReactNode;
}) {
  const colour = resource === "WATER" ? CHART_COLOURS.water : CHART_COLOURS.energy;
  const gradientId = React.useId();

  // Contiguous anomalous runs become shaded bands behind the series.
  const bands = React.useMemo(() => {
    const out: { from: string; to: string }[] = [];
    let start: string | null = null;
    data.forEach((point, index) => {
      if (point.is_anomalous && start === null) start = point.label;
      const ends = !point.is_anomalous || index === data.length - 1;
      if (start !== null && ends) {
        out.push({ from: start, to: point.label });
        start = null;
      }
    });
    return out;
  }, [data]);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colour} stopOpacity={0.28} />
            <stop offset="100%" stopColor={colour} stopOpacity={0.01} />
          </linearGradient>
        </defs>

        <CartesianGrid strokeDasharray="0" vertical={false} />

        {bands.map((band, index) => (
          <ReferenceArea
            key={index}
            x1={band.from}
            x2={band.to}
            fill="rgb(var(--critical))"
            fillOpacity={0.09}
            strokeOpacity={0}
          />
        ))}

        <XAxis
          dataKey="label"
          axisLine={{ stroke: AXIS.stroke }}
          tickLine={false}
          tick={AXIS.tick}
          minTickGap={28}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={AXIS.tick}
          width={52}
          tickFormatter={(value: number) => compact(value, 0)}
        />
        <Tooltip
          content={
            <ChartTooltip unit={unit} decimals={decimals} extra={tooltipExtra} />
          }
        />

        <Area
          type="monotone"
          dataKey="actual"
          name="Metered"
          stroke={colour}
          strokeWidth={1.75}
          fill={`url(#${gradientId})`}
          dot={false}
          activeDot={{ r: 3.5, strokeWidth: 0 }}
        />
        {showExpected ? (
          <Line
            type="monotone"
            dataKey="expected"
            name="Expected"
            stroke={CHART_COLOURS.expected}
            strokeWidth={1.25}
            strokeDasharray="4 4"
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0 }}
          />
        ) : null}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// --------------------------------------------------------------------------
// Dual resource chart (campus overview)
// --------------------------------------------------------------------------
export function CampusChart({
  data,
  showEnergy,
  showWater,
  height = 280,
}: {
  data: Array<Record<string, unknown>>;
  showEnergy: boolean;
  showWater: boolean;
  height?: number;
}) {
  const energyGradient = React.useId();
  const waterGradient = React.useId();

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <defs>
          <linearGradient id={energyGradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_COLOURS.energy} stopOpacity={0.26} />
            <stop offset="100%" stopColor={CHART_COLOURS.energy} stopOpacity={0.01} />
          </linearGradient>
          <linearGradient id={waterGradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_COLOURS.water} stopOpacity={0.24} />
            <stop offset="100%" stopColor={CHART_COLOURS.water} stopOpacity={0.01} />
          </linearGradient>
        </defs>

        <CartesianGrid strokeDasharray="0" vertical={false} />
        <XAxis
          dataKey="label"
          axisLine={{ stroke: AXIS.stroke }}
          tickLine={false}
          tick={AXIS.tick}
          minTickGap={30}
        />
        <YAxis
          yAxisId="energy"
          axisLine={false}
          tickLine={false}
          tick={AXIS.tick}
          width={52}
          tickFormatter={(value: number) => compact(value, 0)}
        />
        {showWater ? (
          <YAxis
            yAxisId="water"
            orientation="right"
            axisLine={false}
            tickLine={false}
            tick={AXIS.tick}
            width={52}
            tickFormatter={(value: number) => compact(value, 0)}
          />
        ) : null}
        <Tooltip content={<ChartTooltip decimals={0} />} />

        {showEnergy ? (
          <>
            <Area
              yAxisId="energy"
              type="monotone"
              dataKey="energy"
              name="Energy (kWh)"
              stroke={CHART_COLOURS.energy}
              strokeWidth={1.75}
              fill={`url(#${energyGradient})`}
              dot={false}
              activeDot={{ r: 3.5, strokeWidth: 0 }}
            />
            <Line
              yAxisId="energy"
              type="monotone"
              dataKey="energy_expected"
              name="Energy expected"
              stroke={CHART_COLOURS.expected}
              strokeWidth={1.15}
              strokeDasharray="4 4"
              dot={false}
            />
          </>
        ) : null}

        {showWater ? (
          <>
            <Area
              yAxisId={showEnergy ? "water" : "energy"}
              type="monotone"
              dataKey="water"
              name="Water (L)"
              stroke={CHART_COLOURS.water}
              strokeWidth={1.75}
              fill={`url(#${waterGradient})`}
              dot={false}
              activeDot={{ r: 3.5, strokeWidth: 0 }}
            />
            <Line
              yAxisId={showEnergy ? "water" : "energy"}
              type="monotone"
              dataKey="water_expected"
              name="Water expected"
              stroke={CHART_COLOURS.expected}
              strokeWidth={1.15}
              strokeDasharray="4 4"
              dot={false}
            />
          </>
        ) : null}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// --------------------------------------------------------------------------
// Hour-of-day profile: before vs after
// --------------------------------------------------------------------------
export function HourProfileChart({
  data,
  seriesA,
  seriesB,
  labelA,
  labelB,
  colourA = CHART_COLOURS.baseline,
  colourB = CHART_COLOURS.post,
  unit,
  height = 220,
  highlightHours,
}: {
  data: Array<Record<string, unknown>>;
  seriesA: string;
  seriesB: string;
  labelA: string;
  labelB: string;
  colourA?: string;
  colourB?: string;
  unit?: string;
  height?: number;
  highlightHours?: number[];
}) {
  const bands = React.useMemo(() => {
    if (!highlightHours?.length) return [];
    const sorted = [...highlightHours].sort((a, b) => a - b);
    const out: { from: number; to: number }[] = [];
    let start = sorted[0];
    let prev = sorted[0];
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i] !== prev + 1) {
        out.push({ from: start, to: prev });
        start = sorted[i];
      }
      prev = sorted[i];
    }
    out.push({ from: start, to: prev });
    return out;
  }, [highlightHours]);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid strokeDasharray="0" vertical={false} />
        {bands.map((band, index) => (
          <ReferenceArea
            key={index}
            x1={String(band.from).padStart(2, "0")}
            x2={String(band.to).padStart(2, "0")}
            fill="rgb(var(--critical))"
            fillOpacity={0.08}
            strokeOpacity={0}
          />
        ))}
        <XAxis
          dataKey="hour"
          axisLine={{ stroke: AXIS.stroke }}
          tickLine={false}
          tick={AXIS.tick}
          interval={2}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={AXIS.tick}
          width={52}
          tickFormatter={(value: number) => compact(value, 0)}
        />
        <Tooltip content={<ChartTooltip unit={unit} decimals={1} />} />
        <Area
          type="monotone"
          dataKey={seriesA}
          name={labelA}
          stroke={colourA}
          strokeWidth={1.5}
          strokeDasharray="4 4"
          fill="transparent"
          dot={false}
        />
        <Area
          type="monotone"
          dataKey={seriesB}
          name={labelB}
          stroke={colourB}
          strokeWidth={2}
          fill={colourB}
          fillOpacity={0.12}
          dot={false}
          connectNulls
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// --------------------------------------------------------------------------
// Comparison bars
// --------------------------------------------------------------------------
export function ComparisonBars({
  data,
  dataKey,
  labelKey = "code",
  unit,
  height = 220,
  colourFor,
  onSelect,
}: {
  data: Array<Record<string, unknown>>;
  dataKey: string;
  labelKey?: string;
  unit?: string;
  height?: number;
  colourFor?: (row: Record<string, unknown>) => string;
  onSelect?: (row: Record<string, unknown>) => void;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid strokeDasharray="0" vertical={false} />
        <XAxis
          dataKey={labelKey}
          axisLine={{ stroke: AXIS.stroke }}
          tickLine={false}
          tick={AXIS.tick}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={AXIS.tick}
          width={52}
          tickFormatter={(value: number) => compact(value, 0)}
        />
        <Tooltip
          content={<ChartTooltip unit={unit} decimals={0} />}
          cursor={{ fill: "rgb(var(--line) / 0.05)" }}
        />
        <Bar
          dataKey={dataKey}
          radius={[4, 4, 0, 0]}
          maxBarSize={44}
          onClick={(entry: unknown) =>
            onSelect?.((entry as { payload: Record<string, unknown> }).payload)
          }
          cursor={onSelect ? "pointer" : undefined}
        >
          {data.map((row, index) => (
            <Cell
              key={index}
              fill={colourFor ? colourFor(row) : CHART_COLOURS.energy}
              fillOpacity={0.85}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// --------------------------------------------------------------------------
// Before / after verification chart
// --------------------------------------------------------------------------
export function BeforeAfterChart({
  data,
  interventionLabel,
  unit,
  height = 260,
}: {
  data: Array<{
    date: string;
    baseline?: number | null;
    post?: number | null;
    adjusted?: number | null;
  }>;
  interventionLabel?: string;
  unit?: string;
  height?: number;
}) {
  const baselineGradient = React.useId();
  const postGradient = React.useId();

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <defs>
          <linearGradient id={baselineGradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_COLOURS.critical} stopOpacity={0.2} />
            <stop offset="100%" stopColor={CHART_COLOURS.critical} stopOpacity={0.01} />
          </linearGradient>
          <linearGradient id={postGradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_COLOURS.post} stopOpacity={0.26} />
            <stop offset="100%" stopColor={CHART_COLOURS.post} stopOpacity={0.01} />
          </linearGradient>
        </defs>

        <CartesianGrid strokeDasharray="0" vertical={false} />
        <XAxis
          dataKey="date"
          axisLine={{ stroke: AXIS.stroke }}
          tickLine={false}
          tick={AXIS.tick}
          minTickGap={24}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={AXIS.tick}
          width={52}
          tickFormatter={(value: number) => compact(value, 0)}
        />
        <Tooltip content={<ChartTooltip unit={unit} decimals={0} />} />

        {interventionLabel ? (
          <ReferenceLine
            x={interventionLabel}
            stroke="rgb(var(--iris))"
            strokeDasharray="3 3"
            strokeWidth={1.25}
            label={{
              value: "Intervention",
              position: "insideTopRight",
              fill: "rgb(var(--iris))",
              fontSize: 10,
            }}
          />
        ) : null}

        <Area
          type="monotone"
          dataKey="baseline"
          name="Baseline (measured)"
          stroke={CHART_COLOURS.critical}
          strokeWidth={1.75}
          fill={`url(#${baselineGradient})`}
          dot={false}
          connectNulls={false}
        />
        <Area
          type="monotone"
          dataKey="post"
          name="Post-intervention (measured)"
          stroke={CHART_COLOURS.post}
          strokeWidth={1.75}
          fill={`url(#${postGradient})`}
          dot={false}
          connectNulls={false}
        />
        <Line
          type="monotone"
          dataKey="adjusted"
          name="Adjusted baseline"
          stroke={CHART_COLOURS.adjusted}
          strokeWidth={1.4}
          strokeDasharray="5 4"
          dot={false}
          connectNulls={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// --------------------------------------------------------------------------
// Sparkline
// --------------------------------------------------------------------------
export function Sparkline({
  data,
  dataKey = "value",
  colour = CHART_COLOURS.energy,
  height = 36,
  className,
}: {
  data: Array<Record<string, unknown>>;
  dataKey?: string;
  colour?: string;
  height?: number;
  className?: string;
}) {
  const gradientId = React.useId();
  return (
    <div className={cn("w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colour} stopOpacity={0.3} />
              <stop offset="100%" stopColor={colour} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={colour}
            strokeWidth={1.4}
            fill={`url(#${gradientId})`}
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
