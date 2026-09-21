"use client";

import { ArrowRight, Building2, Droplets, Users, Zap } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { useAppState } from "@/components/providers/app-state";
import {
  Badge,
  EmptyState,
  ErrorState,
  Panel,
  Progress,
  Skeleton,
  StatusDot,
} from "@/components/ui/primitives";
import { compact, num, pct, signedPct } from "@/lib/format";
import type { Building } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";

export default function BuildingsPage() {
  const { range } = useAppState();
  const { data, error, loading, refetch } = useApi<Building[]>(
    `/api/buildings?days=${range}`,
    [range],
  );

  const maxEnergy = React.useMemo(
    () => Math.max(1, ...(data ?? []).map((b) => b.energy_kwh)),
    [data],
  );

  if (error && !data) {
    return (
      <div className="pt-10">
        <ErrorState error={error} onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header>
        <div className="eyebrow mb-1.5">Buildings</div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
          Campus portfolio
        </h1>
        <p className="mt-1.5 text-[13px] text-ink-muted">
          Five buildings under continuous baseline over the last {range} days.
          Deviation compares metered consumption against the model&apos;s
          expectation for the same conditions.
        </p>
      </header>

      {loading && !data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Panel key={i} className="p-5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-3 h-8 w-24" />
              <Skeleton className="mt-4 h-20 w-full" />
            </Panel>
          ))}
        </div>
      ) : null}

      {data?.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Building2}
            title="No buildings"
            description="Run python scripts/seed.py to create the demo campus."
          />
        </Panel>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data?.map((building, index) => (
          <BuildingCard
            key={building.id}
            building={building}
            share={building.energy_kwh / maxEnergy}
            index={index}
          />
        ))}
      </div>
    </div>
  );
}

function BuildingCard({
  building,
  share,
  index,
}: {
  building: Building;
  share: number;
  index: number;
}) {
  const tone =
    building.status === "CRITICAL"
      ? "critical"
      : building.status === "WARNING"
        ? "medium"
        : "mint";

  return (
    <Link
      href={`/buildings/${building.id}`}
      className="panel group flex flex-col p-5 transition-all duration-200 hover:border-[rgb(var(--line)/0.18)] animate-fade-up"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot
              tone={tone as "mint" | "medium" | "critical"}
              pulse={building.status !== "NORMAL"}
            />
            <span className="num text-[11px] text-ink-muted">{building.code}</span>
          </div>
          <h2 className="mt-2 font-display text-[15px] font-semibold leading-snug text-ink">
            {building.name}
          </h2>
          <p className="mt-0.5 text-[11px] text-ink-muted">{building.category}</p>
        </div>
        <ArrowRight className="mt-1 size-4 shrink-0 text-ink-muted transition-all duration-150 group-hover:translate-x-0.5 group-hover:text-ink-soft" />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Reading
          icon={Zap}
          value={compact(building.energy_kwh, 1)}
          unit="kWh"
          deviation={building.energy_deviation_pct}
          tone="mint"
        />
        <Reading
          icon={Droplets}
          value={compact(building.water_liters / 1000, 1)}
          unit="kL"
          deviation={building.water_deviation_pct}
          tone="aqua"
        />
      </div>

      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between text-[10px] text-ink-muted">
          <span>Share of campus energy</span>
          <span className="num">{pct(share * 100, 0)}</span>
        </div>
        <Progress value={share * 100} tone="mint" />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[rgb(var(--line)/0.08)] pt-3.5 text-[11px] text-ink-muted">
        <span className="num flex items-center gap-1.5">
          <Users className="size-3" />
          {num(building.occupancy_now)}/{num(building.occupancy_capacity)}
        </span>
        <span className="num">{num(building.area_sqm)} m2</span>
        <span className="num">{building.floors} floors</span>
        <span className="num">{num(building.energy_intensity, 1)} kWh/m2</span>
      </div>

      {building.open_anomalies > 0 ? (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-critical/20 bg-critical/[0.05] px-3 py-2">
          <span className="text-[11px] text-ink-soft">
            {building.open_anomalies} open{" "}
            {building.open_anomalies === 1 ? "anomaly" : "anomalies"}
          </span>
          {building.top_severity ? (
            <Badge
              tone={
                building.top_severity.toLowerCase() as
                  | "low"
                  | "medium"
                  | "high"
                  | "critical"
              }
            >
              {building.top_severity}
            </Badge>
          ) : null}
        </div>
      ) : building.verified_savings_energy > 0 || building.verified_savings_water > 0 ? (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-mint/20 bg-mint/[0.05] px-3 py-2">
          <span className="num text-[11px] text-mint">
            Verified saving:{" "}
            {building.verified_savings_energy > 0
              ? `${compact(building.verified_savings_energy, 1)} kWh/wk`
              : `${compact(building.verified_savings_water / 1000, 1)} kL/wk`}
          </span>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-[rgb(var(--line)/0.08)] bg-surface/40 px-3 py-2">
          <span className="text-[11px] text-ink-muted">
            Tracking the expected baseline
          </span>
        </div>
      )}
    </Link>
  );
}

function Reading({
  icon: Icon,
  value,
  unit,
  deviation,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  unit: string;
  deviation: number;
  tone: "mint" | "aqua";
}) {
  const bad = deviation > 3;
  const good = deviation < -3;
  return (
    <div className="rounded-card border border-[rgb(var(--line)/0.08)] bg-surface/40 px-3 py-2.5">
      <Icon className={cn("size-3", tone === "mint" ? "text-mint" : "text-aqua")} />
      <div className="num mt-1.5 text-[16px] font-semibold text-ink">
        {value}
        <span className="ml-1 text-[10px] font-normal text-ink-muted">{unit}</span>
      </div>
      <div
        className={cn(
          "num mt-0.5 text-[10px]",
          bad ? "text-high" : good ? "text-mint" : "text-ink-muted",
        )}
      >
        {signedPct(deviation)} vs expected
      </div>
    </div>
  );
}
