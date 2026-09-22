"""
IoT Raw Telemetry Hourly Aggregation Service (Step 9).

Bridges high-frequency physical edge telemetry (5-60s) from `raw_water_telemetry`
into the canonical hourly `water_readings` database table used by EcoTwin's
Digital Twin, simulator, and ML anomaly detection pipeline.

Architectural Principles:
  1. Immutable Raw Data: Raw packets are never deleted or modified.
  2. Device & Building Scoping: Metrics are strictly aggregated per (building_id, device_id).
  3. Physical Accuracy:
       - Total Volume: Sum of interval volumes (not average).
       - Flow Rate: Time-weighted average in L/min converted to L/hour (not sum).
       - Quality & Depth: Null-aware arithmetic averages over valid non-null samples.
  4. Never Manufacture Data: Nulls are preserved; missing data is not forward-filled.
  5. Idempotence: Re-running on the same hour updates the existing record cleanly.
  6. Incomplete Hour Safety: Current/future hours are skipped unless explicitly allowed.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from ..models import Building, RawWaterTelemetry, WaterReading, utcnow
from ..schemas import AggregationResult

logger = logging.getLogger("ecotwin.aggregation")

DEFAULT_REPORT_INTERVAL_SECONDS = 15
DEFAULT_MIN_COVERAGE_PCT = 50.0
SECONDS_PER_HOUR = 3600


def to_utc_naive(dt: datetime) -> datetime:
    """Normalizes any datetime to a naive UTC datetime."""
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def floor_to_hour(dt: datetime) -> datetime:
    """Floors a datetime to the start of its UTC hour (YYYY-MM-DD HH:00:00)."""
    normalized = to_utc_naive(dt)
    return normalized.replace(minute=0, second=0, microsecond=0)


def compute_hour_aggregate(
    packets: list[RawWaterTelemetry],
    nominal_interval_seconds: int = DEFAULT_REPORT_INTERVAL_SECONDS,
) -> dict[str, Any]:
    """
    Computes physically meaningful hourly metrics from a sequence of raw packets.
    Preserves null vs. valid zero distinctions.
    """
    sample_count = len(packets)
    if sample_count == 0:
        return {
            "sample_count": 0,
            "expected_sample_count": int(round(SECONDS_PER_HOUR / nominal_interval_seconds)),
            "coverage_pct": 0.0,
            "water_liters": None,
            "flow_lph": None,
            "avg_flow_lpm": None,
            "water_level_pct": None,
            "min_water_level_pct": None,
            "max_water_level_pct": None,
            "water_level_cm": None,
            "tds_ppm": None,
            "turbidity_ntu": None,
            "pulse_count": 0,
            "sensor_errors": [],
        }

    # 1. Coverage Calculation
    intervals = [p.interval_seconds for p in packets if p.interval_seconds and p.interval_seconds > 0]
    effective_interval = int(round(sum(intervals) / len(intervals))) if intervals else nominal_interval_seconds
    if effective_interval <= 0:
        effective_interval = nominal_interval_seconds

    expected_samples = int(round(SECONDS_PER_HOUR / effective_interval))
    coverage_pct = round(min(100.0, (sample_count / expected_samples) * 100.0), 2)

    # 2. Volume: SUM of interval volumes (Volume is extensive)
    valid_volumes = [p.volume_liters for p in packets if p.volume_liters is not None]
    if valid_volumes:
        water_liters = round(sum(valid_volumes), 3)
    else:
        water_liters = None

    # 3. Flow Rate: Time-average of flow rates * 60 -> L/hour
    valid_flows = [p.flow_rate_lpm for p in packets if p.flow_rate_lpm is not None]
    if valid_flows:
        avg_flow_lpm = sum(valid_flows) / len(valid_flows)
        flow_lph = round(avg_flow_lpm * 60.0, 2)
    else:
        avg_flow_lpm = None
        flow_lph = None

    # 4. Water Level (% and cm)
    valid_levels_pct = [p.water_level_pct for p in packets if p.water_level_pct is not None]
    if valid_levels_pct:
        avg_level_pct = round(sum(valid_levels_pct) / len(valid_levels_pct), 2)
        min_level_pct = round(min(valid_levels_pct), 2)
        max_level_pct = round(max(valid_levels_pct), 2)
    else:
        avg_level_pct = None
        min_level_pct = None
        max_level_pct = None

    valid_levels_cm = [p.water_level_cm for p in packets if p.water_level_cm is not None]
    avg_level_cm = round(sum(valid_levels_cm) / len(valid_levels_cm), 2) if valid_levels_cm else None

    # 5. Water Quality (TDS and Turbidity)
    valid_tds = [p.tds_ppm for p in packets if p.tds_ppm is not None]
    avg_tds = int(round(sum(valid_tds) / len(valid_tds))) if valid_tds else None

    valid_turb = [p.turbidity_ntu for p in packets if p.turbidity_ntu is not None]
    avg_turb = round(sum(valid_turb) / len(valid_turb), 2) if valid_turb else None

    # 6. Diagnostics & Errors
    valid_pulses = [p.pulse_count for p in packets if p.pulse_count is not None]
    total_pulses = sum(valid_pulses) if valid_pulses else 0

    unique_errors = sorted(list(set(
        err for p in packets for err in (p.sensor_errors or []) if isinstance(err, str)
    )))

    return {
        "sample_count": sample_count,
        "expected_sample_count": expected_samples,
        "coverage_pct": coverage_pct,
        "water_liters": water_liters,
        "flow_lph": flow_lph,
        "avg_flow_lpm": avg_flow_lpm,
        "water_level_pct": avg_level_pct,
        "min_water_level_pct": min_level_pct,
        "max_water_level_pct": max_level_pct,
        "water_level_cm": avg_level_cm,
        "tds_ppm": avg_tds,
        "turbidity_ntu": avg_turb,
        "pulse_count": total_pulses,
        "sensor_errors": unique_errors,
    }


def aggregate_device_hour(
    db: Session,
    building_id: int,
    device_id: str,
    hour_start: datetime,
    allow_partial: bool = False,
    min_coverage_pct: float = DEFAULT_MIN_COVERAGE_PCT,
) -> AggregationResult:
    """
    Aggregates one hourly window [hour_start, hour_start + 1h) for a specific device.
    Inserts or updates the matching `water_readings` row idempotently.
    """
    # 1. Normalize timestamp window
    norm_start = floor_to_hour(hour_start)
    norm_end = norm_start + timedelta(hours=1)
    now = utcnow()

    # 2. Guard against future and incomplete current hours
    if norm_start >= now:
        return AggregationResult(
            building_id=building_id,
            device_id=device_id,
            hour_start=norm_start,
            hour_end=norm_end,
            sample_count=0,
            expected_sample_count=int(round(SECONDS_PER_HOUR / DEFAULT_REPORT_INTERVAL_SECONDS)),
            coverage_pct=0.0,
            status="SKIPPED_FUTURE_HOUR",
            aggregated=False,
            message=f"Hour start {norm_start.isoformat()} is in the future.",
        )

    if norm_end > now and not allow_partial:
        return AggregationResult(
            building_id=building_id,
            device_id=device_id,
            hour_start=norm_start,
            hour_end=norm_end,
            sample_count=0,
            expected_sample_count=int(round(SECONDS_PER_HOUR / DEFAULT_REPORT_INTERVAL_SECONDS)),
            coverage_pct=0.0,
            status="SKIPPED_CURRENT_HOUR",
            aggregated=False,
            message=(
                f"Hour window {norm_start.isoformat()} to {norm_end.isoformat()} is still in progress. "
                "Set allow_partial=True to aggregate an incomplete hour."
            ),
        )

    # 3. Building validation
    building = db.get(Building, building_id)
    if building is None:
        return AggregationResult(
            building_id=building_id,
            device_id=device_id,
            hour_start=norm_start,
            hour_end=norm_end,
            sample_count=0,
            expected_sample_count=int(round(SECONDS_PER_HOUR / DEFAULT_REPORT_INTERVAL_SECONDS)),
            coverage_pct=0.0,
            status="ERROR_UNKNOWN_BUILDING",
            aggregated=False,
            message=f"Building with id {building_id} does not exist.",
        )

    # 4. Fetch raw telemetry strictly scoped by building, device, and window
    query = (
        select(RawWaterTelemetry)
        .where(
            RawWaterTelemetry.building_id == building_id,
            RawWaterTelemetry.device_id == device_id,
            RawWaterTelemetry.received_at >= norm_start,
            RawWaterTelemetry.received_at < norm_end,
        )
        .order_by(RawWaterTelemetry.received_at.asc())
    )
    packets = list(db.execute(query).scalars().all())

    # 5. Handle empty data
    if not packets:
        return AggregationResult(
            building_id=building_id,
            device_id=device_id,
            hour_start=norm_start,
            hour_end=norm_end,
            sample_count=0,
            expected_sample_count=int(round(SECONDS_PER_HOUR / DEFAULT_REPORT_INTERVAL_SECONDS)),
            coverage_pct=0.0,
            status="NO_DATA",
            aggregated=False,
            message=f"No telemetry packets found for {device_id} in window {norm_start.isoformat()}.",
        )

    # 6. Compute metrics
    metrics = compute_hour_aggregate(packets)
    sample_count = metrics["sample_count"]
    expected_count = metrics["expected_sample_count"]
    coverage_pct = metrics["coverage_pct"]

    # 7. Check coverage threshold
    if coverage_pct < min_coverage_pct and not allow_partial:
        return AggregationResult(
            building_id=building_id,
            device_id=device_id,
            hour_start=norm_start,
            hour_end=norm_end,
            sample_count=sample_count,
            expected_sample_count=expected_count,
            coverage_pct=coverage_pct,
            status="INSUFFICIENT_COVERAGE",
            aggregated=False,
            water_liters=metrics["water_liters"],
            flow_lph=metrics["flow_lph"],
            water_level_pct=metrics["water_level_pct"],
            tds_ppm=metrics["tds_ppm"],
            turbidity_ntu=metrics["turbidity_ntu"],
            message=(
                f"Coverage {coverage_pct}% is below required minimum {min_coverage_pct}%. "
                "Hourly aggregate rejected to prevent biased baseline."
            ),
        )

    # 8. Idempotent Upsert into water_readings
    existing_reading = db.execute(
        select(WaterReading).where(
            WaterReading.building_id == building_id,
            WaterReading.ts == norm_start,
        )
    ).scalars().first()

    action = "UPDATED" if existing_reading else "CREATED"
    final_water_liters = metrics["water_liters"] if metrics["water_liters"] is not None else 0.0
    final_flow_lph = metrics["flow_lph"] if metrics["flow_lph"] is not None else 0.0

    if existing_reading:
        existing_reading.water_liters = final_water_liters
        existing_reading.flow_lph = final_flow_lph
        existing_reading.source = "esp32"
        existing_reading.water_level_pct = metrics["water_level_pct"]
        existing_reading.tds_ppm = metrics["tds_ppm"]
        existing_reading.turbidity_ntu = metrics["turbidity_ntu"]
        reading_record = existing_reading
    else:
        reading_record = WaterReading(
            building_id=building_id,
            ts=norm_start,
            water_liters=final_water_liters,
            flow_lph=final_flow_lph,
            source="esp32",
            water_level_pct=metrics["water_level_pct"],
            tds_ppm=metrics["tds_ppm"],
            turbidity_ntu=metrics["turbidity_ntu"],
        )
        db.add(reading_record)

    db.commit()
    db.refresh(reading_record)

    logger.info(
        "Aggregated hour: building=%d device=%s ts=%s action=%s samples=%d (%.1f%%) liters=%.2f",
        building_id,
        device_id,
        norm_start.isoformat(),
        action,
        sample_count,
        coverage_pct,
        final_water_liters,
    )

    return AggregationResult(
        building_id=building_id,
        device_id=device_id,
        hour_start=norm_start,
        hour_end=norm_end,
        sample_count=sample_count,
        expected_sample_count=expected_count,
        coverage_pct=coverage_pct,
        status="SUCCESS",
        aggregated=True,
        action=action,
        water_liters=final_water_liters,
        flow_lph=final_flow_lph,
        water_level_pct=metrics["water_level_pct"],
        tds_ppm=metrics["tds_ppm"],
        turbidity_ntu=metrics["turbidity_ntu"],
        reading_id=reading_record.id,
        message=f"Successfully {action.lower()} hourly water reading from ESP32 telemetry.",
    )


def aggregate_completed_hours(
    db: Session,
    building_id: int | None = None,
    device_id: str | None = None,
    lookback_hours: int = 24,
    min_coverage_pct: float = DEFAULT_MIN_COVERAGE_PCT,
) -> list[AggregationResult]:
    """
    Finds and aggregates all completed hours with raw telemetry within the lookback window.
    Safe to execute periodically via cron or worker task.
    """
    now = utcnow()
    cutoff = now - timedelta(hours=lookback_hours)
    last_completed_hour = floor_to_hour(now)

    query = (
        select(RawWaterTelemetry.building_id, RawWaterTelemetry.device_id, RawWaterTelemetry.received_at)
        .where(
            RawWaterTelemetry.received_at >= cutoff,
            RawWaterTelemetry.received_at < last_completed_hour,
        )
    )
    if building_id is not None:
        query = query.where(RawWaterTelemetry.building_id == building_id)
    if device_id is not None:
        query = query.where(RawWaterTelemetry.device_id == device_id)

    rows = db.execute(query).all()

    # Determine unique (bldg, dev, hour_start) combinations
    distinct_hours: set[tuple[int, str, datetime]] = set()
    for b_id, d_id, r_at in rows:
        distinct_hours.add((b_id, d_id, floor_to_hour(r_at)))

    results: list[AggregationResult] = []
    for b_id, d_id, h_start in sorted(distinct_hours, key=lambda x: (x[0], x[1], x[2])):
        res = aggregate_device_hour(
            db=db,
            building_id=b_id,
            device_id=d_id,
            hour_start=h_start,
            allow_partial=False,
            min_coverage_pct=min_coverage_pct,
        )
        results.append(res)

    return results
