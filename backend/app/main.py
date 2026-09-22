"""
VOLTAURA API.

    uvicorn app.main:app --reload --app-dir backend

Interactive docs at /docs. Every route is namespaced under /api.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import __version__
from .config import settings
from .database import engine, init_db
from .routers import (
    anomalies,
    buildings,
    dashboard,
    demo,
    health,
    interventions,
    readings,
    recommendations,
    reports,
    settings as settings_router,
    verification,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("voltaura")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Ensure the schema exists so a fresh clone never 500s on the first call.
    # Seeding stays an explicit step (scripts/seed.py) so nobody is surprised
    # by 90 days of telemetry appearing on boot.
    try:
        init_db()
        logger.info("Schema ready at %s", settings.database_url)
    except Exception as exc:  # noqa: BLE001
        logger.error("Database initialisation failed: %s", exc)

    from sqlalchemy import func, select

    from .database import SessionLocal
    from .models import Building, EnergyReading

    try:
        with SessionLocal() as db:
            buildings = db.execute(select(func.count(Building.id))).scalar() or 0
            readings = db.execute(select(func.count(EnergyReading.id))).scalar() or 0
        if buildings == 0 or readings == 0:
            logger.warning(
                "Database is empty. Run 'python scripts/seed.py' to load the demo campus."
            )
        else:
            logger.info(
                "Loaded %d buildings and %d energy intervals.", buildings, readings
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not read database state: %s", exc)

    yield
    engine.dispose()


app = FastAPI(
    title="VOLTAURA API",
    version=__version__,
    lifespan=lifespan,
    description=(
        "Sustainable digital twin for building resource waste.\n\n"
        "VOLTAURA detects abnormal energy and water consumption, identifies the "
        "probable cause from measured evidence, recommends an evidence-based "
        "intervention, and then verifies the saving that intervention actually "
        "delivered against an occupancy- and weather-adjusted baseline."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Return a useful JSON error rather than an opaque 500 page."""
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={
            "detail": f"{type(exc).__name__}: {exc}",
            "path": request.url.path,
            "hint": (
                "If the database is empty, run 'python scripts/seed.py'. "
                "Check GET /api/health for readiness."
            ),
        },
    )


for router in (
    health.router,
    dashboard.router,
    buildings.router,
    readings.router,
    anomalies.router,
    recommendations.router,
    interventions.router,
    verification.router,
    reports.router,
    settings_router.router,
    demo.router,
):
    app.include_router(router, prefix="/api")


@app.get("/", tags=["health"])
def root() -> dict:
    return {
        "name": "VOLTAURA API",
        "version": __version__,
        "tagline": "See Waste. Understand Why. Prove the Savings.",
        "docs": "/docs",
        "health": "/api/health",
    }
