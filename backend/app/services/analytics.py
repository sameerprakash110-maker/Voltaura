"""
Read-side analytics.

Assembles the payloads the dashboard, building pages and reports render.
Aggregation is done in pandas rather than dialect-specific SQL date functions,
which keeps the whole layer portable between SQLite and PostgreSQL at the cost
of a few tens of thousands of rows per request -- irrelevant at campus scale,
and the honest trade for a prototype that must move to Postgres cleanly.

Every figure returned here traces back to a stored reading or a stored
calculation. Nothing on the dashboard is a constant.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

import pandas as pd
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import (
    Anomaly,
    AnomalyStatus,
    Building,
    BuildingStatus,
    EnergyReading,
    Intervention,
    InterventionStatus,
    Recommendation,
    RecommendationStatus,
    VerificationResult,
    WaterReading,
)
from . import settings_service, simulation

WEEKS_PER_YEAR = 52.0
SEVERITY_ORDER = {"CRITICAL": 3, "HIGH": 2, "MEDIUM": 1, "LOW": 0}

ENERGY_COLS = (
    EnergyReading.building_id, EnergyReading.ts, EnergyReading.energy_kwh,
    EnergyReading.expected_kwh, EnergyReading.occupancy, EnergyReading.occupancy_pct,
    EnergyReading.temperature_c, EnergyReading.outdoor_temperature_c,
    EnergyReading.hvac_runtime_min, EnergyReading.lighting_runtime_min,
)
WATER_COLS = (
    WaterReading.building_id, WaterReading.ts, WaterReading.water_liters,
    WaterReading.expected_liters, WaterReading.flow_lph, WaterReading.occupancy,
    WaterReading.occupancy_pct, WaterReading.temperature_c,
    WaterReading.outdoor_temperature_c, WaterReading.pump_runtime_min,
)


# --------------------------------------------------------------------------
# Loading helpers
# --------------------------------------------------------------------------
def _frame(db: Session, columns, model, start: datetime, end: datetime,
           building_id: int | None = None) -> pd.DataFrame:
    cache = db.info.setdefault("analytics_frames", {})
    cache_key = (model, tuple(c.key for c in columns), start, end, building_id)
    if cache_key in cache:
        return cache[cache_key]
    query = select(*columns).where(model.ts >= start, model.ts <= end)
    if building_id is not None:
        query = query.where(model.building_id == building_id)
    rows = db.execute(query.order_by(model.ts)).all()
    if not rows:
        df = pd.DataFrame(columns=[c.key for c in columns])
        cache[cache_key] = df
        return df
    df = pd.DataFrame(rows, columns=[c.key for c in columns])
    df["ts"] = pd.to_datetime(df["ts"])
    cache[cache_key] = df
    return df


def energy_frame(db, start, end, building_id=None) -> pd.DataFrame:
    return _frame(db, ENERGY_COLS, EnergyReading, start, end, building_id)


def water_frame(db, start, end, building_id=None) -> pd.DataFrame:
    return _frame(db, WATER_COLS, WaterReading, start, end, building_id)


def window(db: Session, days: int) -> tuple[datetime, datetime, datetime, datetime]:
    """Current window and the equal-length window immediately before it."""
    end = simulation.data_end(db)
    start = end - timedelta(days=days)
    prev_end = start
    prev_start = prev_end - timedelta(days=days)
    return start, end, prev_start, prev_end


def pick_interval(days: int) -> str:
    return "hour" if days <= 7 else "day"


def _bucket(df: pd.DataFrame, interval: str) -> pd.Series:
    if interval == "hour":
        return df["ts"].dt.floor("h")
    return df["ts"].dt.floor("D")


def _comparable(df: pd.DataFrame, actual_col: str, expected_col: str) -> tuple[float, float]:
    """
    Sum actual and expected over only the intervals that have both.

    Any interval whose expectation has not been computed yet is excluded from
    both sides, so the comparison stays like-for-like.
    """
    if df.empty or expected_col not in df.columns:
        return 0.0, 0.0
    mask = df[expected_col].notna()
    if not mask.any():
        return 0.0, 0.0
    return float(df.loc[mask, actual_col].sum()), float(df.loc[mask, expected_col].sum())


def _change_pct(current: float, previous: float) -> float | None:
    if previous is None or abs(previous) < 1e-9:
        return None
    return round((current - previous) / previous * 100.0, 1)


# --------------------------------------------------------------------------
# Building status
# --------------------------------------------------------------------------
def _status_from_anomalies(anomalies: list[Anomaly]) -> tuple[str, str | None, int]:
    open_ones = [
        a for a in anomalies
        if a.status in (AnomalyStatus.OPEN.value, AnomalyStatus.DIAGNOSED.value)
    ]
    if not open_ones:
        return BuildingStatus.NORMAL.value, None, 0
    top = max(open_ones, key=lambda a: SEVERITY_ORDER.get(a.severity, 0))
    critical = sum(1 for a in open_ones if a.severity in ("CRITICAL", "HIGH"))
    status = (
        BuildingStatus.CRITICAL.value
        if top.severity in ("CRITICAL", "HIGH")
        else BuildingStatus.WARNING.value
    )
    return status, top.severity, critical


def building_summaries(db: Session, days: int = 30) -> list[dict[str, Any]]:
    """One row per building: consumption, live state, anomaly status."""
    start, end, _, _ = window(db, days)
    buildings = db.execute(select(Building).order_by(Building.id)).scalars().all()

    energy = energy_frame(db, start, end)
    water = water_frame(db, start, end)

    anomalies = db.execute(select(Anomaly)).scalars().all()
    by_building: dict[int, list[Anomaly]] = {}
    for anomaly in anomalies:
        by_building.setdefault(anomaly.building_id, []).append(anomaly)

    recommendations = db.execute(
        select(Recommendation)
        .where(Recommendation.status == RecommendationStatus.PENDING.value)
        .order_by(Recommendation.priority_score.desc())
    ).scalars().all()
    top_recommendation: dict[int, Recommendation] = {}
    for rec in recommendations:
        top_recommendation.setdefault(rec.building_id, rec)

    verified = db.execute(
        select(VerificationResult).where(VerificationResult.status == "VERIFIED")
    ).scalars().all()

    results: list[dict[str, Any]] = []
    for building in buildings:
        e = energy[energy["building_id"] == building.id] if len(energy) else energy
        w = water[water["building_id"] == building.id] if len(water) else water

        # Totals use every metered interval. The deviation, however, is only
        # meaningful over intervals that actually carry a model expectation:
        # treating a missing expectation as zero would turn any gap in the
        # model output into an enormous fake over-consumption.
        e_actual = float(e["energy_kwh"].sum()) if len(e) else 0.0
        w_actual = float(w["water_liters"].sum()) if len(w) else 0.0
        e_actual_cmp, e_expected = _comparable(e, "energy_kwh", "expected_kwh")
        w_actual_cmp, w_expected = _comparable(w, "water_liters", "expected_liters")

        latest_e = e.iloc[-1] if len(e) else None
        latest_w = w.iloc[-1] if len(w) else None

        status, top_severity, critical = _status_from_anomalies(by_building.get(building.id, []))
        open_count = sum(
            1 for a in by_building.get(building.id, [])
            if a.status in (AnomalyStatus.OPEN.value, AnomalyStatus.DIAGNOSED.value)
        )
        rec = top_recommendation.get(building.id)

        results.append({
            "id": building.id,
            "code": building.code,
            "name": building.name,
            "category": building.category,
            "description": building.description,
            "area_sqm": building.area_sqm,
            "floors": building.floors,
            "occupancy_capacity": building.occupancy_capacity,
            "operating_hours_start": building.operating_hours_start,
            "operating_hours_end": building.operating_hours_end,
            "year_built": building.year_built,
            "twin_x": building.twin_x, "twin_z": building.twin_z,
            "twin_w": building.twin_w, "twin_d": building.twin_d,
            "twin_h": building.twin_h, "twin_rotation": building.twin_rotation,
            "status": status,
            "energy_kwh": round(e_actual, 2),
            "water_liters": round(w_actual, 2),
            "energy_expected_kwh": round(e_expected, 2),
            "water_expected_liters": round(w_expected, 2),
            "energy_deviation_pct": round((e_actual_cmp - e_expected) / e_expected * 100, 2) if e_expected > 1e-9 else 0.0,
            "water_deviation_pct": round((w_actual_cmp - w_expected) / w_expected * 100, 2) if w_expected > 1e-9 else 0.0,
            "occupancy_now": int(latest_e["occupancy"]) if latest_e is not None else 0,
            "occupancy_pct_now": round(float(latest_e["occupancy_pct"]), 1) if latest_e is not None else 0.0,
            "temperature_now": round(float(latest_e["temperature_c"]), 1) if latest_e is not None else 0.0,
            "hvac_runtime_now": round(float(latest_e["hvac_runtime_min"]), 1) if latest_e is not None else 0.0,
            "lighting_runtime_now": round(float(latest_e["lighting_runtime_min"]), 1) if latest_e is not None else 0.0,
            "pump_runtime_now": round(float(latest_w["pump_runtime_min"]), 1) if latest_w is not None else 0.0,
            "open_anomalies": open_count,
            "critical_anomalies": critical,
            "top_severity": top_severity,
            "active_recommendation": rec.title if rec else None,
            "active_recommendation_id": rec.id if rec else None,
            "energy_intensity": round(e_actual / building.area_sqm, 3) if building.area_sqm else 0.0,
            "verified_savings_energy": round(sum(
                v.absolute_saving for v in verified
                if v.building_id == building.id and v.resource_type == "ENERGY"
            ), 2),
            "verified_savings_water": round(sum(
                v.absolute_saving for v in verified
                if v.building_id == building.id and v.resource_type == "WATER"
            ), 2),
        })

    return results


# --------------------------------------------------------------------------
# Series
# --------------------------------------------------------------------------
def campus_series(db: Session, days: int, resource: str = "ALL") -> list[dict[str, Any]]:
    """Campus-wide consumption, bucketed by hour or day."""
    start, end, _, _ = window(db, days)
    interval = pick_interval(days)
    points: dict[pd.Timestamp, dict[str, Any]] = {}

    if resource in ("ALL", "ENERGY"):
        e = energy_frame(db, start, end)
        if len(e):
            e = e.assign(bucket=_bucket(e, interval))
            grouped = e.groupby("bucket").agg(
                energy=("energy_kwh", "sum"),
                energy_expected=("expected_kwh", "sum"),
                expected_n=("expected_kwh", "count"),
            )
            for ts, row in grouped.iterrows():
                points.setdefault(ts, {})["energy"] = round(float(row["energy"]), 2)
                points[ts]["energy_expected"] = (
                    round(float(row["energy_expected"]), 2)
                    if row["expected_n"] > 0
                    else None
                )

    if resource in ("ALL", "WATER"):
        w = water_frame(db, start, end)
        if len(w):
            w = w.assign(bucket=_bucket(w, interval))
            grouped = w.groupby("bucket").agg(
                water=("water_liters", "sum"),
                water_expected=("expected_liters", "sum"),
                expected_n=("expected_liters", "count"),
            )
            for ts, row in grouped.iterrows():
                points.setdefault(ts, {})["water"] = round(float(row["water"]), 2)
                points[ts]["water_expected"] = (
                    round(float(row["water_expected"]), 2)
                    if row["expected_n"] > 0
                    else None
                )

    fmt = "%d %b %H:%M" if interval == "hour" else "%d %b"
    return [
        {"ts": ts.to_pydatetime(), "label": ts.strftime(fmt), **values}
        for ts, values in sorted(points.items())
    ]


def building_series(
    db: Session, building: Building, resource: str, days: int,
    anomalous_timestamps: set | None = None,
    frame: pd.DataFrame | None = None,
) -> list[dict[str, Any]]:
    """One building's telemetry, with anomalous intervals marked."""
    start, end, _, _ = window(db, days)
    interval = pick_interval(days)
    anomalous_timestamps = anomalous_timestamps or set()

    if frame is not None:
        df = frame[(frame["ts"] >= start) & (frame["ts"] <= end)].copy()
    elif resource == "ENERGY":
        df = energy_frame(db, start, end, building.id)
        value, expected = "energy_kwh", "expected_kwh"
    else:
        df = water_frame(db, start, end, building.id)
        value, expected = "water_liters", "expected_liters"

    if resource == "ENERGY":
        value, expected = "energy_kwh", "expected_kwh"
    else:
        value, expected = "water_liters", "expected_liters"

    if df.empty:
        return []

    df = df.copy()
    df["is_anomalous"] = df["ts"].isin(anomalous_timestamps)

    if interval == "hour":
        records = df
        agg = None
    else:
        df["bucket"] = _bucket(df, interval)
        spec: dict[str, Any] = {
            "actual": (value, "sum"),
            "expected": (expected, "sum"),
            "occupancy": ("occupancy", "mean"),
            "occupancy_pct": ("occupancy_pct", "mean"),
            "temperature": ("temperature_c", "mean"),
            "outdoor_temperature": ("outdoor_temperature_c", "mean"),
            "is_anomalous": ("is_anomalous", "any"),
        }
        if resource == "ENERGY":
            spec["hvac_runtime"] = ("hvac_runtime_min", "mean")
            spec["lighting_runtime"] = ("lighting_runtime_min", "mean")
        else:
            spec["pump_runtime"] = ("pump_runtime_min", "mean")
            spec["flow_lph"] = ("flow_lph", "mean")
        agg = df.groupby("bucket").agg(**spec).reset_index()
        records = agg

    out: list[dict[str, Any]] = []
    for _, row in records.iterrows():
        if agg is None:
            point = {
                "ts": row["ts"].to_pydatetime(),
                "actual": round(float(row[value]), 3),
                "expected": round(float(row[expected]), 3) if pd.notna(row[expected]) else None,
                "occupancy": float(row["occupancy"]),
                "occupancy_pct": round(float(row["occupancy_pct"]), 2),
                "temperature": round(float(row["temperature_c"]), 2),
                "outdoor_temperature": round(float(row["outdoor_temperature_c"]), 2),
                "is_anomalous": bool(row["is_anomalous"]),
            }
            if resource == "ENERGY":
                point["hvac_runtime"] = round(float(row["hvac_runtime_min"]), 2)
                point["lighting_runtime"] = round(float(row["lighting_runtime_min"]), 2)
            else:
                point["pump_runtime"] = round(float(row["pump_runtime_min"]), 2)
                point["flow_lph"] = round(float(row["flow_lph"]), 2)
        else:
            point = {
                "ts": row["bucket"].to_pydatetime(),
                "actual": round(float(row["actual"]), 3),
                "expected": round(float(row["expected"]), 3) if pd.notna(row["expected"]) else None,
                "occupancy": round(float(row["occupancy"]), 1),
                "occupancy_pct": round(float(row["occupancy_pct"]), 2),
                "temperature": round(float(row["temperature"]), 2),
                "outdoor_temperature": round(float(row["outdoor_temperature"]), 2),
                "is_anomalous": bool(row["is_anomalous"]),
            }
            for key in ("hvac_runtime", "lighting_runtime", "pump_runtime", "flow_lph"):
                if key in row:
                    point[key] = round(float(row[key]), 2)
        out.append(point)
    return out


