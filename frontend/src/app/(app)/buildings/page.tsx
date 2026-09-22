"use client";

import Link from "next/link";
import * as React from "react";

import { useAppState } from "@/components/providers/app-state";
import {
  EmptyState,
  ErrorState,
  LoadingPanel,
} from "@/components/ui/primitives";
import {
  Metric,
  MiniBar,
  Num,
  PageHeader,
  Section,
  StatusText,
  Table,
} from "@/components/ui/structure";
import { compact, num, pct, signedPct } from "@/lib/format";
import type { Building } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";

/**
 * Campus portfolio.
 *
 * An asset register, read the way a facilities team reads one: every block on
 * one screen, every column comparable, the worst deviation findable by
 * scanning a single column rather than by opening six cards.
 */
export default function BuildingsPage() {
  const { range } = useAppState();
  const { data, error, loading, refetch } = useApi<Building[]>(
    `/api/buildings?days=${range}`,
    [range],
  );

  const totals = React.useMemo(() => {
    const list = data ?? [];
    return {
      blocks: list.length,
      energy: list.reduce((sum, b) => sum + b.energy_kwh, 0),
      water: list.reduce((sum, b) => sum + b.water_liters, 0),
      area: list.reduce((sum, b) => sum + b.area_sqm, 0),
      open: list.reduce((sum, b) => sum + b.open_anomalies, 0),
      verifiedEnergy: list.reduce((sum, b) => sum + b.verified_savings_energy, 0),
    };
  }, [data]);

  const peakEnergy = React.useMemo(
    () => Math.max(1, ...(data ?? []).map((b) => b.energy_kwh)),
    [data],
  );

  if (error && !data) {
    return (
      <div className="pt-8">
        <ErrorState error={error} onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        label="Command"
        title="Campus Portfolio"
        description={`Every block under continuous baseline over the last ${range} days. Deviation compares metered consumption against the model's expectation for the same conditions.`}
      />

      <section className="grid gap-x-8 gap-y-6 border-y border-[rgb(var(--line)/0.08)] py-6 sm:grid-cols-3 lg:grid-cols-5">
        <Metric label="Blocks" value={num(totals.blocks)} size="lg" />
        <Metric
          label="Energy"
          value={compact(totals.energy, 1)}
          unit="kWh"
          size="lg"
        />
        <Metric
          label="Water"
          value={compact(totals.water / 1000, 1)}
          unit="kL"
          size="lg"
        />
        <Metric
          label="Floor area"
          value={num(totals.area)}
          unit="m²"
          size="lg"
        />
        <Metric
          label="Open anomalies"
          value={num(totals.open)}
          size="lg"
          tone={totals.open > 0 ? "high" : "muted"}
        />
      </section>

      <Section
        label="Blocks"
        title="Resource load and condition"
        description="Sorted by metered energy over the window. Select a block for its engineering report."
      >
        {loading && !data ? <LoadingPanel rows={6} /> : null}

        {data?.length ? (
          <Table minWidth={980}>
            <thead>
              <tr>
                <th className="w-[24%]">Block</th>
                <th>Category</th>
                <th className="text-right">Area m²</th>
                <th className="text-right">Energy kWh</th>
                <th className="w-[12%]">Share</th>
                <th className="text-right">Water kL</th>
                <th className="text-right">Intensity</th>
                <th className="text-right">Occupancy</th>
                <th className="text-right">Energy dev.</th>
                <th className="text-right">Water dev.</th>
                <th className="pr-0 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {[...data]
                .sort((a, b) => b.energy_kwh - a.energy_kwh)
                .map((building) => (
                  <tr
                    key={building.id}
                    className="group relative transition-colors hover:bg-[rgb(var(--line)/0.025)]"
                  >
                    <td>
                      <Link
                        href={`/buildings/${building.id}`}
                        className="flex items-center gap-2.5 before:absolute before:inset-0 before:content-['']"
                      >
                        <span
                          className={cn(
                            "size-1.5 shrink-0 rounded-full",
                            building.status === "CRITICAL"
                              ? "bg-critical"
                              : building.status === "WARNING"
                                ? "bg-medium"
                                : "bg-ink-faint",
                          )}
                        />
                        <span className="truncate font-medium text-ink">
                          {building.name}
                        </span>
                        <span className="num text-[10.5px] text-ink-faint">
                          {building.code}
                        </span>
                      </Link>
                    </td>
                    <td className="text-[11.5px] text-ink-muted">
                      {building.category}
                    </td>
                    <td className="text-right">
                      <Num>{num(building.area_sqm)}</Num>
                    </td>
                    <td className="text-right">
                      <Num tone="ink">{compact(building.energy_kwh, 1)}</Num>
                    </td>
                    <td>
                      <MiniBar
                        value={(building.energy_kwh / peakEnergy) * 100}
                        width={72}
                        tone={
                          building.status === "CRITICAL"
                            ? "critical"
                            : building.status === "WARNING"
                              ? "medium"
                              : "mint"
                        }
                      />
                    </td>
                    <td className="text-right">
                      <Num>{compact(building.water_liters / 1000, 1)}</Num>
                    </td>
                    <td className="text-right">
                      <Num>{num(building.energy_intensity, 1)}</Num>
                    </td>
                    <td className="text-right">
                      <Num>
                        {num(building.occupancy_now)}
                        <span className="text-ink-faint">
                          /{num(building.occupancy_capacity)}
                        </span>
                      </Num>
                      <div className="num text-[10px] text-ink-faint">
                        {pct(building.occupancy_pct_now, 0)}
                      </div>
                    </td>
                    <td className="text-right">
                      <Deviation value={building.energy_deviation_pct} />
                    </td>
                    <td className="text-right">
                      <Deviation value={building.water_deviation_pct} />
                    </td>
                    <td className="pr-0 text-right">
                      <StatusText status={building.status} />
                      {building.open_anomalies > 0 ? (
                        <div className="num mt-0.5 text-[10px] text-critical">
                          {building.open_anomalies} open
                        </div>
                      ) : building.verified_savings_energy > 0 ||
                        building.verified_savings_water > 0 ? (
                        <div className="num mt-0.5 text-[10px] text-mint">
                          {building.verified_savings_energy > 0
                            ? `−${compact(building.verified_savings_energy, 1)} kWh/wk`
                            : `−${compact(building.verified_savings_water / 1000, 1)} kL/wk`}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
            </tbody>
          </Table>
        ) : data ? (
          <EmptyState
            title="No buildings"
            description="Run python scripts/seed.py to create the demo campus."
          />
        ) : null}
      </Section>
    </div>
  );
}

function Deviation({ value }: { value: number }) {
  const bad = value > 3;
  const good = value < -3;
  return (
    <Num tone={bad ? "high" : good ? "mint" : "muted"}>{signedPct(value)}</Num>
  );
}
