"""Tests for deterministic investigation evidence enrichment."""
from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parents[1] / "backend"))

from app.services.investigation.recommendation_evidence import (  # noqa: E402
    normalize_investigation_evidence,
)
from app.services.investigation.investigator import investigate  # noqa: E402
from ml.recommendations import build_recommendation  # noqa: E402
from ml.root_cause import CAUSE_PUMP, Diagnosis  # noqa: E402


def _investigation() -> dict:
    return {
        "hypotheses": [
            {"name": "Pump over-run", "status": "SUPPORTED"},
            {"name": "Water leakage", "status": "CONTRADICTED"},
        ],
        "supporting_evidence": [
            {
                "label": "Pump runtime relative to reference",
                "value": 4.25,
                "meaning": "Pump runtime is elevated relative to its reference.",
                "hypothesis": "Pump over-run",
            },
            {
                "label": "TDS",
                "value": 420.0,
                "meaning": "Contextual signal only; not proof of leakage",
            },
        ],
        "contradictions": [
            {
                "label": "Night-time flow relative to reference",
                "value": 1.0,
                "meaning": "Normal night flow weakens leakage.",
                "hypothesis": "Water leakage",
            }
        ],
        "unknowns": [
            {
                "signal": "tank_level",
                "label": "Tank level",
                "status": "UNKNOWN",
                "why_it_matters": "Check tank-level trend.",
            }
        ],
    }


def test_supported_evidence_is_normalized_without_changing_cause() -> None:
    evidence = normalize_investigation_evidence(_investigation())

    pump = next(item for item in evidence if item.get("hypothesis") == "Pump over-run")
    assert pump == {
        "source": "investigation",
        "category": "supporting",
        "status": "SUPPORTED",
        "hypothesis": "Pump over-run",
        "description": "Pump runtime is elevated relative to its reference.",
        "measured_value": 4.25,
    }


def test_contradiction_is_preserved_and_not_promoted() -> None:
    evidence = normalize_investigation_evidence(_investigation())

    contradiction = next(item for item in evidence if item["category"] == "contradiction")
    assert contradiction["hypothesis"] == "Water leakage"
    assert contradiction["status"] == "CONTRADICTED"
    assert not any(
        item.get("category") == "supporting" and item.get("hypothesis") == "Water leakage"
        for item in evidence
    )


def test_unknowns_remain_unknown_without_a_fabricated_value() -> None:
    evidence = normalize_investigation_evidence(_investigation())

    unknown = next(item for item in evidence if item["category"] == "unknown")
    assert unknown["status"] == "UNKNOWN"
    assert unknown["signal"] == "tank_level"
    assert "measured_value" not in unknown


def test_tds_remains_contextual_only() -> None:
    evidence = normalize_investigation_evidence(_investigation())

    tds = next(item for item in evidence if item.get("description", "").startswith("Contextual signal"))
    assert tds["category"] == "supporting"
    assert tds["measured_value"] == 420.0
    assert "leak" not in tds.get("hypothesis", "").lower()


def test_empty_or_missing_sections_are_safe() -> None:
    assert normalize_investigation_evidence({}) == []


def test_deterministic_enrichment_does_not_invoke_llm_reasoner(monkeypatch) -> None:
    def fail_if_called(*args, **kwargs):
        raise AssertionError("LLM reasoner must not be used for deterministic enrichment")

    from app.services.investigation import reasoning

    monkeypatch.setattr(reasoning, "reason_about", fail_if_called)
    result = investigate(
        {
            "resource_type": "WATER",
            "actual_value": 140.0,
            "expected_value": 100.0,
            "deviation_pct": 40.0,
        },
        {"resource_type": "WATER", "pump_ratio": 1.8, "occupancy_pct": 10.0},
    )

    assert normalize_investigation_evidence(result)


def test_existing_recommendation_template_and_cause_selection_are_unchanged() -> None:
    diagnosis = Diagnosis(
        cause_code=CAUSE_PUMP,
        probable_cause="Pump operation inefficiency",
        affected_subsystem="Pumping",
        confidence=0.8,
        narrative="The pump is running beyond its normal duty.",
    )
    anomaly = SimpleNamespace(
        resource_type="WATER",
        severity="HIGH",
        occurrence_days=1,
        excess_total=100.0,
    )
    context = {
        "weekly_excess": 100.0,
        "hours": [0, 1, 2],
        "pump_runtime": 50.0,
        "pump_reference": 20.0,
        "offhours_share": 1.0,
    }

    draft = build_recommendation(
        diagnosis,
        context,
        anomaly,
        electricity_tariff=0.2,
        water_tariff_per_kl=1.0,
        grid_emission_factor=0.4,
        water_emission_factor=0.1,
    )

    assert draft.target_fault_code == "PUMP_OVERRUN"
    assert draft.title == "Re-tune the booster pump control"
