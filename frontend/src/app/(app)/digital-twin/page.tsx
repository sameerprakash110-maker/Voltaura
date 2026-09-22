"use client";

import { ArrowRight, Compass, Maximize2, RotateCcw } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import * as React from "react";

import { useAppState } from "@/components/providers/app-state";
import {
  Button,
  EmptyState,
  ErrorState,
  Segmented,
  Skeleton,
  StatusDot,
} from "@/components/ui/primitives";
import { PageHeader, StatusText } from "@/components/ui/structure";
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

/**
 * Digital twin.
 *
 * The campus model is the hero here, so the interface around it is reduced to
 * the minimum that makes it operable: a camera control, a compass, a legend and
 * one inspection panel. Nothing floats over the geometry that does not have to.
 *
 * The scene itself, its camera presets and its selection behaviour are
 * unchanged -- this file only governs what sits around them.
 */

const CampusScene = dynamic(
  () => import("@/components/twin/campus-scene").then((m) => m.CampusScene),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <span className="label animate-pulse">Building RIT campus model</span>
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
      <div className="pt-8">
        <ErrorState error={buildings.error} onRetry={() => buildings.refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        label="Command"
        title="Digital Twin"
        description="Ramaiah Institute of Technology. Select any block for its live resource summary; status shows as a ground ring and roof marker so the architecture stays readable."
        actions={
          <>
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
          </>
        }
      />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_368px]">
        {/* ================= canvas ================= */}
        <div className="surface overflow-hidden">
          <div className="relative h-[clamp(480px,70vh,820px)] w-full bg-[#8fa5ad]">
            {buildings.loading && !buildings.data ? (
              <div className="flex h-full items-center justify-center">
                <Skeleton className="h-[90%] w-[94%]" />
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
              <div className="flex h-full items-center justify-center">
                <EmptyState
                  title="No blocks loaded"
                  description="Seed the database to populate the campus twin."
                />
              </div>
            )}

            {/* ---- camera ---- */}
            <div className="absolute left-3 top-3 flex flex-col items-start gap-2">
              <div className="flex rounded border border-white/12 bg-[rgb(6_10_11/0.76)] p-px backdrop-blur-sm">
                {CAMERA_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => applyPreset(p.key)}
                    className={cn(
                      "rounded-sm px-2 py-[3px] text-[11px] font-medium transition-colors",
                      presetKey === p.key
                        ? "bg-white/12 text-white"
                        : "text-white/55 hover:text-white/85",
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {selectedId ? (
                <button
                  onClick={() => applyPreset("quad")}
                  className="flex items-center gap-1.5 rounded border border-white/12 bg-[rgb(6_10_11/0.76)] px-2 py-1 text-[11px] text-white/70 backdrop-blur-sm transition-colors hover:text-white"
                >
                  <Maximize2 className="size-3" /> Frame quadrangle
                </button>
              ) : null}
            </div>

            {/* ---- compass ---- */}
            <div className="pointer-events-none absolute right-3 top-3 flex size-11 items-center justify-center rounded-full border border-white/10 bg-[rgb(6_10_11/0.66)] backdrop-blur-sm">
              <div ref={compassRef} className="relative size-7 transition-none">
                <span className="absolute left-1/2 top-0 -translate-x-1/2 text-[8px] font-bold text-mint">
                  N
                </span>
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 text-[7px] text-white/35">
                  S
                </span>
                <span className="absolute left-0 top-1/2 -translate-y-1/2 text-[7px] text-white/35">
                  W
                </span>
                <span className="absolute right-0 top-1/2 -translate-y-1/2 text-[7px] text-white/35">
                  E
                </span>
                <Compass className="absolute left-1/2 top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 text-white/20" />
              </div>
            </div>

            {/* ---- selection + hint ---- */}
            <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col items-start gap-1.5">
              {selected ? (
                <span className="rounded border border-mint/35 bg-[rgb(6_10_11/0.8)] px-2 py-1 text-[11px] font-medium text-mint backdrop-blur-sm">
                  {selected.name}
                </span>
              ) : null}
              <span className="rounded border border-white/10 bg-[rgb(6_10_11/0.66)] px-2 py-1 text-[10px] text-white/50 backdrop-blur-sm">
                Drag to orbit · right-drag to pan · scroll to zoom
              </span>
            </div>
          </div>

          {/* ---- legend ---- */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[rgb(var(--line)/0.07)] px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-5">
              <LegendItem tone="mint" label="Normal" count={counts.normal} />
              <LegendItem tone="medium" label="Warning" count={counts.warning} />
              <LegendItem tone="critical" label="Critical" count={counts.critical} />
            </div>
            <span className="num text-[10px] text-ink-faint">
              13.0308°N 77.5650°E · footprints and heights from stored site data
            </span>
          </div>
        </div>

        {/* ================= inspection panel ================= */}
        {selected ? (
          <InspectionPanel
            building={selected}
            anomalies={selectedAnomalies}
            recommendation={selectedRecommendation}
            resourceView={resourceView}
          />
        ) : (
          <div className="surface">
            <div className="border-b border-[rgb(var(--line)/0.07)] px-4 py-3">
              <div className="label">Inspection</div>
              <p className="mt-2 text-[11.5px] leading-relaxed text-ink-muted">
                Select a block on the twin, or pick one below.
              </p>
            </div>
            <ul className="divide-y divide-[rgb(var(--line)/0.07)]">
              {buildings.data?.map((building) => (
                <li key={building.id}>
                  <button
                    onClick={() => setSelectedId(building.id)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[rgb(var(--line)/0.03)]"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <StatusDot
                        tone={
                          building.status === "CRITICAL"
                            ? "critical"
                            : building.status === "WARNING"
                              ? "medium"
                              : "muted"
                        }
                      />
                      <span className="truncate text-[12.5px] text-ink-soft">
                        {building.name}
                      </span>
                    </span>
                    <span className="num shrink-0 text-[10.5px] text-ink-faint">
                      {building.open_anomalies > 0
                        ? `${building.open_anomalies} open`
                        : "clear"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
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
    <span className="flex items-center gap-1.5 text-[10.5px] text-ink-muted">
      <StatusDot tone={tone} />
      {label}
      <span className="num text-ink-soft">{count}</span>
    </span>
  );
}

// --------------------------------------------------------------------------
function InspectionPanel({
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
  const showEnergy = resourceView !== "WATER";
  const showWater = resourceView !== "ENERGY";
  const deviation =
    resourceView === "WATER"
      ? building.water_deviation_pct
      : building.energy_deviation_pct;

  return (
    <div className="surface">
      {/* ---- identity ---- */}
      <div className="flex items-start justify-between gap-3 border-b border-[rgb(var(--line)/0.07)] px-4 py-3.5">
        <div className="min-w-0">
          <div className="num text-[10.5px] text-ink-faint">{building.code}</div>
          <h2 className="mt-1.5 text-[15px] font-semibold leading-tight tracking-[-0.015em] text-ink">
            {building.name}
          </h2>
          <p className="mt-1 text-[11px] text-ink-muted">{building.category}</p>
        </div>
        <Button variant="secondary" size="sm" asChild>
          <Link href={`/buildings/${building.id}`}>
            Open <ArrowRight />
          </Link>
        </Button>
      </div>

      {/* ---- readings ---- */}
      <dl className="divide-y divide-[rgb(var(--line)/0.07)]">
        <Reading label="Status" value={<StatusText status={building.status} />} />
        <Reading
          label="Occupancy"
          value={`${num(building.occupancy_now)} of ${num(building.occupancy_capacity)}`}
          note={pct(building.occupancy_pct_now, 0)}
        />
        {showEnergy ? (
          <Reading
            label="Energy"
            value={`${compact(building.energy_kwh, 1)} kWh`}
            note={`${signedPct(building.energy_deviation_pct)} vs expected`}
            noteTone={building.energy_deviation_pct > 3 ? "bad" : "good"}
          />
        ) : null}
        {showWater ? (
          <Reading
            label="Water"
            value={`${compact(building.water_liters / 1000, 1)} kL`}
            note={`${signedPct(building.water_deviation_pct)} vs expected`}
            noteTone={building.water_deviation_pct > 3 ? "bad" : "good"}
          />
        ) : null}
        <Reading
          label="HVAC"
          value={`${num(building.hvac_runtime_now, 0)} min/h`}
        />
        <Reading
          label="Lighting"
          value={`${num(building.lighting_runtime_now, 0)} min/h`}
        />
        <Reading
          label="Temperature"
          value={`${num(building.temperature_now, 1)} °C`}
        />
        <Reading
          label="Area"
          value={`${num(building.area_sqm)} m² · ${building.floors} floors`}
        />
        <Reading
          label="Operating hours"
          value={`${String(building.operating_hours_start).padStart(2, "0")}–${String(
            building.operating_hours_end,
          ).padStart(2, "0")}`}
        />
      </dl>

      {/* ---- deviation ---- */}
      <div className="border-t border-[rgb(var(--line)/0.07)] px-4 py-4">
        <div className="label mb-2">Resource deviation</div>
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "num text-[26px] font-semibold leading-none",
              deviation > 3 ? "text-high" : deviation < -3 ? "text-mint" : "text-ink",
            )}
          >
            {signedPct(deviation)}
          </span>
          <span className="text-[11px] text-ink-muted">vs expected</span>
        </div>
      </div>

      {/* ---- anomalies ---- */}
      <div className="border-t border-[rgb(var(--line)/0.07)] px-4 py-4">
        <div className="label mb-3">Anomaly status</div>
        {anomalies.length ? (
          <ul className="space-y-3">
            {anomalies.map((anomaly) => (
              <li key={anomaly.id}>
                <Link href={`/anomalies/${anomaly.id}`} className="group block">
                  <div className="flex items-baseline justify-between gap-3">
                    <StatusText status={anomaly.severity} />
                    <span className="num text-[13px] font-semibold text-ink">
                      {signedPct(anomaly.deviation_pct, 0)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[12px] font-medium text-ink-soft transition-colors group-hover:text-ink">
                    {anomaly.probable_cause}
                  </p>
                  <p className="num mt-1 text-[10.5px] text-ink-faint">
                    {anomaly.affected_subsystem} ·{" "}
                    {pct((anomaly.confidence ?? 0) * 100, 0)} confidence ·{" "}
                    {anomaly.resource_type}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11.5px] leading-relaxed text-ink-muted">
            No open anomalies. Consumption is tracking the expected baseline.
          </p>
        )}
      </div>

      {/* ---- recommendation ---- */}
      {recommendation ? (
        <div className="border-t border-[rgb(var(--line)/0.07)] px-4 py-4">
          <div className="label mb-3">Available recommendation</div>
          <h3 className="text-[13px] font-semibold leading-snug text-ink">
            {recommendation.title}
          </h3>
          <p className="mt-2 text-[11.5px] leading-relaxed text-ink-muted">
            {recommendation.description}
          </p>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="num text-[11.5px] text-ink-soft">
              {compact(recommendation.expected_saving_per_week, 1)}{" "}
              {recommendation.expected_saving_unit}/wk est.
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
        </div>
      ) : null}
    </div>
  );
}

function Reading({
  label,
  value,
  note,
  noteTone,
}: {
  label: string;
  value: React.ReactNode;
  note?: string;
  noteTone?: "good" | "bad";
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
      <dt className="label">{label}</dt>
      <dd className="text-right">
        <span className="num text-[12.5px] font-medium text-ink">{value}</span>
        {note ? (
          <div
            className={cn(
              "num mt-0.5 text-[10.5px]",
              noteTone === "bad"
                ? "text-high"
                : noteTone === "good"
                  ? "text-mint"
                  : "text-ink-faint",
            )}
          >
            {note}
          </div>
        ) : null}
      </dd>
    </div>
  );
}
