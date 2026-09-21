"""AI recommendations and the apply-intervention action."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Anomaly, Intervention, Recommendation, RecommendationStatus
from ..schemas import ApplyRecommendationRequest, InterventionOut, RecommendationOut
from ..services import intervention_service
from .common import (
    building_lookup,
    get_recommendation_or_404,
    intervention_payload,
    recommendation_payload,
)

router = APIRouter(tags=["recommendations"])


@router.get("/recommendations", response_model=list[RecommendationOut])
def list_recommendations(
    building_id: int | None = Query(None),
    resource: Literal["ENERGY", "WATER", "ALL"] = Query("ALL"),
    status: str = Query("ALL"),
    db: Session = Depends(get_db),
) -> list[RecommendationOut]:
    query = select(Recommendation)
    if building_id is not None:
        query = query.where(Recommendation.building_id == building_id)
    if resource != "ALL":
        query = query.where(Recommendation.resource_type == resource)
    if status != "ALL":
        query = query.where(Recommendation.status == status)

    recs = db.execute(query.order_by(Recommendation.priority_score.desc())).scalars().all()
    buildings = building_lookup(db)
    severity = {a.id: a.severity for a in db.execute(select(Anomaly)).scalars()}
    intervention_by_rec = {
        i.recommendation_id: i.id
        for i in db.execute(select(Intervention).where(Intervention.recommendation_id.isnot(None))).scalars()
    }
    return [
        RecommendationOut(**recommendation_payload(
            r, buildings, severity.get(r.anomaly_id), intervention_by_rec.get(r.id)))
        for r in recs
    ]


@router.get("/recommendations/{recommendation_id}", response_model=RecommendationOut)
def get_recommendation(
    recommendation_id: int, db: Session = Depends(get_db)
) -> RecommendationOut:
    rec = get_recommendation_or_404(db, recommendation_id)
    buildings = building_lookup(db)
    anomaly = db.get(Anomaly, rec.anomaly_id) if rec.anomaly_id else None
    intervention = db.execute(
        select(Intervention).where(Intervention.recommendation_id == rec.id)
    ).scalars().first()
    return RecommendationOut(**recommendation_payload(
        rec, buildings, anomaly.severity if anomaly else None,
        intervention.id if intervention else None,
    ))


@router.post("/recommendations/{recommendation_id}/apply", response_model=InterventionOut)
def apply_recommendation(
    recommendation_id: int,
    payload: ApplyRecommendationRequest | None = None,
    db: Session = Depends(get_db),
) -> InterventionOut:
    """
    Apply a recommendation.

    Creates the intervention, moves the anomaly to ACTIONED, and closes the
    underlying fault from `implemented_at` so post-intervention telemetry
    genuinely reflects the change.
    """
    rec = get_recommendation_or_404(db, recommendation_id)
    payload = payload or ApplyRecommendationRequest()

    if rec.status == RecommendationStatus.APPLIED.value:
        existing = db.execute(
            select(Intervention).where(Intervention.recommendation_id == rec.id)
        ).scalars().first()
        if existing is not None:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Recommendation {recommendation_id} has already been applied as "
                    f"intervention {existing.id}."
                ),
            )

    intervention = intervention_service.apply_recommendation(
        db, rec,
        implemented_at=payload.implemented_at,
        owner=payload.owner,
        notes=payload.notes,
        monitoring_days=payload.monitoring_days,
    )

    progress = intervention_service.monitoring_progress(db, intervention)
    return InterventionOut(**intervention_payload(
        intervention, building_lookup(db), progress, rec, None
    ))


@router.post("/recommendations/{recommendation_id}/dismiss", response_model=RecommendationOut)
def dismiss_recommendation(
    recommendation_id: int, db: Session = Depends(get_db)
) -> RecommendationOut:
    rec = get_recommendation_or_404(db, recommendation_id)
    if rec.status == RecommendationStatus.APPLIED.value:
        raise HTTPException(
            status_code=409, detail="An applied recommendation cannot be dismissed."
        )
    rec.status = RecommendationStatus.DISMISSED.value
    db.commit()
    return get_recommendation(recommendation_id, db)
