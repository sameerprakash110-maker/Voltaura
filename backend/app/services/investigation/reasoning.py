"""Optional structured LLM reasoning for investigation probe selection."""
from __future__ import annotations

import json
import logging
from collections.abc import Mapping
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from .. import llm
from .prompt import SYSTEM_PROMPT, build_user_prompt

logger = logging.getLogger("voltaura.investigation.reasoning")


class InvestigationDecision(BaseModel):
    """Untrusted model output before agent-side tool validation."""

    model_config = ConfigDict(extra="forbid")

    reasoning: str = ""
    hypothesis_focus: str = ""
    requested_tool: str | None = None
    tool_arguments: dict[str, Any] = Field(default_factory=dict)
    confidence: str | float | None = None
    stop: bool = False


def _response_text(response: Any) -> str:
    return "\n".join(
        block.text
        for block in response.content
        if getattr(block, "type", None) == "text"
    ).strip()


def _gemini_response_text(response: Any) -> str:
    return str(getattr(response, "text", "") or "").strip()


def _parse_json(text: str) -> InvestigationDecision:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.startswith("json"):
            cleaned = cleaned[4:].lstrip()
    return InvestigationDecision.model_validate(json.loads(cleaned))


def reason_about(
    state: Mapping[str, Any],
    allowed_tools: list[str],
) -> InvestigationDecision | None:
    """Ask the configured provider for a proposal, or return ``None`` safely."""
    if not llm.settings.gemini_available:
        return None
    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=llm.settings.gemini_api_key)
        response = client.models.generate_content(
            model=llm.settings.gemini_model,
            contents=build_user_prompt(dict(state), allowed_tools),
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                max_output_tokens=500,
                response_mime_type="application/json",
            ),
        )
        return _parse_json(_gemini_response_text(response))
    except Exception as exc:  # noqa: BLE001 - deterministic fallback is required
        logger.warning("Investigation reasoning failed (%s); using deterministic rules", exc)
        return None


__all__ = ["InvestigationDecision", "reason_about"]