# --------------------------------------------------------------------------
# KPIs
# --------------------------------------------------------------------------
def build_kpis(db: Session, days: int) -> list[dict[str, Any]]:
    start, end, prev_start, prev_end = window(db, days)
    n_buildings = db.execute(select(func.count(Building.id))).scalar() or 0
    econ = settings_service.economics(db)
    symbol = econ["currency_symbol"]

    e_now = db.execute(
        select(func.sum(EnergyReading.energy_kwh)).where(
            EnergyReading.ts >= start, EnergyReading.ts <= end)
    ).scalar() or 0.0
    e_prev = db.execute(
        select(func.sum(EnergyReading.energy_kwh)).where(
            EnergyReading.ts >= prev_start, EnergyReading.ts < prev_end)
    ).scalar() or 0.0
    w_now = db.execute(
        select(func.sum(WaterReading.water_liters)).where(
            WaterReading.ts >= start, WaterReading.ts <= end)
    ).scalar() or 0.0
    w_prev = db.execute(
        select(func.sum(WaterReading.water_liters)).where(
            WaterReading.ts >= prev_start, WaterReading.ts < prev_end)
    ).scalar() or 0.0

    open_anomalies = db.execute(
        select(func.count(Anomaly.id)).where(
            Anomaly.status.in_([AnomalyStatus.OPEN.value, AnomalyStatus.DIAGNOSED.value]))
    ).scalar() or 0
    anomalies_this = db.execute(
        select(func.count(Anomaly.id)).where(Anomaly.end_ts >= start, Anomaly.start_ts <= end)
    ).scalar() or 0
    anomalies_prev = db.execute(
        select(func.count(Anomaly.id)).where(
            Anomaly.end_ts >= prev_start, Anomaly.start_ts < prev_end)
    ).scalar() or 0

    verified = db.execute(
        select(VerificationResult).where(VerificationResult.status == "VERIFIED")
    ).scalars().all()
    # One verification per intervention: keep only the newest for each.
    latest: dict[int, VerificationResult] = {}
    for v in sorted(verified, key=lambda r: (r.created_at, r.id)):
        latest[v.intervention_id] = v
    verified_list = list(latest.values())

    money_per_year = sum(v.financial_saving_per_year for v in verified_list)
    co2_per_year = sum(v.co2_reduction_per_year for v in verified_list)
    energy_saved_week = sum(v.absolute_saving for v in verified_list if v.resource_type == "ENERGY")
    water_saved_week = sum(v.absolute_saving for v in verified_list if v.resource_type == "WATER")

    def direction(change: float | None) -> str:
        if change is None or abs(change) < 0.05:
            return "flat"
        return "up" if change > 0 else "down"

    e_change = _change_pct(float(e_now), float(e_prev))
    w_change = _change_pct(float(w_now), float(w_prev))
    a_change = _change_pct(float(anomalies_this), float(anomalies_prev))

    return [
        {
            "key": "energy", "label": "Total Energy Consumption",
            "value": round(float(e_now), 1), "unit": "kWh",
            "change_pct": e_change, "previous_value": round(float(e_prev), 1),
            "direction": direction(e_change), "good_direction": "down",
            "caption": f"Metered across {n_buildings} blocks over {days} days", "measured": True,
        },
        {
            "key": "water", "label": "Total Water Consumption",
            "value": round(float(w_now) / 1000.0, 1), "unit": "kL",
            "change_pct": w_change, "previous_value": round(float(w_prev) / 1000.0, 1),
            "direction": direction(w_change), "good_direction": "down",
            "caption": f"Metered across {n_buildings} blocks over {days} days", "measured": True,
        },
        {
            "key": "anomalies", "label": "Active Anomalies",
            "value": float(open_anomalies), "unit": "open",
            "change_pct": a_change, "previous_value": float(anomalies_prev),
            "direction": direction(a_change), "good_direction": "down",
            "caption": "Detected and diagnosed, awaiting intervention", "measured": True,
        },
        {
            "key": "savings", "label": "Verified Savings",
            "value": round(money_per_year, 0), "unit": f"{symbol}/yr",
            "change_pct": None, "previous_value": None, "direction": "flat",
            "good_direction": "up",
            "caption": (
                f"{len(verified_list)} verified intervention"
                f"{'' if len(verified_list) == 1 else 's'} | "
                f"{energy_saved_week:,.0f} kWh + {water_saved_week / 1000:,.1f} kL per week"
            ),
            "measured": True,
        },
        {
            "key": "co2", "label": "CO2 Reduction",
            "value": round(co2_per_year / 1000.0, 2), "unit": "tCO2e/yr",
            "change_pct": None, "previous_value": None, "direction": "flat",
            "good_direction": "up",
            "caption": (
                f"At {econ['grid_emission_factor']} kg CO2e/kWh, annualised from "
                "verified weekly savings"
            ),
            "measured": True,
        },
    ]


