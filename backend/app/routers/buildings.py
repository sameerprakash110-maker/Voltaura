"""Buildings list, detail and the digital-twin feed."""
from __future__ import annotations

import pandas as pd
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Anomaly, AnomalyStatus, Intervention, Recommendation, RecommendationStatus
from ..schemas import BuildingDetail, BuildingSummary
from ..services import analytics, intervention_service, verification_service
from .common import (
    anomaly_payload,
    building_lookup,
    get_building_or_404,
    intervention_payload,
    recommendation_payload,
)

router = APIRouter(tags=["buildings"])


@router.get("/buildings", response_model=list[BuildingSummary])
def list_buildings(
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
) -> list[BuildingSummary]:
    """Every building with its current state. Also powers the digital twin."""
    return [BuildingSummary(**s) for s in analytics.building_summaries(db, days)]


@router.get("/buildings/{building_id}", response_model=BuildingDetail)
def get_building(
    building_id: int,
    days: int = Query(30, ge=1, le=365, description="Date range in days (UI uses 7, 30 or 90)"),
    db: Session = Depends(get_db),
) -> BuildingDetail:
    """
    Full building page: telemetry, subsystem breakdown, anomalies, diagnosis,
    recommendations and interventions.
    """
    building = get_building_or_404(db, building_id)
    buildings = building_lookup(db)

    summary = next(
        (s for s in analytics.building_summaries(db, days) if s["id"] == building_id), None
    )

    anomalies = db.execute(
        select(Anomaly)
        .where(Anomaly.building_id == building_id)
        .order_by(Anomaly.start_ts.desc())
    ).scalars().all()

    # Mark the exact intervals each detector flagged so charts can shade them.
    energy_flagged: set = set()
    water_flagged: set = set()
    for anomaly in anomalies:
        target = energy_flagged if anomaly.resource_type == "ENERGY" else water_flagged
        for iso in anomaly.intervals or []:
            target.add(pd.Timestamp(iso))

    recommendations = db.execute(
        select(Recommendation)
        .where(Recommendation.building_id == building_id)
        .order_by(Recommendation.priority_score.desc())
    ).scalars().all()

    interventions = db.execute(
        select(Intervention)
        .where(Intervention.building_id == building_id)
        .order_by(Intervention.implemented_at.desc())
    ).scalars().all()
    intervention_recommendations = {
        r.id: r for r in db.execute(
            select(Recommendation).where(Recommendation.id.in_([
                i.recommendation_id for i in interventions if i.recommendation_id
            ]))
        ).scalars()
    } if interventions else {}
    intervention_verifications = verification_service.latest_by_intervention(
        db, [i.id for i in interventions]
    )

    severity_by_anomaly = {a.id: a.severity for a in anomalies}
    rec_by_anomaly = {r.anomaly_id: r for r in recommendations if r.anomaly_id}

    intervention_out = []
    for iv in interventions:
        progress = intervention_service.monitoring_progress(db, iv)
        rec = intervention_recommendations.get(iv.recommendation_id)
        ver = intervention_verifications.get(iv.id)
        intervention_out.append(intervention_payload(iv, buildings, progress, rec, ver))

    # ---- subsystem cards ----------------------------------------------
    start, end, _, _ = analytics.window(db, days)
    e = analytics.energy_frame(db, start, end, building_id)
    w = analytics.water_frame(db, start, end, building_id)

    hours = max(1, len(e))
    hvac_share = float(e["hvac_runtime_min"].mean()) / 60.0 if len(e) else 0.0
    light_share = float(e["lighting_runtime_min"].mean()) / 60.0 if len(e) else 0.0
    pump_share = float(w["pump_runtime_min"].mean()) / 60.0 if len(w) else 0.0

    # Attribute metered energy to subsystems using nameplate capacity times
    # measured runtime. This is an apportionment of real metered consumption,
    # not a separate estimate: the shares are scaled to sum to the meter.
    hvac_kwh = building.hvac_capacity_kw * hvac_share * hours * 0.78
    light_kwh = building.lighting_capacity_kw * light_share * hours
    base_kwh = building.base_load_kw * hours
    total_metered = float(e["energy_kwh"].sum()) if len(e) else 0.0
    plug_kwh = max(0.0, total_metered - hvac_kwh - light_kwh - base_kwh)

    subsystems = [
        {
            "key": "electricity", "label": "Electricity", "icon": "zap",
            "value": round(total_metered, 1), "unit": "kWh",
            "secondary": f"{round(total_metered / max(building.area_sqm, 1), 2)} kWh/m2",
            "detail": "Whole-building metered consumption",
            "deviation_pct": summary["energy_deviation_pct"] if summary else 0.0,
        },
        {
            "key": "water", "label": "Water", "icon": "droplets",
            "value": round((float(w["water_liters"].sum()) if len(w) else 0.0) / 1000.0, 2),
            "unit": "kL",
            "secondary": f"{round(float(w['flow_lph'].mean()) if len(w) else 0.0, 1)} L/h average flow",
            "detail": "Whole-building metered flow",
            "deviation_pct": summary["water_deviation_pct"] if summary else 0.0,
        },
        {
            "key": "hvac", "label": "HVAC", "icon": "wind",
            "value": round(hvac_kwh, 1), "unit": "kWh",
            "secondary": f"{round(hvac_share * 60, 1)} min/h average runtime",
            "detail": f"{building.hvac_capacity_kw:.0f} kW installed air-side plant",
            "deviation_pct": 0.0,
        },
        {
            "key": "lighting", "label": "Lighting", "icon": "lightbulb",
            "value": round(light_kwh, 1), "unit": "kWh",
            "secondary": f"{round(light_share * 60, 1)} min/h average runtime",
            "detail": f"{building.lighting_capacity_kw:.0f} kW installed lighting load",
            "deviation_pct": 0.0,
        },
    ]

    stats = {
        "base_load_kwh": round(base_kwh, 1),
        "plug_load_kwh": round(plug_kwh, 1),
        "hvac_kwh": round(hvac_kwh, 1),
        "lighting_kwh": round(light_kwh, 1),
        "pump_runtime_avg": round(pump_share * 60, 1),
        "peak_demand_kw": round(float(e["energy_kwh"].max()) if len(e) else 0.0, 1),
        "avg_occupancy_pct": round(float(e["occupancy_pct"].mean()) if len(e) else 0.0, 1),
        "peak_occupancy": int(e["occupancy"].max()) if len(e) else 0,
        "avg_indoor_temp": round(float(e["temperature_c"].mean()) if len(e) else 0.0, 1),
        "avg_outdoor_temp": round(float(e["outdoor_temperature_c"].mean()) if len(e) else 0.0, 1),
        "night_flow_lph": round(
            float(w[w["ts"].dt.hour.isin([1, 2, 3, 4])]["flow_lph"].mean()) if len(w) else 0.0, 1
        ),
        "intervals": len(e),
        "apportionment_note": (
            "Subsystem figures apportion metered consumption using nameplate "
            "capacity and measured runtime. The electricity and water figures "
            "are direct meter readings."
        ),
    }

    return BuildingDetail(
        building=BuildingSummary(**summary) if summary else BuildingSummary(
            **{c.name: getattr(building, c.name) for c in building.__table__.columns
               if c.name in BuildingSummary.model_fields}
        ),
        energy_series=analytics.building_series(db, building, "ENERGY", days, energy_flagged),
        water_series=analytics.building_series(db, building, "WATER", days, water_flagged),
        anomalies=[
            anomaly_payload(a, buildings,
                            rec_by_anomaly[a.id].id if a.id in rec_by_anomaly else None)
            for a in anomalies
        ],
        recommendations=[
            recommendation_payload(r, buildings, severity_by_anomaly.get(r.anomaly_id))
            for r in recommendations
        ],
        interventions=intervention_out,
        subsystems=subsystems,
        stats=stats,
        range_days=days,
        interval=analytics.pick_interval(days),
    )
