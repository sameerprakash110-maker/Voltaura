"""
Intervention lifecycle.

    PLANNED -> ACTIVE -> MONITORING -> COMPLETED -> VERIFIED

Applying a recommendation does two things at once:

  1. creates the intervention record and moves the anomaly to ACTIONED;
  2. closes the underlying fault in the simulated plant from `implemented_at`.

Step 2 is the important one. Without it, "apply intervention" would be a status
change and the verified saving would be theatre. With it, every hour of
telemetry generated afterwards is produced by a plant that no longer has the
fault, and the saving the verification stage measures is real.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import (
    Anomaly,
    AnomalyStatus,
    Intervention,
    InterventionStatus,
    Recommendation,
    RecommendationStatus,
)
from . import simulation


def _timeline_entry(status: str, note: str, at: datetime) -> dict:
    return {"status": status, "note": note, "at": at.isoformat()}


def apply_recommendation(
    db: Session,
    recommendation: Recommendation,
    implemented_at: datetime | None = None,
    owner: str = "Facilities Team",
    notes: str = "",
    monitoring_days: int = 14,
) -> Intervention:
    """Apply a recommendation and open the monitoring period."""
    now = implemented_at or simulation.data_end(db)

    intervention = Intervention(
        recommendation_id=recommendation.id,
        building_id=recommendation.building_id,
        resource_type=recommendation.resource_type,
        title=recommendation.title,
        description=recommendation.implementation or recommendation.description,
        implemented_at=now,
        status=InterventionStatus.ACTIVE.value,
        owner=owner,
        target_fault_code=recommendation.target_fault_code,
        monitoring_days_required=monitoring_days,
        notes=notes,
        timeline=[
            _timeline_entry(
                InterventionStatus.PLANNED.value,
                f"Raised from recommendation #{recommendation.id}.",
                now,
            ),
            _timeline_entry(
                InterventionStatus.ACTIVE.value,
                "Measure implemented on site. Post-intervention monitoring opened.",
                now,
            ),
        ],
    )
    db.add(intervention)

    recommendation.status = RecommendationStatus.APPLIED.value
    if recommendation.anomaly_id:
        anomaly = db.get(Anomaly, recommendation.anomaly_id)
        if anomaly is not None:
            anomaly.status = AnomalyStatus.ACTIONED.value

    # Remediate the underlying fault in the plant from this moment on.
    if recommendation.target_fault_code:
        simulation.close_fault(
            db, recommendation.building_id, recommendation.target_fault_code, now
        )

    db.commit()
    db.refresh(intervention)
    return intervention


def set_status(
    db: Session, intervention: Intervention, status: str, note: str = ""
) -> Intervention:
    """Advance the lifecycle and append to the timeline."""
    intervention.status = status
    intervention.updated_at = datetime.utcnow()
    timeline = list(intervention.timeline or [])
    timeline.append(_timeline_entry(status, note, simulation.data_end(db)))
    intervention.timeline = timeline
    db.commit()
    db.refresh(intervention)
    return intervention


def monitoring_progress(db: Session, intervention: Intervention) -> dict:
    """How far through the required monitoring window this intervention is."""
    end = simulation.data_end(db)
    elapsed_days = max(0.0, (end - intervention.implemented_at).total_seconds() / 86400.0)
    required = max(1, intervention.monitoring_days_required)
    return {
        "elapsed_days": round(elapsed_days, 2),
        "required_days": required,
        "progress_pct": round(min(100.0, elapsed_days / required * 100.0), 1),
        "ready_for_verification": elapsed_days >= required,
    }


def list_with_progress(db: Session) -> list[tuple[Intervention, dict]]:
    rows = db.execute(
        select(Intervention).order_by(Intervention.implemented_at.desc())
    ).scalars().all()
    return [(i, monitoring_progress(db, i)) for i in rows]
