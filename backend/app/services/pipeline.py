"""
The analysis pipeline.

Orchestrates the middle of the product loop:

    telemetry -> expected consumption -> anomaly detection -> root cause
              -> costed recommendation

`run_full_analysis` is idempotent by design. Re-running it refreshes the
expected-consumption curve and re-detects anomalies, but never disturbs an
anomaly that has already been actioned: once an intervention exists against a
recommendation, the anomaly behind it is part of the audit trail and is left
exactly as it was.
"""
from __future__ import annotations

from datetime import datetime

import pandas as pd
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ml.anomaly_detection import detect
from ml.expected_consumption import compute_expected
from ml.features import EXPECTED_COLUMN, VALUE_COLUMN, build_frame
from ml.recommendations import build_recommendation
from ml.root_cause import build_context, diagnose

from ..config import settings as defaults
from ..models import (
    Anomaly,
    AnomalyStatus,
    Building,
    EnergyReading,
    Recommendation,
    RecommendationStatus,
    WaterReading,
)
from . import settings_service
from .investigation import investigator
from .investigation.recommendation_evidence import normalize_investigation_evidence

READING_MODEL = {"ENERGY": EnergyReading, "WATER": WaterReading}

ENERGY_FIELDS = (
    "ts", "energy_kwh", "occupancy", "occupancy_pct", "temperature_c",
    "outdoor_temperature_c", "hvac_runtime_min", "lighting_runtime_min",
    "equipment_kw", "expected_kwh",
)
WATER_FIELDS = (
    "ts", "water_liters", "flow_lph", "occupancy", "occupancy_pct",
    "temperature_c", "outdoor_temperature_c", "pump_runtime_min",
    "expected_liters",
)


# --------------------------------------------------------------------------
# Loading
# --------------------------------------------------------------------------
def load_frame(
    db: Session,
    building: Building,
    resource_type: str,
    start: datetime | None = None,
    end: datetime | None = None,
) -> pd.DataFrame:
    """Load one building's telemetry for one resource as a modelling frame."""
    model = READING_MODEL[resource_type]
    fields = ENERGY_FIELDS if resource_type == "ENERGY" else WATER_FIELDS

    query = select(model).where(model.building_id == building.id)
    if start is not None:
        query = query.where(model.ts >= start)
    if end is not None:
        query = query.where(model.ts < end)

    rows = db.execute(query.order_by(model.ts)).scalars().all()
    records = [{f: getattr(r, f) for f in fields} for r in rows]

    # Present both resources under a common set of column names so the ML
    # layer never has to branch on resource type.
    for rec in records:
        rec.setdefault("hvac_runtime_min", 0.0)
        rec.setdefault("lighting_runtime_min", 0.0)
        rec.setdefault("pump_runtime_min", 0.0)
        rec.setdefault("flow_lph", 0.0)

    return build_frame(records, building.operating_hours_start, building.operating_hours_end)


# --------------------------------------------------------------------------
# Expected consumption
# --------------------------------------------------------------------------
def refresh_expected(
    db: Session, building: Building, resource_type: str
) -> tuple[pd.DataFrame, object | None]:
    """
    Fit the expected-consumption model and write the prediction back onto every
    reading, so the UI can draw actual-vs-expected without re-running the model.
    """
    df = load_frame(db, building, resource_type)
    if df.empty:
        return df, None

    value_col = VALUE_COLUMN[resource_type]
    expected_col = EXPECTED_COLUMN[resource_type]

    expected, model = compute_expected(df, value_col, seed=defaults.random_seed)
    df[expected_col] = expected

    model_cls = READING_MODEL[resource_type]
    payload = [
        {"building_id": building.id, "ts": ts, expected_col: round(float(value), 3)}
        for ts, value in zip(df["ts"], expected)
    ]

    # Update by (building_id, ts): bulk_update_mappings needs primary keys, so
    # map timestamps to ids in one pass.
    id_map = dict(
        db.execute(
            select(model_cls.ts, model_cls.id).where(model_cls.building_id == building.id)
        ).all()
    )
    updates = [
        {"id": id_map[p["ts"]], expected_col: p[expected_col]}
        for p in payload
        if p["ts"] in id_map
    ]
    if updates:
        db.bulk_update_mappings(model_cls, updates)
        db.commit()

    return df, model


# --------------------------------------------------------------------------
# Detection + diagnosis + recommendation
# --------------------------------------------------------------------------
def _protected_anomaly_keys(db: Session) -> set[tuple]:
    """
    Anomalies that must survive a re-run: anything already diagnosed and
    actioned. Their recommendations may already be linked to interventions.
    """
    rows = db.execute(
        select(Anomaly).where(
            Anomaly.status.in_([AnomalyStatus.ACTIONED.value, AnomalyStatus.RESOLVED.value])
        )
    ).scalars().all()
    return {(a.building_id, a.resource_type, a.cause_code) for a in rows}


