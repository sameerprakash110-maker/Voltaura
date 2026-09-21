/**
 * TypeScript mirrors of the FastAPI response models in backend/app/schemas.py.
 * Kept hand-written and narrow so the compiler catches a drifting contract.
 */

export type ResourceType = "ENERGY" | "WATER";
export type ResourceFilter = "ENERGY" | "WATER" | "ALL";
export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type BuildingStatus = "NORMAL" | "WARNING" | "CRITICAL";
export type RangeDays = 7 | 30 | 90;

export type AnomalyStatus =
  | "OPEN"
  | "DIAGNOSED"
  | "ACTIONED"
  | "RESOLVED"
  | "DISMISSED";

export type InterventionStatus =
  | "PLANNED"
  | "ACTIVE"
  | "MONITORING"
  | "COMPLETED"
  | "VERIFIED";

export type VerificationStatus =
  | "VERIFIED"
  | "NOT_VERIFIED"
  | "INCONCLUSIVE"
  | "INSUFFICIENT_DATA";

export interface Health {
  status: string;
  version: string;
  database: string;
  seeded: boolean;
  buildings: number;
  energy_readings: number;
  water_readings: number;
  anomalies: number;
  data_start: string | null;
  data_end: string | null;
  llm_enabled: boolean;
  message: string;
}

export interface Building {
  id: number;
  code: string;
  name: string;
  category: string;
  description: string;
  area_sqm: number;
  floors: number;
  occupancy_capacity: number;
  operating_hours_start: number;
  operating_hours_end: number;
  year_built: number;
  twin_x: number;
  twin_z: number;
  twin_w: number;
  twin_d: number;
  twin_h: number;
  twin_rotation: number;
  status: BuildingStatus;
  energy_kwh: number;
  water_liters: number;
  energy_expected_kwh: number;
  water_expected_liters: number;
  energy_deviation_pct: number;
  water_deviation_pct: number;
  occupancy_now: number;
  occupancy_pct_now: number;
  temperature_now: number;
  hvac_runtime_now: number;
  lighting_runtime_now: number;
  pump_runtime_now: number;
  open_anomalies: number;
  critical_anomalies: number;
  top_severity: Severity | null;
  active_recommendation: string | null;
  active_recommendation_id: number | null;
  energy_intensity: number;
  verified_savings_energy: number;
  verified_savings_water: number;
}

export interface SeriesPoint {
  ts: string;
  actual: number;
  expected: number | null;
  occupancy?: number | null;
  occupancy_pct?: number | null;
  temperature?: number | null;
  outdoor_temperature?: number | null;
  hvac_runtime?: number | null;
  lighting_runtime?: number | null;
  pump_runtime?: number | null;
  flow_lph?: number | null;
  is_anomalous: boolean;
}

export interface Evidence {
  label: string;
  value: string;
  criterion: string;
  satisfied: boolean;
  weight: number;
  detail: string;
}

export interface Anomaly {
  id: number;
  building_id: number;
  building_code: string | null;
  building_name: string | null;
  resource_type: ResourceType;
  detected_at: string;
  start_ts: string;
  end_ts: string;
  duration_hours: number;
  severity: Severity;
  actual_value: number;
  expected_value: number;
  deviation_pct: number;
  excess_total: number;
  unit: string;
  cause_code: string | null;
  probable_cause: string | null;
  affected_subsystem: string | null;
  confidence: number | null;
  evidence: Evidence[] | null;
  diagnosis_narrative: string | null;
  narrative_source: string;
  flagged_intervals: number;
  occurrence_days: number;
  is_persistent: boolean;
  detector: string;
  anomaly_score: number;
  status: AnomalyStatus;
  recommendation_id: number | null;
}

