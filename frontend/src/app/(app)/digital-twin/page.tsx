"use client";

import {
  ArrowRight,
  Building2,
  Droplets,
  Gauge,
  Lightbulb,
  Radar,
  Thermometer,
  Users,
  Wind,
  Zap,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import * as React from "react";

import { useAppState } from "@/components/providers/app-state";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Panel,
  Skeleton,
  StatusDot,
} from "@/components/ui/primitives";
import { compact, num, pct, signedPct } from "@/lib/format";
import type { Anomaly, Building, Recommendation } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";
import { toTwinBuildings, type TwinBuilding } from "@/components/twin/campus-scene";

const CampusScene = dynamic(
  () => import("@/components/twin/campus-scene").then((m) => m.CampusScene),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Building2 className="size-8 animate-pulse text-ink-muted" />
          <span className="text-[11px] text-ink-muted">Initialising twin</span>
        </div>
      </div>
    ),
  },
);

export default function DigitalTwinPage() {
  const { range } = useAppState();
  const buildings = useApi<Building[]>(`/api/buildings?days=${range}`, [range]);
  const anomalies = useApi<Anomaly[]>("/api/anomalies?status=ALL");
  const recommendations = useApi<Recommendation[]>(
    "/api/recommendations?status=PENDING",
  );

  const [selectedId, setSelectedId] = React.useState<number | null>(null);

  const twin: TwinBuilding[] = React.useMemo(
    () => (buildings.data ? toTwinBuildings(buildings.data) : []),
    [buildings.data],
  );

  const selected = React.useMemo(
    () => buildings.data?.find((b) => b.id === selectedId) ?? null,
    [buildings.data, selectedId],
  );

  const selectedAnomalies = React.useMemo(
    () =>
      (anomalies.data ?? []).filter(
        (a) =>
          a.building_id === selectedId &&
          (a.status === "OPEN" || a.status === "DIAGNOSED"),
      ),
    [anomalies.data, selectedId],
  );

  const selectedRecommendation = React.useMemo(
    () => (recommendations.data ?? []).find((r) => r.building_id === selectedId) ?? null,
    [recommendations.data, selectedId],
  );

  if (buildings.error && !buildings.data) {
    return (
      <div className="pt-10">
        <ErrorState error={buildings.error} onRetry={() => buildings.refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow mb-1.5">Digital twin</div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
            Campus model
          </h1>
          <p className="mt-1.5 max-w-2xl text-[13px] text-ink-muted">
            Click any building to open its resource summary. Facade tint shows
            status, lit floor bands track live occupancy, and a rising beam
            pulses faster where the anomaly is more severe.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Legend tone="mint" label="Normal" />
          <Legend tone="medium" label="Warning" />
          <Legend tone="critical" label="Critical" />
        </div>
      </header>

      <div className="grid items-start gap-4 xl:grid-cols-[1.6fr_1fr]">
        {/* ---- canvas ---- */}
        <Panel className="relative overflow-hidden p-0">
          <div className="h-[560px] w-full bg-[#050b0a]">
            {buildings.loading && !buildings.data ? (
              <div className="flex h-full items-center justify-center">
                <Skeleton className="h-[85%] w-[90%]" />
              </div>
            ) : twin.length ? (
              <CampusScene
                buildings={twin}
                selectedId={selectedId}
                onSelect={setSelectedId}
                interactive
                className="h-full w-full"
              />
            ) : (
              <EmptyState
                icon={Building2}
                title="No buildings loaded"
                description="Seed the database to populate the campus twin."
              />
            )}
          </div>

          <div className="pointer-events-none absolute left-4 top-4 flex flex-col gap-1.5">
            <Badge tone="neutral">Drag to orbit &middot; scroll to zoom</Badge>
            {selectedId ? (
              <Badge tone="mint" dot>
                {buildings.data?.find((b) => b.id === selectedId)?.code} selected
              </Badge>
            ) : null}
          </div>

          <div className="divider-y flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <span className="text-[11px] text-ink-muted">
              Stylised geometry. Positions, footprints and heights come from each
              building&apos;s stored dimensions.
            </span>
            {selectedId ? (
              <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>
                Clear selection
              </Button>
            ) : null}
          </div>
        </Panel>

        {/* ---- inspector ---- */}
        <div className="space-y-4">
          {selected ? (
            <BuildingInspector
              building={selected}
              anomalies={selectedAnomalies}
              recommendation={selectedRecommendation}
            />
          ) : (
            <Panel className="p-6">
              <EmptyState
                icon={Radar}
                title="Select a building"
                description="Pick any block on the twin to see its live resource summary, anomaly status and active recommendation."
                compact
              />
              <div className="mt-2 space-y-1.5">
                {buildings.data?.map((building) => (
                  <button
                    key={building.id}
                    onClick={() => setSelectedId(building.id)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-[rgb(var(--line)/0.08)] bg-surface/40 px-3.5 py-2.5 text-left transition-colors hover:border-[rgb(var(--line)/0.16)] hover:bg-surface"
                  >
                    <span className="flex items-center gap-2.5">
                      <StatusDot
                        tone={
                          building.status === "CRITICAL"
                            ? "critical"
                            : building.status === "WARNING"
                              ? "medium"
                              : "mint"
                        }
                        pulse={building.status !== "NORMAL"}
                      />
                      <span className="text-[12.5px] text-ink-soft">
                        {building.name}
                      </span>
                    </span>
                    <span className="num text-[11px] text-ink-muted">
                      {building.open_anomalies > 0
                        ? `${building.open_anomalies} open`
                        : "clear"}
                    </span>
                  </button>
                ))}
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

function Legend({
  tone,
  label,
}: {
  tone: "mint" | "medium" | "critical";
  label: string;
}) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-ink-muted">
      <StatusDot tone={tone} />
      {label}
    </span>
  );
}

function BuildingInspector({
  building,
  anomalies,
  recommendation,
}: {
  building: Building;
  anomalies: Anomaly[];
  recommendation: Recommendation | null;
}) {
  const statusTone =
    building.status === "CRITICAL"
      ? "critical"
      : building.status === "WARNING"
        ? "medium"
        : "mint";

  return (
    <>
      <Panel className="overflow-hidden p-0">
        <div className="flex items-start justify-between gap-3 px-5 pb-4 pt-5">
          <div>
            <div className="flex items-center gap-2">
              <Badge tone={statusTone as "mint" | "medium" | "critical"} dot
                     pulse={building.status !== "NORMAL"}>
                {building.status}
              </Badge>
              <span className="num text-[11px] text-ink-muted">{building.code}</span>
            </div>
            <h2 className="mt-2 font-display text-lg font-semibold text-ink">
              {building.name}
            </h2>
            <p className="mt-0.5 text-[11px] text-ink-muted">{building.category}</p>
          </div>
          <Button variant="secondary" size="sm" asChild>
            <Link href={`/buildings/${building.id}`}>
              Open <ArrowRight />
            </Link>
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-px bg-[rgb(var(--line)/0.07)]">
          <Metric
            icon={Users}
            label="Occupancy now"
            value={num(building.occupancy_now)}
            unit={`of ${building.occupancy_capacity}`}
            sub={pct(building.occupancy_pct_now, 0)}
          />
          <Metric
            icon={Thermometer}
            label="Indoor temp"
            value={num(building.temperature_now, 1)}
            unit="C"
          />
          <Metric
            icon={Zap}
            label="Energy"
            value={compact(building.energy_kwh, 1)}
            unit="kWh"
            sub={signedPct(building.energy_deviation_pct)}
            subTone={building.energy_deviation_pct > 3 ? "bad" : "good"}
          />
          <Metric
            icon={Droplets}
            label="Water"
            value={compact(building.water_liters / 1000, 1)}
            unit="kL"
            sub={signedPct(building.water_deviation_pct)}
            subTone={building.water_deviation_pct > 3 ? "bad" : "good"}
          />
          <Metric
            icon={Wind}
            label="HVAC runtime"
            value={num(building.hvac_runtime_now, 0)}
            unit="min/h"
          />
          <Metric
            icon={Lightbulb}
            label="Lighting runtime"
            value={num(building.lighting_runtime_now, 0)}
            unit="min/h"
          />
        </div>

        <div className="divider-y grid grid-cols-3 gap-4 px-5 py-3.5">
          <Spec label="Area" value={`${num(building.area_sqm)} m2`} />
          <Spec label="Floors" value={num(building.floors)} />
          <Spec
            label="Hours"
            value={`${String(building.operating_hours_start).padStart(2, "0")}-${String(
              building.operating_hours_end,
            ).padStart(2, "0")}`}
          />
        </div>
      </Panel>

      {/* ---- anomaly status ---- */}
      <Panel className="p-5">
        <div className="eyebrow mb-3">Anomaly status</div>
        {anomalies.length ? (
          <div className="space-y-2">
            {anomalies.map((anomaly) => (
              <Link
                key={anomaly.id}
                href={`/anomalies/${anomaly.id}`}
                className="group block rounded-card border border-[rgb(var(--line)/0.09)] bg-surface/50 p-3.5 transition-colors hover:border-[rgb(var(--line)/0.18)]"
              >
                <div className="flex items-center justify-between gap-3">
                  <Badge
                    tone={
                      anomaly.severity.toLowerCase() as
                        | "low"
                        | "medium"
                        | "high"
                        | "critical"
                    }
                    dot
                  >
                    {anomaly.severity}
                  </Badge>
                  <span className="num text-[13px] font-semibold text-ink">
                    {signedPct(anomaly.deviation_pct, 0)}
                  </span>
                </div>
                <p className="mt-2 text-[12px] font-medium text-ink">
                  {anomaly.probable_cause}
                </p>
                <p className="num mt-1 text-[11px] text-ink-muted">
                  {anomaly.affected_subsystem} &middot;{" "}
                  {pct((anomaly.confidence ?? 0) * 100, 0)} confidence
                </p>
              </Link>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2.5 rounded-card border border-mint/20 bg-mint/[0.05] p-3.5">
            <StatusDot tone="mint" />
            <span className="text-[12px] text-ink-soft">
              No open anomalies. Consumption is tracking the expected baseline.
            </span>
          </div>
        )}
      </Panel>

      {/* ---- active recommendation ---- */}
      {recommendation ? (
        <Panel className="p-5">
          <div className="eyebrow mb-3">Active recommendation</div>
          <h3 className="font-display text-[14px] font-semibold text-ink">
            {recommendation.title}
          </h3>
          <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">
            {recommendation.description}
          </p>
          <div className="mt-3 flex items-center justify-between border-t border-[rgb(var(--line)/0.08)] pt-3">
            <span className="num text-[12px] text-ink-muted">
              Est.{" "}
              <span className="font-semibold text-mint">
                {compact(recommendation.expected_saving_per_week, 1)}{" "}
                {recommendation.expected_saving_unit}/wk
              </span>
            </span>
            <Button variant="outline" size="sm" asChild>
              <Link href="/recommendations">
                Review <ArrowRight />
              </Link>
            </Button>
          </div>
        </Panel>
      ) : null}
    </>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  unit,
  sub,
  subTone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  subTone?: "good" | "bad";
}) {
  return (
    <div className="bg-surface px-4 py-3">
      <div className="flex items-center gap-1.5">
        <Icon className="size-3 text-ink-muted" />
        <span className="text-[9px] uppercase tracking-[0.1em] text-ink-muted">
          {label}
        </span>
      </div>
      <div className="num mt-1.5 text-[15px] font-semibold text-ink">
        {value}
        {unit ? (
          <span className="ml-1 text-[10px] font-normal text-ink-muted">{unit}</span>
        ) : null}
      </div>
      {sub ? (
        <div
          className={cn(
            "num mt-0.5 text-[10px]",
            subTone === "bad"
              ? "text-high"
              : subTone === "good"
                ? "text-mint"
                : "text-ink-muted",
          )}
        >
          {sub}
        </div>
      ) : null}
    </div>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="eyebrow mb-0.5">{label}</div>
      <div className="num text-[12px] text-ink-soft">{value}</div>
    </div>
  );
}
