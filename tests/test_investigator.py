"""Focused tests for the deterministic investigation engine."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "backend"))

from app.services.investigation.investigator import investigate


def _anomaly(resource: str, deviation: float = 40.0) -> dict:
    return {
        "resource_type": resource,
        "actual_value": 140.0,
        "expected_value": 100.0,
        "deviation_pct": deviation,
        "unit": "L" if resource == "WATER" else "kWh",
    }


def _hypothesis(result: dict, name: str) -> dict:
    return next(item for item in result["hypotheses"] if item["name"] == name)


def _labels(result: dict) -> set[str]:
    return {item["label"] for item in result["supporting_evidence"]}


def test_water_likely_leakage_uses_measured_context_only() -> None:
    result = investigate(
        _anomaly("WATER"),
        {
            "resource_type": "WATER",
            "night_flow_ratio": 2.4,
            "flow_persistence": 0.8,
            "occupancy_pct": 5.0,
            "occupancy_ratio": 0.6,
            "pump_ratio": 1.0,
        },
    )

    assert _hypothesis(result, "Water leakage")["status"] == "SUPPORTED"
    assert {"Night-time flow relative to reference", "Flow persistence during low occupancy", "Occupancy during affected intervals"} <= _labels(result)
    assert not any(item["label"] in {"Tank level", "TDS", "Independent flow", "Equipment state"} for item in result["supporting_evidence"])


def test_water_high_demand_does_not_make_high_usage_a_leak() -> None:
    result = investigate(
        _anomaly("WATER", deviation=35.0),
        {
            "resource_type": "WATER",
            "occupancy_pct": 75.0,
            "occupancy_reference": 45.0,
            "occupancy_ratio": 1.67,
            "night_flow_ratio": 1.1,
            "flow_persistence": 0.1,
            "pump_ratio": 1.0,
        },
    )

    assert _hypothesis(result, "Water leakage")["status"] != "SUPPORTED"
    assert _hypothesis(result, "Occupancy-driven demand")["status"] == "SUPPORTED"
    assert any(item.get("hypothesis") == "Water leakage" for item in result["contradictions"])


def test_water_pump_overrun_is_supported_by_pump_runtime_ratio() -> None:
    result = investigate(
        _anomaly("WATER"),
        {"resource_type": "WATER", "pump_ratio": 1.8, "occupancy_pct": 10.0},
    )

    assert _hypothesis(result, "Pump over-run")["status"] == "SUPPORTED"


def test_water_missing_hardware_signals_are_unknown_and_not_invented() -> None:
    result = investigate(_anomaly("WATER"), {"resource_type": "WATER"})

    unknown = {item["signal"] for item in result["unknowns"]}
    assert {"tank_level", "tds", "flow", "equipment_state"} <= unknown
    assert all(item["status"] == "UNKNOWN" for item in result["unknowns"])
    assert "signal" in result["next_probe"]
    assert result["next_probe"]["signal"] == "tank_level"


def test_energy_occupancy_context_is_not_automatically_an_equipment_fault() -> None:
    result = investigate(
        _anomaly("ENERGY"),
        {
            "resource_type": "ENERGY",
            "occupancy_ratio": 1.6,
            "occupancy_pct": 80.0,
            "hvac_ratio": 1.0,
            "lighting_ratio": 1.0,
        },
    )

    assert _hypothesis(result, "Contextual demand (weather/occupancy)")["status"] == "SUPPORTED"
    assert _hypothesis(result, "HVAC over-run")["status"] != "SUPPORTED"
    assert _hypothesis(result, "Lighting over-run")["status"] != "SUPPORTED"
    assert "Occupancy relative to reference" in _labels(result)


def test_energy_hvac_runtime_and_off_hours_support_hvac_hypothesis() -> None:
    result = investigate(
        _anomaly("ENERGY"),
        {
            "resource_type": "ENERGY",
            "occupancy_ratio": 0.5,
            "hvac_ratio": 1.6,
            "lighting_ratio": 1.0,
            "offhours_share": 0.75,
        },
    )

    assert _hypothesis(result, "HVAC over-run")["status"] == "SUPPORTED"


def test_energy_lighting_runtime_and_off_hours_support_lighting_hypothesis() -> None:
    result = investigate(
        _anomaly("ENERGY"),
        {
            "resource_type": "ENERGY",
            "occupancy_ratio": 0.5,
            "hvac_ratio": 1.0,
            "lighting_ratio": 1.7,
            "offhours_share": 0.8,
        },
    )

    assert _hypothesis(result, "Lighting over-run")["status"] == "SUPPORTED"


def test_energy_insufficient_context_preserves_uncertainty() -> None:
    result = investigate(_anomaly("ENERGY", deviation=25.0), {"resource_type": "ENERGY"})

    assert _hypothesis(result, "Contextual demand (weather/occupancy)")["status"] == "UNKNOWN"
    assert _hypothesis(result, "HVAC over-run")["status"] == "UNKNOWN"
    assert _hypothesis(result, "Lighting over-run")["status"] == "UNKNOWN"
    assert not any(item["status"] == "SUPPORTED" for item in result["hypotheses"] if item["name"] in {"HVAC over-run", "Lighting over-run"})


def test_tds_is_contextual_evidence_not_leak_proof() -> None:
    result = investigate(
        _anomaly("WATER"),
        {"resource_type": "WATER", "tds": 420.0, "night_flow_ratio": 1.0, "flow_persistence": 0.0},
    )

    tds = next(item for item in result["supporting_evidence"] if item["label"] == "TDS")
    assert tds["value"] == 420.0
    assert tds["meaning"] == "Contextual signal only; not proof of leakage"
    assert _hypothesis(result, "Water leakage")["status"] != "SUPPORTED"


def test_absolute_temperature_values_are_preserved_without_weather_rule() -> None:
    result = investigate(
        _anomaly("ENERGY"),
        {
            "resource_type": "ENERGY",
            "outdoor_temperature": 36.0,
            "outdoor_reference": 30.0,
            "hvac_ratio": 1.0,
            "lighting_ratio": 1.0,
        },
    )

    outdoor = next(item for item in result["supporting_evidence"] if item["label"] == "Outdoor temperature")
    reference = next(item for item in result["supporting_evidence"] if item["label"] == "Reference outdoor temperature")
    assert outdoor["value"] == 36.0
    assert reference["value"] == 30.0
    assert _hypothesis(result, "Contextual demand (weather/occupancy)")["status"] == "UNKNOWN"
