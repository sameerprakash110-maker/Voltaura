"""Savings verification endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Intervention, VerificationResult
from ..schemas import RunVerificationRequest, VerificationOut
from ..services import settings_service, verification_service
from .common import building_lookup, get_intervention_or_404, verification_payload

router = APIRouter(tags=["verification"])


@router.get("/verification", response_model=list[VerificationOut])
def list_verifications(
    building_id: int | None = Query(None),
    status: str = Query("ALL"),
    latest_only: bool = Query(True, description="One result per intervention"),
    db: Session = Depends(get_db),
) -> list[VerificationOut]:
    """Verification results, newest first."""
    if latest_only:
        results = verification_service.latest_per_intervention(db)
    else:
        results = db.execute(
            select(VerificationResult).order_by(VerificationResult.created_at.desc())
        ).scalars().all()

    if building_id is not None:
        results = [r for r in results if r.building_id == building_id]
    if status != "ALL":
        results = [r for r in results if r.status == status]

    buildings = building_lookup(db)
    return [
        VerificationOut(**verification_payload(
            r, buildings, db.get(Intervention, r.intervention_id)))
        for r in results
    ]


@router.get("/verification/{verification_id}", response_model=VerificationOut)
def get_verification(verification_id: int, db: Session = Depends(get_db)) -> VerificationOut:
    result = db.get(VerificationResult, verification_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Verification {verification_id} not found.")
    return VerificationOut(**verification_payload(
        result, building_lookup(db), db.get(Intervention, result.intervention_id)))


@router.post("/verification/{intervention_id}/run", response_model=VerificationOut)
def run_verification(
    intervention_id: int,
    payload: RunVerificationRequest | None = None,
    db: Session = Depends(get_db),
) -> VerificationOut:
    """
    Measure the saving this intervention actually delivered.

    Compares post-intervention telemetry against a baseline model evaluated on
    the post period's own occupancy and weather. A saving is VERIFIED only if
    it clears the configured threshold *and* is statistically significant.
    Returning NOT_VERIFIED or INSUFFICIENT_DATA is a valid, intended outcome.
    """
    intervention = get_intervention_or_404(db, intervention_id)
    payload = payload or RunVerificationRequest()

    if payload.threshold_pct is not None:
        settings_service.update(db, {"verification_threshold_pct": payload.threshold_pct})

    try:
        result = verification_service.run_verification(db, intervention)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Verification failed: {exc}") from exc

    return VerificationOut(**verification_payload(
        result, building_lookup(db), intervention))
