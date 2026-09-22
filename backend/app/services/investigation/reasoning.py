"""Optional structured LLM reasoning for investigation probe selection."""
from __future__ import annotations

import json
import logging
import hashlib
from collections.abc import Mapping
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from .. import llm
from .prompt import SYSTEM_PROMPT, build_user_prompt

logger = logging.getLogger("ecotwin.investigation.reasoning")
_gemini_client: Any | None = None
_gemini_client_key_fingerprint: str | None = None


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


def _finish_reason_name(response: Any) -> str:
    candidates = getattr(response, "candidates", None)
    if not candidates:
        return "MISSING"
    finish_reason = getattr(candidates[0], "finish_reason", None)
    if finish_reason is None:
        return "MISSING"
    name = getattr(finish_reason, "name", None)
    if isinstance(name, str) and name:
        return name.upper()
    if isinstance(finish_reason, str) and finish_reason:
        return finish_reason.upper()
    return "UNKNOWN"


def _safe_exception_message(exc: Exception) -> str:
    message = str(exc)
    api_key = getattr(llm.settings, "gemini_api_key", "")
    if api_key:
        message = message.replace(api_key, "<redacted-api-key>")
    return message


def _log_phase_failure(phase: str, exc: Exception) -> None:
    logger.warning(
        "Gemini phase failed: %s (%s: %s)",
        phase,
        type(exc).__name__,
        _safe_exception_message(exc),
    )


def _parse_json(text: str) -> InvestigationDecision:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.startswith("json"):
            cleaned = cleaned[4:].lstrip()
    try:
        payload = json.loads(cleaned)
    except Exception as exc:  # noqa: BLE001 - provider output is untrusted
        _log_phase_failure("json_parsing", exc)
        raise
    try:
        return InvestigationDecision.model_validate(payload)
    except Exception as exc:  # noqa: BLE001 - provider output is untrusted
        _log_phase_failure("pydantic_validation", exc)
        raise


def _get_gemini_client() -> Any:
    global _gemini_client, _gemini_client_key_fingerprint
    key_fingerprint = hashlib.sha256(
        llm.settings.gemini_api_key.encode("utf-8")
    ).hexdigest()
    if _gemini_client is not None and _gemini_client_key_fingerprint == key_fingerprint:
        return _gemini_client

    try:
        from google import genai

        logger.debug("Gemini phase: client_initialization")
        _gemini_client = genai.Client(api_key=llm.settings.gemini_api_key)
        _gemini_client_key_fingerprint = key_fingerprint
        return _gemini_client
    except Exception as exc:  # noqa: BLE001 - deterministic fallback is required
        _log_phase_failure("client_initialization", exc)
        raise


def reason_about(
    state: Mapping[str, Any],
    allowed_tools: list[str],
) -> InvestigationDecision | None:
    """Ask the configured provider for a proposal, or return ``None`` safely."""
    if not llm.settings.gemini_available:
        return None
    try:
        from google.genai import types

        client = _get_gemini_client()
        prompt = build_user_prompt(dict(state), allowed_tools)
        config = types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            max_output_tokens=800,
            response_mime_type="application/json",
        )
        logger.debug("Gemini phase: before_generate_content")
        try:
            response = client.models.generate_content(
                model=llm.settings.gemini_model,
                contents=prompt,
                config=config,
            )
        except Exception as exc:  # noqa: BLE001 - deterministic fallback is required
            _log_phase_failure("generate_content", exc)
            raise
        logger.debug("Gemini phase: after_generate_content")
        finish_reason = _finish_reason_name(response)
        if finish_reason != "STOP":
            logger.warning(
                "Gemini response rejected before parsing: finish_reason=%s",
                finish_reason,
            )
            return None
        try:
            response_text = _gemini_response_text(response)
        except Exception as exc:  # noqa: BLE001 - provider output is untrusted
            _log_phase_failure("response_text_extraction", exc)
            raise
        logger.debug("Gemini phase: response_text_extraction")
        return _parse_json(response_text)
    except Exception as exc:  # noqa: BLE001 - deterministic fallback is required
        logger.warning(
            "Investigation reasoning failed (%s: %s); using deterministic rules",
            type(exc).__name__,
            _safe_exception_message(exc),
        )
        return None


__all__ = ["InvestigationDecision", "reason_about"]