# --------------------------------------------------------------------------
# Pipeline status (the product loop, as data)
# --------------------------------------------------------------------------
def pipeline_status(db: Session) -> dict[str, Any]:
    buildings = db.execute(select(func.count(Building.id))).scalar() or 0
    readings = (db.execute(select(func.count(EnergyReading.id))).scalar() or 0) + (
        db.execute(select(func.count(WaterReading.id))).scalar() or 0
    )
    anomalies = db.execute(select(func.count(Anomaly.id))).scalar() or 0
    diagnosed = db.execute(
        select(func.count(Anomaly.id)).where(Anomaly.cause_code.isnot(None))
    ).scalar() or 0
    pending = db.execute(
        select(func.count(Recommendation.id)).where(
            Recommendation.status == RecommendationStatus.PENDING.value)
    ).scalar() or 0
    interventions = db.execute(select(func.count(Intervention.id))).scalar() or 0
    monitoring = db.execute(
        select(func.count(Intervention.id)).where(
            Intervention.status.in_([
                InterventionStatus.ACTIVE.value, InterventionStatus.MONITORING.value]))
    ).scalar() or 0
    verified = db.execute(
        select(func.count(Intervention.id)).where(
            Intervention.status == InterventionStatus.VERIFIED.value)
    ).scalar() or 0

    return {
        "stages": [
            {"key": "data", "label": "Data", "value": readings,
             "caption": "hourly intervals ingested"},
            {"key": "monitor", "label": "Monitor", "value": buildings,
             "caption": "blocks under continuous baseline"},
            {"key": "detect", "label": "Detect", "value": anomalies,
             "caption": "anomaly events found"},
            {"key": "diagnose", "label": "Diagnose", "value": diagnosed,
             "caption": "root causes identified"},
            {"key": "recommend", "label": "Recommend", "value": pending,
             "caption": "recommendations awaiting action"},
            {"key": "intervene", "label": "Intervene", "value": interventions,
             "caption": "interventions applied"},
            {"key": "verify", "label": "Verify", "value": verified,
             "caption": "savings verified"},
        ],
        "monitoring": monitoring,
    }


