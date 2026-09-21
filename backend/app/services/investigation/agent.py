"""Deterministic investigation orchestration.

This is a small, inspectable controller for the investigation tools. It is
deliberately not an agent powered by a model: probe selection is a fixed rule
table and every measured value remains owned by the tool that returned it.
"""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Callable

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.orm import Session

from . import tools
from .investigator import investigate
from .reasoning import InvestigationDecision, reason_about

MAX_PROBES = 3
ALLOWED_TOOLS = (
    "get_latest_telemetry",
    "get_historical_readings",
    "get_building_context",
    "get_equipment_state",
    "compare_with_baseline",
)


class _NoToolArguments(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _HoursArguments(BaseModel):
    model_config = ConfigDict(extra="forbid")

    hours: int = Field(ge=1, le=168)


TOOL_ARGUMENT_MODELS = {
    "get_latest_telemetry": _NoToolArguments,
    "get_historical_readings": _HoursArguments,
    "get_building_context": _NoToolArguments,
    "get_equipment_state": _NoToolArguments,
    "compare_with_baseline": _HoursArguments,
}


def _hypothesis(state: Mapping[str, Any], name: str) -> dict[str, Any] | None:
    return next((item for item in state["hypotheses"] if item["name"] == name), None)


def _has_probe(state: Mapping[str, Any], name: str) -> bool:
    return any(probe["tool"] == name for probe in state["probes_taken"])


def _tool_evidence(tool_name: str, result: Mapping[str, Any]) -> dict[str, Any]:
    """Preserve returned tool data as tool-sourced evidence."""
    if not result.get("available", False):
        return {
            "label": tool_name,
            "value": result.get("reason"),
            "source": f"tool:{tool_name}",
            "meaning": "Tool result unavailable; no measurement was inferred.",
        }
    return {
        "label": tool_name,
        "value": {key: value for key, value in result.items() if key not in {"available", "status"}},
        "source": f"tool:{tool_name}",
        "meaning": "Measured/contextual data returned by an existing EcoTwin tool.",
    }


def _remove_resolved_unknowns(
    unknowns: list[dict[str, Any]], tool_name: str, result: Mapping[str, Any]
) -> list[dict[str, Any]]:
    if not result.get("available", False):
        return unknowns
    resolved: set[str] = set()
    if tool_name == "get_equipment_state":
        resolved.add("equipment_state")
    elif tool_name == "get_building_context":
        resolved.add("operating_context")
    elif tool_name == "get_historical_readings":
        readings = result.get("readings", [])
        if any(reading.get("flow_lph") is not None for reading in readings):
            resolved.add("flow")
        if any(reading.get("tds") is not None for reading in readings):
            resolved.add("tds")
    return [item for item in unknowns if item.get("signal") not in resolved]


def _choose_probe(state: Mapping[str, Any]) -> tuple[str, dict[str, Any]] | None:
    """Select the next unique, useful tool call using explicit rules."""
    resource = state["resource"]
    unknown_signals = {item.get("signal") for item in state["unknowns"]}
    leakage = _hypothesis(state, "Water leakage")
    pump = _hypothesis(state, "Pump over-run")
    hvac = _hypothesis(state, "HVAC over-run")
    lighting = _hypothesis(state, "Lighting over-run")

    if resource == "WATER" and leakage and leakage["status"] in {"SUPPORTED", "WEAK"}:
        if not _has_probe(state, "get_historical_readings"):
            return "get_historical_readings", {"hours": 24}

    equipment_relevant = any(
        hypothesis and hypothesis["status"] in {"SUPPORTED", "WEAK", "UNKNOWN"}
        for hypothesis in (leakage, pump, hvac, lighting)
    )
    if "equipment_state" in unknown_signals and equipment_relevant:
        if not _has_probe(state, "get_equipment_state"):
            return "get_equipment_state", {}

    usage = state["usage_summary"]
    if any(usage.get(key) is None for key in ("observed_usage", "expected_usage", "deviation_from_expected_pct")):
        if not _has_probe(state, "compare_with_baseline"):
            return "compare_with_baseline", {"hours": 24}

    if "operating_context" in unknown_signals and not _has_probe(state, "get_building_context"):
        return "get_building_context", {}

    if resource == "WATER" and "flow" in unknown_signals and not _has_probe(state, "get_historical_readings"):
        return "get_historical_readings", {"hours": 24}

    return None


def _call_tool(
    db: Session,
    tool_name: str,
    anomaly_id: int,
    resource: str,
    building_id: int,
    arguments: Mapping[str, Any],
) -> dict[str, Any]:
    tool: Callable[..., dict[str, Any]] = getattr(tools, tool_name)
    if tool_name == "get_historical_readings" or tool_name == "compare_with_baseline":
        return tool(db, building_id, resource, int(arguments["hours"]))
    if tool_name in {"get_latest_telemetry", "get_equipment_state"}:
        return tool(db, building_id, resource)
    if tool_name == "get_building_context":
        return tool(db, building_id)
    raise ValueError(f"Unsupported investigation tool: {tool_name}")


def _validate_llm_request(
    decision: InvestigationDecision,
    state: Mapping[str, Any],
) -> tuple[str | None, dict[str, Any] | None, str | None, str | None]:
    """Validate untrusted model output before any tool execution."""
    if decision.stop:
        if decision.requested_tool is not None:
            return None, None, "stop=true cannot include requested_tool", "invalid_request"
        return None, None, None, None
    if decision.requested_tool not in ALLOWED_TOOLS:
        return None, None, "requested_tool is not in the investigation allowlist", "unknown_tool"
    if _has_probe(state, decision.requested_tool):
        return None, None, "requested probe has already been executed", "duplicate_probe"
    model = TOOL_ARGUMENT_MODELS[decision.requested_tool]
    try:
        arguments = model.model_validate(decision.tool_arguments).model_dump()
    except ValidationError as exc:
        return None, None, f"invalid arguments: {exc.errors()}", "invalid_arguments"
    return decision.requested_tool, arguments, None, None


def _reasoning_state(state: Mapping[str, Any]) -> dict[str, Any]:
    """Expose only structured state, never sessions, ORM objects, or callables."""
    return {key: value for key, value in state.items() if not key.startswith("_")}


def _evidence_is_sufficient(state: Mapping[str, Any]) -> bool:
    """Stop before probing when a supported explanation has no open unknowns."""
    has_supported_hypothesis = any(
        hypothesis.get("status") == "SUPPORTED"
        for hypothesis in state["hypotheses"]
    )
    return has_supported_hypothesis and not state["unknowns"]


def _summary(state: Mapping[str, Any]) -> str:
    supported = [item["name"] for item in state["hypotheses"] if item["status"] == "SUPPORTED"]
    contradicted = [item["name"] for item in state["hypotheses"] if item["status"] == "CONTRADICTED"]
    parts = [
        f"Investigated anomaly {state['anomaly_id']} ({state['resource']}).",
        f"Completed {len(state['probes_taken'])} deterministic probe(s).",
    ]
    if supported:
        parts.append("Supported hypotheses: " + ", ".join(supported) + ".")
    if contradicted:
        parts.append("Contradicted hypotheses: " + ", ".join(contradicted) + ".")
    if state["unknowns"]:
        parts.append("Remaining unknowns: " + ", ".join(item["label"] for item in state["unknowns"]) + ".")
    else:
        parts.append("No investigation unknowns remain in the supplied tool context.")
    return " ".join(parts)


def investigate_anomaly(
    anomaly_id: int,
    db: Session,
    *,
    max_probes: int = MAX_PROBES,
    reasoner: Callable[[Mapping[str, Any], list[str]], InvestigationDecision | None] | None = None,
) -> dict[str, Any]:
    """Investigate one anomaly with deterministic, bounded tool selection."""
    limit = max(0, min(max_probes, MAX_PROBES))
    context_result = tools.get_investigation_context(db, anomaly_id)
    if not context_result.get("available", False):
        return {
            "anomaly_id": anomaly_id,
            "resource": None,
            "status": "BLOCKED",
            "hypotheses": [],
            "supporting_evidence": [],
            "contradictions": [],
            "unknowns": [],
            "probes_taken": [],
            "next_probe": None,
            "investigation_summary": context_result.get("reason", "Investigation context unavailable."),
        }

    anomaly = context_result["anomaly"]
    context = context_result["context"]
    initial = investigate(anomaly, context)
    state: dict[str, Any] = {
        "anomaly_id": anomaly_id,
        "resource": initial["resource_type"],
        "hypotheses": list(initial["hypotheses"]),
        "supporting_evidence": list(initial["supporting_evidence"]),
        "contradictions": list(initial["contradictions"]),
        "unknowns": list(initial["unknowns"]),
        "probes_taken": [],
        "next_probe": None,
        "usage_summary": initial["usage_summary"],
        "_building_context_available": bool(context.get("operating_hours")),
        "events": [],
    }
    if not state["_building_context_available"]:
        state["unknowns"].append({
            "signal": "operating_context",
            "label": "Operating context",
            "status": "UNKNOWN",
            "why_it_matters": "Check the building operating schedule for the affected interval.",
        })

    while len(state["probes_taken"]) < limit:
        if _evidence_is_sufficient(state):
            break
        try:
            decision = (
                reasoner(_reasoning_state(state), list(ALLOWED_TOOLS))
                if reasoner is not None
                else reason_about(_reasoning_state(state), list(ALLOWED_TOOLS))
            )
        except Exception as exc:  # noqa: BLE001 - probe safety requires fallback
            decision = None
            state["events"].append({
                "type": "llm_failure",
                "reason": f"LLM reasoning failed; deterministic probe selection used: {exc}",
            })
        choice: tuple[str, dict[str, Any]] | None = None
        if decision is None:
            state["events"].append({
                "type": "llm_fallback",
                "reason": "LLM unavailable or reasoning failed; deterministic probe selection used.",
            })
            choice = _choose_probe(state)
        else:
            requested_tool, arguments, validation_error, validation_kind = _validate_llm_request(decision, state)
            state["events"].append({
                "type": "llm_decision",
                "reasoning": decision.reasoning,
                "hypothesis_focus": decision.hypothesis_focus,
                "confidence": decision.confidence,
                "requested_tool": decision.requested_tool,
                "stop": decision.stop,
            })
            if validation_error:
                state["events"].append({
                    "type": "invalid_llm_request",
                    "reason": validation_error,
                })
                if validation_kind == "unknown_tool":
                    # An unknown name cannot be executed, but it does not
                    # prevent the safe deterministic selector from choosing a
                    # different allowed probe.
                    choice = _choose_probe(state)
                else:
                    # Invalid arguments, duplicate probes, and malformed
                    # request combinations stop safely without substitution.
                    break
            elif requested_tool is None:
                break
            else:
                choice = (requested_tool, arguments or {})
        if choice is None:
            break
        tool_name, arguments = choice
        result = _call_tool(
            db,
            tool_name,
            anomaly_id,
            state["resource"],
            int(anomaly["building_id"]),
            arguments,
        )
        state["probes_taken"].append({
            "tool": tool_name,
            "arguments": dict(arguments),
            "status": result.get("status", "UNKNOWN"),
            "selector": "llm" if decision is not None and not validation_error else "deterministic",
        })
        state["supporting_evidence"].append(_tool_evidence(tool_name, result))
        state["unknowns"] = _remove_resolved_unknowns(state["unknowns"], tool_name, result)

    next_choice = None if _evidence_is_sufficient(state) else _choose_probe(state)
    if next_choice is not None:
        state["next_probe"] = {"tool": next_choice[0], "arguments": next_choice[1]}
    if len(state["probes_taken"]) >= limit and next_choice is not None:
        status = "MAX_PROBES_REACHED"
    else:
        status = "COMPLETE"

    state["status"] = status
    state["investigation_summary"] = _summary(state)
    state.pop("usage_summary", None)
    state.pop("_building_context_available", None)
    return state


__all__ = ["MAX_PROBES", "investigate_anomaly"]
