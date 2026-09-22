"""Mocked LLM-boundary tests for the investigation agent."""
from __future__ import annotations

import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "backend"))

from app.database import SessionLocal  # noqa: E402
from app.services import llm  # noqa: E402
from app.services.investigation import agent  # noqa: E402
from app.services.investigation import reasoning  # noqa: E402
from app.services.investigation.reasoning import InvestigationDecision  # noqa: E402


def _context_result(context: dict | None = None) -> dict:
    return {
        "available": True,
        "status": "AVAILABLE",
        "anomaly": {
            "id": 41,
            "building_id": 4,
            "resource_type": "WATER",
            "actual_value": 140.0,
            "expected_value": 100.0,
            "deviation_pct": 40.0,
            "unit": "L",
        },
        "context": context or {
            "resource_type": "WATER",
            "night_flow_ratio": 1.0,
            "flow_persistence": 0.0,
            "occupancy_pct": 10.0,
            "occupancy_ratio": 0.8,
            "pump_ratio": 1.0,
            "operating_hours": "08:00-18:00",
        },
    }


def _historical_result() -> dict:
    return {
        "available": True,
        "status": "AVAILABLE",
        "readings": [{"ts": "2026-09-21T00:00:00", "flow_lph": 20.0}],
    }


def _install_context(monkeypatch, context: dict | None = None) -> None:
    monkeypatch.setattr(
        agent.tools,
        "get_investigation_context",
        lambda db, anomaly_id: _context_result(context),
    )


def _install_fake_gemini(monkeypatch, response, key: str) -> None:
    class Messages:
        def generate_content(self, **kwargs):
            return response

    class Client:
        def __init__(self, **kwargs):
            self.models = Messages()

    fake_genai = types.ModuleType("google.genai")
    fake_genai.Client = Client
    fake_genai.types = types.SimpleNamespace(
        GenerateContentConfig=lambda **kwargs: kwargs
    )
    fake_google = types.ModuleType("google")
    fake_google.genai = fake_genai
    monkeypatch.setitem(sys.modules, "google", fake_google)
    monkeypatch.setitem(sys.modules, "google.genai", fake_genai)
    monkeypatch.setattr(reasoning.llm.settings, "gemini_api_key", key)
    monkeypatch.setattr(reasoning.llm.settings, "gemini_model", "gemini-test")


def test_configured_provider_response_is_parsed_as_structured_decision(monkeypatch) -> None:
    response = types.SimpleNamespace(
        text='{"reasoning":"Need flow history","hypothesis_focus":"Water leakage","requested_tool":"get_historical_readings","tool_arguments":{"hours":24},"confidence":"medium","stop":false}',
        candidates=[types.SimpleNamespace(finish_reason=types.SimpleNamespace(name="STOP"))],
    )
    _install_fake_gemini(monkeypatch, response, "test-key-stop")

    original_parse = reasoning._parse_json
    monkeypatch.setattr(
        reasoning,
        "_parse_json",
        lambda text: original_parse(text),
    )

    decision = reasoning.reason_about(
        {"unknowns": [{"signal": "flow", "status": "UNKNOWN"}]},
        list(agent.ALLOWED_TOOLS),
    )

    assert decision is not None
    assert decision.requested_tool == "get_historical_readings"
    assert decision.tool_arguments == {"hours": 24}


def test_max_tokens_returns_none_without_json_parsing(monkeypatch) -> None:
    response = types.SimpleNamespace(
        text='{"reasoning":"incomplete',
        candidates=[types.SimpleNamespace(finish_reason=types.SimpleNamespace(name="MAX_TOKENS"))],
    )
    _install_fake_gemini(monkeypatch, response, "test-key-max-tokens")
    monkeypatch.setattr(
        reasoning,
        "_parse_json",
        lambda text: (_ for _ in ()).throw(AssertionError("JSON was parsed")),
    )

    assert reasoning.reason_about({}, list(agent.ALLOWED_TOOLS)) is None


def test_missing_finish_reason_returns_none_without_json_parsing(monkeypatch) -> None:
    response = types.SimpleNamespace(text='{}', candidates=[])
    _install_fake_gemini(monkeypatch, response, "test-key-missing-finish")
    monkeypatch.setattr(
        reasoning,
        "_parse_json",
        lambda text: (_ for _ in ()).throw(AssertionError("JSON was parsed")),
    )

    assert reasoning.reason_about({}, list(agent.ALLOWED_TOOLS)) is None


def test_malformed_json_with_stop_uses_existing_fallback(monkeypatch) -> None:
    response = types.SimpleNamespace(
        text='{"reasoning":"unterminated',
        candidates=[types.SimpleNamespace(finish_reason=types.SimpleNamespace(name="STOP"))],
    )
    _install_fake_gemini(monkeypatch, response, "test-key-malformed-json")

    assert reasoning.reason_about({}, list(agent.ALLOWED_TOOLS)) is None


def test_valid_llm_tool_request_is_executed_after_validation(monkeypatch) -> None:
    _install_context(monkeypatch)
    monkeypatch.setattr(agent.tools, "get_historical_readings", lambda *args: _historical_result())

    def reasoner(state, allowed_tools):
        assert "get_historical_readings" in allowed_tools
        return InvestigationDecision(
            reasoning="Historical flow reduces uncertainty.",
            hypothesis_focus="Water leakage",
            requested_tool="get_historical_readings",
            tool_arguments={"hours": 12},
            confidence="medium",
        )

    with SessionLocal() as db:
        result = agent.investigate_anomaly(41, db, reasoner=reasoner, max_probes=1)

    assert result["probes_taken"][0]["tool"] == "get_historical_readings"
    assert result["probes_taken"][0]["selector"] == "llm"
    assert result["probes_taken"][0]["arguments"] == {"hours": 12}


