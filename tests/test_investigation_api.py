"""Focused API checks for the read-only investigation endpoint."""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parents[1] / "backend"))

from app.main import app  # noqa: E402


def test_anomaly_4_returns_investigation() -> None:
    with TestClient(app) as client:
        response = client.get("/api/anomalies/4/investigation")

    assert response.status_code == 200
    payload = response.json()
    assert payload["resource"] == "WATER"
    assert payload["hypotheses"]


def test_investigation_response_contains_expected_sections() -> None:
    with TestClient(app) as client:
        response = client.get("/api/anomalies/4/investigation")

    assert response.status_code == 200
    assert {
        "resource",
        "usage_summary",
        "hypotheses",
        "supporting_evidence",
        "contradictions",
        "unknowns",
        "next_probe",
    } <= response.json().keys()


def test_nonexistent_anomaly_uses_normal_404_response() -> None:
    with TestClient(app) as client:
        response = client.get("/api/anomalies/999999/investigation")

    assert response.status_code == 404
    assert response.json()["detail"] == "Anomaly 999999 not found."


def test_agent_investigation_returns_agent_fields() -> None:
    with TestClient(app) as client:
        response = client.get("/api/anomalies/4/investigation/agent")

    assert response.status_code == 200
    payload = response.json()
    assert payload["anomaly_id"] == 4
    assert payload["resource"] == "WATER"
    assert "probes_taken" in payload
    assert "events" in payload
    assert "investigation_summary" in payload


def test_agent_investigation_nonexistent_anomaly_uses_normal_404() -> None:
    with TestClient(app) as client:
        response = client.get("/api/anomalies/999999/investigation/agent")

    assert response.status_code == 404
    assert response.json()["detail"] == "Anomaly 999999 not found."


def test_agent_investigation_without_llm_uses_deterministic_fallback() -> None:
    with TestClient(app) as client:
        response = client.get("/api/anomalies/4/investigation/agent")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] in {"COMPLETE", "MAX_PROBES_REACHED"}
    assert payload["probes_taken"]
    assert any(event["type"] == "llm_fallback" for event in payload["events"])
