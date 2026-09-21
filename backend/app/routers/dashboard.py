"""Main dashboard payload."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (
    Anomaly,
    AnomalyStatus,
    Intervention,
    Recommendation,
    RecommendationStatus,
)
from ..schemas import DashboardResponse
from ..services import analytics, intervention_service, settings_service, simulation
from ..services import verification_service
from .common import (
    anomaly_payload,
    building_lookup,
    intervention_payload,
    recommendation_payload,
    verification_payload,
)

router = APIRouter(tags=["dashboard"])


@router.get("/dashboard", response_model=DashboardResponse)
def get_dashboard(
    days: int = Query(30, ge=1, le=365, description="Date range in days (UI uses 7, 30 or 90)"),
    resource: Literal["ENERGY", "WATER", "ALL"] = Query("ALL"),
    db: Session = Depends(get_db),
) -> DashboardResponse:
    """
    Everything the command centre renders, in one round trip.

    Keeping this as a single endpoint avoids a waterfall of requests on the
    most-viewed screen and guarantees every panel describes the same window.
    """
    buildings = building_lookup(db)

    kpis = analytics.build_kpis(db, days)
    series = analytics.campus_series(db, days, resource)
    summaries = analytics.building_summaries(db, days)

    comparison = [
        {
            "building_id": s["id"], "code": s["code"], "name": s["name"],
            "energy_kwh": s["energy_kwh"], "water_liters": s["water_liters"],
            "energy_intensity": s["energy_intensity"],
            "water_intensity": round(s["water_liters"] / s["area_sqm"], 2) if s["area_sqm"] else 0.0,
            "deviation_pct": s["energy_deviation_pct"] if resource != "WATER" else s["water_deviation_pct"],
            "status": s["status"], "open_anomalies": s["open_anomalies"],
        }
        for s in summaries
    ]

    # ---- open anomalies, worst first ---------------------------------
    anomaly_query = select(Anomaly).where(
        Anomaly.status.in_([AnomalyStatus.OPEN.value, AnomalyStatus.DIAGNOSED.value])
    )
    if resource != "ALL":
        anomaly_query = anomaly_query.where(Anomaly.resource_type == resource)
    anomalies = db.execute(anomaly_query).scalars().all()

    severity_rank = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}
    anomalies.sort(key=lambda a: (severity_rank.get(a.severity, 4), -abs(a.deviation_pct)))

    rec_by_anomaly = {
        r.anomaly_id: r
        for r in db.execute(select(Recommendation).where(Recommendation.anomaly_id.isnot(None))).scalars()
    }
    anomaly_out = [
        anomaly_payload(a, buildings, rec_by_anomaly.get(a.id).id if rec_by_anomaly.get(a.id) else None)
        for a in anomalies[:12]
    ]

    # ---- pending recommendations, highest value first -----------------
    rec_query = select(Recommendation).where(
        Recommendation.status == RecommendationStatus.PENDING.value
    )
    if resource != "ALL":
        rec_query = rec_query.where(Recommendation.resource_type == resource)
    recs = db.execute(rec_query.order_by(Recommendation.priority_score.desc())).scalars().all()

    severity_by_anomaly = {a.id: a.severity for a in db.execute(select(Anomaly)).scalars()}
    rec_out = [
        recommendation_payload(r, buildings, severity_by_anomaly.get(r.anomaly_id))
        for r in recs[:8]
    ]

    # ---- recent interventions -----------------------------------------
    interventions = db.execute(
        select(Intervention).order_by(Intervention.implemented_at.desc())
    ).scalars().all()
    intervention_out = []
    for iv in interventions[:6]:
        progress = intervention_service.monitoring_progress(db, iv)
        rec = db.get(Recommendation, iv.recommendation_id) if iv.recommendation_id else None
        ver = verification_service.latest_for_intervention(db, iv.id)
        intervention_out.append(intervention_payload(iv, buildings, progress, rec, ver))

    # ---- latest verification per intervention --------------------------
    verifications = verification_service.latest_per_intervention(db)
    verification_out = [
        verification_payload(v, buildings, db.get(Intervention, v.intervention_id))
        for v in verifications[:6]
    ]

    return DashboardResponse(
        kpis=kpis,
        series=series,
        buildings=comparison,
        anomalies=anomaly_out,
        recommendations=rec_out,
        interventions=intervention_out,
        verifications=verification_out,
        pipeline=analytics.pipeline_status(db),
        range_days=days,
        resource=resource,
        interval=analytics.pick_interval(days),
        data_start=simulation.data_start(db),
        data_end=simulation.data_end(db),
        economics=settings_service.economics(db),
    )
