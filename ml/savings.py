"""
Savings verification (measurement & verification).

This is the stage that separates VOLTAURA from a dashboard: it does not report
the saving a recommendation *promised*, it measures the saving the building
actually delivered.

METHOD - IPMVP OPTION C, WHOLE-FACILITY, WITH ROUTINE ADJUSTMENTS
-----------------------------------------------------------------
A naive before/after comparison is not evidence. If the fortnight after an
intervention happens to be cooler, or falls in a quieter teaching week,
consumption drops for reasons that have nothing to do with the measure.

So the comparison is normalised:

  1. Fit a baseline model on the pre-intervention window using DRIVERS ONLY
     (hour, day of week, occupancy, outdoor temperature, schedule).
  2. Evaluate that baseline model on the POST period's own driver values.
     This yields the *adjusted baseline*: what the building would have consumed
     in the post period had nothing been changed.
  3. Saving = adjusted baseline - actual post-intervention consumption.

Reported alongside is the unadjusted difference, so the effect of the
normalisation itself is visible rather than hidden.

CONFIDENCE
----------
A Welch t-test compares hourly actuals against the adjusted baseline. A result
is VERIFIED only when it clears BOTH gates:

    saving_pct >= verification_threshold_pct     (material)
    p_value    <  significance level             (not noise)

Anything that reduces consumption but fails significance is reported
INCONCLUSIVE, and anything that fails the threshold is NOT_VERIFIED. The system
is allowed to say an intervention did not work.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
from scipy import stats

from .expected_consumption import fit_baseline
from .features import EXPECTED_COLUMN, UNIT, VALUE_COLUMN

HOURS_PER_WEEK = 168.0


@dataclass
class VerificationOutcome:
    status: str
    baseline_value: float          # per week, raw
    post_value: float              # per week, raw
    adjusted_baseline_value: float  # per week, normalised
    absolute_saving: float         # per week
    saving_pct: float
    unit: str
    raw_saving: float
    raw_saving_pct: float
    p_value: float | None
    confidence_pct: float | None
    baseline_model_r2: float | None
    baseline_model_cvrmse: float | None
    threshold_pct: float
    baseline_start: datetime
    baseline_end: datetime
    post_start: datetime
    post_end: datetime
    baseline_days: float
    post_days: float
    explanation: str
    method: str
    series: dict = field(default_factory=dict)
    hourly_profile: dict = field(default_factory=dict)


def _weekly(values: np.ndarray) -> float:
    """Mean hourly value scaled to a 168-hour week."""
    if values.size == 0:
        return 0.0
    return float(np.mean(values) * HOURS_PER_WEEK)


def _daily_series(df: pd.DataFrame, value_col: str, label: str) -> list[dict]:
    if df.empty:
        return []
    grouped = df.groupby("date")[value_col].sum().reset_index()
    return [
        {
            "date": pd.Timestamp(row["date"]).strftime("%Y-%m-%d"),
            "value": round(float(row[value_col]), 2),
            "phase": label,
        }
        for _, row in grouped.iterrows()
    ]


def verify(
    df: pd.DataFrame,
    resource_type: str,
    implemented_at: datetime,
    baseline_days: int = 14,
    post_days: int = 14,
    threshold_pct: float = 5.0,
    significance: float = 0.05,
    min_post_days: int = 7,
    seed: int = 42,
) -> VerificationOutcome:
    """
    Run one verification pass.

    `df` must contain the building's full telemetry for the resource, already
    passed through `features.build_frame`.
    """
    value_col = VALUE_COLUMN[resource_type]
    unit = UNIT[resource_type]

    baseline_start = implemented_at - timedelta(days=baseline_days)
    post_end_target = implemented_at + timedelta(days=post_days)

    ts = pd.to_datetime(df["ts"])
    baseline_df = df[(ts >= baseline_start) & (ts < implemented_at)]
    post_df = df[(ts >= implemented_at) & (ts < post_end_target)]

    post_actual_days = len(post_df) / 24.0
    post_end_actual = (
        pd.Timestamp(post_df["ts"].max()).to_pydatetime() if len(post_df) else implemented_at
    )

    # ---- guard: not enough post-intervention telemetry yet ------------
    if post_actual_days < min_post_days or baseline_df.empty:
        observed = round(post_actual_days, 1)
        return VerificationOutcome(
            status="INSUFFICIENT_DATA",
            baseline_value=_weekly(baseline_df[value_col].to_numpy()) if len(baseline_df) else 0.0,
            post_value=_weekly(post_df[value_col].to_numpy()) if len(post_df) else 0.0,
            adjusted_baseline_value=0.0,
            absolute_saving=0.0,
            saving_pct=0.0,
            unit=unit,
            raw_saving=0.0,
            raw_saving_pct=0.0,
            p_value=None,
            confidence_pct=None,
            baseline_model_r2=None,
            baseline_model_cvrmse=None,
            threshold_pct=threshold_pct,
            baseline_start=baseline_start,
            baseline_end=implemented_at,
            post_start=implemented_at,
            post_end=post_end_actual,
            baseline_days=len(baseline_df) / 24.0,
            post_days=post_actual_days,
            explanation=(
                f"Only {observed:.1f} days of post-intervention telemetry are "
                f"available. Verification requires at least {min_post_days} days "
                "so that weekday, weekend and weather variation are all "
                "represented. The intervention remains under monitoring."
            ),
            method="IPMVP Option C (adjusted baseline)",
        )

    # ---- fit the baseline model on the pre-intervention window --------
    model = fit_baseline(baseline_df, value_col, seed=seed)

    baseline_actual = baseline_df[value_col].to_numpy(dtype=float)
    post_actual = post_df[value_col].to_numpy(dtype=float)

    if model is not None:
        adjusted_hourly = model.predict(post_df)
        method = "IPMVP Option C - Random Forest baseline with routine adjustments"
        r2, cvrmse = model.r2, model.cvrmse
    else:
        # Fallback: match on hour-of-week medians from the baseline window.
        work = baseline_df.copy()
        work["how"] = work["dow"] * 24 + work["hour"]
        medians = work.groupby("how")[value_col].median()
        overall = float(work[value_col].median())
        how_post = post_df["dow"] * 24 + post_df["hour"]
        adjusted_hourly = how_post.map(medians).fillna(overall).to_numpy(dtype=float)
        method = "IPMVP Option C - hour-of-week baseline (insufficient data for model fit)"
        r2, cvrmse = None, None

    baseline_weekly = _weekly(baseline_actual)
    post_weekly = _weekly(post_actual)
    adjusted_weekly = _weekly(adjusted_hourly)

    absolute_saving = adjusted_weekly - post_weekly
    saving_pct = (absolute_saving / adjusted_weekly * 100.0) if adjusted_weekly > 1e-9 else 0.0

    raw_saving = baseline_weekly - post_weekly
    raw_saving_pct = (raw_saving / baseline_weekly * 100.0) if baseline_weekly > 1e-9 else 0.0

    # ---- statistical significance --------------------------------------
    p_value: float | None = None
    if len(post_actual) > 8 and len(adjusted_hourly) > 8:
        try:
            _, p_value = stats.ttest_ind(
                adjusted_hourly, post_actual, equal_var=False, alternative="greater"
            )
            p_value = float(p_value)
            if not np.isfinite(p_value):
                p_value = None
        except (ValueError, FloatingPointError):
            p_value = None

    confidence_pct = round((1.0 - p_value) * 100.0, 2) if p_value is not None else None

    # ---- verdict --------------------------------------------------------
    meets_threshold = saving_pct >= threshold_pct
    significant = p_value is not None and p_value < significance

    if meets_threshold and significant:
        status = "VERIFIED"
        explanation = (
            f"Post-intervention consumption is {saving_pct:.1f}% below the "
            f"occupancy- and weather-adjusted baseline, exceeding the "
            f"{threshold_pct:.0f}% minimum verification threshold. The "
            f"reduction is statistically significant (p = {p_value:.2g}) across "
            f"{len(post_actual)} hourly intervals, so it cannot be explained by "
            f"normal variation. Saving verified at "
            f"{absolute_saving:,.0f} {unit}/week."
        )
    elif meets_threshold and not significant:
        status = "INCONCLUSIVE"
        pv = f"p = {p_value:.2g}" if p_value is not None else "significance could not be computed"
        explanation = (
            f"Consumption is {saving_pct:.1f}% below the adjusted baseline, "
            f"which clears the {threshold_pct:.0f}% threshold, but the result is "
            f"not statistically distinguishable from normal variation ({pv}). "
            "A longer monitoring period is required before the saving can be "
            "verified."
        )
    elif saving_pct > 0:
        status = "NOT_VERIFIED"
        explanation = (
            f"Consumption is only {saving_pct:.1f}% below the adjusted baseline, "
            f"short of the {threshold_pct:.0f}% minimum verification threshold. "
            "The intervention has not yet delivered a material reduction; "
            "re-inspect the implementation before extending the monitoring period."
        )
    else:
        status = "NOT_VERIFIED"
        explanation = (
            f"Post-intervention consumption is {abs(saving_pct):.1f}% "
            f"{'above' if saving_pct < 0 else 'level with'} the adjusted "
            "baseline. No saving has been delivered. The intervention should be "
            "re-inspected: the measure may not have been applied as specified."
        )

    # ---- chart series ----------------------------------------------------
    series_baseline = _daily_series(baseline_df, value_col, "baseline")
    series_post = _daily_series(post_df, value_col, "post")

    post_with_adjusted = post_df.copy()
    post_with_adjusted["_adjusted"] = adjusted_hourly
    series_adjusted = _daily_series(post_with_adjusted, "_adjusted", "adjusted_baseline")
    adjusted_by_date = {row["date"]: row["value"] for row in series_adjusted}

    # Average day-of-hour profile, before vs after. This is the chart that
    # makes an evening HVAC fix or an overnight leak repair instantly legible.
    baseline_profile = baseline_df.groupby("hour")[value_col].mean()
    post_profile = post_df.groupby("hour")[value_col].mean()
    hourly_profile = {
        "hours": list(range(24)),
        "baseline": [round(float(baseline_profile.get(h, 0.0)), 3) for h in range(24)],
        "post": [round(float(post_profile.get(h, 0.0)), 3) for h in range(24)],
    }

    return VerificationOutcome(
        status=status,
        baseline_value=round(baseline_weekly, 2),
        post_value=round(post_weekly, 2),
        adjusted_baseline_value=round(adjusted_weekly, 2),
        absolute_saving=round(absolute_saving, 2),
        saving_pct=round(saving_pct, 2),
        unit=unit,
        raw_saving=round(raw_saving, 2),
        raw_saving_pct=round(raw_saving_pct, 2),
        p_value=p_value,
        confidence_pct=confidence_pct,
        baseline_model_r2=round(r2, 4) if r2 is not None else None,
        baseline_model_cvrmse=round(cvrmse, 2) if cvrmse is not None else None,
        threshold_pct=threshold_pct,
        baseline_start=baseline_start,
        baseline_end=implemented_at,
        post_start=implemented_at,
        post_end=post_end_actual,
        baseline_days=round(len(baseline_df) / 24.0, 2),
        post_days=round(post_actual_days, 2),
        explanation=explanation,
        method=method,
        series={
            "baseline": series_baseline,
            "post": series_post,
            "adjusted_baseline": series_adjusted,
            "adjusted_by_date": adjusted_by_date,
        },
        hourly_profile=hourly_profile,
    )


def financial_and_carbon(
    saving: float,
    resource_type: str,
    electricity_tariff: float,
    water_tariff_per_kl: float,
    grid_emission_factor: float,
    water_emission_factor: float,
) -> tuple[float, float]:
    """
    Convert a physical saving into money and carbon.

      energy:  saving_kwh * tariff_per_kwh          and  saving_kwh * kgCO2e/kWh
      water:   saving_litres/1000 * tariff_per_kl   and  /1000 * kgCO2e/kl
    """
    if resource_type == "ENERGY":
        return saving * electricity_tariff, saving * grid_emission_factor
    return (
        saving / 1000.0 * water_tariff_per_kl,
        saving / 1000.0 * water_emission_factor,
    )
