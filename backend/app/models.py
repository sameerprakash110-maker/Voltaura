"""SQLAlchemy ORM models for EcoTwin."""
from __future__ import annotations

import enum
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# --------------------------------------------------------------------------
# Enumerations (stored as plain strings so any SQL dialect is happy)
# --------------------------------------------------------------------------
class ResourceType(str, enum.Enum):
    ENERGY = "ENERGY"
    WATER = "WATER"


class Severity(str, enum.Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class AnomalyStatus(str, enum.Enum):
    OPEN = "OPEN"
    DIAGNOSED = "DIAGNOSED"
    ACTIONED = "ACTIONED"
    RESOLVED = "RESOLVED"
    DISMISSED = "DISMISSED"


class RecommendationStatus(str, enum.Enum):
    PENDING = "PENDING"
    APPLIED = "APPLIED"
    DISMISSED = "DISMISSED"


class InterventionStatus(str, enum.Enum):
    PLANNED = "PLANNED"
    ACTIVE = "ACTIVE"
    MONITORING = "MONITORING"
    COMPLETED = "COMPLETED"
    VERIFIED = "VERIFIED"


class VerificationStatus(str, enum.Enum):
    VERIFIED = "VERIFIED"
    NOT_VERIFIED = "NOT_VERIFIED"
    INCONCLUSIVE = "INCONCLUSIVE"
    INSUFFICIENT_DATA = "INSUFFICIENT_DATA"


class BuildingStatus(str, enum.Enum):
    NORMAL = "NORMAL"
    WARNING = "WARNING"
    CRITICAL = "CRITICAL"


# --------------------------------------------------------------------------
# Core entities
# --------------------------------------------------------------------------
class Building(Base):
    __tablename__ = "buildings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    category: Mapped[str] = mapped_column(String(48), default="Academic")
    description: Mapped[str] = mapped_column(Text, default="")

    area_sqm: Mapped[float] = mapped_column(Float)
    floors: Mapped[int] = mapped_column(Integer)
    occupancy_capacity: Mapped[int] = mapped_column(Integer)
    operating_hours_start: Mapped[int] = mapped_column(Integer, default=8)
    operating_hours_end: Mapped[int] = mapped_column(Integer, default=18)
    year_built: Mapped[int] = mapped_column(Integer, default=2012)

    # Digital-twin placement on the stylised campus grid (metres).
    twin_x: Mapped[float] = mapped_column(Float, default=0.0)
    twin_z: Mapped[float] = mapped_column(Float, default=0.0)
    twin_w: Mapped[float] = mapped_column(Float, default=6.0)
    twin_d: Mapped[float] = mapped_column(Float, default=6.0)
    twin_h: Mapped[float] = mapped_column(Float, default=6.0)
    twin_rotation: Mapped[float] = mapped_column(Float, default=0.0)

    # Simulator nameplate parameters. These also explain the expected load
    # breakdown shown on the building page.
    hvac_capacity_kw: Mapped[float] = mapped_column(Float, default=60.0)
    lighting_capacity_kw: Mapped[float] = mapped_column(Float, default=25.0)
    plug_capacity_kw: Mapped[float] = mapped_column(Float, default=40.0)
    base_load_kw: Mapped[float] = mapped_column(Float, default=12.0)
    water_per_occupant_lph: Mapped[float] = mapped_column(Float, default=3.2)
    pump_flow_lph: Mapped[float] = mapped_column(Float, default=180.0)
    night_base_flow_lph: Mapped[float] = mapped_column(Float, default=8.0)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    energy_readings: Mapped[list["EnergyReading"]] = relationship(
        back_populates="building", cascade="all, delete-orphan", passive_deletes=True
    )
    water_readings: Mapped[list["WaterReading"]] = relationship(
        back_populates="building", cascade="all, delete-orphan", passive_deletes=True
    )
    anomalies: Mapped[list["Anomaly"]] = relationship(
        back_populates="building", cascade="all, delete-orphan", passive_deletes=True
    )
    recommendations: Mapped[list["Recommendation"]] = relationship(
        back_populates="building", cascade="all, delete-orphan", passive_deletes=True
    )
    interventions: Mapped[list["Intervention"]] = relationship(
        back_populates="building", cascade="all, delete-orphan", passive_deletes=True
    )
    faults: Mapped[list["Fault"]] = relationship(
        back_populates="building", cascade="all, delete-orphan", passive_deletes=True
    )


class EnergyReading(Base):
    """Hourly electricity telemetry. One row == one smart-meter interval."""

    __tablename__ = "energy_readings"
    __table_args__ = (
        UniqueConstraint("building_id", "ts", name="uq_energy_building_ts"),
        Index("ix_energy_building_ts", "building_id", "ts"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    building_id: Mapped[int] = mapped_column(
        ForeignKey("buildings.id", ondelete="CASCADE"), index=True
    )
    ts: Mapped[datetime] = mapped_column(DateTime, index=True)

    energy_kwh: Mapped[float] = mapped_column(Float)
    occupancy: Mapped[int] = mapped_column(Integer, default=0)
    occupancy_pct: Mapped[float] = mapped_column(Float, default=0.0)
    temperature_c: Mapped[float] = mapped_column(Float, default=26.0)
    outdoor_temperature_c: Mapped[float] = mapped_column(Float, default=28.0)
    hvac_runtime_min: Mapped[float] = mapped_column(Float, default=0.0)
    lighting_runtime_min: Mapped[float] = mapped_column(Float, default=0.0)
    equipment_kw: Mapped[float] = mapped_column(Float, default=0.0)

    # Ground truth from the simulator. Used for documentation and offline
    # evaluation only; the detection pipeline never reads this column.
    fault_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Filled in by the ML pipeline (expected-consumption regressor).
    expected_kwh: Mapped[float | None] = mapped_column(Float, nullable=True)

    building: Mapped[Building] = relationship(back_populates="energy_readings")


class WaterReading(Base):
    """Hourly water telemetry. One row == one smart flow-meter interval."""

    __tablename__ = "water_readings"
    __table_args__ = (
        UniqueConstraint("building_id", "ts", name="uq_water_building_ts"),
        Index("ix_water_building_ts", "building_id", "ts"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    building_id: Mapped[int] = mapped_column(
        ForeignKey("buildings.id", ondelete="CASCADE"), index=True
    )
    ts: Mapped[datetime] = mapped_column(DateTime, index=True)

    water_liters: Mapped[float] = mapped_column(Float)
    flow_lph: Mapped[float] = mapped_column(Float, default=0.0)
    occupancy: Mapped[int] = mapped_column(Integer, default=0)
    occupancy_pct: Mapped[float] = mapped_column(Float, default=0.0)
    temperature_c: Mapped[float] = mapped_column(Float, default=26.0)
    outdoor_temperature_c: Mapped[float] = mapped_column(Float, default=28.0)
    pump_runtime_min: Mapped[float] = mapped_column(Float, default=0.0)

    fault_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    expected_liters: Mapped[float | None] = mapped_column(Float, nullable=True)

    building: Mapped[Building] = relationship(back_populates="water_readings")


class Fault(Base):
    """
    A physical fault present in the simulated plant.

    This table is the simulator's state, not the detector's. The detection
    pipeline never reads it. It exists so that (a) the generator can reproduce
    telemetry deterministically and (b) applying an intervention can actually
    remove the underlying fault, which is what makes post-intervention
    verification meaningful rather than cosmetic.
    """

    __tablename__ = "faults"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    building_id: Mapped[int] = mapped_column(
        ForeignKey("buildings.id", ondelete="CASCADE"), index=True
    )
    code: Mapped[str] = mapped_column(String(32), index=True)
    resource_type: Mapped[str] = mapped_column(String(16))
    label: Mapped[str] = mapped_column(String(160), default="")
    start_ts: Mapped[datetime] = mapped_column(DateTime)
    end_ts: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    scenario_key: Mapped[str | None] = mapped_column(String(48), nullable=True)

    building: Mapped[Building] = relationship(back_populates="faults")


class Anomaly(Base):
    """A detected anomaly event: a merged run of anomalous intervals."""

    __tablename__ = "anomalies"
    __table_args__ = (Index("ix_anomaly_building_start", "building_id", "start_ts"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    building_id: Mapped[int] = mapped_column(
        ForeignKey("buildings.id", ondelete="CASCADE"), index=True
    )
    resource_type: Mapped[str] = mapped_column(String(16), index=True)

    detected_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    start_ts: Mapped[datetime] = mapped_column(DateTime, index=True)
    end_ts: Mapped[datetime] = mapped_column(DateTime)
    duration_hours: Mapped[float] = mapped_column(Float, default=0.0)

    severity: Mapped[str] = mapped_column(String(16), index=True)
    actual_value: Mapped[float] = mapped_column(Float)
    expected_value: Mapped[float] = mapped_column(Float)
    deviation_pct: Mapped[float] = mapped_column(Float)
    excess_total: Mapped[float] = mapped_column(Float, default=0.0)
    unit: Mapped[str] = mapped_column(String(12), default="kWh")

    # Root-cause output
    cause_code: Mapped[str | None] = mapped_column(String(48), nullable=True)
    probable_cause: Mapped[str | None] = mapped_column(Text, nullable=True)
    affected_subsystem: Mapped[str | None] = mapped_column(String(48), nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    evidence: Mapped[list | None] = mapped_column(JSON, nullable=True)
    diagnosis_narrative: Mapped[str | None] = mapped_column(Text, nullable=True)
    narrative_source: Mapped[str] = mapped_column(String(16), default="rules")

    flagged_intervals: Mapped[int] = mapped_column(Integer, default=0)
    occurrence_days: Mapped[int] = mapped_column(Integer, default=1)
    is_persistent: Mapped[bool] = mapped_column(Boolean, default=False)
    intervals: Mapped[list] = mapped_column(JSON, default=list)

    detector: Mapped[str] = mapped_column(String(48), default="isolation_forest+rf_residual")
    anomaly_score: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String(16), default=AnomalyStatus.OPEN.value, index=True)

    building: Mapped[Building] = relationship(back_populates="anomalies")
    recommendations: Mapped[list["Recommendation"]] = relationship(
        back_populates="anomaly", cascade="all, delete-orphan", passive_deletes=True
    )


class Recommendation(Base):
    __tablename__ = "recommendations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    anomaly_id: Mapped[int | None] = mapped_column(
        ForeignKey("anomalies.id", ondelete="CASCADE"), nullable=True, index=True
    )
    building_id: Mapped[int] = mapped_column(
        ForeignKey("buildings.id", ondelete="CASCADE"), index=True
    )
    resource_type: Mapped[str] = mapped_column(String(16), index=True)

    title: Mapped[str] = mapped_column(String(180))
    description: Mapped[str] = mapped_column(Text)
    reason: Mapped[str] = mapped_column(Text)
    implementation: Mapped[str] = mapped_column(Text, default="")
    evidence: Mapped[list] = mapped_column(JSON, default=list)

    expected_saving_per_week: Mapped[float] = mapped_column(Float, default=0.0)
    expected_saving_unit: Mapped[str] = mapped_column(String(12), default="kWh")
    estimated_cost_saving_per_week: Mapped[float] = mapped_column(Float, default=0.0)
    estimated_co2_reduction_per_week: Mapped[float] = mapped_column(Float, default=0.0)

    implementation_difficulty: Mapped[str] = mapped_column(String(16), default="MEDIUM")
    priority: Mapped[str] = mapped_column(String(16), default="MEDIUM")
    priority_score: Mapped[float] = mapped_column(Float, default=0.0)
    payback_note: Mapped[str] = mapped_column(String(180), default="")

    target_fault_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    status: Mapped[str] = mapped_column(
        String(16), default=RecommendationStatus.PENDING.value, index=True
    )
    narrative_source: Mapped[str] = mapped_column(String(16), default="rules")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    anomaly: Mapped[Anomaly | None] = relationship(back_populates="recommendations")
    building: Mapped[Building] = relationship(back_populates="recommendations")
    interventions: Mapped[list["Intervention"]] = relationship(
        back_populates="recommendation", cascade="all, delete-orphan", passive_deletes=True
    )


class Intervention(Base):
    __tablename__ = "interventions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    recommendation_id: Mapped[int | None] = mapped_column(
        ForeignKey("recommendations.id", ondelete="CASCADE"), nullable=True, index=True
    )
    building_id: Mapped[int] = mapped_column(
        ForeignKey("buildings.id", ondelete="CASCADE"), index=True
    )
    resource_type: Mapped[str] = mapped_column(String(16), index=True)

    title: Mapped[str] = mapped_column(String(180), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    implemented_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    status: Mapped[str] = mapped_column(
        String(16), default=InterventionStatus.PLANNED.value, index=True
    )
    owner: Mapped[str] = mapped_column(String(80), default="Facilities Team")
    target_fault_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    monitoring_days_required: Mapped[int] = mapped_column(Integer, default=14)
    notes: Mapped[str] = mapped_column(Text, default="")
    timeline: Mapped[list] = mapped_column(JSON, default=list)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    recommendation: Mapped[Recommendation | None] = relationship(back_populates="interventions")
    building: Mapped[Building] = relationship(back_populates="interventions")
    verifications: Mapped[list["VerificationResult"]] = relationship(
        back_populates="intervention", cascade="all, delete-orphan", passive_deletes=True
    )


class VerificationResult(Base):
    """
    Output of an IPMVP Option C style measurement and verification run.

    `adjusted_baseline_value` is the baseline model evaluated on the post
    period's own driver values (occupancy / temperature / schedule), so the
    saving is weather- and occupancy-normalised rather than a naive
    before/after difference.
    """

    __tablename__ = "verification_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    intervention_id: Mapped[int] = mapped_column(
        ForeignKey("interventions.id", ondelete="CASCADE"), index=True
    )
    building_id: Mapped[int] = mapped_column(
        ForeignKey("buildings.id", ondelete="CASCADE"), index=True
    )
    resource_type: Mapped[str] = mapped_column(String(16))

    baseline_start: Mapped[datetime] = mapped_column(DateTime)
    baseline_end: Mapped[datetime] = mapped_column(DateTime)
    post_start: Mapped[datetime] = mapped_column(DateTime)
    post_end: Mapped[datetime] = mapped_column(DateTime)

    baseline_days: Mapped[float] = mapped_column(Float, default=0.0)
    post_days: Mapped[float] = mapped_column(Float, default=0.0)
    baseline_value: Mapped[float] = mapped_column(Float)
    post_value: Mapped[float] = mapped_column(Float)
    adjusted_baseline_value: Mapped[float] = mapped_column(Float)
    absolute_saving: Mapped[float] = mapped_column(Float)
    saving_pct: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String(12), default="kWh")

    financial_saving_per_week: Mapped[float] = mapped_column(Float, default=0.0)
    financial_saving_per_year: Mapped[float] = mapped_column(Float, default=0.0)
    co2_reduction_per_week: Mapped[float] = mapped_column(Float, default=0.0)
    co2_reduction_per_year: Mapped[float] = mapped_column(Float, default=0.0)

    p_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    confidence_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    baseline_model_r2: Mapped[float | None] = mapped_column(Float, nullable=True)
    baseline_model_cvrmse: Mapped[float | None] = mapped_column(Float, nullable=True)
    threshold_pct: Mapped[float] = mapped_column(Float, default=5.0)

    status: Mapped[str] = mapped_column(String(24), index=True)
    method: Mapped[str] = mapped_column(String(64), default="IPMVP Option C (adjusted baseline)")
    explanation: Mapped[str] = mapped_column(Text, default="")
    series: Mapped[dict] = mapped_column(JSON, default=dict)
    hourly_profile: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    intervention: Mapped[Intervention] = relationship(back_populates="verifications")


class AppSetting(Base):
    """Runtime-tunable overrides for anything in `config.TUNABLE_KEYS`."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(String(160))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class SimulationState(Base):
    """
    Single-row table holding the simulator clock.

    `data_end_ts` is the timestamp of the most recent telemetry interval in the
    database. Demo-mode fast-forward advances it by generating new intervals.
    """

    __tablename__ = "simulation_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    data_start_ts: Mapped[datetime] = mapped_column(DateTime)
    data_end_ts: Mapped[datetime] = mapped_column(DateTime)
    seeded_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    demo_mode: Mapped[bool] = mapped_column(Boolean, default=True)
