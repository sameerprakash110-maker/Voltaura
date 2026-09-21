"""
Optional LLM narrative enrichment.

STRICTLY OPTIONAL. EcoTwin works completely without an API key: detection,
diagnosis, recommendations and verification are all deterministic and run
locally. If a key is configured, the LLM is used for exactly one thing --
rewriting an already-computed diagnosis into a fluent paragraph for a facilities
manager.

The rules below are what keep this safe:

  * the LLM never decides a cause, a confidence or a number;
  * it receives the finished diagnosis as facts and is asked only to phrase it;
  * every failure mode (no key, bad key, timeout, network error, bad response)
    falls back silently to the deterministic narrative;
  * output is tagged `narrative_source = "llm"` so the UI can be honest about
    which text a human is reading.

In other words: the LLM can improve how a finding reads. It can never change
what the finding is.
"""
from __future__ import annotations

import json
import logging

from ..config import settings

logger = logging.getLogger("ecotwin.llm")

SYSTEM_PROMPT = (
    "You are an energy analyst writing for a campus facilities manager. "
    "You will be given a COMPLETED diagnosis of an abnormal building "
    "consumption event, including its measured evidence. "
    "Rewrite it as one clear paragraph of at most 90 words.\n\n"
    "Hard rules:\n"
    "- Use ONLY the facts and numbers provided. Never invent or alter a number.\n"
    "- Do not change the stated cause or confidence.\n"
    "- No marketing language, no AI buzzwords, no bullet points.\n"
    "- Plain professional English. State what is happening, the evidence for "
    "it, and what it costs.\n"
    "Return only the paragraph."
)


def is_available() -> bool:
    return settings.llm_available


def status() -> dict:
    return {
        "enabled": is_available(),
        "model": settings.llm_model if is_available() else None,
        "reason": (
            "Active"
            if is_available()
            else "No ECOTWIN_LLM_API_KEY configured. Deterministic narratives in use."
        ),
    }


def _build_user_prompt(payload: dict) -> str:
    return (
        "Diagnosis to rewrite:\n"
        + json.dumps(payload, indent=2, default=str)
        + "\n\nWrite the paragraph now."
    )


def enrich_narrative(payload: dict, fallback: str) -> tuple[str, str]:
    """
    Return (narrative, source) where source is "llm" or "rules".

    Never raises. Any problem at all returns the deterministic fallback, so a
    missing key or a flaky network can never break the product loop.
    """
    if not is_available():
        return fallback, "rules"

    try:
        import anthropic  # imported lazily: not a required dependency
    except ImportError:
        logger.info("anthropic SDK not installed; using deterministic narrative")
        return fallback, "rules"

    try:
        client = anthropic.Anthropic(api_key=settings.llm_api_key, timeout=12.0)
        response = client.messages.create(
            model=settings.llm_model,
            max_tokens=400,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": _build_user_prompt(payload)}],
        )
        parts = [
            block.text for block in response.content
            if getattr(block, "type", None) == "text"
        ]
        text = "\n".join(parts).strip()
        if len(text) < 40:
            return fallback, "rules"
        return text, "llm"
    except Exception as exc:  # noqa: BLE001 - enrichment must never break the loop
        logger.warning("LLM enrichment failed (%s); using deterministic narrative", exc)
        return fallback, "rules"


def diagnosis_payload(anomaly, building, context: dict | None = None) -> dict:
    """Facts handed to the LLM. Deliberately narrow: findings, not raw data."""
    return {
        "building": building.name,
        "resource": anomaly.resource_type,
        "probable_cause": anomaly.probable_cause,
        "affected_subsystem": anomaly.affected_subsystem,
        "confidence_pct": round((anomaly.confidence or 0) * 100),
        "severity": anomaly.severity,
        "deviation_pct": anomaly.deviation_pct,
        "excess_total": f"{anomaly.excess_total:,.0f} {anomaly.unit}",
        "affected_intervals": anomaly.flagged_intervals,
        "span_days": anomaly.occurrence_days,
        "evidence": [
            {"measurement": e.get("label"), "value": e.get("value"),
             "threshold": e.get("criterion"), "met": e.get("satisfied")}
            for e in (anomaly.evidence or [])
        ],
        "deterministic_summary": anomaly.diagnosis_narrative,
    }
