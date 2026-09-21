"""
Root-cause analysis.

A transparent, fully deterministic rule engine. Given the same telemetry it
always returns the same diagnosis, and every diagnosis carries the exact
measurements that produced it. Nothing here is generated, sampled or guessed.

HOW A RULE WORKS
----------------
Each rule is a list of weighted conditions evaluated against measured context.
Confidence is the share of rule weight that the evidence actually satisfies,
then discounted by how closely the runner-up rule scores. A cause that only
narrowly beats its alternative is reported with lower confidence, which is the
honest thing to do.

If no rule clears `ACCEPT_THRESHOLD`, the engine returns UNEXPLAINED and asks
for a manual audit. It never invents a cause to fill the gap.

WHY THE EVIDENCE IS THE POINT
-----------------------------
The conditions are chosen so that the five failure modes produce mutually
exclusive signatures:

    HVAC over-run      high HVAC runtime,     normal lighting, low occupancy
    Lighting left on   normal HVAC runtime,   high lighting,   low occupancy
    Water leak         high *night* flow,     normal pump,     persistent
    Pump over-run      high pump runtime,     off-hours biased
    Base-load fault    normal runtimes,       normal occupancy, flat 24/7 offset

So the rule that fires is discriminating between real alternatives, not
pattern-matching a single threshold.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .features import EXPECTED_COLUMN, VALUE_COLUMN, pct_change, safe_ratio

ACCEPT_THRESHOLD = 0.50
NIGHT_HOURS = (0, 1, 2, 3, 4, 5)
COMFORT_BAND = (20.0, 27.5)

# Cause codes
CAUSE_HVAC_SCHEDULE = "HVAC_SCHEDULING_INEFFICIENCY"
CAUSE_LIGHTING = "LIGHTING_CONTROL_INEFFICIENCY"
CAUSE_WATER_LEAK = "PROBABLE_WATER_LEAKAGE"
CAUSE_PUMP = "PUMP_OPERATION_INEFFICIENCY"
CAUSE_BASE_LOAD = "BASE_LOAD_EQUIPMENT_FAULT"
CAUSE_COOLING_DEMAND = "ELEVATED_COOLING_DEMAND"
CAUSE_OCCUPANCY = "OCCUPANCY_DRIVEN_DEMAND"
CAUSE_UNEXPLAINED = "UNEXPLAINED_DEVIATION"


@dataclass
class Evidence:
    label: str
    value: str
    criterion: str
    satisfied: bool
    weight: float
    detail: str = ""

    def as_dict(self) -> dict:
        return {
            "label": self.label,
            "value": self.value,
            "criterion": self.criterion,
            "satisfied": self.satisfied,
            "weight": round(self.weight, 2),
            "detail": self.detail,
        }


@dataclass
class Diagnosis:
    cause_code: str
    probable_cause: str
    affected_subsystem: str
    confidence: float
    evidence: list[Evidence] = field(default_factory=list)
    narrative: str = ""
    runner_up: str | None = None
    rule_id: str = ""

    def evidence_dicts(self) -> list[dict]:
        return [e.as_dict() for e in self.evidence]


# --------------------------------------------------------------------------
# Context extraction
# --------------------------------------------------------------------------
def build_context(
    df: pd.DataFrame,
    interval_timestamps: list,
    resource_type: str,
    building,
) -> dict:
    """
    Measure the anomaly against the building's *own* normal behaviour.

    The reference set is the same building's non-flagged intervals restricted
    to the same hours of day as the event. Comparing 20:00 against 20:00 is the
    only fair comparison: an absolute runtime threshold would call every summer
    afternoon an anomaly.
    """
    value_col = VALUE_COLUMN[resource_type]
    expected_col = EXPECTED_COLUMN[resource_type]

    ts_index = pd.to_datetime(pd.Series(list(interval_timestamps)))
    event_mask = df["ts"].isin(ts_index)
    event = df[event_mask]

    if event.empty:
        return {"valid": False}

    hours = sorted(event["hour"].unique().tolist())
    reference = df[(~event_mask) & (df["hour"].isin(hours))]
    if reference.empty:
        reference = df[~event_mask]

    def emean(col: str) -> float:
        return float(event[col].mean()) if col in event.columns and len(event) else 0.0

    def rmean(col: str) -> float:
        return float(reference[col].mean()) if col in reference.columns and len(reference) else 0.0

    ctx: dict = {
        "valid": True,
        "resource_type": resource_type,
        "n_intervals": int(len(event)),
        "hours": hours,
        "actual_mean": emean(value_col),
        "expected_mean": emean(expected_col),
        "deviation_pct": pct_change(emean(value_col), emean(expected_col)),
        "occupancy_pct": emean("occupancy_pct"),
        "occupancy_reference": rmean("occupancy_pct"),
        "indoor_temperature": emean("temperature_c"),
        "outdoor_temperature": emean("outdoor_temperature_c"),
        "outdoor_reference": rmean("outdoor_temperature_c"),
        "hvac_runtime": emean("hvac_runtime_min"),
        "hvac_reference": rmean("hvac_runtime_min"),
        "lighting_runtime": emean("lighting_runtime_min"),
        "lighting_reference": rmean("lighting_runtime_min"),
        "pump_runtime": emean("pump_runtime_min"),
        "pump_reference": rmean("pump_runtime_min"),
    }

    ctx["occupancy_ratio"] = safe_ratio(ctx["occupancy_pct"], max(ctx["occupancy_reference"], 0.5))
    ctx["hvac_ratio"] = safe_ratio(ctx["hvac_runtime"], max(ctx["hvac_reference"], 0.5))
    ctx["lighting_ratio"] = safe_ratio(ctx["lighting_runtime"], max(ctx["lighting_reference"], 0.5))
    ctx["pump_ratio"] = safe_ratio(ctx["pump_runtime"], max(ctx["pump_reference"], 0.5))

    # Share of the event that falls outside published operating hours.
    ctx["offhours_share"] = float(event["is_offhours"].mean()) if "is_offhours" in event else 0.0

    # ---- fault footprint -------------------------------------------------
    # An anomaly is characterised by a *span of dates* and a *set of hours*.
    # The detector only flags the intervals where the excess is individually
    # significant, but the fault is present across the whole footprint. Sizing
    # the recommendation from the flagged intervals alone would therefore
    # under-state the prize by roughly half. The footprint below measures the
    # excess across every interval the fault actually touches.
    span_start, span_end = event["ts"].min(), event["ts"].max()
    footprint = df[
        (df["ts"] >= span_start) & (df["ts"] <= span_end) & (df["hour"].isin(hours))
    ]
    span_days = max(1.0, (pd.Timestamp(span_end) - pd.Timestamp(span_start)).total_seconds() / 86400.0)
    if len(footprint):
        excess = (footprint[value_col] - footprint[expected_col]).clip(lower=0.0).sum()
        ctx["footprint_excess_total"] = float(excess)
        ctx["footprint_intervals"] = int(len(footprint))
        ctx["weekly_excess"] = float(excess) / span_days * 7.0
    else:
        ctx["footprint_excess_total"] = 0.0
        ctx["footprint_intervals"] = 0
        ctx["weekly_excess"] = 0.0
    ctx["span_days"] = round(span_days, 2)

    # How evenly the excess is spread across the day. A parasitic base load is
    # flat around the clock; a scheduling fault is concentrated in a few hours.
    by_hour = event.groupby("hour")[value_col].mean() - event.groupby("hour")[expected_col].mean()
    ctx["excess_hour_spread"] = float(by_hour.std() / max(abs(by_hour.mean()), 1e-6)) if len(by_hour) > 1 else 0.0
    ctx["hours_covered"] = int(len(by_hour))

    # ---- water-specific --------------------------------------------------
    if resource_type == "WATER":
        night_event = event[event["hour"].isin(NIGHT_HOURS)]
        night_ref = df[(~event_mask) & (df["hour"].isin(NIGHT_HOURS))]
        flow_col = "flow_lph" if "flow_lph" in df.columns else value_col

        ctx["night_flow"] = float(night_event[flow_col].mean()) if len(night_event) else ctx["actual_mean"]
        ctx["night_flow_reference"] = (
            float(night_ref[flow_col].mean()) if len(night_ref) else max(ctx["expected_mean"], 1.0)
        )
        ctx["night_flow_ratio"] = safe_ratio(ctx["night_flow"], max(ctx["night_flow_reference"], 0.5))

        # Persistence: of the event intervals where the building is effectively
        # empty, how many still show flow well above the standing baseline?
        empty = event[event["occupancy_pct"] < 8.0]
        if len(empty):
            threshold = max(ctx["night_flow_reference"] * 1.6, 1.0)
            ctx["flow_persistence"] = float((empty[flow_col] > threshold).mean())
        else:
            ctx["flow_persistence"] = 0.0
        ctx["low_occupancy_intervals"] = int(len(empty))
    else:
        ctx["night_flow"] = 0.0
        ctx["night_flow_reference"] = 0.0
        ctx["night_flow_ratio"] = 1.0
        ctx["flow_persistence"] = 0.0
        ctx["low_occupancy_intervals"] = 0

    ctx["building_name"] = getattr(building, "name", "")
    ctx["operating_hours"] = (
        f"{getattr(building, 'operating_hours_start', 8):02d}:00-"
        f"{getattr(building, 'operating_hours_end', 18):02d}:00"
    )
    return ctx


# --------------------------------------------------------------------------
# Rules
# --------------------------------------------------------------------------
def _pct(x: float) -> str:
    return f"{x:.1f}%"


def _ratio_pct(x: float) -> str:
    return f"{(x - 1.0) * 100:+.0f}%"


def _rule_hvac(c: dict) -> tuple[float, list[Evidence]]:
    ev = [
        Evidence("Consumption above expected", _pct(c["deviation_pct"]),
                 "at least +20%", c["deviation_pct"] >= 20, 1.0,
                 "Metered against the occupancy- and weather-adjusted baseline."),
        Evidence("Occupancy during affected hours", _pct(c["occupancy_pct"]),
                 "below 30% of capacity", c["occupancy_pct"] < 30.0, 1.6,
                 f"Building operating hours are {c['operating_hours']}."),
        Evidence("HVAC runtime vs same hours on normal days", _ratio_pct(c["hvac_ratio"]),
                 "at least +40%", c["hvac_ratio"] >= 1.40, 2.0,
                 f"{c['hvac_runtime']:.0f} min/h during the event vs "
                 f"{c['hvac_reference']:.0f} min/h normally."),
        Evidence("Lighting runtime vs normal", _ratio_pct(c["lighting_ratio"]),
                 "below +25% (rules out lighting)", c["lighting_ratio"] < 1.25, 0.9,
                 "Isolates the fault to the air-side plant."),
        Evidence("Indoor temperature", f"{c['indoor_temperature']:.1f} C",
                 f"inside {COMFORT_BAND[0]:.0f}-{COMFORT_BAND[1]:.0f} C",
                 COMFORT_BAND[0] <= c["indoor_temperature"] <= COMFORT_BAND[1], 0.9,
                 "Comfort is already being met, so this is not unmet cooling demand."),
        Evidence("Share of event outside operating hours", _pct(c["offhours_share"] * 100),
                 "at least 50%", c["offhours_share"] >= 0.5, 0.9,
                 "Points to a schedule that never hands back to setback."),
    ]
    return _score(ev), ev


def _rule_lighting(c: dict) -> tuple[float, list[Evidence]]:
    ev = [
        Evidence("Consumption above expected", _pct(c["deviation_pct"]),
                 "at least +20%", c["deviation_pct"] >= 20, 1.0,
                 "Metered against the occupancy- and weather-adjusted baseline."),
        Evidence("Lighting runtime vs same hours on normal days", _ratio_pct(c["lighting_ratio"]),
                 "at least +40%", c["lighting_ratio"] >= 1.40, 2.2,
                 f"{c['lighting_runtime']:.0f} min/h during the event vs "
                 f"{c['lighting_reference']:.0f} min/h normally."),
        Evidence("HVAC runtime vs normal", _ratio_pct(c["hvac_ratio"]),
                 "below +25% (rules out HVAC)", c["hvac_ratio"] < 1.25, 1.2,
                 "Isolates the fault to the lighting circuits."),
        Evidence("Occupancy during affected hours", _pct(c["occupancy_pct"]),
                 "below 25% of capacity", c["occupancy_pct"] < 25.0, 1.4,
                 "Lighting load is not being driven by people in the building."),
        Evidence("Share of event outside operating hours", _pct(c["offhours_share"] * 100),
                 "at least 50%", c["offhours_share"] >= 0.5, 0.9,
                 f"Building closes at {c['operating_hours'].split('-')[1]}."),
    ]
    return _score(ev), ev


def _rule_water_leak(c: dict) -> tuple[float, list[Evidence]]:
    if c["resource_type"] != "WATER":
        return 0.0, []
    ev = [
        Evidence("Night-time flow vs normal nights", f"{c['night_flow']:.1f} L/h",
                 f"at least 2x the {c['night_flow_reference']:.1f} L/h baseline",
                 c["night_flow_ratio"] >= 2.0, 2.4,
                 "Standing overnight flow is the classic leak signature."),
        Evidence("Flow persists while the building is empty",
                 _pct(c["flow_persistence"] * 100),
                 "at least 60% of empty intervals", c["flow_persistence"] >= 0.6, 2.0,
                 f"{c['low_occupancy_intervals']} intervals with occupancy under 8%."),
        Evidence("Occupancy during affected hours", _pct(c["occupancy_pct"]),
                 "below 20% of capacity", c["occupancy_pct"] < 20.0, 1.4,
                 "Demand cannot explain the flow."),
        Evidence("Pump runtime vs normal", _ratio_pct(c["pump_ratio"]),
                 "below +30% (rules out pump over-run)", c["pump_ratio"] < 1.30, 1.0,
                 "Distinguishes a distribution leak from a pump control fault."),
        Evidence("Consumption above expected", _pct(c["deviation_pct"]),
                 "at least +15%", c["deviation_pct"] >= 15, 0.8,
                 "Measured against the occupancy-adjusted baseline."),
    ]
    return _score(ev), ev


def _rule_pump(c: dict) -> tuple[float, list[Evidence]]:
    if c["resource_type"] != "WATER":
        return 0.0, []
    ev = [
        Evidence("Pump runtime vs same hours on normal days", _ratio_pct(c["pump_ratio"]),
                 "at least +50%", c["pump_ratio"] >= 1.50, 2.4,
                 f"{c['pump_runtime']:.0f} min/h during the event vs "
                 f"{c['pump_reference']:.0f} min/h normally."),
        Evidence("Consumption above expected", _pct(c["deviation_pct"]),
                 "at least +18%", c["deviation_pct"] >= 18, 1.0,
                 "Measured against the occupancy-adjusted baseline."),
        Evidence("Share of event outside operating hours", _pct(c["offhours_share"] * 100),
                 "at least 40%", c["offhours_share"] >= 0.4, 1.0,
                 "Cycling outside the scheduled fill window."),
        Evidence("Occupancy during affected hours", _pct(c["occupancy_pct"]),
                 "below 25% of capacity", c["occupancy_pct"] < 25.0, 1.0,
                 "Pumping is not tracking real demand."),
    ]
    return _score(ev), ev


def _rule_base_load(c: dict) -> tuple[float, list[Evidence]]:
    if c["resource_type"] != "ENERGY":
        return 0.0, []
    ev = [
        Evidence("HVAC runtime vs normal", _ratio_pct(c["hvac_ratio"]),
                 "below +25%", c["hvac_ratio"] < 1.25, 1.4,
                 "The air-side plant is behaving normally."),
        Evidence("Lighting runtime vs normal", _ratio_pct(c["lighting_ratio"]),
                 "below +25%", c["lighting_ratio"] < 1.25, 1.4,
                 "The lighting circuits are behaving normally."),
        Evidence("Excess spread across the day", f"{c['excess_hour_spread']:.2f}",
                 "below 0.85 (a flat, round-the-clock offset)",
                 c["excess_hour_spread"] < 0.85, 2.0,
                 f"Excess observed across {c['hours_covered']} distinct hours of the day."),
        Evidence("Occupancy during affected hours", _pct(c["occupancy_pct"]),
                 "within 60-140% of normal for these hours",
                 0.6 <= c["occupancy_ratio"] <= 1.4, 1.2,
                 "Occupancy does not explain the additional load."),
        Evidence("Consumption above expected", _pct(c["deviation_pct"]),
                 "at least +12%", c["deviation_pct"] >= 12, 1.0,
                 "Measured against the occupancy- and weather-adjusted baseline."),
    ]
    return _score(ev), ev


def _rule_cooling_demand(c: dict) -> tuple[float, list[Evidence]]:
    if c["resource_type"] != "ENERGY":
        return 0.0, []
    hot = c["outdoor_temperature"] > c["outdoor_reference"] + 2.0
    ev = [
        Evidence("Outdoor temperature vs normal for these hours",
                 f"{c['outdoor_temperature']:.1f} C",
                 f"more than 2 C above the {c['outdoor_reference']:.1f} C norm", hot, 2.2,
                 "A genuine weather-driven increase in cooling load."),
        Evidence("HVAC runtime vs normal", _ratio_pct(c["hvac_ratio"]),
                 "at least +25%", c["hvac_ratio"] >= 1.25, 1.4,
                 "Plant is responding to the additional heat load."),
        Evidence("Indoor temperature", f"{c['indoor_temperature']:.1f} C",
                 f"at or above {COMFORT_BAND[1]:.0f} C",
                 c["indoor_temperature"] >= COMFORT_BAND[1], 1.6,
                 "Comfort is not being met, so the plant is genuinely loaded."),
        Evidence("Occupancy during affected hours", _pct(c["occupancy_pct"]),
                 "at least 30% of capacity", c["occupancy_pct"] >= 30.0, 1.0,
                 "The building is in use."),
    ]
    return _score(ev), ev


def _rule_occupancy(c: dict) -> tuple[float, list[Evidence]]:
    ev = [
        Evidence("Occupancy vs same hours on normal days", _ratio_pct(c["occupancy_ratio"]),
                 "at least +35%", c["occupancy_ratio"] >= 1.35, 2.4,
                 f"{c['occupancy_pct']:.0f}% of capacity vs "
                 f"{c['occupancy_reference']:.0f}% normally."),
        Evidence("Equipment runtimes broadly proportional",
                 f"HVAC {_ratio_pct(c['hvac_ratio'])}, lighting {_ratio_pct(c['lighting_ratio'])}",
                 "both below +60%",
                 c["hvac_ratio"] < 1.6 and c["lighting_ratio"] < 1.6, 1.4,
                 "Plant is tracking the additional load rather than misbehaving."),
        Evidence("Event falls inside operating hours",
                 _pct((1 - c["offhours_share"]) * 100), "at least 60%",
                 c["offhours_share"] <= 0.4, 1.2,
                 "Consistent with an unusually busy period, such as an event or exams."),
    ]
    return _score(ev), ev


RULES = [
    ("RULE-1", CAUSE_HVAC_SCHEDULE, "HVAC scheduling inefficiency", "HVAC", _rule_hvac),
    ("RULE-2", CAUSE_LIGHTING, "Lighting control inefficiency", "Lighting", _rule_lighting),
    ("RULE-3", CAUSE_WATER_LEAK, "Probable water leakage", "Water distribution", _rule_water_leak),
    ("RULE-4", CAUSE_PUMP, "Pump operation inefficiency", "Pumping", _rule_pump),
    ("RULE-5", CAUSE_BASE_LOAD, "Base-load equipment fault", "Electrical base load", _rule_base_load),
    ("RULE-6", CAUSE_COOLING_DEMAND, "Elevated cooling demand", "HVAC", _rule_cooling_demand),
    ("RULE-7", CAUSE_OCCUPANCY, "Occupancy-driven demand", "Building demand", _rule_occupancy),
]

CAUSE_DESCRIPTIONS = {
    CAUSE_HVAC_SCHEDULE: (
        "Air-handling plant is running well beyond the hours the building is "
        "actually occupied. Comfort is already being met and no weather event "
        "explains the load, so the additional consumption is schedule-driven waste."
    ),
    CAUSE_LIGHTING: (
        "Lighting circuits remain energised long after the building closes. "
        "HVAC runtime is normal over the same intervals, which isolates the "
        "additional load to the lighting subsystem."
    ),
    CAUSE_WATER_LEAK: (
        "Flow does not fall back to the building's standing overnight baseline "
        "and persists while the building is empty. Pump behaviour is normal, "
        "so the loss is on the distribution side rather than in control."
    ),
    CAUSE_PUMP: (
        "The booster pump is running far beyond its scheduled fill window, "
        "largely outside operating hours. This inflates both water throughput "
        "and the pump's own electrical load."
    ),
    CAUSE_BASE_LOAD: (
        "A near-constant additional load is present around the clock while HVAC "
        "and lighting runtimes stay normal. The flat profile points to faulty or "
        "mis-configured equipment drawing continuously."
    ),
    CAUSE_COOLING_DEMAND: (
        "The additional consumption tracks genuinely hotter outdoor conditions "
        "with indoor temperature at the top of the comfort band. The plant is "
        "responding correctly to real demand rather than malfunctioning."
    ),
    CAUSE_OCCUPANCY: (
        "Consumption rose alongside a materially higher headcount than these "
        "hours normally see, with equipment runtimes staying proportional."
    ),
    CAUSE_UNEXPLAINED: (
        "The deviation is statistically real but its signature does not match "
        "any known failure mode. Equipment runtimes, occupancy and weather do "
        "not individually account for it, so a manual site audit is required."
    ),
}


def _score(evidence: list[Evidence]) -> float:
    total = sum(e.weight for e in evidence)
    if total <= 0:
        return 0.0
    return sum(e.weight for e in evidence if e.satisfied) / total


# --------------------------------------------------------------------------
# Engine
# --------------------------------------------------------------------------
def diagnose(context: dict) -> Diagnosis:
    """Evaluate every rule and return the best-supported explanation."""
    if not context.get("valid"):
        return Diagnosis(
            cause_code=CAUSE_UNEXPLAINED,
            probable_cause="Insufficient data for diagnosis",
            affected_subsystem="Unknown",
            confidence=0.0,
            narrative=CAUSE_DESCRIPTIONS[CAUSE_UNEXPLAINED],
        )

    scored = []
    for rule_id, code, label, subsystem, fn in RULES:
        score, evidence = fn(context)
        if evidence:
            scored.append((score, rule_id, code, label, subsystem, evidence))

    scored.sort(key=lambda r: r[0], reverse=True)
    if not scored or scored[0][0] < ACCEPT_THRESHOLD:
        fallback_evidence = scored[0][5] if scored else []
        return Diagnosis(
            cause_code=CAUSE_UNEXPLAINED,
            probable_cause="Unclassified consumption deviation",
            affected_subsystem="Requires manual audit",
            confidence=round(min(0.45, scored[0][0]) if scored else 0.0, 2),
            evidence=fallback_evidence,
            narrative=CAUSE_DESCRIPTIONS[CAUSE_UNEXPLAINED],
            runner_up=scored[0][3] if scored else None,
            rule_id="NO-MATCH",
        )

    best = scored[0]
    runner_up_score = scored[1][0] if len(scored) > 1 else 0.0

    # Confidence is the satisfied share of rule weight, then discounted twice:
    #   * margin  - a diagnosis that only narrowly beats a competing
    #               explanation should not be reported as certain;
    #   * sample  - three anomalous hours support a weaker claim than ninety.
    # Capped below 1.0 because a rule engine can establish a signature, never
    # a certainty about the physical world.
    margin = best[0] - runner_up_score
    margin_factor = 0.80 + 0.20 * float(np.clip(margin / 0.35, 0.0, 1.0))
    sample_factor = 0.82 + 0.18 * float(np.clip(context["n_intervals"] / 24.0, 0.0, 1.0))
    confidence = float(np.clip(best[0] * margin_factor * sample_factor, 0.0, 0.94))

    return Diagnosis(
        cause_code=best[2],
        probable_cause=best[3],
        affected_subsystem=best[4],
        confidence=round(confidence, 3),
        evidence=best[5],
        narrative=CAUSE_DESCRIPTIONS.get(best[2], ""),
        runner_up=scored[1][3] if len(scored) > 1 else None,
        rule_id=best[1],
    )
