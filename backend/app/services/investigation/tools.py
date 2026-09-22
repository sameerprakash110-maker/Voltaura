"""Deterministic data tools for future investigation orchestration.

These functions are intentionally thin adapters around the existing database,
telemetry loading, contextual baseline, and anomaly-context paths. They do not
fit models, infer unavailable readings, persist investigation state, or call an
LLM.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

import pandas as pd
from sqlalchemy.orm import Session

from ml.root_cause import build_context

from ...models import Anomaly, Building
from .. import pipeline


def _unavailable(reason: str) -> dict[str, Any]:
    return {"available": False, "status": "UNKNOWN", "reason": reason}


def _json_value(value: Any) -> Any:
    if value is None or value is pd.NA:
        return None
    if isinstance(value, (pd.Timestamp, datetime)):
        return value.isoformat()
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    if hasattr(value, "item"):
        return value.item()
    return value


def _row(row: pd.Series) -> dict[str, Any]:
    return {str(key): _json_value(value) for key, value in row.items()}


def _building_and_frame(
    db: Session, building_id: int, resource_type: str
) -> tuple[Building | None, pd.DataFrame | None, dict[str, Any] | None]:
    resource = resource_type.upper()
    if resource not in {"ENERGY", "WATER"}:
        return None, None, _unavailable(f"Unsupported resource type: {resource_type}")

    building = db.get(Building, building_id)
    if building is None:
        return None, None, _unavailable(f"Building {building_id} not found")
    frame = pipeline.load_frame(db, building, resource)
    if frame.empty:
        return building, frame, _unavailable(
            f"No {resource.lower()} telemetry available for building {building_id}"
        )
    return building, frame, None


def get_latest_telemetry(
    db: Session, building_id: int, resource_type: str
) -> dict[str, Any]:
    """Return the latest stored telemetry row for a building/resource."""
    _building, frame, unavailable = _building_and_frame(db, building_id, resource_type)
    if unavailable:
        return unavailable
    assert frame is not None
    return {
        "available": True,
        "status": "AVAILABLE",
        "building_id": building_id,
        "resource_type": resource_type.upper(),
        "reading": _row(frame.iloc[-1]),
    }


def get_historical_readings(
    db: Session, building_id: int, resource_type: str, hours: int
) -> dict[str, Any]:
    """Return recent measured readings, including stored expected values."""
    if hours <= 0:
        return _unavailable("hours must be greater than zero")
    _building, frame, unavailable = _building_and_frame(db, building_id, resource_type)
    if unavailable:
        return unavailable
    assert frame is not None
    end = frame["ts"].max()
    start = end - pd.Timedelta(hours=hours)
    recent = frame[frame["ts"] >= start]
    return {
        "available": not recent.empty,
        "status": "AVAILABLE" if not recent.empty else "UNKNOWN",
        "building_id": building_id,
        "resource_type": resource_type.upper(),
        "hours": hours,
        "readings": [_row(row) for _, row in recent.iterrows()],
    }


def get_building_context(db: Session, building_id: int) -> dict[str, Any]:
    """Return metadata already stored for a building."""
    building = db.get(Building, building_id)
    if building is None:
        return _unavailable(f"Building {building_id} not found")
    fields = (
        "id", "code", "name", "category", "description", "area_sqm", "floors",
        "occupancy_capacity", "operating_hours_start", "operating_hours_end",
        "year_built", "water_per_occupant_lph", "pump_flow_lph", "night_base_flow_lph",
    )
    return {
        "available": True,
        "status": "AVAILABLE",
        "building_id": building_id,
        "building": {field: _json_value(getattr(building, field)) for field in fields},
    }


def get_equipment_state(
    db: Session, building_id: int, resource_type: str
) -> dict[str, Any]:
    """Return equipment/runtime fields present in the latest telemetry."""
    latest = get_latest_telemetry(db, building_id, resource_type)
    if not latest.get("available"):
        return latest
    reading = latest["reading"]
    resource = resource_type.upper()
    fields = (
        ("hvac_runtime_min", "lighting_runtime_min", "equipment_kw")
        if resource == "ENERGY"
        else ("pump_runtime_min", "flow_lph")
    )
    state = {field: reading[field] for field in fields if field in reading and reading[field] is not None}
    if not state:
        return _unavailable("No equipment state fields are available in telemetry")
    return {
        "available": True,
        "status": "AVAILABLE",
        "building_id": building_id,
        "resource_type": resource,
        "timestamp": reading.get("ts"),
        "state": state,
    }


def compare_with_baseline(
    db: Session, building_id: int, resource_type: str, hours: int
) -> dict[str, Any]:
    """Compare recent stored actuals with the existing expected values."""
    if hours <= 0:
        return _unavailable("hours must be greater than zero")
    _building, frame, unavailable = _building_and_frame(db, building_id, resource_type)
    if unavailable:
        return unavailable
    assert frame is not None
    resource = resource_type.upper()
    actual_column = "energy_kwh" if resource == "ENERGY" else "water_liters"
    expected_column = "expected_kwh" if resource == "ENERGY" else "expected_liters"
    end = frame["ts"].max()
    recent = frame[frame["ts"] >= end - pd.Timedelta(hours=hours)]
    comparable = recent[recent[expected_column].notna()]
    if comparable.empty:
        return {
            "available": False,
            "status": "UNKNOWN",
            "building_id": building_id,
            "resource_type": resource,
            "hours": hours,
            "reason": "No stored expected values are available for the requested period",
        }

    actual = float(comparable[actual_column].sum())
    expected = float(comparable[expected_column].sum())
    deviation = ((actual - expected) / expected * 100.0) if abs(expected) > 1e-9 else None
    context_fields = (
        "occupancy", "occupancy_pct", "temperature_c", "outdoor_temperature_c",
        "hvac_runtime_min", "lighting_runtime_min", "pump_runtime_min", "flow_lph",
    )
    contextual = [
        _row(row)
        for _, row in comparable[["ts", *[field for field in context_fields if field in comparable.columns]]].iterrows()
    ]
    return {
        "available": True,
        "status": "AVAILABLE",
        "building_id": building_id,
        "resource_type": resource,
        "hours": hours,
        "actual": actual,
        "expected": expected,
        "deviation_pct": deviation,
        "comparable_intervals": len(comparable),
        "context": contextual,
    }


def get_investigation_context(db: Session, anomaly_id: int) -> dict[str, Any]:
    """Return the same anomaly/context inputs used by the investigation API."""
    anomaly = db.get(Anomaly, anomaly_id)
    if anomaly is None:
        return _unavailable(f"Anomaly {anomaly_id} not found")
    building = db.get(Building, anomaly.building_id)
    if building is None:
        return _unavailable(f"Building {anomaly.building_id} not found")
    frame = pipeline.load_frame(db, building, anomaly.resource_type)
    if frame.empty:
        return _unavailable("No telemetry available for this anomaly")
    context = build_context(
        frame,
        [pd.Timestamp(value) for value in (anomaly.intervals or [])],
        anomaly.resource_type,
        building,
    )
    if not context.get("valid", False):
        return _unavailable("Investigation context could not be established")
    anomaly_data = {
        column.name: _json_value(getattr(anomaly, column.name))
        for column in anomaly.__table__.columns
        if column.name != "intervals"
    }
    return {
        "available": True,
        "status": "AVAILABLE",
        "anomaly": anomaly_data,
        "context": {key: _json_value(value) for key, value in context.items() if key != "valid"},
    }


__all__ = [
    "get_latest_telemetry",
    "get_historical_readings",
    "get_building_context",
    "get_equipment_state",
    "compare_with_baseline",
    "get_investigation_context",
]
