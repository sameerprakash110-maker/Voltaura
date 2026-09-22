"""Deterministic, evidence-first investigation of an existing anomaly.

This module deliberately sits after anomaly detection and root-cause analysis.
It consumes their outputs; it does not load telemetry, fit a baseline, persist
state, call an LLM, or recalculate root-cause features.
"""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any


SUPPORTED_STATUSES = {"SUPPORTED", "WEAK", "CONTRADICTED", "UNKNOWN"}


def _get(data: Mapping[str, Any], key: str) -> Any:
    value = data.get(key)
    return None if value is None else value


def _evidence(
    label: str,
    value: Any,
    source: str,
    *,
    meaning: str = "",
    hypothesis: str | None = None,
) -> dict[str, Any]:
    item: dict[str, Any] = {
        "label": label,
        "value": value,
        "source": source,
    }
    if meaning:
        item["meaning"] = meaning
    if hypothesis:
        item["hypothesis"] = hypothesis
    return item


def _hypothesis(name: str, status: str, confidence: float, reasoning: str) -> dict[str, Any]:
    if status not in SUPPORTED_STATUSES:
        raise ValueError(f"Unsupported hypothesis status: {status}")
    return {
        "name": name,
        "status": status,
        "confidence": round(max(0.0, min(confidence, 1.0)), 2),
        "reasoning": reasoning,
    }


def _ratio(context: Mapping[str, Any], key: str) -> float | None:
    value = _get(context, key)
    return float(value) if isinstance(value, (int, float)) else None


def _number(context: Mapping[str, Any], key: str) -> float | None:
    """Read an absolute numeric context value without implying a ratio."""
    value = _get(context, key)
    return float(value) if isinstance(value, (int, float)) else None


def _usage_summary(anomaly: Mapping[str, Any], context: Mapping[str, Any]) -> dict[str, Any]:
    """Expose usage facts without treating absolute usage as fault evidence."""
    observed = _get(anomaly, "actual_value")
    if observed is None:
        observed = _get(context, "actual_mean")
    expected = _get(anomaly, "expected_value")
    if expected is None:
        expected = _get(context, "expected_mean")
    deviation = _get(anomaly, "deviation_pct")
    if deviation is None:
        deviation = _get(context, "deviation_pct")

    result: dict[str, Any] = {}
    if observed is not None:
        result["observed_usage"] = observed
    if expected is not None:
        result["expected_usage"] = expected
    if deviation is not None:
        result["deviation_from_expected_pct"] = deviation
    unit = _get(anomaly, "unit")
    if unit is not None:
        result["unit"] = unit
    result["interpretation"] = (
        "Absolute usage is not treated as fault evidence; the investigation "
        "uses the contextual expected-vs-actual deviation."
    )
    return result


