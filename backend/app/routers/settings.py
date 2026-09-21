"""Application settings: tariffs, emission factors and detection thresholds."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..config import TUNABLE_KEYS, settings as defaults
from ..database import get_db
from ..schemas import SettingsResponse, SettingsUpdateRequest
from ..services import llm, settings_service

router = APIRouter(tags=["settings"])

# Presentation metadata for the settings form. Every entry here is a value the
# calculations actually read, so changing one visibly changes the numbers.
METADATA = [
    {"key": "electricity_tariff", "label": "Electricity tariff", "group": "Economics",
     "unit": f"{defaults.currency}/kWh", "step": 0.25, "min": 0, "max": 100,
     "help": "Applied to every verified and estimated energy saving."},
    {"key": "water_tariff_per_kl", "label": "Water tariff", "group": "Economics",
     "unit": f"{defaults.currency}/kL", "step": 1, "min": 0, "max": 500,
     "help": "Applied per kilolitre of verified and estimated water saving."},
    {"key": "grid_emission_factor", "label": "Grid emission factor", "group": "Carbon",
     "unit": "kg CO2e/kWh", "step": 0.01, "min": 0, "max": 2,
     "help": "Converts saved electricity into avoided emissions."},
    {"key": "water_emission_factor", "label": "Water emission factor", "group": "Carbon",
     "unit": "kg CO2e/kL", "step": 0.01, "min": 0, "max": 5,
     "help": "Embodied emissions of treating and pumping supplied water."},
    {"key": "verification_threshold_pct", "label": "Verification threshold", "group": "Verification",
     "unit": "% reduction", "step": 1, "min": 0, "max": 60,
     "help": "Minimum reduction against the adjusted baseline before a saving "
             "is marked VERIFIED. Raise it to see the engine refuse a result."},
    {"key": "verification_significance", "label": "Significance level", "group": "Verification",
     "unit": "max p-value", "step": 0.01, "min": 0.001, "max": 0.5,
     "help": "A saving must also be statistically significant at this level."},
    {"key": "baseline_window_days", "label": "Baseline window", "group": "Verification",
     "unit": "days", "step": 1, "min": 3, "max": 60,
     "help": "Length of the pre-intervention period used to fit the baseline model."},
    {"key": "post_window_days", "label": "Post-intervention window", "group": "Verification",
     "unit": "days", "step": 1, "min": 3, "max": 60,
     "help": "Length of the reporting period compared against the baseline."},
    {"key": "min_post_days_for_verification", "label": "Minimum monitoring", "group": "Verification",
     "unit": "days", "step": 1, "min": 1, "max": 30,
     "help": "Telemetry required before verification will return a verdict."},
    {"key": "iforest_contamination", "label": "Isolation Forest contamination", "group": "Detection",
     "unit": "fraction", "step": 0.005, "min": 0.005, "max": 0.25,
     "help": "Expected share of anomalous intervals. Higher means more sensitive."},
    {"key": "residual_z_threshold", "label": "Residual z-score threshold", "group": "Detection",
     "unit": "sigma", "step": 0.1, "min": 1, "max": 6,
     "help": "How far above the expected-consumption model an interval must sit, "
             "scored within its own hour of day."},
    {"key": "min_deviation_pct", "label": "Minimum deviation", "group": "Detection",
     "unit": "%", "step": 1, "min": 1, "max": 100,
     "help": "Deviations below this are treated as noise, not waste."},
    {"key": "min_event_duration_hours", "label": "Minimum event length", "group": "Detection",
     "unit": "intervals", "step": 1, "min": 1, "max": 24,
     "help": "Flagged runs shorter than this are not raised as anomalies."},
]


@router.get("/settings", response_model=SettingsResponse)
def get_settings(db: Session = Depends(get_db)) -> SettingsResponse:
    """Current effective settings, the shipped defaults, and form metadata."""
    return SettingsResponse(
        values=settings_service.get_effective(db),
        defaults={key: getattr(defaults, key) for key in TUNABLE_KEYS},
        metadata=METADATA,
        economics=settings_service.economics(db),
        llm_enabled=llm.is_available(),
        llm_model=llm.status()["model"],
    )


@router.put("/settings", response_model=SettingsResponse)
def update_settings(
    payload: SettingsUpdateRequest, db: Session = Depends(get_db)
) -> SettingsResponse:
    """
    Update settings.

    Unknown or malformed keys are ignored rather than rejected, so a partial
    form submission is always safe. Changes take effect on the next
    calculation: re-run detection or verification to see them applied.
    """
    settings_service.update(db, payload.values)
    return get_settings(db)


@router.post("/settings/reset", response_model=SettingsResponse)
def reset_settings(db: Session = Depends(get_db)) -> SettingsResponse:
    """Discard every override and return to the shipped defaults."""
    settings_service.reset(db)
    return get_settings(db)