# --------------------------------------------------------------------------
# Reports
# --------------------------------------------------------------------------
def build_report(db: Session, days: int = 90) -> dict[str, Any]:
    start, end, _, _ = window(db, days)
    econ = settings_service.economics(db)

    verifications = db.execute(
        select(VerificationResult).order_by(VerificationResult.created_at.desc())
    ).scalars().all()
    latest: dict[int, VerificationResult] = {}
    for v in sorted(verifications, key=lambda r: (r.created_at, r.id)):
        latest[v.intervention_id] = v
    verified = [v for v in latest.values() if v.status == "VERIFIED"]

    energy_week = sum(v.absolute_saving for v in verified if v.resource_type == "ENERGY")
    water_week = sum(v.absolute_saving for v in verified if v.resource_type == "WATER")
    money_week = sum(v.financial_saving_per_week for v in verified)
    co2_week = sum(v.co2_reduction_per_week for v in verified)

    anomalies = db.execute(select(Anomaly)).scalars().all()
    by_severity: dict[str, int] = {}
    by_cause: dict[str, int] = {}
    by_resource: dict[str, int] = {}
    for a in anomalies:
        by_severity[a.severity] = by_severity.get(a.severity, 0) + 1
        by_resource[a.resource_type] = by_resource.get(a.resource_type, 0) + 1
        if a.probable_cause:
            by_cause[a.probable_cause] = by_cause.get(a.probable_cause, 0) + 1

    buildings = db.execute(select(Building).order_by(Building.id)).scalars().all()
    e = energy_frame(db, start, end)
    w = water_frame(db, start, end)

    by_building = []
    for b in buildings:
        eb = e[e["building_id"] == b.id] if len(e) else e
        wb = w[w["building_id"] == b.id] if len(w) else w
        v_energy = sum(v.absolute_saving for v in verified
                       if v.building_id == b.id and v.resource_type == "ENERGY")
        v_water = sum(v.absolute_saving for v in verified
                      if v.building_id == b.id and v.resource_type == "WATER")
        by_building.append({
            "building_id": b.id, "code": b.code, "name": b.name,
            "area_sqm": b.area_sqm,
            "energy_kwh": round(float(eb["energy_kwh"].sum()) if len(eb) else 0.0, 1),
            "water_kl": round((float(wb["water_liters"].sum()) if len(wb) else 0.0) / 1000.0, 2),
            "energy_intensity": round(
                (float(eb["energy_kwh"].sum()) if len(eb) else 0.0) / b.area_sqm, 3
            ) if b.area_sqm else 0.0,
            "anomalies": sum(1 for a in anomalies if a.building_id == b.id),
            "verified_energy_saving_week": round(v_energy, 1),
            "verified_water_saving_week": round(v_water, 1),
            "verified_money_year": round(sum(
                v.financial_saving_per_year for v in verified if v.building_id == b.id), 0),
        })

    interventions = db.execute(select(Intervention)).scalars().all()

    return {
        "generated_at": datetime.utcnow(),
        "period_start": start,
        "period_end": end,
        "totals": {
            "energy_saved_per_week": round(energy_week, 1),
            "energy_saved_per_year": round(energy_week * WEEKS_PER_YEAR, 0),
            "water_saved_per_week_kl": round(water_week / 1000.0, 2),
            "water_saved_per_year_kl": round(water_week * WEEKS_PER_YEAR / 1000.0, 1),
            "financial_saving_per_week": round(money_week, 0),
            "financial_saving_per_year": round(money_week * WEEKS_PER_YEAR, 0),
            "co2_reduction_per_week": round(co2_week, 1),
            "co2_reduction_per_year_tonnes": round(co2_week * WEEKS_PER_YEAR / 1000.0, 2),
            "anomalies_detected": len(anomalies),
            "interventions_applied": len(interventions),
            "interventions_verified": len(verified),
            "total_energy_consumed": round(float(e["energy_kwh"].sum()) if len(e) else 0.0, 0),
            "total_water_consumed_kl": round(
                (float(w["water_liters"].sum()) if len(w) else 0.0) / 1000.0, 1),
            "verification_rate_pct": round(
                len(verified) / len(interventions) * 100.0, 1) if interventions else 0.0,
        },
        "by_building": by_building,
        "by_resource": {
            "anomalies": by_resource,
            "energy_saved_per_week": round(energy_week, 1),
            "water_saved_per_week": round(water_week, 1),
        },
        "anomaly_breakdown": {"by_severity": by_severity, "by_cause": by_cause},
        "verified": verified,
        "economics": econ,
        "methodology": [
            {"stage": "Expected consumption",
             "method": "Random Forest regression on occupancy, outdoor temperature, "
                       "hour-of-day, day-of-week and schedule, with a robust re-fit that "
                       "trims fault-affected intervals from the training set."},
            {"stage": "Anomaly detection",
             "method": "Isolation Forest over the contextual feature vector, required to "
                       "agree with a hour-of-day-normalised robust residual z-score. Only "
                       "over-consumption is reported."},
            {"stage": "Root cause",
             "method": "Deterministic weighted rule engine over measured evidence. "
                       "Confidence is the satisfied share of rule weight, discounted for "
                       "competing hypotheses and sample size."},
            {"stage": "Savings verification",
             "method": "IPMVP Option C. A baseline model fitted on the pre-intervention "
                       "window is evaluated on the post period's own drivers to give an "
                       "adjusted baseline, then compared by Welch t-test."},
        ],
    }