def _common_evidence(
    anomaly: Mapping[str, Any], context: Mapping[str, Any]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    supporting: list[dict[str, Any]] = []
    contradictions: list[dict[str, Any]] = []

    for key, label in (
        ("actual_value", "Observed usage"),
        ("expected_value", "Expected usage"),
        ("deviation_pct", "Deviation from expected usage"),
    ):
        value = _get(anomaly, key)
        if value is not None:
            supporting.append(
                _evidence(label, value, "anomaly_record", meaning="Existing anomaly output")
            )

    if _get(anomaly, "actual_value") is None and _get(context, "actual_mean") is not None:
        supporting.append(_evidence("Observed usage", context["actual_mean"], "measured_context"))
    if _get(anomaly, "expected_value") is None and _get(context, "expected_mean") is not None:
        supporting.append(_evidence("Expected usage", context["expected_mean"], "measured_context"))
    if _get(anomaly, "deviation_pct") is None and _get(context, "deviation_pct") is not None:
        supporting.append(
            _evidence("Deviation from expected usage", context["deviation_pct"], "measured_context")
        )

    contextual = (
        ("occupancy_pct", "Occupancy during affected intervals"),
        ("occupancy_reference", "Reference occupancy"),
        ("occupancy_ratio", "Occupancy relative to reference"),
        ("outdoor_temperature", "Outdoor temperature"),
        ("outdoor_reference", "Reference outdoor temperature"),
        ("offhours_share", "Share of event outside operating hours"),
        ("hvac_ratio", "HVAC runtime relative to reference"),
        ("lighting_ratio", "Lighting runtime relative to reference"),
        ("pump_ratio", "Pump runtime relative to reference"),
        ("night_flow", "Night-time flow"),
        ("night_flow_reference", "Reference night-time flow"),
        ("night_flow_ratio", "Night-time flow relative to reference"),
        ("flow_persistence", "Flow persistence during low occupancy"),
    )
    for key, label in contextual:
        value = _get(context, key)
        if value is not None:
            supporting.append(
                _evidence(label, value, "measured_context", meaning="Existing derived context")
            )

    # Stored diagnosis is useful as a hypothesis source, but is never silently
    # promoted to measured proof.
    for key in ("cause_code", "probable_cause"):
        value = _get(anomaly, key)
        if value is not None:
            supporting.append(
                _evidence(
                    key.replace("_", " ").title(),
                    value,
                    "anomaly_record",
                    meaning="Existing diagnosis; treated as a hypothesis input",
                )
            )
    return supporting, contradictions


def _unknowns(context: Mapping[str, Any], resource: str) -> list[dict[str, Any]]:
    if resource != "WATER":
        candidates = (
            ("equipment_state", "Equipment state", "Check HVAC/lighting equipment state during affected intervals."),
            ("occupancy_validation", "Independent occupancy validation", "Verify occupancy against access-control or on-site records."),
        )
    else:
        candidates = (
            ("tank_level", "Tank level", "Check tank-level trend during the affected interval."),
            ("tds", "TDS", "Take a time-matched TDS reading; use it only as contextual evidence, never as leak proof."),
            ("flow", "Independent flow signal", "Verify continuous flow at the meter or downstream isolation points."),
            ("equipment_state", "Equipment state", "Check pump, valve, and controller state during the affected interval."),
        )
    result = []
    for key, label, use in candidates:
        if _get(context, key) is None:
            result.append({"signal": key, "label": label, "status": "UNKNOWN", "why_it_matters": use})
    return result


def investigate(
    anomaly: Mapping[str, Any],
    context: Mapping[str, Any],
) -> dict[str, Any]:
    """Return deterministic investigation state for an existing anomaly.

    ``anomaly`` is normally a serialized ``Anomaly``/``AnomalyOut`` and
    ``context`` is the result of ``ml.root_cause.build_context``. Both are
    mappings so this function is easy to test without a database or ORM.
    """
    resource = str(_get(anomaly, "resource_type") or _get(context, "resource_type") or "").upper()
    supporting, contradictions = _common_evidence(anomaly, context)
    deviation = _get(anomaly, "deviation_pct")
    if deviation is None:
        deviation = _get(context, "deviation_pct")
    deviation = float(deviation) if isinstance(deviation, (int, float)) else None

    hypotheses: list[dict[str, Any]] = []
    if resource == "WATER":
        night_ratio = _ratio(context, "night_flow_ratio")
        persistence = _ratio(context, "flow_persistence")
        occupancy = _ratio(context, "occupancy_pct")
        pump_ratio = _ratio(context, "pump_ratio")
        occupancy_ratio = _ratio(context, "occupancy_ratio")

        leak_positive = night_ratio is not None and persistence is not None and night_ratio >= 2 and persistence >= 0.6
        leak_contra = (occupancy is not None and occupancy >= 30) or (pump_ratio is not None and pump_ratio >= 1.5)
        leak_status = "SUPPORTED" if leak_positive and not leak_contra else "CONTRADICTED" if leak_contra else "WEAK" if night_ratio is not None or persistence is not None else "UNKNOWN"
        leak_conf = 0.85 if leak_status == "SUPPORTED" else 0.7 if leak_status == "CONTRADICTED" else 0.45 if leak_status == "WEAK" else 0.0
        hypotheses.append(_hypothesis("Water leakage", leak_status, leak_conf, "Night flow and persistence are evaluated against measured reference context; TDS is not proof."))

        if pump_ratio is not None and pump_ratio >= 1.5:
            pump_status, pump_conf = "SUPPORTED", 0.8
        elif pump_ratio is not None and pump_ratio < 1.3:
            pump_status, pump_conf = "CONTRADICTED", 0.7
        else:
            pump_status, pump_conf = "UNKNOWN", 0.0
        hypotheses.append(_hypothesis("Pump over-run", pump_status, pump_conf, "Pump runtime is compared with its existing contextual reference."))

        if occupancy_ratio is not None and occupancy_ratio >= 1.35:
            demand_status, demand_conf = "SUPPORTED", 0.8
        elif occupancy is not None and occupancy < 20:
            demand_status, demand_conf = "CONTRADICTED", 0.7
        else:
            demand_status, demand_conf = "UNKNOWN", 0.0
        hypotheses.append(_hypothesis("Occupancy-driven demand", demand_status, demand_conf, "High usage can be normal when measured occupancy explains the deviation."))
        if occupancy is not None and occupancy >= 30:
            contradictions.append(_evidence("Occupancy during affected intervals", occupancy, "measured_context", meaning="Weakens leakage as the sole explanation", hypothesis="Water leakage"))
        if pump_ratio is not None and pump_ratio < 1.3:
            contradictions.append(_evidence("Pump runtime relative to reference", pump_ratio, "measured_context", meaning="Normal pump runtime weakens pump over-run", hypothesis="Pump over-run"))
    else:
        hvac = _ratio(context, "hvac_ratio")
        lighting = _ratio(context, "lighting_ratio")
        outdoor = _number(context, "outdoor_temperature")
        outdoor_ref = _number(context, "outdoor_reference")
        occupancy_ratio = _ratio(context, "occupancy_ratio")
        offhours = _ratio(context, "offhours_share")

        occupancy_explains = occupancy_ratio is not None and occupancy_ratio >= 1.35
        weather_context_available = outdoor is not None and outdoor_ref is not None
        contextual_status = "SUPPORTED" if occupancy_explains else "UNKNOWN"
        contextual_confidence = 0.8 if occupancy_explains else 0.0
        contextual_reasoning = (
            "Measured occupancy explains part of the deviation; outdoor temperature "
            "is preserved as context and is not treated as a hard-coded diagnosis."
            if occupancy_explains
            else "Outdoor temperature is preserved as context, but the supplied data "
            "does not establish that weather explains the deviation."
        )
        if not weather_context_available and not occupancy_explains:
            contextual_reasoning = "The supplied context does not establish a weather or occupancy explanation."
        hypotheses.append(_hypothesis("Contextual demand (weather/occupancy)", contextual_status, contextual_confidence, contextual_reasoning))
        hypotheses.append(_hypothesis("HVAC over-run", "SUPPORTED" if hvac is not None and hvac >= 1.4 else "CONTRADICTED" if hvac is not None and hvac < 1.25 else "WEAK" if hvac is not None else "UNKNOWN", 0.8 if hvac is not None and hvac >= 1.4 else 0.7 if hvac is not None and hvac < 1.25 else 0.4 if hvac is not None else 0.0, "Requires excess relative to the existing contextual baseline and elevated HVAC runtime."))
        hypotheses.append(_hypothesis("Lighting over-run", "SUPPORTED" if lighting is not None and lighting >= 1.4 and (offhours is None or offhours >= 0.5) else "CONTRADICTED" if lighting is not None and lighting < 1.25 else "UNKNOWN", 0.75 if lighting is not None and lighting >= 1.4 else 0.7 if lighting is not None and lighting < 1.25 else 0.0, "Requires elevated lighting runtime rather than high absolute energy alone."))
        hypotheses.append(_hypothesis("Persistent unexplained deviation", "SUPPORTED" if deviation is not None and deviation > 0 and not occupancy_explains else "WEAK" if deviation is not None and deviation > 0 else "UNKNOWN", 0.7 if deviation is not None and deviation > 0 and not occupancy_explains else 0.35 if deviation is not None and deviation > 0 else 0.0, "The existing expected-vs-actual deviation is primary; contextual factors determine how much remains unexplained."))
        if occupancy_explains:
            contradictions.append(_evidence("Occupancy relative to reference", occupancy_ratio, "measured_context", meaning="Higher occupancy weakens a fault explanation"))

    unknowns = _unknowns(context, resource)
    if resource == "WATER" and _get(context, "tds") is not None:
        supporting.append(_evidence("TDS", context["tds"], "measured_context", meaning="Contextual signal only; not proof of leakage"))

    if unknowns:
        first_unknown = unknowns[0]
        next_probe = {
            "signal": first_unknown["signal"],
            "action": first_unknown["why_it_matters"],
            "purpose": "Reduce the leading uncertainty using a time-matched measured check.",
        }
    else:
        next_probe = {
            "action": "Review the time-aligned measured telemetry and compare the deviation with the existing contextual reference.",
            "purpose": "Reduce remaining uncertainty without changing the measured evidence.",
        }
    return {
        "resource_type": resource,
        "usage_summary": _usage_summary(anomaly, context),
        "hypotheses": hypotheses,
        "supporting_evidence": supporting,
        "contradictions": contradictions,
        "unknowns": unknowns,
        "next_probe": next_probe,
    }


__all__ = ["investigate", "SUPPORTED_STATUSES"]