def test_invalid_tool_name_is_recorded_and_deterministic_fallback_runs(monkeypatch) -> None:
    _install_context(monkeypatch)
    monkeypatch.setattr(agent.tools, "get_historical_readings", lambda *args: _historical_result())

    with SessionLocal() as db:
        result = agent.investigate_anomaly(
            41,
            db,
            reasoner=lambda state, allowed: InvestigationDecision(
                requested_tool="delete_database", tool_arguments={}
            ),
            max_probes=1,
        )

    assert any(event["type"] == "invalid_llm_request" for event in result["events"])
    assert result["probes_taken"][0]["selector"] == "deterministic"


def test_invalid_arguments_are_not_executed(monkeypatch) -> None:
    _install_context(monkeypatch)
    calls = []
    monkeypatch.setattr(agent.tools, "get_historical_readings", lambda *args: calls.append(args) or _historical_result())

    with SessionLocal() as db:
        result = agent.investigate_anomaly(
            41,
            db,
            reasoner=lambda state, allowed: InvestigationDecision(
                requested_tool="get_historical_readings", tool_arguments={"hours": 0}
            ),
            max_probes=1,
        )

    assert any(event["type"] == "invalid_llm_request" for event in result["events"])
    assert calls == []


def test_duplicate_probe_request_is_rejected(monkeypatch) -> None:
    _install_context(monkeypatch)
    monkeypatch.setattr(agent.tools, "get_historical_readings", lambda *args: _historical_result())
    calls = {"count": 0}

    def reasoner(state, allowed):
        calls["count"] += 1
        return InvestigationDecision(
            requested_tool="get_historical_readings", tool_arguments={"hours": 12}
        )

    with SessionLocal() as db:
        result = agent.investigate_anomaly(41, db, reasoner=reasoner, max_probes=2)

    assert len(result["probes_taken"]) <= 2
    assert len({probe["tool"] for probe in result["probes_taken"]}) == len(result["probes_taken"])
    assert any("already been executed" in event.get("reason", "") for event in result["events"])
    assert calls["count"] >= 2


def test_maximum_probe_limit_is_preserved(monkeypatch) -> None:
    _install_context(monkeypatch)
    monkeypatch.setattr(agent.tools, "get_historical_readings", lambda *args: _historical_result())
    monkeypatch.setattr(agent.tools, "get_equipment_state", lambda *args: {"available": True, "status": "AVAILABLE", "state": {"pump_runtime_min": 10.0}})

    def reasoner(state, allowed):
        choices = ["get_historical_readings", "get_equipment_state", "get_building_context"]
        return InvestigationDecision(
            requested_tool=choices[len(state["probes_taken"])],
            tool_arguments={"hours": 12} if len(state["probes_taken"]) == 0 else {},
        )

    monkeypatch.setattr(agent.tools, "get_building_context", lambda *args: {"available": True, "status": "AVAILABLE", "building": {"id": 4}})
    with SessionLocal() as db:
        result = agent.investigate_anomaly(41, db, reasoner=reasoner, max_probes=3)

    assert len(result["probes_taken"]) == 3


def test_llm_receives_and_preserves_contradictions(monkeypatch) -> None:
    _install_context(
        monkeypatch,
        {
            "resource_type": "WATER",
            "night_flow_ratio": 1.0,
            "flow_persistence": 0.0,
            "occupancy_pct": 80.0,
            "occupancy_ratio": 1.7,
            "pump_ratio": 1.0,
            "operating_hours": "08:00-18:00",
        },
    )
    observed = {}

    def reasoner(state, allowed):
        observed["contradictions"] = state["contradictions"]
        return InvestigationDecision(stop=True, reasoning="Contradictions remain material.")

    with SessionLocal() as db:
        result = agent.investigate_anomaly(41, db, reasoner=reasoner)

    assert observed["contradictions"]
    assert result["contradictions"] == observed["contradictions"]


def test_llm_cannot_fabricate_telemetry_into_state(monkeypatch) -> None:
    _install_context(monkeypatch)

    with SessionLocal() as db:
        result = agent.investigate_anomaly(
            41,
            db,
            reasoner=lambda state, allowed: InvestigationDecision(
                reasoning="Claiming a tank value would be unsafe.", stop=True
            ),
        )

    assert "tank_level" in {item["signal"] for item in result["unknowns"]}
    assert not any(item.get("label") == "Tank level" for item in result["supporting_evidence"])


def test_llm_failure_falls_back_to_deterministic_selection(monkeypatch) -> None:
    _install_context(monkeypatch)
    monkeypatch.setattr(agent.tools, "get_historical_readings", lambda *args: _historical_result())

    def failing_reasoner(state, allowed):
        raise TimeoutError("mock timeout")

    with SessionLocal() as db:
        result = agent.investigate_anomaly(41, db, reasoner=failing_reasoner, max_probes=1)

    assert any(event["type"] == "llm_failure" for event in result["events"])
    assert result["probes_taken"][0]["selector"] == "deterministic"


def test_no_api_key_keeps_deterministic_investigation(monkeypatch) -> None:
    _install_context(monkeypatch)
    monkeypatch.setattr(agent.tools, "get_historical_readings", lambda *args: _historical_result())
    monkeypatch.setattr(llm.settings, "llm_api_key", "", raising=False)

    with SessionLocal() as db:
        result = agent.investigate_anomaly(41, db, max_probes=1)

    assert result["probes_taken"]
    assert any(event["type"] == "llm_fallback" for event in result["events"])
