"""
Expected-consumption model.

A Random Forest regressor learns, per building and per resource, what an hour
*should* consume given only its demand drivers (time, occupancy, weather). The
gap between metered and expected consumption is the quantity everything
downstream reasons about:

    excess  =  actual  -  expected

ROBUST FITTING
--------------
The training history contains the very faults we want to find. Fitted naively,
the forest would partly learn the waste as normal behaviour and quietly absorb
it into the baseline. So the fit runs twice:

    1. fit on everything
    2. score residuals with a median/MAD scale (immune to the outliers)
    3. drop intervals whose residual sits beyond `trim_z`
    4. re-fit on the retained, cleaner intervals

Step 3 removes roughly the fault-affected minority without needing to know
where the faults are, which is the same trick an energy analyst applies by hand
when picking a "representative" baseline period.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, r2_score

from .features import DRIVER_FEATURES, driver_matrix, mad_scale, robust_z_by_hour

MIN_TRAINING_ROWS = 48


@dataclass
class BaselineModel:
    """A fitted expected-consumption model plus its fit diagnostics."""

    model: RandomForestRegressor
    r2: float
    mae: float
    cvrmse: float
    trimmed_fraction: float
    n_train: int
    feature_importance: dict[str, float]

    def predict(self, df: pd.DataFrame) -> np.ndarray:
        if df.empty:
            return np.array([], dtype=float)
        return np.maximum(0.0, self.model.predict(driver_matrix(df)))


def _make_forest(seed: int) -> RandomForestRegressor:
    return RandomForestRegressor(
        n_estimators=220,
        max_depth=14,
        min_samples_leaf=3,
        max_features=0.8,
        random_state=seed,
        n_jobs=-1,
    )


def fit_baseline(
    df: pd.DataFrame,
    target_col: str,
    seed: int = 42,
    trim_z: float = 2.6,
) -> BaselineModel | None:
    """
    Fit the robust expected-consumption model.

    Returns None when there is not enough history to fit anything meaningful;
    callers fall back to an hour-of-week median baseline in that case.
    """
    if df is None or len(df) < MIN_TRAINING_ROWS or target_col not in df.columns:
        return None

    work = df.dropna(subset=[target_col, *DRIVER_FEATURES])
    if len(work) < MIN_TRAINING_ROWS:
        return None

    X = driver_matrix(work)
    y = work[target_col].to_numpy(dtype=float)

    # --- pass 1: fit on everything -----------------------------------
    first = _make_forest(seed)
    first.fit(X, y)
    residuals = y - first.predict(X)

    # --- trim intervals dominated by faults ---------------------------
    # Scored within each hour of day, for the same reason detection is: a
    # single global scale is set by daytime variance and would either trim
    # half the night or miss faults entirely.
    if mad_scale(residuals) <= 1e-9:
        keep = np.ones(len(y), dtype=bool)
    else:
        z = robust_z_by_hour(
            residuals,
            work["hour"].to_numpy(dtype=int),
            min_scale=max(1e-6, 0.02 * float(np.mean(np.abs(y)))),
        )
        keep = np.abs(z) <= trim_z

    # Never trim so hard that the model loses its footing.
    if keep.sum() < max(MIN_TRAINING_ROWS, int(0.55 * len(y))):
        keep = np.ones(len(y), dtype=bool)

    trimmed_fraction = float(1.0 - keep.mean())

    # --- pass 2: re-fit on the retained intervals ---------------------
    final = _make_forest(seed + 1)
    final.fit(X[keep], y[keep])

    pred_clean = final.predict(X[keep])
    y_clean = y[keep]
    denom = float(np.mean(y_clean)) or 1.0
    cvrmse = float(np.sqrt(np.mean((y_clean - pred_clean) ** 2)) / denom * 100.0)

    return BaselineModel(
        model=final,
        r2=float(r2_score(y_clean, pred_clean)),
        mae=float(mean_absolute_error(y_clean, pred_clean)),
        cvrmse=cvrmse,
        trimmed_fraction=trimmed_fraction,
        n_train=int(keep.sum()),
        feature_importance={
            name: round(float(imp), 4)
            for name, imp in zip(DRIVER_FEATURES, final.feature_importances_)
        },
    )


def hour_of_week_baseline(df: pd.DataFrame, target_col: str) -> np.ndarray:
    """
    Fallback baseline: the median value for the same hour-of-week.

    Used when there is too little history for the forest, so the product still
    produces an "expected" curve rather than an empty chart.
    """
    if df.empty or target_col not in df.columns:
        return np.array([], dtype=float)

    work = df.copy()
    work["how"] = work["dow"] * 24 + work["hour"]
    medians = work.groupby("how")[target_col].median()
    overall = float(work[target_col].median())
    return work["how"].map(medians).fillna(overall).to_numpy(dtype=float)


def compute_expected(
    df: pd.DataFrame, target_col: str, seed: int = 42
) -> tuple[np.ndarray, BaselineModel | None]:
    """
    Expected consumption for every row of `df`.

    Returns (expected, model). `model` is None when the fallback was used.
    """
    model = fit_baseline(df, target_col, seed=seed)
    if model is None:
        return hour_of_week_baseline(df, target_col), None
    return model.predict(df), model
