"""Intervention tracking and post-intervention monitoring."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Intervention, InterventionStatus, Recommendation
from ..schemas import (
    CreateInterventionRequest,
    InterventionOut,
    MonitoringRequest,
    VerificationOut,
)
from ..services import intervention_service, simulation, verification_service
from .common import (
    building_lookup,
    get_building_or_404,
    get_intervention_or_404,
    get_recommendation_or_404,
    intervention_payload,
    verification_payload,
)

router = APIRouter(tags=["interventions"])


def _out(db: Session, intervention: Intervention) -> InterventionOut:
    progress = intervention_service.monitoring_progress(db, intervention)
    rec = db.get(Recommendation, intervention.recommendation_id) if intervention.recommendation_id else None
    ver = verification_service.latest_for_intervention(db, intervention.id)
    return InterventionOut(**intervention_payload(
        intervention, building_lookup(db), progress, rec, ver
    ))


@router.get("/interventions", response_model=list[InterventionOut])
def list_interventions(
    building_id: int | None = Query(None),
    status: str = Query("ALL"),
    db: Session = Depends(get_db),
) -> list[InterventionOut]:
    query = select(Intervention)
    if building_id is not None:
        query = query.where(Intervention.building_id == building_id)
    if status != "ALL":
        query = query.where(Intervention.status == status)
    rows = db.execute(query.order_by(Intervention.implemented_at.desc())).scalars().all()
    return [_out(db, i) for i in rows]


@router.get("/interventions/{intervention_id}", response_model=InterventionOut)
def get_intervention(intervention_id: int, db: Session = Depends(get_db)) -> InterventionOut:
    return _out(db, get_intervention_or_404(db, intervention_id))


@router.post("/interventions", response_model=InterventionOut, status_code=201)
def create_intervention(
    payload: CreateInterventionRequest, db: Session = Depends(get_db)
) -> InterventionOut:
    """
    Create an intervention.

    Normally raised from a recommendation, which links the measure to the
    evidence behind it. A free-standing intervention is allowed for measures
    taken outside the system, but it carries no target fault, so verification
    will measure whatever the telemetry actually shows.
    """
    if payload.recommendation_id is not None:
        rec = get_recommendation_or_404(db, payload.recommendation_id)
        intervention = intervention_service.apply_recommendation(
            db, rec,
            implemented_at=payload.implemented_at,
            owner=payload.owner,
            notes=payload.notes,
            monitoring_days=payload.monitoring_days,
        )
        return _out(db, intervention)

    if payload.building_id is None or payload.resource_type is None:
        raise HTTPException(
            status_code=422,
            detail="Provide either recommendation_id, or both building_id and resource_type.",
        )

    building = get_building_or_404(db, payload.building_id)
    now = payload.implemented_at or simulation.data_end(db)
    intervention = Intervention(
        recommendation_id=None,
        building_id=building.id,
        resource_type=payload.resource_type,
        title=payload.title or "Manual intervention",
        description=payload.description,
        implemented_at=now,
        status=InterventionStatus.ACTIVE.value,
        owner=payload.owner,
        target_fault_code=None,
        monitoring_days_required=payload.monitoring_days,
        notes=payload.notes,
        timeline=[{
            "status": InterventionStatus.ACTIVE.value,
            "note": "Manually recorded intervention. Post-intervention monitoring opened.",
            "at": now.isoformat(),
        }],
    )
    db.add(intervention)
    db.commit()
    db.refresh(intervention)
    return _out(db, intervention)


@router.post("/interventions/{intervention_id}/monitor", response_model=VerificationOut)
def run_monitoring(
    intervention_id: int,
    payload: MonitoringRequest | None = None,
    db: Session = Depends(get_db),
) -> VerificationOut:
    """
    Collect post-intervention telemetry, then verify.

    DEMO MODE. The telemetry is produced by the same building simulator that
    generated the history, with the intervention's fault removed. In a real
    deployment this step is simply the passage of time while the meters report;
    the verification maths that follows is identical either way.
    """
    intervention = get_intervention_or_404(db, intervention_id)
    payload = payload or MonitoringRequest()

    try:
        result, _advance = verification_service.run_monitoring_then_verify(
            db, intervention, days=payload.days
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=500, detail=f"Post-intervention monitoring failed: {exc}"
        ) from exc

    return VerificationOut(**verification_payload(
        result, building_lookup(db), intervention
    ))


@router.patch("/interventions/{intervention_id}/status", response_model=InterventionOut)
def update_status(
    intervention_id: int,
    status: str = Query(..., description="PLANNED | ACTIVE | MONITORING | COMPLETED | VERIFIED"),
    note: str = Query(""),
    db: Session = Depends(get_db),
) -> InterventionOut:
    intervention = get_intervention_or_404(db, intervention_id)
    valid = {s.value for s in InterventionStatus}
    if status not in valid:
        raise HTTPException(
            status_code=422, detail=f"Invalid status '{status}'. Expected one of {sorted(valid)}."
        )
    intervention_service.set_status(db, intervention, status, note or f"Status set to {status}.")
    return _out(db, intervention)
