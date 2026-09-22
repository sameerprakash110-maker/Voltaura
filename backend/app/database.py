"""
Database engine / session plumbing.

The layer is deliberately dialect-agnostic: the only SQLite-specific bit is the
`connect_args` / PRAGMA block, which is skipped for any other URL.  Pointing
VOLTAURA_DATABASE_URL at `postgresql+psycopg://...` is the whole migration.
"""
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings

IS_SQLITE = settings.database_url.startswith("sqlite")

engine = create_engine(
    settings.database_url,
    echo=False,
    future=True,
    pool_pre_ping=not IS_SQLITE,
    connect_args={"check_same_thread": False} if IS_SQLITE else {},
)

if IS_SQLITE:

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_connection, _record):  # pragma: no cover - driver glue
        cur = dbapi_connection.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


class Base(DeclarativeBase):
    """Declarative base shared by every model."""


def get_db() -> Iterator[Session]:
    """FastAPI dependency."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope() -> Iterator[Session]:
    """Transactional scope for scripts and services."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def init_db(drop: bool = False) -> None:
    from . import models  # noqa: F401  (register mappers)
    from sqlalchemy import inspect, text

    if drop:
        Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    # Ensure backward-compatible column migration for existing tables
    try:
        with engine.begin() as conn:
            inspector = inspect(conn)
            tables = inspector.get_table_names()

            # 1. water_readings extra telemetry columns
            if "water_readings" in tables:
                existing_cols = {c["name"] for c in inspector.get_columns("water_readings")}
                if "source" not in existing_cols:
                    conn.execute(text("ALTER TABLE water_readings ADD COLUMN source VARCHAR(32) DEFAULT 'simulator'"))
                if "water_level_pct" not in existing_cols:
                    conn.execute(text("ALTER TABLE water_readings ADD COLUMN water_level_pct FLOAT"))
                if "tds_ppm" not in existing_cols:
                    conn.execute(text("ALTER TABLE water_readings ADD COLUMN tds_ppm INTEGER"))
                if "turbidity_ntu" not in existing_cols:
                    conn.execute(text("ALTER TABLE water_readings ADD COLUMN turbidity_ntu FLOAT"))

            # 2. raw_water_telemetry composite index
            if "raw_water_telemetry" in tables:
                existing_indexes = {idx["name"] for idx in inspector.get_indexes("raw_water_telemetry")}
                if "ix_raw_water_telemetry_bldg_dev_rcvd" not in existing_indexes:
                    conn.execute(text(
                        "CREATE INDEX IF NOT EXISTS ix_raw_water_telemetry_bldg_dev_rcvd "
                        "ON raw_water_telemetry (building_id, device_id, received_at)"
                    ))
    except Exception:
        pass