def analyse_building(
    db: Session,
    building: Building,
    resource_type: str,
    config: dict,
    replace: bool = True,
) -> list[Anomaly]:
    """Run detection + diagnosis + recommendation for one building/resource."""
    df, _model = refresh_expected(db, building, resource_type)
    if df.empty:
        return []

    events, _flagged = detect(
        df,
        building_id=building.id,
        resource_type=resource_type,
        contamination=config["iforest_contamination"],
        residual_z_threshold=config["residual_z_threshold"],
        min_deviation_pct=config["min_deviation_pct"],
        merge_gap_hours=defaults.event_merge_gap_hours,
        min_event_duration_hours=config["min_event_duration_hours"],
        cluster_gap_hours=defaults.event_cluster_gap_hours,
        seed=defaults.random_seed,
    )

    if replace:
        # Drop only the untouched anomalies for this building/resource;
        # actioned ones are audit trail and stay put.
        stale = db.execute(
            select(Anomaly).where(
                Anomaly.building_id == building.id,
                Anomaly.resource_type == resource_type,
                Anomaly.status.in_([AnomalyStatus.OPEN.value, AnomalyStatus.DIAGNOSED.value]),
            )
        ).scalars().all()
        for anomaly in stale:
            db.execute(
                delete(Recommendation).where(
                    Recommendation.anomaly_id == anomaly.id,
                    Recommendation.status == RecommendationStatus.PENDING.value,
                )
            )
            db.delete(anomaly)
        db.commit()

    protected = _protected_anomaly_keys(db)
    economics = settings_service.economics(db)
    created: list[Anomaly] = []

    for event in events:
        anomaly = Anomaly(
            building_id=building.id,
            resource_type=resource_type,
            detected_at=datetime.utcnow(),
            start_ts=event.start_ts,
            end_ts=event.end_ts,
            duration_hours=float(event.flagged_intervals),
            severity=event.severity,
            actual_value=event.actual_value,
            expected_value=event.expected_value,
            deviation_pct=event.deviation_pct,
            excess_total=event.excess_total,
            unit=event.unit,
            flagged_intervals=event.flagged_intervals,
            occurrence_days=event.occurrence_days,
            is_persistent=event.is_persistent,
            intervals=event.intervals,
            detector=event.detector,
            anomaly_score=event.anomaly_score,
            status=AnomalyStatus.OPEN.value,
        )

        # ---- diagnose immediately: an undiagnosed anomaly is not useful ----
        context = build_context(
            df, [pd.Timestamp(t) for t in event.intervals], resource_type, building
        )
        diagnosis = diagnose(context)

        anomaly.cause_code = diagnosis.cause_code
        anomaly.probable_cause = diagnosis.probable_cause
        anomaly.affected_subsystem = diagnosis.affected_subsystem
        anomaly.confidence = diagnosis.confidence
        anomaly.evidence = diagnosis.evidence_dicts()
        anomaly.diagnosis_narrative = diagnosis.narrative
        anomaly.narrative_source = "rules"
        anomaly.status = AnomalyStatus.DIAGNOSED.value

        if (building.id, resource_type, diagnosis.cause_code) in protected:
            # An intervention already covers this cause. Recording a duplicate
            # open anomaly would double-count the same waste.
            continue

        db.add(anomaly)
        db.flush()

        investigation = investigator.investigate(
            {
                column.name: getattr(anomaly, column.name)
                for column in anomaly.__table__.columns
            },
            context,
        )

        draft = build_recommendation(
            diagnosis,
            context,
            anomaly,
            electricity_tariff=economics["electricity_tariff"],
            water_tariff_per_kl=economics["water_tariff_per_kl"],
            grid_emission_factor=economics["grid_emission_factor"],
            water_emission_factor=economics["water_emission_factor"],
        )
        draft.evidence = [
            *draft.evidence,
            *normalize_investigation_evidence(investigation),
        ]

        db.add(
            Recommendation(
                anomaly_id=anomaly.id,
                building_id=building.id,
                resource_type=resource_type,
                title=draft.title,
                description=draft.description,
                reason=draft.reason,
                implementation=draft.implementation,
                evidence=draft.evidence,
                expected_saving_per_week=draft.expected_saving_per_week,
                expected_saving_unit=draft.expected_saving_unit,
                estimated_cost_saving_per_week=draft.estimated_cost_saving_per_week,
                estimated_co2_reduction_per_week=draft.estimated_co2_reduction_per_week,
                implementation_difficulty=draft.implementation_difficulty,
                priority=draft.priority,
                priority_score=draft.priority_score,
                payback_note=draft.payback_note,
                target_fault_code=draft.target_fault_code,
                status=RecommendationStatus.PENDING.value,
                narrative_source="rules",
            )
        )
        created.append(anomaly)

    db.commit()
    return created


def run_full_analysis(db: Session, building_id: int | None = None) -> dict:
    """Run the pipeline across the campus (or one building)."""
    config = settings_service.get_effective(db)
    config.setdefault("min_event_duration_hours", defaults.min_event_duration_hours)

    query = select(Building).order_by(Building.id)
    if building_id is not None:
        query = query.where(Building.id == building_id)
    buildings = db.execute(query).scalars().all()

    summary = {"buildings_analysed": 0, "anomalies_detected": 0, "by_resource": {}}
    for building in buildings:
        summary["buildings_analysed"] += 1
        for resource_type in ("ENERGY", "WATER"):
            created = analyse_building(db, building, resource_type, config)
            summary["anomalies_detected"] += len(created)
            summary["by_resource"][resource_type] = (
                summary["by_resource"].get(resource_type, 0) + len(created)
            )

    return summary


def recompute_expected_only(db: Session, building_id: int | None = None) -> int:
    """
    Refresh the expected-consumption curve without touching anomalies.

    Used after appending post-intervention telemetry, so charts stay correct
    while the anomaly audit trail is left alone.
    """
    query = select(Building).order_by(Building.id)
    if building_id is not None:
        query = query.where(Building.id == building_id)

    count = 0
    for building in db.execute(query).scalars().all():
        for resource_type in ("ENERGY", "WATER"):
            df, _ = refresh_expected(db, building, resource_type)
            count += len(df)
    return count
