"""Focused tests for deterministic investigation data tools."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "backend"))

from app.database import SessionLocal  # noqa: E402
from app.services.investigation.tools import (  # noqa: E402
    compare_with_baseline,
    get_building_context,
    get_equipment_state,
    get_historical_readings,
    get_investigation_context,
    get_latest_telemetry,
)


def test_latest_telemetry_retrieval() -> None:
    with SessionLocal() as db:
        result = get_latest_telemetry(db, 4, "WATER")

    assert result["available"] is True
    assert result["resource_type"] == "WATER"
    assert result["reading"]["water_liters"] is not None
    assert result["reading"]["ts"] is not None


def test_historical_readings_preserve_measured_values() -> None:
    with SessionLocal() as db:
        result = get_historical_readings(db, 4, "WATER", 24)

    assert result["available"] is True
    assert result["readings"]
    assert all("water_liters" in reading for reading in result["readings"])
    assert all("ts" in reading for reading in result["readings"])


def test_building_context_uses_stored_metadata() -> None:
    with SessionLocal() as db:
        result = get_building_context(db, 4)

    assert result["available"] is True
    assert result["building"]["operating_hours_start"] is not None
    assert result["building"]["operating_hours_end"] is not None


def test_equipment_state_returns_available_water_runtime_fields() -> None:
    with SessionLocal() as db:
        result = get_equipment_state(db, 4, "WATER")

    assert result["available"] is True
    assert result["resource_type"] == "WATER"
    assert "pump_runtime_min" in result["state"] or "flow_lph" in result["state"]


def test_baseline_comparison_uses_stored_expected_values() -> None:
    with SessionLocal() as db:
        result = compare_with_baseline(db, 4, "WATER", 24)

    assert result["available"] is True
    assert result["actual"] is not None
    assert result["expected"] is not None
    assert result["deviation_pct"] is not None
    assert result["context"]


def test_investigation_context_matches_existing_anomaly_context_path() -> None:
    with SessionLocal() as db:
        result = get_investigation_context(db, 4)

    assert result["available"] is True
    assert result["anomaly"]["id"] == 4
    assert result["context"]
    assert "actual_mean" in result["context"]


def test_missing_data_is_explicitly_unavailable() -> None:
    with SessionLocal() as db:
        latest = get_latest_telemetry(db, 999999, "WATER")
        history = get_historical_readings(db, 4, "WATER", 0)
        building = get_building_context(db, 999999)
        investigation = get_investigation_context(db, 999999)

    assert latest["available"] is False
    assert latest["status"] == "UNKNOWN"
    assert history["available"] is False
    assert building["available"] is False
    assert investigation["available"] is False
