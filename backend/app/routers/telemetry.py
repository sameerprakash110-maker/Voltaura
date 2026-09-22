"""
IoT Device Telemetry Ingestion Router.

Provides dedicated endpoints for high-frequency edge telemetry (e.g. ESP32 nodes)
before hourly aggregation into the existing `water_readings` pipeline.
"""
from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models import Building, RawWaterTelemetry, WaterReading, utcnow
from ..schemas import (
    AggregatedReadingItem,
    AggregationResult,
    AggregationTriggerRequest,
    RawTelemetryItem,
    TelemetryIngestionRequest,
    TelemetryIngestionResponse,
)
from ..services.telemetry_aggregation import (
    aggregate_device_hour,
    floor_to_hour,
    to_utc_naive,
)

logger = logging.getLogger("ecotwin.telemetry")

router = APIRouter(prefix="/telemetry", tags=["telemetry"])


def verify_device_authorization(
    sensor_key: str | None,
    device_id: str,
    building_id: int,
    db: Session,
) -> None:
    """
    Validates X-Sensor-Key against the configured device registry, verifies
    that the key is mapped to the claimed device_id, confirms that the target
    building exists in the database, and ensures the device is authorized
    for that specific building.
    """
    if not sensor_key:
        raise HTTPException(
            status_code=401,
            detail="Missing required authentication header: 'X-Sensor-Key'.",
        )

    registry = settings.authorized_devices
    device_entry = registry.get(sensor_key)
    if not device_entry:
        raise HTTPException(
            status_code=403,
            detail="Invalid or unauthorized X-Sensor-Key.",
        )

    # 1. Device identity authorization
    authorized_device_id = device_entry.get("device_id")
    if authorized_device_id != device_id:
        raise HTTPException(
            status_code=403,
            detail=(
                f"Sensor key is authorized for device '{authorized_device_id}', "
                f"not '{device_id}'."
            ),
        )

    # 2. Building existence check (must refer to a real existing building in DB)
    building = db.get(Building, building_id)
    if building is None:
        raise HTTPException(
            status_code=404,
            detail=f"Building with id {building_id} does not exist.",
        )

    # 3. Device/building authorization (device cannot arbitrarily claim another building)
    authorized_building_id = device_entry.get("building_id")
    if authorized_building_id != building_id:
        raise HTTPException(
            status_code=403,
            detail=(
                f"Device '{device_id}' is not authorized for building {building_id} "
                f"(registered for building {authorized_building_id})."
            ),
        )


def _ingest_telemetry_packet(
    payload: TelemetryIngestionRequest,
    sensor_key: str | None,
    db: Session,
) -> TelemetryIngestionResponse:
    """Shared ingestion handler for POST /api/telemetry and POST /api/telemetry/water."""
    verify_device_authorization(
        sensor_key=sensor_key,
        device_id=payload.device_id,
        building_id=payload.building_id,
        db=db,
    )

    diag = payload.diagnostics
    record = RawWaterTelemetry(
        device_id=payload.device_id,
        building_id=payload.building_id,
        schema_version=payload.schema_version,
        source=payload.source,
        device_timestamp=payload.timestamp,
        received_at=utcnow(),
        interval_seconds=payload.interval_seconds,
        water_level_pct=payload.water_level_pct,
        water_level_cm=payload.water_level_cm,
        flow_rate_lpm=payload.flow_rate_lpm,
        volume_liters=payload.volume_liters,
        tds_ppm=payload.tds_ppm,
        turbidity_ntu=payload.turbidity_ntu,
        pulse_count=diag.pulse_count if diag else None,
        distance_raw_cm=diag.distance_raw_cm if diag else None,
        tds_voltage_mv=diag.tds_voltage_mv if diag else None,
        turbidity_voltage_mv=diag.turbidity_voltage_mv if diag else None,
        rssi_dbm=diag.rssi_dbm if diag else None,
        uptime_seconds=diag.uptime_seconds if diag else None,
        free_heap_bytes=diag.free_heap_bytes if diag else None,
        sensor_errors=payload.sensor_errors,
        raw_payload=payload.model_dump(mode="json"),
    )

    try:
        db.add(record)
        db.commit()
        db.refresh(record)
    except Exception as exc:
        db.rollback()
        logger.error("Failed to persist telemetry from device %s: %s", payload.device_id, exc)
        raise HTTPException(
            status_code=500,
            detail="Database persistence error while recording telemetry.",
        ) from exc

    logger.info(
        "Ingested telemetry: device=%s building=%d id=%d interval=%ds",
        record.device_id,
        record.building_id,
        record.id,
        record.interval_seconds,
    )

    return TelemetryIngestionResponse(
        success=True,
        message="Telemetry accepted",
        id=record.id,
        received_at=record.received_at,
    )


