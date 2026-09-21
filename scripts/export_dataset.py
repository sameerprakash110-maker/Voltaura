"""
Export the EcoTwin telemetry to CSV.

Useful for inspecting the dataset outside the app, or for feeding it to a
notebook.

    python scripts/export_dataset.py
    python scripts/export_dataset.py --building ENGG --resource energy
    python scripts/export_dataset.py --out some/other/dir
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for path in (str(ROOT), str(ROOT / "backend")):
    if path not in sys.path:
        sys.path.insert(0, path)

from sqlalchemy import select  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.models import (  # noqa: E402
    Anomaly,
    Building,
    EnergyReading,
    Fault,
    WaterReading,
)

ENERGY_FIELDS = [
    "ts", "energy_kwh", "expected_kwh", "occupancy", "occupancy_pct",
    "temperature_c", "outdoor_temperature_c", "hvac_runtime_min",
    "lighting_runtime_min", "equipment_kw", "fault_code",
]
WATER_FIELDS = [
    "ts", "water_liters", "expected_liters", "flow_lph", "occupancy",
    "occupancy_pct", "temperature_c", "outdoor_temperature_c",
    "pump_runtime_min", "fault_code",
]


def write_rows(path: Path, header: list[str], rows: list[list]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(header)
        writer.writerows(rows)
    print(f"  {path.relative_to(ROOT)}  ({len(rows):,} rows)")


def main() -> int:
    parser = argparse.ArgumentParser(description="Export EcoTwin telemetry to CSV")
    parser.add_argument("--building", help="building code, e.g. ENGG (default: all)")
    parser.add_argument("--resource", choices=["energy", "water", "both"], default="both")
    parser.add_argument("--out", default=str(ROOT / "data" / "exports"))
    args = parser.parse_args()

    out_dir = Path(args.out)
    db = SessionLocal()
    try:
        query = select(Building).order_by(Building.id)
        if args.building:
            query = query.where(Building.code == args.building.upper())
        buildings = db.execute(query).scalars().all()

        if not buildings:
            print(
                f"No buildings matched '{args.building}'. "
                "Run 'python scripts/seed.py' first."
            )
            return 1

        print(f"Exporting to {out_dir}")

        for building in buildings:
            if args.resource in ("energy", "both"):
                rows = db.execute(
                    select(EnergyReading)
                    .where(EnergyReading.building_id == building.id)
                    .order_by(EnergyReading.ts)
                ).scalars().all()
                write_rows(
                    out_dir / f"{building.code}_energy.csv",
                    ENERGY_FIELDS,
                    [[getattr(r, f) for f in ENERGY_FIELDS] for r in rows],
                )

            if args.resource in ("water", "both"):
                rows = db.execute(
                    select(WaterReading)
                    .where(WaterReading.building_id == building.id)
                    .order_by(WaterReading.ts)
                ).scalars().all()
                write_rows(
                    out_dir / f"{building.code}_water.csv",
                    WATER_FIELDS,
                    [[getattr(r, f) for f in WATER_FIELDS] for r in rows],
                )

        # ---- metadata: buildings, planted faults, detected anomalies -----
        write_rows(
            out_dir / "buildings.csv",
            ["code", "name", "category", "area_sqm", "floors", "occupancy_capacity",
             "operating_hours_start", "operating_hours_end", "year_built"],
            [[b.code, b.name, b.category, b.area_sqm, b.floors, b.occupancy_capacity,
              b.operating_hours_start, b.operating_hours_end, b.year_built]
             for b in db.execute(select(Building).order_by(Building.id)).scalars()],
        )

        codes = {b.id: b.code for b in db.execute(select(Building)).scalars()}

        write_rows(
            out_dir / "faults_ground_truth.csv",
            ["building", "code", "resource_type", "start_ts", "end_ts", "label", "scenario_key"],
            [[codes.get(f.building_id), f.code, f.resource_type, f.start_ts, f.end_ts,
              f.label, f.scenario_key]
             for f in db.execute(select(Fault).order_by(Fault.start_ts)).scalars()],
        )

        write_rows(
            out_dir / "anomalies_detected.csv",
            ["building", "resource_type", "start_ts", "end_ts", "severity",
             "deviation_pct", "excess_total", "unit", "cause_code", "confidence",
             "flagged_intervals", "status"],
            [[codes.get(a.building_id), a.resource_type, a.start_ts, a.end_ts, a.severity,
              a.deviation_pct, a.excess_total, a.unit, a.cause_code, a.confidence,
              a.flagged_intervals, a.status]
             for a in db.execute(select(Anomaly).order_by(Anomaly.start_ts)).scalars()],
        )

        print("\nDone. faults_ground_truth.csv vs anomalies_detected.csv lets you "
              "score the detector offline.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
