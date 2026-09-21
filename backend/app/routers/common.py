"""Shared helpers for the API routers."""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import (
    Anomaly,
    Building,
    Intervention,
    Recommendation,
    VerificationResult,
)


def get_building_or_404(db: Session, building_id: int) -> Building:
    building = db.get(Building, building_id)
    if building is None:
        raise HTTPException(
            status_code=404,
            detail=f"Building {building_id} not found. Call GET /api/buildings for valid ids.",
        )
    return building


def get_anomaly_or_404(db: Session, anomaly_id: int) -> Anomaly:
    anomaly = db.get(Anomaly, anomaly_id)
    if anomaly is None:
        raise HTTPException(status_code=404, detail=f"Anomaly {anomaly_id} not found.")
    return anomaly


def get_recommendation_or_404(db: Session, recommendation_id: int) -> Recommendation:
    rec = db.get(Recommendation, recommendation_id)
    if rec is None:
        raise HTTPException(
            status_code=404, detail=f"Recommendation {recommendation_id} not found."
        )
    return rec


def get_intervention_or_404(db: Session, intervention_id: int) -> Intervention:
    intervention = db.get(Intervention, intervention_id)
    if intervention is None:
        raise HTTPException(
            status_code=404, detail=f"Intervention {intervention_id} not found."
        )
    return intervention


def building_lookup(db: Session) -> dict[int, Building]:
    return {b.id: b for b in db.execute(select(Building)).scalars()}


def anomaly_payload(anomaly: Anomaly, buildings: dict[int, Building],
                    recommendation_id: int | None = None) -> dict:
    building = buildings.get(anomaly.building_id)
    return {
        **{c.name: getattr(anomaly, c.name) for c in anomaly.__table__.columns
           if c.name != "intervals"},
        "building_code": building.code if building else None,
        "building_name": building.name if building else None,
        "recommendation_id": recommendation_id,
    }


def recommendation_payload(rec: Recommendation, buildings: dict[int, Building],
                           severity: str | None = None,
                           intervention_id: int | None = None) -> dict:
    building = buildings.get(rec.building_id)
    return {
        **{c.name: getattr(rec, c.name) for c in rec.__table__.columns},
        "building_code": building.code if building else None,
        "building_name": building.name if building else None,
        "severity": severity,
        "intervention_id": intervention_id,
    }


def intervention_payload(intervention: Intervention, buildings: dict[int, Building],
                         progress: dict, recommendation: Recommendation | None = None,
                         verification: VerificationResult | None = None) -> dict:
    building = buildings.get(intervention.building_id)
    return {
        **{c.name: getattr(intervention, c.name) for c in intervention.__table__.columns},
        "building_code": building.code if building else None,
        "building_name": building.name if building else None,
        "elapsed_days": progress.get("elapsed_days", 0.0),
        "progress_pct": progress.get("progress_pct", 0.0),
        "ready_for_verification": progress.get("ready_for_verification", False),
        "expected_saving_per_week": recommendation.expected_saving_per_week if recommendation else None,
        "expected_saving_unit": recommendation.expected_saving_unit if recommendation else None,
        "verification_status": verification.status if verification else None,
        "verified_saving": verification.absolute_saving if verification else None,
        "verified_saving_pct": verification.saving_pct if verification else None,
        "verification_id": verification.id if verification else None,
    }


def verification_payload(result: VerificationResult, buildings: dict[int, Building],
                         intervention: Intervention | None = None) -> dict:
    building = buildings.get(result.building_id)
    return {
        **{c.name: getattr(result, c.name) for c in result.__table__.columns},
        "building_code": building.code if building else None,
        "building_name": building.name if building else None,
        "intervention_title": intervention.title if intervention else None,
    }
