"use client";

import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Compass,
  Droplets,
  Lightbulb,
  Maximize2,
  Radar,
  RotateCcw,
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
  Segmented,
  Skeleton,
  StatusDot,
} from "@/components/ui/primitives";
import { compact, num, pct, signedPct } from "@/lib/format";
import type { Anomaly, Building, Recommendation } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";
import {
  CAMERA_PRESETS,
  toTwinBuildings,
  type CameraPreset,
  type TwinBuilding,
} from "@/components/twin/campus-data";

const CampusScene = dynamic(
  () => import("@/components/twin/campus-scene").then((m) => m.CampusScene),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Building2 className="size-8 animate-pulse text-ink-muted" />
          <span className="text-[11px] text-ink-muted">
            Building RIT campus model
          </span>
        </div>
      </div>
    ),
  },
);

type ResourceView = "ALL" | "ENERGY" | "WATER";

export default function DigitalTwinPage() {
  const { range } = useAppState();
  const buildings = useApi<Building[]>(`/api/buildings?days=${range}`, [range]);
  const anomalies = useApi<Anomaly[]>("/api/anomalies?status=ALL");
  const recommendations = useApi<Recommendation[]>(
    "/api/recommendations?status=PENDING",
  );

  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [preset, setPreset] = React.useState<CameraPreset | null>(null);
  const [presetKey, setPresetKey] = React.useState("campus");
  const [resourceView, setResourceView] = React.useState<ResourceView>("ALL");
  const compassRef = React.useRef<HTMLDivElement>(null);

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
    () =>
      (recommendations.data ?? []).find((r) => r.building_id === selectedId) ??
      null,
    [recommendations.data, selectedId],
  );

  const applyPreset = React.useCallback((key: string) => {
    const next = CAMERA_PRESETS.find((p) => p.key === key);
    if (!next) return;
    setPresetKey(key);
    setPreset(next);
  }, []);

  // Rotate the compass needle by mutating the DOM directly: doing it through
  // React state would re-render the page on every animation frame.
  const handleBearing = React.useCallback((deg: number) => {
    if (compassRef.current) {
      compassRef.current.style.transform = `rotate(${deg}deg)`;
    }
  }, []);

  const counts = React.useMemo(() => {
    const list = buildings.data ?? [];
    return {
      total: list.length,
      normal: list.filter((b) => b.status === "NORMAL").length,
      warning: list.filter((b) => b.status === "WARNING").length,
      critical: list.filter((b) => b.status === "CRITICAL").length,
    };
  }, [buildings.data]);

  if (buildings.error && !buildings.data) {
    return (
      <div className="pt-10">
        <ErrorState error={buildings.error} onRetry={() => buildings.refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ---- header ---- */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow mb-1.5">Digital twin</div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
            Ramaiah Institute of Technology
          </h1>
          <p className="mt-1.5 max-w-2xl text-[13px] text-ink-muted">
            Click any block to open its live resource summary. Status shows as a
            ground ring and roof marker so the architecture stays readable.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            size="sm"
            options={[
              { value: "ALL", label: "All" },
              { value: "ENERGY", label: "Energy" },
              { value: "WATER", label: "Water" },
            ]}
            value={resourceView}
            onChange={setResourceView}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setSelectedId(null);
              applyPreset("campus");
            }}
          >
            <RotateCcw /> Reset view
          </Button>
        </div>
      </header>

      <div className="grid items-start gap-4 xl:grid-cols-[1.75fr_1fr]">
        {/* ================= canvas ================= */}
        <Panel className="relative overflow-hidden p-0">
          <div className="relative h-[clamp(460px,66vh,760px)] w-full bg-[#8fa5ad]">
            {buildings.loading && !buildings.data ? (
              <div className="flex h-full items-center justify-center">
                <Skeleton className="h-[88%] w-[92%]" />
              </div>
            ) : twin.length ? (
              <CampusScene
                buildings={twin}
                selectedId={selectedId}
                onSelect={setSelectedId}
                interactive
                preset={preset}
                onPresetSettled={() => setPreset(null)}
                onBearing={handleBearing}
                className="h-full w-full"
              />
            ) : (
              <EmptyState
                icon={Building2}
                title="No blocks loaded"
                description="Seed the database to populate the campus twin."
              />
            )}

            {/* ---- camera presets ---- */}
            <div className="pointer-events-auto absolute left-4 top-4 flex flex-col gap-2">
              <div className="flex flex-wrap gap-1 rounded-lg border border-white/10 bg-[rgb(5_11_10/0.72)] p-1 backdrop-blur-md">
                {CAMERA_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => applyPreset(p.key)}
                    className={cn(
                      "rounded-[6px] px-2.5 py-1 text-[11px] font-medium transition-colors",
                      presetKey === p.key
                        ? "bg-mint/20 text-mint"
                        : "text-white/60 hover:bg-white/10 hover:text-white/90",
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {selectedId ? (
                <button
                  onClick={() => applyPreset("quad")}
                  className="flex w-fit items-center gap-1.5 rounded-lg border border-white/10 bg-[rgb(5_11_10/0.72)] px-2.5 py-1.5 text-[11px] text-white/75 backdrop-blur-md transition-colors hover:text-white"
                >
                  <Maximize2 className="size-3" /> Frame quadrangle
                </button>
              ) : null}
            </div>

            {/* ---- compass ---- */}
            <div className="pointer-events-none absolute right-4 top-4 flex size-14 items-center justify-center rounded-full border border-white/12 bg-[rgb(5_11_10/0.66)] backdrop-blur-md">
              <div ref={compassRef} className="relative size-9 transition-none">
                <span className="absolute left-1/2 top-0 -translate-x-1/2 text-[9px] font-bold text-mint">
                  N
                </span>
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 text-[8px] text-white/40">
                  S
                </span>
                <span className="absolute left-0 top-1/2 -translate-y-1/2 text-[8px] text-white/40">
                  W
                </span>
                <span className="absolute right-0 top-1/2 -translate-y-1/2 text-[8px] text-white/40">
                  E
                </span>
                <Compass className="absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 text-white/25" />
              </div>
            </div>

            {/* ---- hint + selection ---- */}
            <div className="pointer-events-none absolute bottom-4 left-4 flex flex-col gap-1.5">
              {selectedId ? (
                <span className="w-fit rounded-md border border-mint/30 bg-[rgb(5_11_10/0.78)] px-2.5 py-1 text-[11px] font-medium text-mint backdrop-blur-md">
                  {buildings.data?.find((b) => b.id === selectedId)?.name} selected
                </span>
              ) : null}
              <span className="w-fit rounded-md border border-white/10 bg-[rgb(5_11_10/0.66)] px-2.5 py-1 text-[10px] text-white/55 backdrop-blur-md">
                Drag to orbit &middot; right-drag to pan &middot; scroll to zoom
              </span>
            </div>
          </div>

          {/* ---- legend strip ---- */}
          <div className="divider-y flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <div className="flex flex-wrap items-center gap-4">
              <LegendItem tone="mint" label="Normal" count={counts.normal} />
              <LegendItem tone="medium" label="Warning" count={counts.warning} />
              <LegendItem tone="critical" label="Critical" count={counts.critical} />
            </div>
            <span className="text-[10.5px] text-ink-muted">
              Block positions, footprints and heights from stored site data
              &middot; 13.0308&deg;N 77.5650&deg;E
            </span>
          </div>
        </Panel>

        {/* ================= inspector ================= */}
        <div className="space-y-4">
          {selected ? (
            <BuildingInspector
              building={selected}
              anomalies={selectedAnomalies}
              recommendation={selectedRecommendation}
              resourceView={resourceView}
            />
          ) : (
            <Panel className="p-5">
              <EmptyState
                icon={Radar}
                title="Select a block"
                description="Pick any building on the twin to see its live resource summary, anomaly status and active recommendation."
                compact
              />
              <div className="mt-2 space-y-1.5">
                {buildings.data?.map((building) => (
                  <button
                    key={building.id}
                    onClick={() => setSelectedId(building.id)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-[rgb(var(--line)/0.08)] bg-surface/40 px-3.5 py-2.5 text-left transition-colors hover:border-[rgb(var(--line)/0.16)] hover:bg-surface"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
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
                      <span className="truncate text-[12.5px] text-ink-soft">
                        {building.name}
                      </span>
                    </span>
                    <span className="num shrink-0 text-[11px] text-ink-muted">
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

function LegendItem({
  tone,
  label,
  count,
}: {
  tone: "mint" | "medium" | "critical";
  label: string;
  count: number;
}) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-ink-muted">
      <StatusDot tone={tone} />
      {label}
      <span className="num text-ink-soft">{count}</span>
    </span>
  );
}

// --------------------------------------------------------------------------
function BuildingInspector({
  building,
  anomalies,
  recommendation,
  resourceView,
}: {
  building: Building;
  anomalies: Anomaly[];
  recommendation: Recommendation | null;
  resourceView: ResourceView;
}) {
  const statusTone =
    building.status === "CRITICAL"
      ? "critical"
      : building.status === "WARNING"
        ? "medium"
        : "mint";

  const showEnergy = resourceView !== "WATER";
  const showWater = resourceView !== "ENERGY";

  return (
    <>
      <Panel className="overflow-hidden p-0">
        <div className="flex items-start justify-between gap-3 px-5 pb-4 pt-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                tone={statusTone as "mint" | "medium" | "critical"}
                dot
                pulse={building.status !== "NORMAL"}
              >
                {building.status}
              </Badge>
              <span className="num text-[11px] text-ink-muted">
                {building.code}
              </span>
            </div>
            <h2 className="mt-2 font-display text-lg font-semibold leading-tight text-ink">
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
          {showEnergy ? (
            <Metric
              icon={Zap}
              label="Energy"
              value={compact(building.energy_kwh, 1)}
              unit="kWh"
              sub={`${signedPct(building.energy_deviation_pct)} vs expected`}
              subTone={building.energy_deviation_pct > 3 ? "bad" : "good"}
            />
          ) : null}
          {showWater ? (
            <Metric
              icon={Droplets}
              label="Water"
              value={compact(building.water_liters / 1000, 1)}
              unit="kL"
              sub={`${signedPct(building.water_deviation_pct)} vs expected`}
              subTone={building.water_deviation_pct > 3 ? "bad" : "good"}
            />
          ) : null}
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

        <div className="divider-y grid grid-cols-4 gap-3 px-5 py-3.5">
          <Spec label="Area" value={`${num(building.area_sqm)} m2`} />
          <Spec label="Floors" value={num(building.floors)} />
          <Spec
            label="Hours"
            value={`${String(building.operating_hours_start).padStart(2, "0")}-${String(
              building.operating_hours_end,
            ).padStart(2, "0")}`}
          />
          <Spec label="Built" value={String(building.year_built)} />
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
                  <span className="flex items-center gap-2">
                    <AlertTriangle className="size-3.5 text-critical" />
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
                  </span>
                  <span className="num text-[13px] font-semibold text-ink">
                    {signedPct(anomaly.deviation_pct, 0)}
                  </span>
                </div>
                <p className="mt-2 text-[12px] font-medium text-ink">
                  {anomaly.probable_cause}
                </p>
                <p className="num mt-1 text-[11px] text-ink-muted">
                  {anomaly.affected_subsystem} &middot;{" "}
                  {pct((anomaly.confidence ?? 0) * 100, 0)} confidence &middot;{" "}
                  {anomaly.resource_type === "WATER" ? "Water" : "Energy"}
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
          <div className="eyebrow mb-3">Available recommendation</div>
          <h3 className="font-display text-[14px] font-semibold text-ink">
            {recommendation.title}
          </h3>
          <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">
            {recommendation.description}
          </p>
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-[rgb(var(--line)/0.08)] pt-3">
            <span className="num text-[12px] text-ink-muted">
              Est.{" "}
              <span className="font-semibold text-mint">
                {compact(recommendation.expected_saving_per_week, 1)}{" "}
                {recommendation.expected_saving_unit}/wk
              </span>
            </span>
            <Button variant="outline" size="sm" asChild>
              <Link
                href={
                  recommendation.anomaly_id
                    ? `/anomalies/${recommendation.anomaly_id}`
                    : "/recommendations"
                }
              >
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
