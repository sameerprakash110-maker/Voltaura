"""Anomaly centre: list, detail and on-demand re-analysis."""
from __future__ import annotations

from typing import Literal

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ml.root_cause import build_context, diagnose

from ..database import get_db
from ..models import Anomaly, AnomalyStatus, Recommendation
from ..schemas import AnomalyDetail, AnomalyOut
from ..services import analytics, llm, pipeline, settings_service
from .common import (
    anomaly_payload,
    building_lookup,
    get_anomaly_or_404,
    get_building_or_404,
    recommendation_payload,
)

router = APIRouter(tags=["anomalies"])


@router.get("/anomalies", response_model=list[AnomalyOut])
def list_anomalies(
    building_id: int | None = Query(None),
    resource: Literal["ENERGY", "WATER", "ALL"] = Query("ALL"),
    severity: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL", "ALL"] = Query("ALL"),
    status: str = Query("ALL"),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
) -> list[AnomalyOut]:
    query = select(Anomaly)
    if building_id is not None:
        query = query.where(Anomaly.building_id == building_id)
    if resource != "ALL":
        query = query.where(Anomaly.resource_type == resource)
    if severity != "ALL":
        query = query.where(Anomaly.severity == severity)
    if status != "ALL":
        query = query.where(Anomaly.status == status)

    anomalies = db.execute(query).scalars().all()
    rank = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}
    anomalies.sort(key=lambda a: (rank.get(a.severity, 4), -abs(a.deviation_pct)))

    buildings = building_lookup(db)
    rec_by_anomaly = {
        r.anomaly_id: r.id
        for r in db.execute(select(Recommendation).where(Recommendation.anomaly_id.isnot(None))).scalars()
    }
    return [
        AnomalyOut(**anomaly_payload(a, buildings, rec_by_anomaly.get(a.id)))
        for a in anomalies[:limit]
    ]


@router.get("/anomalies/{anomaly_id}", response_model=AnomalyDetail)
def get_anomaly(
    anomaly_id: int,
    db: Session = Depends(get_db),
) -> AnomalyDetail:
    """One anomaly with the telemetry window around it and its measured context."""
    anomaly = get_anomaly_or_404(db, anomaly_id)
    buildings = building_lookup(db)
    building = get_building_or_404(db, anomaly.building_id)

    recommendation = db.execute(
        select(Recommendation).where(Recommendation.anomaly_id == anomaly.id)
    ).scalars().first()

    flagged = {pd.Timestamp(t) for t in (anomaly.intervals or [])}

    # Show the whole window the anomaly sits in, with a little context on
    # either side, rather than an arbitrary fixed range.
    span_days = max(7, min(90, (anomaly.end_ts - anomaly.start_ts).days + 8))
    series = analytics.building_series(
        db, building, anomaly.resource_type, span_days, flagged
    )

    df = pipeline.load_frame(db, building, anomaly.resource_type)
    context = build_context(df, [pd.Timestamp(t) for t in (anomaly.intervals or [])],
                            anomaly.resource_type, building)

    # Before/after hour-of-day profile: affected intervals vs the same hours on
    # normal days. This is the chart that makes the cause obvious at a glance.
    hourly_profile: dict = {"hours": [], "anomalous": [], "normal": []}
    if not df.empty and flagged:
        value_col = "energy_kwh" if anomaly.resource_type == "ENERGY" else "water_liters"
        mask = df["ts"].isin(list(flagged))
        affected_hours = sorted(df[mask]["hour"].unique().tolist())
        normal = df[~mask]
        anomalous_by_hour = df[mask].groupby("hour")[value_col].mean()
        normal_by_hour = normal.groupby("hour")[value_col].mean()
        hourly_profile = {
            "hours": list(range(24)),
            "anomalous": [
                round(float(anomalous_by_hour.get(h, float("nan"))), 3)
                if h in anomalous_by_hour.index else None
                for h in range(24)
            ],
            "normal": [round(float(normal_by_hour.get(h, 0.0)), 3) for h in range(24)],
            "affected_hours": affected_hours,
            "unit": anomaly.unit,
        }

    return AnomalyDetail(
        anomaly=AnomalyOut(**anomaly_payload(
            anomaly, buildings, recommendation.id if recommendation else None)),
        recommendation=(
            recommendation_payload(recommendation, buildings, anomaly.severity)
            if recommendation else None
        ),
        series=series,
        context={k: v for k, v in context.items() if k != "valid"},
        hourly_profile=hourly_profile,
    )


@router.post("/anomalies/{anomaly_id}/analyze", response_model=AnomalyDetail)
def analyze_anomaly(
    anomaly_id: int,
    use_llm: bool = Query(True, description="Enrich the narrative if a key is configured"),
    db: Session = Depends(get_db),
) -> AnomalyDetail:
    """
    Re-run root-cause analysis for one anomaly.

    The rule engine is deterministic, so this returns the same cause and
    confidence every time. When an LLM key is configured it additionally
    rewrites the narrative; the diagnosis itself is never delegated.
    """
    anomaly = get_anomaly_or_404(db, anomaly_id)
    building = get_building_or_404(db, anomaly.building_id)

    df = pipeline.load_frame(db, building, anomaly.resource_type)
    if df.empty:
        raise HTTPException(
            status_code=409,
            detail="No telemetry available for this building. Run: python scripts/seed.py",
        )

    context = build_context(
        df, [pd.Timestamp(t) for t in (anomaly.intervals or [])],
        anomaly.resource_type, building,
    )
    diagnosis = diagnose(context)

    anomaly.cause_code = diagnosis.cause_code
    anomaly.probable_cause = diagnosis.probable_cause
    anomaly.affected_subsystem = diagnosis.affected_subsystem
    anomaly.confidence = diagnosis.confidence
    anomaly.evidence = diagnosis.evidence_dicts()
    anomaly.diagnosis_narrative = diagnosis.narrative
    anomaly.narrative_source = "rules"
    if anomaly.status == AnomalyStatus.OPEN.value:
        anomaly.status = AnomalyStatus.DIAGNOSED.value

    if use_llm and llm.is_available():
        narrative, source = llm.enrich_narrative(
            llm.diagnosis_payload(anomaly, building, context), diagnosis.narrative
        )
        anomaly.diagnosis_narrative = narrative
        anomaly.narrative_source = source

    db.commit()
    return get_anomaly(anomaly_id, db)


@router.post("/anomalies/detect")
def run_detection(
    building_id: int | None = Query(None),
    db: Session = Depends(get_db),
) -> dict:
    """
    Re-run the whole detection pipeline.

    Refreshes expected-consumption models and re-detects anomalies. Anomalies
    that already have an intervention against them are preserved: they are part
    of the audit trail.
    """
    try:
        summary = pipeline.run_full_analysis(db, building_id=building_id)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=500, detail=f"Detection pipeline failed: {exc}"
        ) from exc
    return {
        "status": "ok",
        "detector": "IsolationForest + hour-normalised RandomForest residual",
        **summary,
    }
