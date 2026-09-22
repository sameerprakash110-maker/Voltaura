"""
Savings verification service.

Runs the M&V engine in `ml.savings` against real stored telemetry, converts the
measured physical saving into money and carbon at the configured tariffs, and
persists the result with the full before/after series for charting.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ml.savings import financial_and_carbon, verify

from ..config import settings as defaults
from ..models import (
    Building,
    Intervention,
    InterventionStatus,
    VerificationResult,
)
from . import intervention_service, pipeline, settings_service, simulation

WEEKS_PER_YEAR = 52.0


def run_verification(
    db: Session, intervention: Intervention, persist: bool = True
) -> VerificationResult:
    """
    Verify one intervention and store the result.

    Returns a VerificationResult in every case, including when there is not
    yet enough post-intervention telemetry: "not enough data yet" is a real
    answer the product must be able to give.
    """
    config = settings_service.get_effective(db)
    economics = settings_service.economics(db)

    building = db.get(Building, intervention.building_id)
    if building is None:
        raise ValueError(f"Building {intervention.building_id} no longer exists")

    df = pipeline.load_frame(db, building, intervention.resource_type)

    outcome = verify(
        df,
        resource_type=intervention.resource_type,
        implemented_at=intervention.implemented_at,
        baseline_days=int(config["baseline_window_days"]),
        post_days=int(config["post_window_days"]),
        threshold_pct=float(config["verification_threshold_pct"]),
        significance=float(config["verification_significance"]),
        min_post_days=int(config["min_post_days_for_verification"]),
        seed=defaults.random_seed,
    )

    saving = max(0.0, outcome.absolute_saving) if outcome.status == "VERIFIED" else outcome.absolute_saving
    financial, co2 = financial_and_carbon(
        saving,
        intervention.resource_type,
        electricity_tariff=economics["electricity_tariff"],
        water_tariff_per_kl=economics["water_tariff_per_kl"],
        grid_emission_factor=economics["grid_emission_factor"],
        water_emission_factor=economics["water_emission_factor"],
    )
    # Only a verified saving is annualised: projecting an unverified or
    # negative result would misrepresent it.
    annualise = outcome.status == "VERIFIED"

    result = VerificationResult(
        intervention_id=intervention.id,
        building_id=intervention.building_id,
        resource_type=intervention.resource_type,
        baseline_start=outcome.baseline_start,
        baseline_end=outcome.baseline_end,
        post_start=outcome.post_start,
        post_end=outcome.post_end,
        baseline_days=outcome.baseline_days,
        post_days=outcome.post_days,
        baseline_value=outcome.baseline_value,
        post_value=outcome.post_value,
        adjusted_baseline_value=outcome.adjusted_baseline_value,
        absolute_saving=outcome.absolute_saving,
        saving_pct=outcome.saving_pct,
        unit=outcome.unit,
        financial_saving_per_week=round(financial, 2),
        financial_saving_per_year=round(financial * WEEKS_PER_YEAR, 2) if annualise else 0.0,
        co2_reduction_per_week=round(co2, 2),
        co2_reduction_per_year=round(co2 * WEEKS_PER_YEAR, 2) if annualise else 0.0,
        p_value=outcome.p_value,
        confidence_pct=outcome.confidence_pct,
        baseline_model_r2=outcome.baseline_model_r2,
        baseline_model_cvrmse=outcome.baseline_model_cvrmse,
        threshold_pct=outcome.threshold_pct,
        status=outcome.status,
        method=outcome.method,
        explanation=outcome.explanation,
        series={
            **outcome.series,
            "raw_saving": outcome.raw_saving,
            "raw_saving_pct": outcome.raw_saving_pct,
            "baseline_days": outcome.baseline_days,
            "post_days": outcome.post_days,
        },
        hourly_profile=outcome.hourly_profile,
        created_at=datetime.utcnow(),
    )

    if not persist:
        return result

    db.add(result)

    # ---- advance the intervention lifecycle to match the evidence -----
    if outcome.status == "VERIFIED":
        intervention_service.set_status(
            db,
            intervention,
            InterventionStatus.VERIFIED.value,
            f"Saving verified at {outcome.absolute_saving:,.0f} {outcome.unit}/week "
            f"({outcome.saving_pct:.1f}% below the adjusted baseline).",
        )
    elif outcome.status == "INSUFFICIENT_DATA":
        if intervention.status != InterventionStatus.MONITORING.value:
            intervention_service.set_status(
                db,
                intervention,
                InterventionStatus.MONITORING.value,
                f"Monitoring in progress: {outcome.post_days:.1f} of "
                f"{config['min_post_days_for_verification']} days of "
                "post-intervention telemetry collected.",
            )
    else:
        intervention_service.set_status(
            db,
            intervention,
            InterventionStatus.COMPLETED.value,
            f"Verification returned {outcome.status}: {outcome.saving_pct:.1f}% "
            "against the adjusted baseline.",
        )

    db.commit()
    db.refresh(result)
    return result


def latest_for_intervention(db: Session, intervention_id: int) -> VerificationResult | None:
    return db.execute(
        select(VerificationResult)
        .where(VerificationResult.intervention_id == intervention_id)
        .order_by(VerificationResult.created_at.desc(), VerificationResult.id.desc())
    ).scalars().first()


def latest_per_intervention(db: Session) -> list[VerificationResult]:
    """Most recent verification run for each intervention, newest first."""
    interventions = db.execute(
        select(Intervention).order_by(Intervention.implemented_at.desc())
    ).scalars().all()
    results = db.execute(
        select(VerificationResult).order_by(
            VerificationResult.created_at.desc(), VerificationResult.id.desc()
        )
    ).scalars().all()
    latest: dict[int, VerificationResult] = {}
    for result in results:
        latest.setdefault(result.intervention_id, result)
    return [latest[i.id] for i in interventions if i.id in latest]


def latest_by_intervention(
    db: Session, intervention_ids: list[int]
) -> dict[int, VerificationResult]:
    """Load the newest result for each requested intervention in one query."""
    if not intervention_ids:
        return {}
    results = db.execute(
        select(VerificationResult)
        .where(VerificationResult.intervention_id.in_(intervention_ids))
        .order_by(VerificationResult.created_at.desc(), VerificationResult.id.desc())
    ).scalars().all()
    latest: dict[int, VerificationResult] = {}
    for result in results:
        latest.setdefault(result.intervention_id, result)
    return latest


def run_monitoring_then_verify(
    db: Session, intervention: Intervention, days: float
) -> tuple[VerificationResult, dict]:
    """
    Demo-mode convenience: collect `days` of post-intervention telemetry, then
    verify in one step.

    The telemetry is generated by the same building simulator that produced the
    history, with the intervention's fault removed. This is the software
    equivalent of waiting a fortnight for the meters to report.
    """
    advance = simulation.advance_simulation(db, days=days)
    # The simulator advances the whole campus clock, so every building gains
    # new intervals. Expected consumption has to be refreshed for all of them,
    # not just the one under test -- otherwise the other buildings carry
    # readings with no expectation attached and their actual-vs-expected
    # deviation on the dashboard becomes meaningless.
    pipeline.recompute_expected_only(db)
    result = run_verification(db, intervention)
    return result, advance
