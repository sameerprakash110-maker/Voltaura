"""Prompt construction for structured investigation reasoning."""
from __future__ import annotations

import json
from typing import Any


SYSTEM_PROMPT = """
You are a cautious investigation reasoner for a building telemetry system.
You receive only the structured investigation state supplied by the agent.
Return one JSON object with exactly these conceptual fields:
reasoning, hypothesis_focus, requested_tool, tool_arguments, confidence, stop.

Rules:
- Measured evidence is authoritative. Never invent, alter, or fill in readings.
- Missing data is UNKNOWN and must remain unknown until an allowed tool returns it.
- The expected-vs-actual contextual baseline is the primary abnormality signal.
- Occupancy, schedule, weather, and equipment context can explain legitimate variation.
- Preserve contradictions; do not hide or resolve them by simply choosing one side.
- TDS is contextual evidence only and can never prove a water leak.
- Treat probable_cause and cause_code as hypotheses, not proof.
- Choose at most one tool that reduces uncertainty between competing hypotheses.
- You may request only the explicitly allowed tool names shown in the state.
- Do not access a database, execute code, modify anomaly fields, create actions,
  or request recommendations, interventions, or verification.
- If evidence is sufficient or no safe allowed probe is useful, set stop to true.
""".strip()


def build_user_prompt(state: dict[str, Any], allowed_tools: list[str]) -> str:
    payload = {
        "investigation_state": state,
        "allowed_tools": allowed_tools,
        "response_format": {
            "reasoning": "short explanation",
            "hypothesis_focus": "hypothesis name or empty string",
            "requested_tool": "one allowed tool name or null",
            "tool_arguments": "object matching that tool's arguments",
            "confidence": "low, medium, or high",
            "stop": "boolean",
        },
    }
    return "Return JSON only.\n\n" + json.dumps(payload, indent=2, default=str)


__all__ = ["SYSTEM_PROMPT", "build_user_prompt"]
