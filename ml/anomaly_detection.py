"""
Anomaly detection.

Two independent signals must agree before an interval is flagged:

  1. ISOLATION FOREST over the full contextual feature vector (consumption,
     occupancy, weather, equipment runtimes, time-of-day, and the baseline
     residual). Unsupervised, multivariate, catches odd *combinations* --
     e.g. high load with an empty building -- that no single threshold would.

  2. ROBUST RESIDUAL against the expected-consumption model, z-scored within
     each hour of day. Directional and physically interpretable: it only fires
     when a building is using MORE than it should.

Requiring both keeps the isolation forest from flagging merely unusual-but-fine
hours (a one-off packed Saturday), and keeps the residual rule from flagging
ordinary model noise. Under-consumption is never reported as waste.

EVENTS, NOT HOURS
-----------------
Raw hourly flags are unusable as a product surface: a three-week leak would
appear as 90 separate rows. Flags are therefore merged into runs (gaps up to
`merge_gap_hours`), and runs recurring within `cluster_gap_hours` of each other
are consolidated into a single *persistent* anomaly event spanning the whole
episode. One leak becomes one anomaly, with the affected intervals retained so
the UI can shade the exact hours on the chart.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

from .features import (
    EXPECTED_COLUMN,
    RESPONSE_COLUMNS,
    UNIT,
    VALUE_COLUMN,
    pct_change,
    robust_z_by_hour,
)

# Floor on the per-hour residual scale, per resource, in native units. Stops a
# quiet hour bucket from turning meter quantisation into a huge z-score.
MIN_RESIDUAL_SCALE = {"ENERGY": 0.45, "WATER": 1.2}


@dataclass
class AnomalyEvent:
    """A consolidated anomaly, ready to be persisted."""

    building_id: int
    resource_type: str
    start_ts: datetime
    end_ts: datetime
    flagged_intervals: int
    occurrence_days: int
    is_persistent: bool
    actual_value: float
    expected_value: float
    deviation_pct: float
    excess_total: float
    unit: str
    severity: str
    anomaly_score: float
    intervals: list[str] = field(default_factory=list)
    detector: str = "isolation_forest+rf_residual"


# --------------------------------------------------------------------------
# Interval-level detection
# --------------------------------------------------------------------------
def detect_intervals(
    df: pd.DataFrame,
    resource_type: str,
    contamination: float = 0.045,
    residual_z_threshold: float = 2.5,
    min_deviation_pct: float = 12.0,
    seed: int = 42,
) -> pd.DataFrame:
    """
    Flag anomalous intervals. Returns `df` with detection columns attached:

        residual, residual_z, deviation_pct, iforest_flag, iforest_score,
        is_anomaly
    """
    out = df.copy()
    value_col = VALUE_COLUMN[resource_type]
    expected_col = EXPECTED_COLUMN[resource_type]

    if out.empty or expected_col not in out.columns:
        for col in ("residual", "residual_z", "deviation_pct", "iforest_score"):
            out[col] = pd.Series(dtype=float)
        out["iforest_flag"] = pd.Series(dtype=bool)
        out["is_anomaly"] = pd.Series(dtype=bool)
        return out

    actual = out[value_col].to_numpy(dtype=float)
    expected = out[expected_col].to_numpy(dtype=float)

    out["residual"] = actual - expected
    out["residual_z"] = robust_z_by_hour(
        out["residual"].to_numpy(dtype=float),
        out["hour"].to_numpy(dtype=int),
        MIN_RESIDUAL_SCALE.get(resource_type, 0.5),
    )
    out["deviation_pct"] = [pct_change(a, e) for a, e in zip(actual, expected)]

    # ---- isolation forest over the contextual feature vector ---------
    feature_cols = [
        value_col,
        "occupancy_pct",
        "outdoor_temperature_c",
        "hour_sin",
        "hour_cos",
        "is_weekend",
        "residual",
        "residual_z",
        *[c for c in RESPONSE_COLUMNS.get(resource_type, []) if c in out.columns],
    ]
    feature_cols = [c for c in feature_cols if c in out.columns]
    matrix = out[feature_cols].to_numpy(dtype=float)

    if len(out) >= 64 and np.isfinite(matrix).all():
        scaled = StandardScaler().fit_transform(matrix)
        forest = IsolationForest(
            n_estimators=260,
            contamination=float(np.clip(contamination, 0.005, 0.25)),
            random_state=seed,
            n_jobs=-1,
        )
        labels = forest.fit_predict(scaled)
        out["iforest_flag"] = labels == -1
        # Higher == more anomalous, normalised into a readable 0..100 band.
        raw = -forest.score_samples(scaled)
        lo, hi = float(raw.min()), float(raw.max())
        out["iforest_score"] = (
            (raw - lo) / (hi - lo) * 100.0 if hi - lo > 1e-9 else np.zeros_like(raw)
        )
    else:
        # Not enough history for a forest: fall back to the residual rule alone.
        out["iforest_flag"] = True
        out["iforest_score"] = np.clip(out["residual_z"].to_numpy() * 12.0, 0, 100)

    # ---- consensus ---------------------------------------------------
    out["is_anomaly"] = (
        out["iforest_flag"]
        & (out["residual_z"] >= residual_z_threshold)
        & (out["deviation_pct"] >= min_deviation_pct)
        & (out["residual"] > 0)  # over-consumption only: under-use is not waste
    )
    return out


# --------------------------------------------------------------------------
# Event consolidation
# --------------------------------------------------------------------------
def _severity(deviation_pct: float, flagged_intervals: int, is_persistent: bool) -> str:
    if deviation_pct >= 70:
        level = 3
    elif deviation_pct >= 40:
        level = 2
    elif deviation_pct >= 22:
        level = 1
    else:
        level = 0

    # A modest deviation that never goes away is worse than a big one-off spike.
    if is_persistent and flagged_intervals >= 40:
        level += 1
    elif flagged_intervals >= 12:
        level = max(level, 1)

    return ["LOW", "MEDIUM", "HIGH", "CRITICAL"][min(level, 3)]


def consolidate_events(
    flagged: pd.DataFrame,
    building_id: int,
    resource_type: str,
    merge_gap_hours: int = 3,
    cluster_gap_hours: int = 72,
    min_intervals: int = 3,
) -> list[AnomalyEvent]:
    """
    Merge flagged intervals into anomaly events.

    Two stages: contiguous runs first (gaps <= merge_gap_hours), then clusters
    of runs that keep recurring (gaps <= cluster_gap_hours). The second stage
    is what turns "a leak flagged every night for three weeks" into one
    persistent anomaly rather than twenty-one separate ones.
    """
    anomalies = flagged[flagged["is_anomaly"]].sort_values("ts")
    if anomalies.empty:
        return []

    value_col = VALUE_COLUMN[resource_type]
    expected_col = EXPECTED_COLUMN[resource_type]

    # --- stage 1: contiguous runs -------------------------------------
    runs: list[list[int]] = []
    current: list[int] = []
    previous_ts: datetime | None = None
    for idx, row in anomalies.iterrows():
        ts = row["ts"].to_pydatetime() if hasattr(row["ts"], "to_pydatetime") else row["ts"]
        if previous_ts is not None and (ts - previous_ts) > timedelta(hours=merge_gap_hours + 1):
            runs.append(current)
            current = []
        current.append(idx)
        previous_ts = ts
    if current:
        runs.append(current)

    # --- stage 2: cluster recurring runs ------------------------------
    clusters: list[list[int]] = []
    for run in runs:
        if not clusters:
            clusters.append(list(run))
            continue
        last_ts = anomalies.loc[clusters[-1][-1], "ts"]
        first_ts = anomalies.loc[run[0], "ts"]
        if (first_ts - last_ts) <= timedelta(hours=cluster_gap_hours):
            clusters[-1].extend(run)
        else:
            clusters.append(list(run))

    events: list[AnomalyEvent] = []
    for cluster in clusters:
        block = anomalies.loc[cluster]
        if len(block) < min_intervals:
            continue

        actual_mean = float(block[value_col].mean())
        expected_mean = float(block[expected_col].mean())
        excess = float((block[value_col] - block[expected_col]).sum())
        deviation = pct_change(actual_mean, expected_mean)

        start_ts = block["ts"].min()
        end_ts = block["ts"].max()
        start_ts = start_ts.to_pydatetime() if hasattr(start_ts, "to_pydatetime") else start_ts
        end_ts = end_ts.to_pydatetime() if hasattr(end_ts, "to_pydatetime") else end_ts

        occurrence_days = int(block["date"].nunique())
        span_hours = (end_ts - start_ts).total_seconds() / 3600.0
        is_persistent = span_hours >= 48 and occurrence_days >= 3

        events.append(
            AnomalyEvent(
                building_id=building_id,
                resource_type=resource_type,
                start_ts=start_ts,
                end_ts=end_ts,
                flagged_intervals=int(len(block)),
                occurrence_days=occurrence_days,
                is_persistent=is_persistent,
                actual_value=round(actual_mean, 3),
                expected_value=round(expected_mean, 3),
                deviation_pct=round(deviation, 2),
                excess_total=round(excess, 2),
                unit=UNIT[resource_type],
                severity=_severity(deviation, len(block), is_persistent),
                anomaly_score=round(float(block["iforest_score"].mean()), 2),
                intervals=[
                    (t.to_pydatetime() if hasattr(t, "to_pydatetime") else t).isoformat()
                    for t in block["ts"]
                ],
            )
        )

    return events


def detect(
    df: pd.DataFrame,
    building_id: int,
    resource_type: str,
    contamination: float = 0.045,
    residual_z_threshold: float = 2.5,
    min_deviation_pct: float = 12.0,
    merge_gap_hours: int = 3,
    min_event_duration_hours: int = 3,
    cluster_gap_hours: int = 72,
    seed: int = 42,
) -> tuple[list[AnomalyEvent], pd.DataFrame]:
    """Run the full detection pass. Returns (events, annotated frame)."""
    flagged = detect_intervals(
        df,
        resource_type,
        contamination=contamination,
        residual_z_threshold=residual_z_threshold,
        min_deviation_pct=min_deviation_pct,
        seed=seed,
    )
    events = consolidate_events(
        flagged,
        building_id=building_id,
        resource_type=resource_type,
        merge_gap_hours=merge_gap_hours,
        cluster_gap_hours=cluster_gap_hours,
        min_intervals=max(1, min_event_duration_hours),
    )
    return events, flagged
