"""Raw telemetry access: /api/energy and /api/water."""
from __future__ import annotations

from datetime import datetime
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas import SeriesPoint
from ..services import analytics, simulation
from .common import get_building_or_404

router = APIRouter(tags=["readings"])


def _series(db: Session, resource: str, building_id: int | None, days: int,
            start: datetime | None, end: datetime | None) -> dict:
    """Shared body for the two reading endpoints."""
    if building_id is not None:
        building = get_building_or_404(db, building_id)
        points = analytics.building_series(db, building, resource, days)
        scope = building.name
    else:
        raw = analytics.campus_series(db, days, resource)
        key = "energy" if resource == "ENERGY" else "water"
        points = [
            {
                "ts": p["ts"],
                "actual": p.get(key, 0.0) or 0.0,
                "expected": p.get(f"{key}_expected"),
            }
            for p in raw
        ]
        scope = "Campus (all buildings)"

    if start is not None:
        points = [p for p in points if p["ts"] >= start]
    if end is not None:
        points = [p for p in points if p["ts"] <= end]

    return {
        "resource": resource,
        "scope": scope,
        "building_id": building_id,
        "interval": analytics.pick_interval(days),
        "unit": "kWh" if resource == "ENERGY" else "L",
        "range_days": days,
        "data_end": simulation.data_end(db),
        "count": len(points),
        "points": [SeriesPoint(**p) for p in points],
    }


@router.get("/energy")
def get_energy(
    building_id: int | None = Query(None),
    days: int = Query(30, ge=1, le=365),
    start: datetime | None = Query(None),
    end: datetime | None = Query(None),
    db: Session = Depends(get_db),
) -> dict:
    """Electricity readings with the model's expected consumption alongside."""
    return _series(db, "ENERGY", building_id, days, start, end)


@router.get("/water")
def get_water(
    building_id: int | None = Query(None),
    days: int = Query(30, ge=1, le=365),
    start: datetime | None = Query(None),
    end: datetime | None = Query(None),
    db: Session = Depends(get_db),
) -> dict:
    """Water readings with the model's expected consumption alongside."""
    return _series(db, "WATER", building_id, days, start, end)
