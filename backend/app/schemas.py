"""Pydantic response and request models for the EcoTwin API."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

ResourceLiteral = Literal["ENERGY", "WATER"]
ResourceFilter = Literal["ENERGY", "WATER", "ALL"]


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --------------------------------------------------------------------------
# Health / meta
# --------------------------------------------------------------------------
class HealthResponse(BaseModel):
    status: str
    version: str
    database: str
    seeded: bool
    buildings: int
    energy_readings: int
    water_readings: int
    anomalies: int
    data_start: datetime | None = None
    data_end: datetime | None = None
    llm_enabled: bool
    message: str


# --------------------------------------------------------------------------
# Buildings
# --------------------------------------------------------------------------
class BuildingBase(ORMModel):
    id: int
    code: str
    name: str
    category: str
    description: str
    area_sqm: float
    floors: int
    occupancy_capacity: int
    operating_hours_start: int
    operating_hours_end: int
    year_built: int
    twin_x: float
    twin_z: float
    twin_w: float
    twin_d: float
    twin_h: float
    twin_rotation: float


class BuildingSummary(BuildingBase):
    """Building plus its current live state, for lists and the digital twin."""

    status: str = "NORMAL"
    energy_kwh: float = 0.0
    water_liters: float = 0.0
    energy_expected_kwh: float = 0.0
    water_expected_liters: float = 0.0
    energy_deviation_pct: float = 0.0
    water_deviation_pct: float = 0.0
    occupancy_now: int = 0
    occupancy_pct_now: float = 0.0
    temperature_now: float = 0.0
    hvac_runtime_now: float = 0.0
    lighting_runtime_now: float = 0.0
    pump_runtime_now: float = 0.0
    open_anomalies: int = 0
    critical_anomalies: int = 0
    top_severity: str | None = None
    active_recommendation: str | None = None
    active_recommendation_id: int | None = None
    energy_intensity: float = 0.0          # kWh / m2 over the window
    verified_savings_energy: float = 0.0   # kWh / week
    verified_savings_water: float = 0.0    # L / week


class SeriesPoint(BaseModel):
    ts: datetime
    actual: float
    expected: float | None = None
    occupancy: float | None = None
    occupancy_pct: float | None = None
    temperature: float | None = None
    outdoor_temperature: float | None = None
    hvac_runtime: float | None = None
    lighting_runtime: float | None = None
    pump_runtime: float | None = None
    flow_lph: float | None = None
    is_anomalous: bool = False


class BuildingDetail(BaseModel):
    building: BuildingSummary
    energy_series: list[SeriesPoint]
    water_series: list[SeriesPoint]
    anomalies: list["AnomalyOut"]
    recommendations: list["RecommendationOut"]
    interventions: list["InterventionOut"]
    subsystems: list[dict[str, Any]]
    stats: dict[str, Any]
    range_days: int
    interval: str


# --------------------------------------------------------------------------
# Anomalies
# --------------------------------------------------------------------------
class AnomalyOut(ORMModel):
    id: int
    building_id: int
    building_code: str | None = None
    building_name: str | None = None
    resource_type: str
    detected_at: datetime
    start_ts: datetime
    end_ts: datetime
    duration_hours: float
    severity: str
    actual_value: float
    expected_value: float
    deviation_pct: float
    excess_total: float
    unit: str
    cause_code: str | None = None
    probable_cause: str | None = None
    affected_subsystem: str | None = None
    confidence: float | None = None
    evidence: list[dict[str, Any]] | None = None
    diagnosis_narrative: str | None = None
    narrative_source: str = "rules"
    flagged_intervals: int = 0
    occurrence_days: int = 1
    is_persistent: bool = False
    detector: str
    anomaly_score: float
    status: str
    recommendation_id: int | None = None


class AnomalyDetail(BaseModel):
    anomaly: AnomalyOut
    recommendation: "RecommendationOut | None" = None
    series: list[SeriesPoint]
    context: dict[str, Any]
    hourly_profile: dict[str, Any]


# --------------------------------------------------------------------------
# Recommendations
# --------------------------------------------------------------------------
class RecommendationOut(ORMModel):
    id: int
    anomaly_id: int | None = None
    building_id: int
    building_code: str | None = None
    building_name: str | None = None
    resource_type: str
    title: str
    description: str
    reason: str
    implementation: str
    evidence: list[dict[str, Any]]
    expected_saving_per_week: float
    expected_saving_unit: str
    estimated_cost_saving_per_week: float
    estimated_co2_reduction_per_week: float
    implementation_difficulty: str
    priority: str
    priority_score: float
    payback_note: str
    target_fault_code: str | None = None
    status: str
    narrative_source: str = "rules"
    created_at: datetime
    severity: str | None = None
    intervention_id: int | None = None


class ApplyRecommendationRequest(BaseModel):
    owner: str = "Facilities Team"
    notes: str = ""
    monitoring_days: int = Field(default=14, ge=1, le=90)
    implemented_at: datetime | None = None


# --------------------------------------------------------------------------
# Interventions
# --------------------------------------------------------------------------
class InterventionOut(ORMModel):
    id: int
    recommendation_id: int | None = None
    building_id: int
    building_code: str | None = None
    building_name: str | None = None
    resource_type: str
    title: str
    description: str
    implemented_at: datetime
    status: str
    owner: str
    target_fault_code: str | None = None
    monitoring_days_required: int
    notes: str
    timeline: list[dict[str, Any]]
    created_at: datetime
    updated_at: datetime
    elapsed_days: float = 0.0
    progress_pct: float = 0.0
    ready_for_verification: bool = False
    expected_saving_per_week: float | None = None
    expected_saving_unit: str | None = None
    verification_status: str | None = None
    verified_saving: float | None = None
    verified_saving_pct: float | None = None
    verification_id: int | None = None


class CreateInterventionRequest(BaseModel):
    recommendation_id: int | None = None
    building_id: int | None = None
    resource_type: ResourceLiteral | None = None
    title: str | None = None
    description: str = ""
    owner: str = "Facilities Team"
    notes: str = ""
    monitoring_days: int = Field(default=14, ge=1, le=90)
    implemented_at: datetime | None = None


class MonitoringRequest(BaseModel):
    days: float = Field(default=14, gt=0, le=120)
    verify: bool = True


# --------------------------------------------------------------------------
# Verification
# --------------------------------------------------------------------------
class VerificationOut(ORMModel):
    id: int
    intervention_id: int
    building_id: int
    building_code: str | None = None
    building_name: str | None = None
    resource_type: str
    intervention_title: str | None = None
    baseline_start: datetime
    baseline_end: datetime
    post_start: datetime
    post_end: datetime
    baseline_days: float = 0.0
    post_days: float = 0.0
    baseline_value: float
    post_value: float
    adjusted_baseline_value: float
    absolute_saving: float
    saving_pct: float
    unit: str
    financial_saving_per_week: float
    financial_saving_per_year: float
    co2_reduction_per_week: float
    co2_reduction_per_year: float
    p_value: float | None = None
    confidence_pct: float | None = None
    baseline_model_r2: float | None = None
    baseline_model_cvrmse: float | None = None
    threshold_pct: float
    status: str
    method: str
    explanation: str
    series: dict[str, Any]
    hourly_profile: dict[str, Any]
    created_at: datetime


class RunVerificationRequest(BaseModel):
    threshold_pct: float | None = Field(default=None, ge=0, le=100)


# --------------------------------------------------------------------------
# Dashboard
# --------------------------------------------------------------------------
class KpiCard(BaseModel):
    key: str
    label: str
    value: float
    unit: str
    change_pct: float | None = None
    previous_value: float | None = None
    direction: Literal["up", "down", "flat"] = "flat"
    good_direction: Literal["up", "down"] = "down"
    caption: str = ""
    measured: bool = True


class TimeseriesPoint(BaseModel):
    ts: datetime
    label: str
    energy: float | None = None
    energy_expected: float | None = None
    water: float | None = None
    water_expected: float | None = None


class BuildingComparison(BaseModel):
    building_id: int
    code: str
    name: str
    energy_kwh: float
    water_liters: float
    energy_intensity: float
    water_intensity: float
    deviation_pct: float
    status: str
    open_anomalies: int


class DashboardResponse(BaseModel):
    kpis: list[KpiCard]
    series: list[TimeseriesPoint]
    buildings: list[BuildingComparison]
    anomalies: list[AnomalyOut]
    recommendations: list[RecommendationOut]
    interventions: list[InterventionOut]
    verifications: list[VerificationOut]
    pipeline: dict[str, Any]
    range_days: int
    resource: str
    interval: str
    data_start: datetime | None = None
    data_end: datetime | None = None
    economics: dict[str, Any]


# --------------------------------------------------------------------------
# Reports
# --------------------------------------------------------------------------
class ReportResponse(BaseModel):
    generated_at: datetime
    period_start: datetime | None
    period_end: datetime | None
    totals: dict[str, Any]
    by_building: list[dict[str, Any]]
    by_resource: dict[str, Any]
    verified_interventions: list[VerificationOut]
    anomaly_breakdown: dict[str, Any]
    methodology: list[dict[str, str]]
    economics: dict[str, Any]


# --------------------------------------------------------------------------
# Settings / demo
# --------------------------------------------------------------------------
class SettingsResponse(BaseModel):
    values: dict[str, Any]
    defaults: dict[str, Any]
    metadata: list[dict[str, Any]]
    economics: dict[str, Any]
    llm_enabled: bool
    llm_model: str | None = None


class SettingsUpdateRequest(BaseModel):
    values: dict[str, Any]


class DemoScenario(BaseModel):
    key: str
    order: int
    title: str
    resource_type: str
    building_code: str
    building_id: int | None = None
    fault_code: str
    headline: str
    summary: str
    what_to_look_for: list[str]
    expected_cause: str
    anomaly_id: int | None = None
    recommendation_id: int | None = None
    intervention_id: int | None = None
    verification_id: int | None = None
    stage: str = "DETECTED"
    available: bool = True


class DemoStateResponse(BaseModel):
    demo_mode: bool
    scenarios: list[DemoScenario]
    data_start: datetime | None = None
    data_end: datetime | None = None
    seeded_at: datetime | None = None


# --------------------------------------------------------------------------
# IoT Telemetry Ingestion (Step 8)
# --------------------------------------------------------------------------
class TelemetryDiagnosticsSchema(BaseModel):
    """Optional low-level hardware diagnostics block."""

    pulse_count: int | None = Field(None, ge=0)
    distance_raw_cm: float | None = Field(None, ge=0.0)
    tds_voltage_mv: float | None = Field(None, ge=0.0)
    turbidity_voltage_mv: float | None = Field(None, ge=0.0)
    rssi_dbm: int | None = Field(None, ge=-130, le=0)
    uptime_seconds: int | None = Field(None, ge=0)
    free_heap_bytes: int | None = Field(None, ge=0)


class TelemetryIngestionRequest(BaseModel):
    """
    Canonical telemetry payload from physical edge nodes (docs/TELEMETRY_CONTRACT.md).
    Strictly preserves null vs zero semantics across all fields.
    """

    schema_version: Literal["1.0"] = Field(
        ..., description="Frozen contract schema version, must be '1.0'"
    )
    device_id: str = Field(
        ..., min_length=1, max_length=64, description="Canonical device identifier"
    )
    building_id: int = Field(..., description="Target building database ID")
    source: Literal["esp32"] = Field(
        ..., description="Telemetry source identifier, must be 'esp32' for hardware ingestion"
    )
    interval_seconds: int = Field(
        ..., ge=5, le=60, description="Reporting interval in seconds (5-60s)"
    )
    timestamp: datetime | None = Field(
        None, description="Device ISO 8601 timestamp (null if NTP not yet active)"
    )

    # Water telemetry
    water_level_pct: float | None = Field(
        None, ge=0.0, le=100.0, description="Effective water height percentage (0.0-100.0%)"
    )
    water_level_cm: float | None = Field(
        None, ge=0.0, description="Effective water height in centimeters"
    )
    flow_rate_lpm: float | None = Field(
        None, ge=0.0, description="Average flow rate over interval in L/min"
    )
    volume_liters: float | None = Field(
        None, ge=0.0, description="Cumulative volume passed during interval in Liters"
    )

    # Water quality
    tds_ppm: int | None = Field(
        None, ge=0, description="Total dissolved solids in ppm"
    )
    turbidity_ntu: float | None = Field(
        None, ge=0.0, description="Water turbidity in Nephelometric Turbidity Units"
    )

    # Errors & Diagnostics
    sensor_errors: list[str] = Field(
        default_factory=list, description="List of active hardware error codes"
    )
    diagnostics: TelemetryDiagnosticsSchema | None = Field(
        None, description="Optional hardware health and raw sensor diagnostics"
    )


class TelemetryIngestionResponse(BaseModel):
    """Structured response on successful telemetry persistence."""

    success: bool = True
    message: str = "Telemetry accepted"
    id: int
    received_at: datetime


class RawTelemetryItem(ORMModel):
    """Public schema for querying raw telemetry records."""

    id: int
    device_id: str
    building_id: int
    schema_version: str
    source: str
    device_timestamp: datetime | None = None
    received_at: datetime
    interval_seconds: int
    water_level_pct: float | None = None
    water_level_cm: float | None = None
    flow_rate_lpm: float | None = None
    volume_liters: float | None = None
    tds_ppm: int | None = None
    turbidity_ntu: float | None = None
    pulse_count: int | None = None
    distance_raw_cm: float | None = None
    tds_voltage_mv: float | None = None
    turbidity_voltage_mv: float | None = None
    rssi_dbm: int | None = None
    uptime_seconds: int | None = None
    free_heap_bytes: int | None = None
    sensor_errors: list[str] = Field(default_factory=list)


class AggregationResult(BaseModel):
    """Detailed summary of an hourly aggregation execution."""

    building_id: int
    device_id: str
    hour_start: datetime
    hour_end: datetime
    sample_count: int
    expected_sample_count: int
    coverage_pct: float
    status: str
    aggregated: bool
    action: str | None = None
    water_liters: float | None = None
    flow_lph: float | None = None
    water_level_pct: float | None = None
    tds_ppm: int | None = None
    turbidity_ntu: float | None = None
    reading_id: int | None = None
    message: str | None = None


class AggregationTriggerRequest(BaseModel):
    """Request payload to manually trigger hourly telemetry aggregation."""

    building_id: int
    device_id: str
    hour_start: datetime | None = None
    allow_partial: bool = False
    min_coverage_pct: float = 50.0


class AggregatedReadingItem(ORMModel):
    """Public representation of an hourly water reading including telemetry provenance."""

    id: int
    building_id: int
    ts: datetime
    water_liters: float
    flow_lph: float
    water_level_pct: float | None = None
    tds_ppm: int | None = None
    turbidity_ntu: float | None = None
    source: str = "simulator"


BuildingDetail.model_rebuild()
AnomalyDetail.model_rebuild()
