"""
Seed VOLTAURA with a complete, demo-ready deployment.

Runs the whole product loop once, end to end:

    1. create the five campus buildings
    2. install the fault plan and generate 90 days of hourly telemetry
    3. fit expected-consumption models and detect anomalies
    4. diagnose each anomaly and raise a costed recommendation
    5. apply the two historically-remediated measures and verify their savings

Step 5 is what gives the Verification and Reports pages real measured numbers
the moment the app opens, while the three live faults stay open for the judge
to drive through the loop themselves.

    python scripts/seed.py              # full reset and seed
    python scripts/seed.py --days 120   # longer history
    python scripts/seed.py --keep       # re-run analysis without regenerating
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for path in (str(ROOT), str(ROOT / "backend")):
    if path not in sys.path:
        sys.path.insert(0, path)

from sqlalchemy import select  # noqa: E402

from app.config import settings  # noqa: E402
from app.database import SessionLocal, init_db  # noqa: E402
from app.models import (  # noqa: E402
    Anomaly,
    Building,
    Fault,
    Intervention,
    Recommendation,
    VerificationResult,
)
from app.services import (  # noqa: E402
    intervention_service,
    pipeline,
    simulation,
    verification_service,
)
from ml.campus import BUILDINGS, FAULT_PLAN  # noqa: E402

# Faults already remediated inside the history window. Seeding an intervention
# at the moment each was fixed gives the app verified savings on first load.
HISTORICAL_SCENARIOS = ["ups-apex", "pump-mpb"]


def banner(step: str, message: str) -> None:
    print(f"\n[{step}] {message}")


def create_buildings(db) -> list[Building]:
    existing = db.execute(select(Building)).scalars().all()
    if existing:
        return existing

    buildings = []
    for spec in BUILDINGS:
        building = Building(**spec)
        db.add(building)
        buildings.append(building)
    db.commit()
    for building in buildings:
        db.refresh(building)
    return buildings


def seed_historical_interventions(db) -> list[Intervention]:
    """
    Apply the measures for faults that were already fixed in the history.

    Each intervention is dated to the moment the fault actually stopped, so the
    verification that follows compares real pre- and post-telemetry.
    """
    created: list[Intervention] = []

    for scenario_key in HISTORICAL_SCENARIOS:
        planned = next((p for p in FAULT_PLAN if p.scenario_key == scenario_key), None)
        if planned is None:
            continue

        fault = db.execute(
            select(Fault).where(Fault.scenario_key == scenario_key)
        ).scalars().first()
        if fault is None or fault.end_ts is None:
            print(f"    - {scenario_key}: no closed fault found, skipping")
            continue

        recommendation = db.execute(
            select(Recommendation)
            .join(Anomaly, Recommendation.anomaly_id == Anomaly.id)
            .where(
                Recommendation.building_id == fault.building_id,
                Recommendation.resource_type == fault.resource_type,
                Recommendation.target_fault_code == fault.code,
            )
            .order_by(Recommendation.priority_score.desc())
        ).scalars().first()

        if recommendation is None:
            print(f"    - {scenario_key}: no matching recommendation, skipping")
            continue

        intervention = intervention_service.apply_recommendation(
            db,
            recommendation,
            implemented_at=fault.end_ts,
            owner="Facilities Team",
            notes=f"Historical record. Remediation of: {fault.label}",
            monitoring_days=14,
        )
        created.append(intervention)
        print(
            f"    - {scenario_key}: intervention #{intervention.id} "
            f"applied {fault.end_ts:%Y-%m-%d %H:%M}"
        )

    return created


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed the VOLTAURA database")
    parser.add_argument("--days", type=int, default=settings.history_days,
                        help="days of hourly history to generate")
    parser.add_argument("--keep", action="store_true",
                        help="keep existing telemetry, re-run analysis only")
    args = parser.parse_args()

    started = time.perf_counter()
    print("=" * 66)
    print("  VOLTAURA - seeding the demo deployment")
    print("=" * 66)
    print(f"  database : {settings.database_url}")
    print(f"  history  : {args.days} days at hourly resolution")
    print(f"  seed     : {settings.random_seed} (deterministic)")

    if not args.keep:
        banner("1/5", "Creating schema")
        init_db(drop=True)
        print("    schema created")

    db = SessionLocal()
    try:
        banner("2/5", "Creating buildings")
        buildings = create_buildings(db)
        for building in buildings:
            print(f"    - {building.code:6} {building.name:26} "
                  f"{building.area_sqm:>6,.0f} m2  cap {building.occupancy_capacity}")

        if not args.keep:
            banner("3/5", "Generating telemetry and installing the fault plan")
            result = simulation.seed_history(db, days=args.days)
            print(f"    {result['intervals_per_resource']:,} hourly intervals per resource "
                  f"across {result['buildings']} buildings")
            print(f"    window: {result['data_start']:%Y-%m-%d %H:%M} "
                  f"-> {result['data_end']:%Y-%m-%d %H:%M}")
            print(f"    faults installed: {result['faults_installed']}")
            for planned in FAULT_PLAN:
                state = "LIVE" if planned.end_days_before_end is None else "remediated"
                print(f"      - {planned.building_code:6} {planned.code:22} {state}")
        else:
            print("\n[3/5] Keeping existing telemetry")

        banner("4/5", "Running the analysis pipeline")
        summary = pipeline.run_full_analysis(db)
        print(f"    buildings analysed : {summary['buildings_analysed']}")
        print(f"    anomalies detected : {summary['anomalies_detected']} "
              f"({summary['by_resource']})")

        for anomaly in db.execute(select(Anomaly).order_by(Anomaly.id)).scalars():
            building = db.get(Building, anomaly.building_id)
            print(f"      - {building.code:6} {anomaly.resource_type:6} "
                  f"{anomaly.severity:8} {anomaly.deviation_pct:+7.1f}%  "
                  f"{anomaly.probable_cause} ({anomaly.confidence:.0%})")

        banner("5/5", "Applying historically-remediated measures and verifying")
        interventions = seed_historical_interventions(db)
        for intervention in interventions:
            result = verification_service.run_verification(db, intervention)
            print(f"    - {intervention.title[:44]:44} {result.status:16} "
                  f"{result.absolute_saving:>9,.0f} {result.unit}/wk  "
                  f"({result.saving_pct:.1f}%)")

        # ---- final tally --------------------------------------------
        counts = {
            "buildings": db.query(Building).count(),
            "anomalies": db.query(Anomaly).count(),
            "recommendations": db.query(Recommendation).count(),
            "interventions": db.query(Intervention).count(),
            "verifications": db.query(VerificationResult).count(),
        }
        print("\n" + "=" * 66)
        print("  Seed complete in %.1fs" % (time.perf_counter() - started))
        for key, value in counts.items():
            print(f"    {key:16} {value}")
        print("=" * 66)
        print("\n  Next:  uvicorn app.main:app --reload --app-dir backend")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
