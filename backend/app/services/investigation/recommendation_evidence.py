"""Normalize deterministic investigation output for recommendation evidence."""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any


def _copy_measurement(item: Mapping[str, Any], result: dict[str, Any]) -> None:
    """Copy explicitly supplied measurements/references without deriving any."""
    if item.get("value") is not None:
        result["measured_value"] = item["value"]
    for key in ("reference", "baseline"):
        value = item.get(key)
        if value is None and isinstance(item.get("value"), Mapping):
            value = item["value"].get(key)
        if value is not None:
            result[key] = value


def _hypothesis_statuses(result: Mapping[str, Any]) -> dict[str, str]:
    return {
        str(item.get("name")): str(item.get("status"))
        for item in result.get("hypotheses", [])
        if item.get("name") and item.get("status")
    }


def normalize_investigation_evidence(
    investigation: Mapping[str, Any],
) -> list[dict[str, Any]]:
    """Return concise, recommendation-safe investigation evidence.

    This function only copies values present in the deterministic investigation
    result. It does not infer measurements, select a cause, or alter the
    existing root-cause evidence.
    """
    statuses = _hypothesis_statuses(investigation)
    normalized: list[dict[str, Any]] = []

    for item in investigation.get("supporting_evidence", []):
        if not isinstance(item, Mapping):
            continue
        hypothesis = item.get("hypothesis")
        evidence = {
            "source": "investigation",
            "category": "supporting",
            "status": statuses.get(str(hypothesis), "SUPPORTING") if hypothesis else "SUPPORTING",
            "description": item.get("meaning") or item.get("label") or "Measured investigation evidence",
        }
        if hypothesis:
            evidence["hypothesis"] = hypothesis
        _copy_measurement(item, evidence)
        normalized.append(evidence)

    for item in investigation.get("contradictions", []):
        if not isinstance(item, Mapping):
            continue
        evidence = {
            "source": "investigation",
            "category": "contradiction",
            "status": "CONTRADICTED",
            "description": item.get("meaning") or item.get("label") or "Contradictory investigation evidence",
        }
        if item.get("hypothesis"):
            evidence["hypothesis"] = item["hypothesis"]
        _copy_measurement(item, evidence)
        normalized.append(evidence)

    for item in investigation.get("unknowns", []):
        if not isinstance(item, Mapping):
            continue
        evidence: dict[str, Any] = {
            "source": "investigation",
            "category": "unknown",
            "status": str(item.get("status") or "UNKNOWN"),
            "description": item.get("why_it_matters") or item.get("label") or "Investigation evidence unavailable",
        }
        if item.get("signal"):
            evidence["signal"] = item["signal"]
        normalized.append(evidence)

    return normalized


__all__ = ["normalize_investigation_evidence"]
