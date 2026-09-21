"""
Demo mode.

Exposes the three judge-facing scenarios and reports how far each has
progressed through the product loop, so the UI can take a reviewer straight to
the right screen with one click.

Nothing here fabricates data. A scenario is just a pointer at the anomaly the
detector independently found in the seeded telemetry, plus whatever
recommendation, intervention and verification now hang off it.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ml.campus import DEMO_SCENARIOS

from ..database import get_db
from ..models import (
    Anomaly,
    Building,
    Intervention,
    Recommendation,
    VerificationResult,
)
from ..schemas import DemoScenario, DemoStateResponse
from ..services import pipeline, simulation

router = APIRouter(tags=["demo"])

# Which detected cause each scripted fault should surface as. Used only to
# locate the right anomaly; the diagnosis itself comes from the rule engine.
CAUSE_BY_FAULT = {
    "HVAC_OVERRUN": "HVAC_SCHEDULING_INEFFICIENCY",
    "LIGHTING_AFTER_HOURS": "LIGHTING_CONTROL_INEFFICIENCY",
    "WATER_LEAK": "PROBABLE_WATER_LEAKAGE",
    "PUMP_OVERRUN": "PUMP_OPERATION_INEFFICIENCY",
    "EQUIPMENT_FAULT": "BASE_LOAD_EQUIPMENT_FAULT",
}


def _resolve(db: Session, scenario: dict) -> DemoScenario:
    building = db.execute(
        select(Building).where(Building.code == scenario["building_code"])
    ).scalars().first()

    payload = DemoScenario(**scenario, building_id=building.id if building else None)
    if building is None:
        payload.available = False
        payload.stage = "UNAVAILABLE"
        return payload

    cause = CAUSE_BY_FAULT.get(scenario["fault_code"])
    anomaly = db.execute(
        select(Anomaly)
        .where(
            Anomaly.building_id == building.id,
            Anomaly.resource_type == scenario["resource_type"],
            Anomaly.cause_code == cause,
        )
        .order_by(Anomaly.start_ts.desc())
    ).scalars().first()

    if anomaly is None:
        payload.available = False
        payload.stage = "NOT_DETECTED"
        return payload

    payload.anomaly_id = anomaly.id
    payload.stage = "DIAGNOSED" if anomaly.cause_code else "DETECTED"

    recommendation = db.execute(
        select(Recommendation).where(Recommendation.anomaly_id == anomaly.id)
    ).scalars().first()
    if recommendation is None:
        return payload

    payload.recommendation_id = recommendation.id
    payload.stage = "RECOMMENDED"

    intervention = db.execute(
        select(Intervention).where(Intervention.recommendation_id == recommendation.id)
    ).scalars().first()
    if intervention is None:
        return payload

    payload.intervention_id = intervention.id
    payload.stage = "INTERVENED"

    verification = db.execute(
        select(VerificationResult)
        .where(VerificationResult.intervention_id == intervention.id)
        .order_by(VerificationResult.created_at.desc(), VerificationResult.id.desc())
    ).scalars().first()
    if verification is None:
        return payload

    payload.verification_id = verification.id
    payload.stage = "VERIFIED" if verification.status == "VERIFIED" else "MONITORING"
    return payload


@router.get("/demo/scenarios", response_model=DemoStateResponse)
def list_scenarios(db: Session = Depends(get_db)) -> DemoStateResponse:
    """The demo scenarios and how far each has progressed through the loop."""
    state = simulation.get_state(db)
    return DemoStateResponse(
        demo_mode=state.demo_mode if state else True,
        scenarios=[_resolve(db, s) for s in sorted(DEMO_SCENARIOS, key=lambda s: s["order"])],
        data_start=state.data_start_ts if state else None,
        data_end=state.data_end_ts if state else None,
        seeded_at=state.seeded_at if state else None,
    )


@router.get("/demo/scenarios/{key}", response_model=DemoScenario)
def get_scenario(key: str, db: Session = Depends(get_db)) -> DemoScenario:
    scenario = next((s for s in DEMO_SCENARIOS if s["key"] == key), None)
    if scenario is None:
        valid = ", ".join(s["key"] for s in DEMO_SCENARIOS)
        raise HTTPException(
            status_code=404, detail=f"Unknown scenario '{key}'. Available: {valid}"
        )
    return _resolve(db, scenario)


@router.post("/demo/reanalyse")
def reanalyse(db: Session = Depends(get_db)) -> dict:
    """
    Re-run detection across the campus.

    Useful mid-demo after changing a detection threshold in Settings: the
    anomaly list rebuilds from the same telemetry under the new configuration.
    """
    try:
        summary = pipeline.run_full_analysis(db)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Re-analysis failed: {exc}") from exc
    return {"status": "ok", **summary}
