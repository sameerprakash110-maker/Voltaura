"""Focused tests for deterministic investigation orchestration."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "backend"))

from app.database import SessionLocal  # noqa: E402
from app.services.investigation import agent  # noqa: E402


def _context_result(
    *,
    resource: str = "WATER",
    building_id: int = 4,
    context: dict | None = None,
) -> dict:
    return {
        "available": True,
        "status": "AVAILABLE",
        "anomaly": {
            "id": 41,
            "building_id": building_id,
            "resource_type": resource,
            "actual_value": 140.0,
            "expected_value": 100.0,
            "deviation_pct": 40.0,
            "unit": "L" if resource == "WATER" else "kWh",
        },
        "context": context or {"resource_type": resource},
    }


def test_water_anomaly_4_uses_tools_without_fabricating_hardware() -> None:
    with SessionLocal() as db:
        result = agent.investigate_anomaly(4, db)

    assert result["resource"] == "WATER"
    assert result["probes_taken"]
    assert len(result["probes_taken"]) <= agent.MAX_PROBES
    assert {"tank_level", "tds"} <= {item["signal"] for item in result["unknowns"]}
    assert not any(item.get("label") == "Tank level" for item in result["supporting_evidence"])


def test_missing_evidence_selects_and_records_a_relevant_probe(monkeypatch) -> None:
    monkeypatch.setattr(agent.tools, "get_investigation_context", lambda db, anomaly_id: _context_result())
    monkeypatch.setattr(
        agent.tools,
        "get_equipment_state",
        lambda db, building_id, resource: {
            "available": True,
            "status": "AVAILABLE",
            "state": {"pump_runtime_min": 12.0},
        },
    )

    with SessionLocal() as db:
        result = agent.investigate_anomaly(41, db)

    assert result["probes_taken"]
    assert result["probes_taken"][0]["tool"] == "get_equipment_state"
    assert any(item["source"] == "tool:get_equipment_state" for item in result["supporting_evidence"])
    assert "equipment_state" not in {item["signal"] for item in result["unknowns"]}


def test_probe_limit_is_never_exceeded(monkeypatch) -> None:
    monkeypatch.setattr(
        agent.tools,
        "get_investigation_context",
        lambda db, anomaly_id: _context_result(resource="ENERGY"),
    )
    monkeypatch.setattr(
        agent,
        "_choose_probe",
        lambda state: ("get_equipment_state", {}) if not state["probes_taken"] else ("get_building_context", {}),
    )
    monkeypatch.setattr(
        agent.tools,
        "get_equipment_state",
        lambda db, building_id, resource: {"available": True, "status": "AVAILABLE", "state": {"hvac_runtime_min": 10.0}},
    )
    monkeypatch.setattr(
        agent.tools,
        "get_building_context",
        lambda db, building_id: {"available": True, "status": "AVAILABLE", "building": {"id": building_id}},
    )

    with SessionLocal() as db:
        result = agent.investigate_anomaly(41, db, max_probes=3)

    assert len(result["probes_taken"]) <= 3


def test_same_probe_is_not_executed_twice() -> None:
    state = {
        "resource": "WATER",
        "unknowns": [{"signal": "equipment_state", "label": "Equipment state"}],
        "hypotheses": [{"name": "Pump over-run", "status": "UNKNOWN"}],
        "usage_summary": {"observed_usage": 1, "expected_usage": 1, "deviation_from_expected_pct": 0},
        "probes_taken": [{"tool": "get_equipment_state"}],
    }

    assert agent._choose_probe(state) is None


def test_existing_anomaly_cause_fields_are_not_modified() -> None:
    with SessionLocal() as db:
        before = db.get(agent.tools.Anomaly, 4)
        cause_code = before.cause_code
        probable_cause = before.probable_cause
        agent.investigate_anomaly(4, db)
        db.expire_all()
        after = db.get(agent.tools.Anomaly, 4)

    assert after.cause_code == cause_code
    assert after.probable_cause == probable_cause


def test_contradictory_evidence_is_preserved(monkeypatch) -> None:
    monkeypatch.setattr(
        agent.tools,
        "get_investigation_context",
        lambda db, anomaly_id: _context_result(
            context={
                "resource_type": "WATER",
                "night_flow_ratio": 1.0,
                "flow_persistence": 0.0,
                "occupancy_pct": 80.0,
                "occupancy_ratio": 1.7,
                "pump_ratio": 1.0,
            }
        ),
    )

    with SessionLocal() as db:
        result = agent.investigate_anomaly(41, db, max_probes=0)

    assert any(item.get("hypothesis") == "Water leakage" for item in result["contradictions"])


def test_sufficient_evidence_stops_without_tool_calls(monkeypatch) -> None:
    monkeypatch.setattr(
        agent.tools,
        "get_investigation_context",
        lambda db, anomaly_id: _context_result(
            context={
                "resource_type": "WATER",
                "night_flow_ratio": 2.2,
                "flow_persistence": 0.8,
                "occupancy_pct": 5.0,
                "occupancy_ratio": 0.5,
                "pump_ratio": 1.0,
                "tank_level": 50.0,
                "tds": 300.0,
                "flow": 100.0,
                "equipment_state": {"pump": "OFF"},
                "operating_hours": "08:00-18:00",
            }
        ),
    )

    with SessionLocal() as db:
        result = agent.investigate_anomaly(41, db)

    assert result["probes_taken"] == []
    assert result["next_probe"] is None
