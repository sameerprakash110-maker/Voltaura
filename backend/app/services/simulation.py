"""
Telemetry generation and the simulator clock.

This service owns the boundary between the database and `ml.simulator`. It is
the software stand-in for the IoT ingestion layer: in a real deployment the
same rows would arrive from smart meters over MQTT and everything downstream
would be unchanged.

Two entry points matter:

  seed_history()          build the initial 90 days of history
  advance_simulation()    append new hours to the end of the record

`advance_simulation` is what makes the closed loop real. When an intervention
closes a fault, the hours generated afterwards are produced by the same physics
with that fault removed, so the reduction measured by the verification stage is
a genuine consequence of the action the user took, not a scripted outcome.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ml.campus import BUILDINGS, FAULT_PLAN
from ml.simulator import (
    ActiveFault,
    BuildingSpec,
    build_holiday_set,
    simulate_range,
)

from ..config import settings
from ..models import Building, EnergyReading, Fault, SimulationState, WaterReading

HOUR = timedelta(hours=1)


# --------------------------------------------------------------------------
# Clock
# --------------------------------------------------------------------------
def get_state(db: Session) -> SimulationState | None:
    return db.get(SimulationState, 1)


def data_end(db: Session) -> datetime:
    """The timestamp of the most recent telemetry interval."""
    state = get_state(db)
    if state is not None:
        return state.data_end_ts
    latest = db.execute(select(func.max(EnergyReading.ts))).scalar()
    return latest or datetime.utcnow().replace(minute=0, second=0, microsecond=0)


def data_start(db: Session) -> datetime:
    state = get_state(db)
    if state is not None:
        return state.data_start_ts
    earliest = db.execute(select(func.min(EnergyReading.ts))).scalar()
    return earliest or data_end(db) - timedelta(days=settings.history_days)


def _holidays(db: Session):
    start = data_start(db)
    span_days = max(settings.history_days, int((data_end(db) - start).days) + 1)
    return build_holiday_set(start, span_days)


# --------------------------------------------------------------------------
# Faults
# --------------------------------------------------------------------------
def active_faults(db: Session, building_id: int) -> list[ActiveFault]:
    rows = db.execute(select(Fault).where(Fault.building_id == building_id)).scalars().all()
    return [ActiveFault(code=f.code, start_ts=f.start_ts, end_ts=f.end_ts, params=f.params or {}) for f in rows]


def close_fault(db: Session, building_id: int, fault_code: str, closed_at: datetime) -> Fault | None:
    """
    Mark a fault as remediated from `closed_at`.

    Called when an intervention is applied. Telemetry generated after this
    point no longer carries the fault, which is what allows the saving to be
    measured rather than asserted.
    """
    fault = db.execute(
        select(Fault)
        .where(Fault.building_id == building_id, Fault.code == fault_code)
        .where((Fault.end_ts.is_(None)) | (Fault.end_ts > closed_at))
        .order_by(Fault.start_ts.desc())
    ).scalars().first()

    if fault is None:
        return None
    fault.end_ts = closed_at
    db.commit()
    return fault


# --------------------------------------------------------------------------
# Generation
# --------------------------------------------------------------------------
def _spec(building: Building) -> BuildingSpec:
    return BuildingSpec.from_model(building)


def _rows_to_models(building_id: int, rows: list[dict]) -> tuple[list[dict], list[dict]]:
    """Split simulator output into energy and water reading payloads."""
    energy = [
        {
            "building_id": building_id,
            "ts": r["ts"],
            "energy_kwh": r["energy_kwh"],
            "occupancy": r["occupancy"],
            "occupancy_pct": r["occupancy_pct"],
            "temperature_c": r["temperature_c"],
            "outdoor_temperature_c": r["outdoor_temperature_c"],
            "hvac_runtime_min": r["hvac_runtime_min"],
            "lighting_runtime_min": r["lighting_runtime_min"],
            "equipment_kw": r["equipment_kw"],
            "fault_code": r["energy_fault_code"],
        }
        for r in rows
    ]
    water = [
        {
            "building_id": building_id,
            "ts": r["ts"],
            "water_liters": r["water_liters"],
            "flow_lph": r["flow_lph"],
            "occupancy": r["occupancy"],
            "occupancy_pct": r["occupancy_pct"],
            "temperature_c": r["temperature_c"],
            "outdoor_temperature_c": r["outdoor_temperature_c"],
            "pump_runtime_min": r["pump_runtime_min"],
            "fault_code": r["water_fault_code"],
        }
        for r in rows
    ]
    return energy, water


def generate_window(
    db: Session,
    building: Building,
    start: datetime,
    end: datetime,
    holidays,
) -> int:
    """Generate and persist [start, end) for one building. Returns row count."""
    if end <= start:
        return 0

    faults = active_faults(db, building.id)
    rows = simulate_range(_spec(building), start, end, faults, holidays, settings.random_seed)
    if not rows:
        return 0

    energy, water = _rows_to_models(building.id, rows)
    db.bulk_insert_mappings(EnergyReading, energy)
    db.bulk_insert_mappings(WaterReading, water)
    return len(rows)


def seed_history(db: Session, days: int | None = None, end: datetime | None = None) -> dict:
    """
    Build the initial telemetry history and the fault plan behind it.

    Clears any existing telemetry first so the operation is idempotent.
    """
    days = days or settings.history_days
    end = (end or datetime.now()).replace(minute=0, second=0, microsecond=0)
    start = end - timedelta(days=days)

    db.execute(delete(EnergyReading))
    db.execute(delete(WaterReading))
    db.execute(delete(Fault))
    db.commit()

    buildings = db.execute(select(Building).order_by(Building.id)).scalars().all()
    by_code = {b.code: b for b in buildings}

    # ---- install the fault plan before generating anything ------------
    for planned in FAULT_PLAN:
        building = by_code.get(planned.building_code)
        if building is None:
            continue
        fault_start, fault_end = planned.window(end)
        db.add(
            Fault(
                building_id=building.id,
                code=planned.code,
                resource_type=planned.resource_type,
                label=planned.label,
                start_ts=fault_start,
                end_ts=fault_end,
                params=planned.params,
                scenario_key=planned.scenario_key,
            )
        )
    db.commit()

    holidays = build_holiday_set(start, days)
    total = 0
    for building in buildings:
        total += generate_window(db, building, start, end, holidays)
    db.commit()

    state = db.get(SimulationState, 1)
    if state is None:
        state = SimulationState(id=1, data_start_ts=start, data_end_ts=end)
        db.add(state)
    else:
        state.data_start_ts = start
        state.data_end_ts = end
        state.seeded_at = datetime.utcnow()
    db.commit()

    return {
        "buildings": len(buildings),
        "intervals_per_resource": total,
        "data_start": start,
        "data_end": end,
        "faults_installed": len(FAULT_PLAN),
    }


def advance_simulation(db: Session, days: float, building_id: int | None = None) -> dict:
    """
    Append `days` of new telemetry to the end of the record.

    Used by post-intervention monitoring. Faults closed by an intervention are
    absent from the generated hours, so the measured saving is a real
    consequence of the change.
    """
    if days <= 0:
        return {"appended_hours": 0, "data_end": data_end(db)}

    current_end = data_end(db)
    new_end = current_end + timedelta(days=days)
    holidays = _holidays(db)

    query = select(Building).order_by(Building.id)
    if building_id is not None:
        query = query.where(Building.id == building_id)
    buildings = db.execute(query).scalars().all()

    appended = 0
    for building in buildings:
        # Resume from this building's own last interval so a per-building
        # advance can never leave a gap or duplicate an hour.
        last = db.execute(
            select(func.max(EnergyReading.ts)).where(EnergyReading.building_id == building.id)
        ).scalar()
        start = (last + HOUR) if last else current_end
        appended += generate_window(db, building, start, new_end, holidays)
    db.commit()

    state = db.get(SimulationState, 1)
    if state is not None:
        # The clock only advances as far as the *least* advanced building, so a
        # per-building advance can never make the campus clock claim data that
        # some buildings do not have yet.
        per_building_last = db.execute(
            select(func.max(EnergyReading.ts)).group_by(EnergyReading.building_id)
        ).scalars().all()
        state.data_end_ts = min(per_building_last) if per_building_last else new_end
        db.commit()

    return {
        "appended_hours": appended,
        "data_end": data_end(db),
        "advanced_days": days,
    }