export interface Recommendation {
  id: number;
  anomaly_id: number | null;
  building_id: number;
  building_code: string | null;
  building_name: string | null;
  resource_type: ResourceType;
  title: string;
  description: string;
  reason: string;
  implementation: string;
  evidence: Evidence[];
  expected_saving_per_week: number;
  expected_saving_unit: string;
  estimated_cost_saving_per_week: number;
  estimated_co2_reduction_per_week: number;
  implementation_difficulty: "LOW" | "MEDIUM" | "HIGH";
  priority: Severity;
  priority_score: number;
  payback_note: string;
  target_fault_code: string | null;
  status: "PENDING" | "APPLIED" | "DISMISSED";
  narrative_source: string;
  created_at: string;
  severity: Severity | null;
  intervention_id: number | null;
}

export interface TimelineEntry {
  status: string;
  note: string;
  at: string;
}

export interface Intervention {
  id: number;
  recommendation_id: number | null;
  building_id: number;
  building_code: string | null;
  building_name: string | null;
  resource_type: ResourceType;
  title: string;
  description: string;
  implemented_at: string;
  status: InterventionStatus;
  owner: string;
  target_fault_code: string | null;
  monitoring_days_required: number;
  notes: string;
  timeline: TimelineEntry[];
  created_at: string;
  updated_at: string;
  elapsed_days: number;
  progress_pct: number;
  ready_for_verification: boolean;
  expected_saving_per_week: number | null;
  expected_saving_unit: string | null;
  verification_status: VerificationStatus | null;
  verified_saving: number | null;
  verified_saving_pct: number | null;
  verification_id: number | null;
}

export interface VerificationSeriesPoint {
  date: string;
  value: number;
  phase: "baseline" | "post" | "adjusted_baseline";
}

export interface Verification {
  id: number;
  intervention_id: number;
  building_id: number;
  building_code: string | null;
  building_name: string | null;
  resource_type: ResourceType;
  intervention_title: string | null;
  baseline_start: string;
  baseline_end: string;
  post_start: string;
  post_end: string;
  baseline_days: number;
  post_days: number;
  baseline_value: number;
  post_value: number;
  adjusted_baseline_value: number;
  absolute_saving: number;
  saving_pct: number;
  unit: string;
  financial_saving_per_week: number;
  financial_saving_per_year: number;
  co2_reduction_per_week: number;
  co2_reduction_per_year: number;
  p_value: number | null;
  confidence_pct: number | null;
  baseline_model_r2: number | null;
  baseline_model_cvrmse: number | null;
  threshold_pct: number;
  status: VerificationStatus;
  method: string;
  explanation: string;
  series: {
    baseline: VerificationSeriesPoint[];
    post: VerificationSeriesPoint[];
    adjusted_baseline: VerificationSeriesPoint[];
    adjusted_by_date: Record<string, number>;
    raw_saving: number;
    raw_saving_pct: number;
    baseline_days: number;
    post_days: number;
  };
  hourly_profile: {
    hours: number[];
    baseline: number[];
    post: number[];
  };
  created_at: string;
}

export interface Kpi {
  key: string;
  label: string;
  value: number;
  unit: string;
  change_pct: number | null;
  previous_value: number | null;
  direction: "up" | "down" | "flat";
  good_direction: "up" | "down";
  caption: string;
  measured: boolean;
}

export interface CampusPoint {
  ts: string;
  label: string;
  energy?: number | null;
  energy_expected?: number | null;
  water?: number | null;
  water_expected?: number | null;
}

export interface BuildingComparison {
  building_id: number;
  code: string;
  name: string;
  energy_kwh: number;
  water_liters: number;
  energy_intensity: number;
  water_intensity: number;
  deviation_pct: number;
  status: BuildingStatus;
  open_anomalies: number;
}

export interface PipelineStage {
  key: string;
  label: string;
  value: number;
  caption: string;
}

export interface Economics {
  electricity_tariff: number;
  water_tariff_per_kl: number;
  grid_emission_factor: number;
  water_emission_factor: number;
  currency: string;
  currency_symbol: string;
}

export interface Dashboard {
  kpis: Kpi[];
  series: CampusPoint[];
  buildings: BuildingComparison[];
  anomalies: Anomaly[];
  recommendations: Recommendation[];
  interventions: Intervention[];
  verifications: Verification[];
  pipeline: { stages: PipelineStage[]; monitoring: number };
  range_days: number;
  resource: ResourceFilter;
  interval: string;
  data_start: string | null;
  data_end: string | null;
  economics: Economics;
}

