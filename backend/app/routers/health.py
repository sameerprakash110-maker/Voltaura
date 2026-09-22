"""Health and readiness."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models import Anomaly, Building, EnergyReading, WaterReading
from ..schemas import HealthResponse
from ..services import llm, simulation

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health(db: Session = Depends(get_db)) -> HealthResponse:
    """
    Liveness plus a readiness summary.

    The frontend uses `seeded` to tell a genuinely empty database apart from a
    backend that is simply unreachable, so it can show the right guidance.
    """
    try:
        buildings = db.execute(select(func.count(Building.id))).scalar() or 0
        energy = db.execute(select(func.count(EnergyReading.id))).scalar() or 0
        water = db.execute(select(func.count(WaterReading.id))).scalar() or 0
        anomalies = db.execute(select(func.count(Anomaly.id))).scalar() or 0
        state = simulation.get_state(db)
        seeded = buildings > 0 and energy > 0

        return HealthResponse(
            status="ok",
            version=settings.app_name,
            database="connected",
            seeded=seeded,
            buildings=buildings,
            energy_readings=energy,
            water_readings=water,
            anomalies=anomalies,
            data_start=state.data_start_ts if state else None,
            data_end=state.data_end_ts if state else None,
            llm_enabled=llm.is_available(),
            message=(
                "VOLTAURA API is ready."
                if seeded
                else "Database is empty. Run: python scripts/seed.py"
            ),
        )
    except Exception as exc:  # noqa: BLE001 - health must answer even when broken
        return HealthResponse(
            status="degraded", version=settings.app_name, database=f"error: {exc}",
            seeded=False, buildings=0, energy_readings=0, water_readings=0,
            anomalies=0, llm_enabled=False,
            message="Database unreachable. Run: python scripts/init_db.py && python scripts/seed.py",
        )