@router.post(
    "",
    response_model=TelemetryIngestionResponse,
    status_code=200,
    summary="Ingest edge node telemetry",
)
def ingest_telemetry(
    payload: TelemetryIngestionRequest,
    x_sensor_key: Annotated[str | None, Header(alias="X-Sensor-Key")] = None,
    db: Session = Depends(get_db),
) -> TelemetryIngestionResponse:
    """
    Ingests a canonical JSON telemetry packet from an authorized physical edge node.
    Requires 'X-Sensor-Key' header for authentication.
    """
    return _ingest_telemetry_packet(payload, x_sensor_key, db)


@router.post(
    "/water",
    response_model=TelemetryIngestionResponse,
    status_code=200,
    summary="Ingest edge node water telemetry (alias)",
)
def ingest_water_telemetry(
    payload: TelemetryIngestionRequest,
    x_sensor_key: Annotated[str | None, Header(alias="X-Sensor-Key")] = None,
    db: Session = Depends(get_db),
) -> TelemetryIngestionResponse:
    """Explicit water telemetry ingestion alias matching /api/telemetry/water."""
    return _ingest_telemetry_packet(payload, x_sensor_key, db)


@router.get(
    "",
    response_model=list[RawTelemetryItem],
    summary="Query ingested raw telemetry records",
)
def get_raw_telemetry(
    building_id: int | None = Query(None, description="Filter by building ID"),
    device_id: str | None = Query(None, description="Filter by device ID"),
    start: datetime | None = Query(None, description="Earliest received_at (UTC)"),
    end: datetime | None = Query(None, description="Latest received_at (UTC)"),
    limit: int = Query(50, ge=1, le=500, description="Max records to return"),
    db: Session = Depends(get_db),
) -> list[RawWaterTelemetry]:
    """Retrieves recent raw telemetry records for diagnostics and verification."""
    query = select(RawWaterTelemetry).order_by(desc(RawWaterTelemetry.received_at)).limit(limit)

    if building_id is not None:
        query = query.where(RawWaterTelemetry.building_id == building_id)
    if device_id is not None:
        query = query.where(RawWaterTelemetry.device_id == device_id)
    if start is not None:
        query = query.where(RawWaterTelemetry.received_at >= to_utc_naive(start))
    if end is not None:
        query = query.where(RawWaterTelemetry.received_at <= to_utc_naive(end))

    return list(db.execute(query).scalars().all())


@router.get(
    "/latest",
    response_model=RawTelemetryItem,
    summary="Get newest raw telemetry record",
)
def get_latest_telemetry(
    building_id: int | None = Query(None, description="Filter by building ID"),
    device_id: str | None = Query(None, description="Filter by device ID"),
    db: Session = Depends(get_db),
) -> RawWaterTelemetry:
    """
    Retrieves the single newest raw telemetry record ordered by backend arrival time (received_at).
    """
    if building_id is not None:
        building = db.get(Building, building_id)
        if building is None:
            raise HTTPException(status_code=404, detail=f"Building {building_id} not found.")

    query = select(RawWaterTelemetry).order_by(desc(RawWaterTelemetry.received_at)).limit(1)
    if building_id is not None:
        query = query.where(RawWaterTelemetry.building_id == building_id)
    if device_id is not None:
        query = query.where(RawWaterTelemetry.device_id == device_id)

    record = db.execute(query).scalars().first()
    if record is None:
        raise HTTPException(
            status_code=404,
            detail="No telemetry found matching the specified criteria.",
        )
    return record