export interface Subsystem {
  key: string;
  label: string;
  icon: string;
  value: number;
  unit: string;
  secondary: string;
  detail: string;
  deviation_pct: number;
}

export interface BuildingDetail {
  building: Building;
  energy_series: SeriesPoint[];
  water_series: SeriesPoint[];
  anomalies: Anomaly[];
  recommendations: Recommendation[];
  interventions: Intervention[];
  subsystems: Subsystem[];
  stats: Record<string, number | string>;
  range_days: number;
  interval: string;
}

export interface AnomalyDetail {
  anomaly: Anomaly;
  recommendation: Recommendation | null;
  series: SeriesPoint[];
  context: Record<string, number | string | number[]>;
  hourly_profile: {
    hours: number[];
    anomalous: (number | null)[];
    normal: number[];
    affected_hours?: number[];
    unit?: string;
  };
}

export interface InvestigationHypothesis {
  name: string;
  status?: string | null;
  confidence: number;
  reasoning: string;
}

export interface InvestigationEvidence {
  label: string;
  value: unknown;
  meaning: string;
  hypothesis?: string;
}

export interface InvestigationUnknown {
  label: string;
  status?: string | null;
  why_it_matters: string;
}

export interface InvestigationProbe {
  tool: string;
  arguments: Record<string, unknown>;
  status?: string | null;
  selector: string;
}

export interface InvestigationResponse {
  anomaly_id: number;
  resource: string | null;
  hypotheses: InvestigationHypothesis[];
  supporting_evidence: InvestigationEvidence[];
  contradictions: InvestigationEvidence[];
  unknowns: InvestigationUnknown[];
  probes_taken?: InvestigationProbe[];
  next_probe: Record<string, unknown> | null;
  events?: Array<Record<string, unknown>>;
  status?: string | null;
  investigation_summary?: string | null;
}

export interface ReportSummary {
  generated_at: string;
  period_start: string | null;
  period_end: string | null;
  totals: Record<string, number>;
  by_building: Array<{
    building_id: number;
    code: string;
    name: string;
    area_sqm: number;
    energy_kwh: number;
    water_kl: number;
    energy_intensity: number;
    anomalies: number;
    verified_energy_saving_week: number;
    verified_water_saving_week: number;
    verified_money_year: number;
  }>;
  by_resource: {
    anomalies: Record<string, number>;
    energy_saved_per_week: number;
    water_saved_per_week: number;
  };
  verified_interventions: Verification[];
  anomaly_breakdown: {
    by_severity: Record<string, number>;
    by_cause: Record<string, number>;
  };
  methodology: Array<{ stage: string; method: string }>;
  economics: Economics;
}

export interface SettingMeta {
  key: string;
  label: string;
  group: string;
  unit: string;
  step: number;
  min: number;
  max: number;
  help: string;
}

export interface SettingsPayload {
  values: Record<string, number>;
  defaults: Record<string, number>;
  metadata: SettingMeta[];
  economics: Economics;
  llm_enabled: boolean;
  llm_model: string | null;
}

export type DemoStage =
  | "DETECTED"
  | "DIAGNOSED"
  | "RECOMMENDED"
  | "INTERVENED"
  | "MONITORING"
  | "VERIFIED"
  | "NOT_DETECTED"
  | "UNAVAILABLE";

export interface DemoScenario {
  key: string;
  order: number;
  title: string;
  resource_type: ResourceType;
  building_code: string;
  building_id: number | null;
  fault_code: string;
  headline: string;
  summary: string;
  what_to_look_for: string[];
  expected_cause: string;
  anomaly_id: number | null;
  recommendation_id: number | null;
  intervention_id: number | null;
  verification_id: number | null;
  stage: DemoStage;
  available: boolean;
}

export interface DemoState {
  demo_mode: boolean;
  scenarios: DemoScenario[];
  data_start: string | null;
  data_end: string | null;
  seeded_at: string | null;
}
