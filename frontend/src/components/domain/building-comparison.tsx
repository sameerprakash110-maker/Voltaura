"use client";

import Link from "next/link";
import * as React from "react";

import { MiniBar, Num, StatusText, Table } from "@/components/ui/structure";
import { compact, num, signedPct } from "@/lib/format";
import type { BuildingComparison as BuildingRow } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Building resource load.
 *
 * An infrastructure ranking, not a chart with a legend. The bar exists only in
 * the energy column, where the proportion of campus load genuinely is the
 * information; every other column is a figure, because a figure is more
 * precise than a bar and takes less room.
 */
export function BuildingComparison({
  rows,
  metric = "energy_kwh",
  className,
}: {
  rows: BuildingRow[];
  metric?: "energy_kwh" | "water_liters" | "energy_intensity";
  className?: string;
}) {
  const ranked = React.useMemo(
    () => [...rows].sort((a, b) => (b[metric] as number) - (a[metric] as number)),
    [rows, metric],
  );

  const peak = React.useMemo(
    () => Math.max(1, ...rows.map((row) => row[metric] as number)),
    [rows, metric],
  );

  return (
    <Table className={className} minWidth={720}>
      <thead>
        <tr>
          <th className="w-[26%]">Block</th>
          <th className="text-right">Energy kWh</th>
          <th className="w-[18%]">Share</th>
          <th className="text-right">Water kL</th>
          <th className="text-right">Intensity kWh/m²</th>
          <th className="text-right">Deviation</th>
          <th className="text-right">Open</th>
          <th className="pr-0 text-right">Status</th>
        </tr>
      </thead>
      <tbody>
        {ranked.map((row) => {
          const share = ((row[metric] as number) / peak) * 100;
          const drifting = row.deviation_pct > 3;
          const better = row.deviation_pct < -3;

          return (
            <tr
              key={row.building_id}
              className="group relative transition-colors hover:bg-[rgb(var(--line)/0.025)]"
            >
              <td>
                <Link
                  href={`/buildings/${row.building_id}`}
                  className="flex items-center gap-2.5 before:absolute before:inset-0 before:content-['']"
                >
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      row.status === "CRITICAL"
                        ? "bg-critical"
                        : row.status === "WARNING"
                          ? "bg-medium"
                          : "bg-ink-faint",
                    )}
                  />
                  <span className="truncate font-medium text-ink">{row.name}</span>
                  <span className="num text-[10.5px] text-ink-faint">{row.code}</span>
                </Link>
              </td>
              <td className="text-right">
                <Num tone="ink">{compact(row.energy_kwh, 1)}</Num>
              </td>
              <td>
                <MiniBar
                  value={share}
                  width={96}
                  tone={
                    row.status === "CRITICAL"
                      ? "critical"
                      : row.status === "WARNING"
                        ? "medium"
                        : "mint"
                  }
                />
              </td>
              <td className="text-right">
                <Num>{compact(row.water_liters / 1000, 1)}</Num>
              </td>
              <td className="text-right">
                <Num>{num(row.energy_intensity, 1)}</Num>
              </td>
              <td className="text-right">
                <Num tone={drifting ? "high" : better ? "mint" : "muted"}>
                  {signedPct(row.deviation_pct)}
                </Num>
              </td>
              <td className="text-right">
                <Num tone={row.open_anomalies > 0 ? "critical" : "muted"}>
                  {row.open_anomalies > 0 ? num(row.open_anomalies) : "—"}
                </Num>
              </td>
              <td className="pr-0 text-right">
                <StatusText status={row.status} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