@router.get(
    "/history",
    response_model=list[RawTelemetryItem],
    summary="Query historical raw telemetry records",
)
def get_telemetry_history(
    building_id: int | None = Query(None, description="Filter by building ID"),
    device_id: str | None = Query(None, description="Filter by device ID"),
    start: datetime | None = Query(None, description="Earliest received_at timestamp (UTC)"),
    end: datetime | None = Query(None, description="Latest received_at timestamp (UTC)"),
    limit: int = Query(100, ge=1, le=500, description="Max records to return (capped at 500)"),
    db: Session = Depends(get_db),
) -> list[RawWaterTelemetry]:
    """
    Retrieves bounded time-series raw telemetry records sorted newest first (received_at DESC).
    """
    if building_id is not None:
        building = db.get(Building, building_id)
        if building is None:
            raise HTTPException(status_code=404, detail=f"Building {building_id} not found.")

    query = select(RawWaterTelemetry).order_by(desc(RawWaterTelemetry.received_at)).limit(limit)

    if building_id is not None:
        query = query.where(RawWaterTelemetry.building_id == building_id)
    if device_id is not None:
        query = query.where(RawWaterTelemetry.device_id == device_id)
    if start is not None:
        query = query.where(RawWaterTelemetry.received_at >= to_utc_naive(start))
    if end is not None:
        query = query.where(RawWaterTelemetry.received_at <= to_utc_naive(end))

    return list(db.execute(query).scalars().all())


@router.post(
    "/aggregate",
    response_model=AggregationResult,
    summary="Trigger hourly raw telemetry aggregation",
)
def trigger_aggregation(
    payload: AggregationTriggerRequest,
    x_sensor_key: Annotated[str | None, Header(alias="X-Sensor-Key")] = None,
    db: Session = Depends(get_db),
) -> AggregationResult:
    """
    Executes hourly aggregation for a specific device and building window,
    updating or inserting a record into the canonical water_readings table.
    """
    if x_sensor_key is not None:
        verify_device_authorization(
            sensor_key=x_sensor_key,
            device_id=payload.device_id,
            building_id=payload.building_id,
            db=db,
        )
    else:
        building = db.get(Building, payload.building_id)
        if building is None:
            raise HTTPException(status_code=404, detail=f"Building {payload.building_id} not found.")

    hour_start = payload.hour_start
    if hour_start is None:
        hour_start = floor_to_hour(utcnow() - timedelta(hours=1))

    return aggregate_device_hour(
        db=db,
        building_id=payload.building_id,
        device_id=payload.device_id,
        hour_start=hour_start,
        allow_partial=payload.allow_partial,
        min_coverage_pct=payload.min_coverage_pct,
    )


@router.get(
    "/aggregates",
    response_model=list[AggregatedReadingItem],
    summary="Query hourly aggregated water readings",
)
def get_aggregated_readings(
    building_id: int | None = Query(None, description="Filter by building ID"),
    source: str | None = Query(None, description="Filter by provenance ('esp32' or 'simulator')"),
    limit: int = Query(100, ge=1, le=1000, description="Max records to return"),
    db: Session = Depends(get_db),
) -> list[WaterReading]:
    """
    Retrieves hourly aggregated water readings from the canonical water_readings table.
    """
    if building_id is not None:
        building = db.get(Building, building_id)
        if building is None:
            raise HTTPException(status_code=404, detail=f"Building {building_id} not found.")

    query = select(WaterReading).order_by(desc(WaterReading.ts)).limit(limit)

    if building_id is not None:
        query = query.where(WaterReading.building_id == building_id)
    if source is not None:
        query = query.where(WaterReading.source == source)

    return list(db.execute(query).scalars().all())
