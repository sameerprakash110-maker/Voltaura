"""
Shared feature engineering for the EcoTwin ML pipeline.

A deliberate distinction runs through this module:

  DRIVER features   - things the building cannot choose: time of day, day of
                      week, how many people are inside, how hot it is outside.
  RESPONSE features - things the plant does in response: HVAC runtime,
                      lighting runtime, pump runtime, metered consumption.

The expected-consumption model is trained on DRIVERS ONLY. If equipment
runtime were included, a unit left running all night would simply raise the
prediction and the waste would vanish into the baseline. Keeping runtime out of
the baseline is what makes "actual vs expected" mean "wasted vs needed", and it
is what leaves runtime free to act as *evidence* for the root-cause engine.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

# Cooling-degree base temperature (deg C) for the campus setpoint.
COOLING_BASE_C = 22.0

DRIVER_FEATURES = [
    "hour_sin",
    "hour_cos",
    "dow",
    "is_weekend",
    "is_offhours",
    "occupancy_pct",
    "outdoor_temperature_c",
    "cooling_degrees",
]

RESPONSE_COLUMNS = {
    "ENERGY": ["hvac_runtime_min", "lighting_runtime_min"],
    "WATER": ["pump_runtime_min"],
}

VALUE_COLUMN = {"ENERGY": "energy_kwh", "WATER": "water_liters"}
EXPECTED_COLUMN = {"ENERGY": "expected_kwh", "WATER": "expected_liters"}
UNIT = {"ENERGY": "kWh", "WATER": "L"}


def add_time_features(df: pd.DataFrame, ts_col: str = "ts") -> pd.DataFrame:
    """Attach calendar/cyclical features derived purely from the timestamp."""
    out = df.copy()
    ts = pd.to_datetime(out[ts_col])
    out["hour"] = ts.dt.hour
    out["dow"] = ts.dt.dayofweek
    out["date"] = ts.dt.normalize()
    out["hour_sin"] = np.sin(2 * np.pi * out["hour"] / 24.0)
    out["hour_cos"] = np.cos(2 * np.pi * out["hour"] / 24.0)
    out["is_weekend"] = (out["dow"] >= 5).astype(int)
    return out


def add_building_features(
    df: pd.DataFrame, operating_start: int, operating_end: int
) -> pd.DataFrame:
    """Attach features that depend on the building's published schedule."""
    out = df.copy()
    out["is_offhours"] = (
        (out["hour"] < operating_start) | (out["hour"] >= operating_end)
    ).astype(int)
    out["cooling_degrees"] = np.maximum(0.0, out["outdoor_temperature_c"] - COOLING_BASE_C)
    return out


def build_frame(
    rows: list[dict], operating_start: int, operating_end: int
) -> pd.DataFrame:
    """
    Turn raw reading dicts into a modelling frame.

    Returns an empty frame (with the right columns) when there are no rows, so
    every caller downstream can rely on the schema.
    """
    if not rows:
        cols = ["ts", "hour", "dow", "date", "hour_sin", "hour_cos", "is_weekend",
                "is_offhours", "occupancy_pct", "outdoor_temperature_c", "cooling_degrees"]
        return pd.DataFrame(columns=cols)

    df = pd.DataFrame(rows)
    df = add_time_features(df)
    df = add_building_features(df, operating_start, operating_end)
    return df.sort_values("ts").reset_index(drop=True)


def driver_matrix(df: pd.DataFrame) -> np.ndarray:
    """Driver-only design matrix for the expected-consumption model."""
    return df[DRIVER_FEATURES].to_numpy(dtype=float)


# --------------------------------------------------------------------------
# Robust statistics
# --------------------------------------------------------------------------
def mad_scale(values: np.ndarray) -> float:
    """
    Median-absolute-deviation scaled to be a consistent estimator of sigma for
    normal data. Robust to the anomalies we are trying to find, unlike std().
    """
    values = np.asarray(values, dtype=float)
    if values.size == 0:
        return 0.0
    med = float(np.median(values))
    mad = float(np.median(np.abs(values - med)))
    return 1.4826 * mad


def robust_z_by_hour(
    residuals: np.ndarray, hours: np.ndarray, min_scale: float
) -> np.ndarray:
    """
    Residual z-scores computed *within each hour of day*.

    This matters enormously for water. A 41 L/h leak is invisible against a
    building-wide residual spread dominated by daytime demand of several
    hundred L/h, but at 03:00 the normal residual spread is a couple of litres
    and the same leak is a 20-sigma event. Scaling per hour-of-day is what lets
    one detector catch both a daytime HVAC over-run and an overnight leak.

    `min_scale` floors the denominator so that a near-degenerate hour bucket
    cannot manufacture enormous z-scores out of sensor quantisation noise.
    """
    residuals = np.asarray(residuals, dtype=float)
    hours = np.asarray(hours, dtype=int)
    z = np.zeros_like(residuals)

    for h in range(24):
        mask = hours == h
        if not mask.any():
            continue
        bucket = residuals[mask]
        centre = float(np.median(bucket))
        scale = max(mad_scale(bucket), min_scale)
        z[mask] = (bucket - centre) / scale

    return z


def summarise_window(df: pd.DataFrame, columns: list[str]) -> dict[str, float]:
    """Mean of the requested columns over a window, tolerating missing cols."""
    out: dict[str, float] = {}
    for col in columns:
        if col in df.columns and len(df):
            out[col] = float(pd.to_numeric(df[col], errors="coerce").mean())
        else:
            out[col] = 0.0
    return out


def safe_ratio(numerator: float, denominator: float, default: float = 1.0) -> float:
    """Ratio that degrades gracefully when the denominator is ~0."""
    if denominator is None or abs(denominator) < 1e-9:
        return default
    return float(numerator) / float(denominator)


def pct_change(actual: float, expected: float) -> float:
    """Percentage deviation of actual from expected."""
    if expected is None or abs(expected) < 1e-9:
        return 0.0
    return float((actual - expected) / expected * 100.0)
