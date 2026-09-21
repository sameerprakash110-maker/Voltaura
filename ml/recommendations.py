"""
Recommendation engine.

One template per diagnosed cause. The prose is fixed; every *number* is derived
from the measured anomaly. Nothing is sampled and nothing is hard-coded.

HOW THE EXPECTED SAVING IS DERIVED
----------------------------------
An anomaly is characterised by a span of dates and a set of hours-of-day. The
excess is measured across that whole *fault footprint*, not merely the
intervals the detector flagged individually, because the fault is present
throughout even where its hourly signal is not individually significant:

    footprint_excess = sum(max(0, actual - expected))
                       over every interval in the span, at the affected hours

Normalised to a week and multiplied by a `recoverable_fraction` that reflects
how much of that excess the measure can realistically reclaim:

    expected_weekly_saving = footprint_excess / span_days * 7 * recoverable

The result is deliberately conservative. A fault that is only *visible* during
part of the day (an overnight leak that also runs unseen through daytime
demand) is sized from the hours where it can be measured, so the verified
saving often exceeds the estimate rather than falling short of it.

The recoverable fraction is below 1.0 for every measure, because no
intervention recovers 100% of an observed excess: an HVAC schedule still needs
some evening setback, a repaired pipe still serves genuine demand. These
factors are stated in the template and shown in the UI, so the assumption is
visible rather than buried.

Everything produced here is labelled ESTIMATED. Only the verification stage,
which measures real post-intervention telemetry, produces MEASURED numbers.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .root_cause import (
    CAUSE_BASE_LOAD,
    CAUSE_COOLING_DEMAND,
    CAUSE_HVAC_SCHEDULE,
    CAUSE_LIGHTING,
    CAUSE_OCCUPANCY,
    CAUSE_PUMP,
    CAUSE_UNEXPLAINED,
    CAUSE_WATER_LEAK,
)
from .simulator import (
    FAULT_EQUIPMENT_FAULT,
    FAULT_HVAC_OVERRUN,
    FAULT_LIGHTING_AFTER_HOURS,
    FAULT_PUMP_OVERRUN,
    FAULT_WATER_LEAK,
)


@dataclass
class RecommendationTemplate:
    title: str
    description: str
    reason_template: str
    implementation: str
    difficulty: str            # LOW | MEDIUM | HIGH
    recoverable_fraction: float
    recoverable_rationale: str
    payback_note: str
    target_fault_code: str | None
    steps: list[str] = field(default_factory=list)


TEMPLATES: dict[str, RecommendationTemplate] = {
    CAUSE_HVAC_SCHEDULE: RecommendationTemplate(
        title="Optimise the HVAC operating schedule",
        description=(
            "Re-commission the air-handling schedule so the plant returns to "
            "night setback when the floor plate empties, and add an occupancy "
            "interlock so any extension has to be requested rather than assumed."
        ),
        reason_template=(
            "HVAC is consuming significantly more energy during low-occupancy "
            "periods. Runtime averaged {hvac_runtime:.0f} min/hour against a "
            "normal {hvac_reference:.0f} min/hour for the same hours, while "
            "occupancy sat at {occupancy_pct:.0f}% of capacity and indoor "
            "temperature stayed inside the comfort band."
        ),
        implementation=(
            "Reduce HVAC operation between {window} when occupancy is below "
            "the 25% threshold. Retain a 30-minute post-occupancy purge, then "
            "hand control back to the night setback loop."
        ),
        difficulty="LOW",
        recoverable_fraction=0.82,
        recoverable_rationale=(
            "Some evening runtime remains necessary for purge cycles and for "
            "genuinely occupied late sessions, so ~18% of the observed excess "
            "is treated as non-recoverable."
        ),
        payback_note="BMS schedule change only. No capital cost, immediate payback.",
        target_fault_code=FAULT_HVAC_OVERRUN,
        steps=[
            "Export the current AHU time schedule from the BMS",
            "Set unoccupied setback for the affected hours on weekdays and weekends",
            "Interlock the extension override to the occupancy sensor threshold",
            "Confirm the purge cycle still runs for 30 minutes after last occupancy",
            "Monitor for 14 days and run verification",
        ],
    ),
    CAUSE_LIGHTING: RecommendationTemplate(
        title="Restore after-hours lighting control",
        description=(
            "Bring the lighting contactors back under the time schedule and add "
            "occupancy sensing to the affected floors so circuits cannot remain "
            "energised overnight."
        ),
        reason_template=(
            "Lighting circuits are staying energised long after the building "
            "closes. Lighting runtime averaged {lighting_runtime:.0f} min/hour "
            "against a normal {lighting_reference:.0f} min/hour for the same "
            "hours, with occupancy at {occupancy_pct:.0f}% of capacity. HVAC "
            "runtime was normal over the same intervals."
        ),
        implementation=(
            "Re-enable the lighting time schedule for {window}, with a manual "
            "override limited to 60 minutes, and commission occupancy sensors "
            "on the affected floors."
        ),
        difficulty="LOW",
        recoverable_fraction=0.88,
        recoverable_rationale=(
            "Security and egress lighting must remain on, so ~12% of the "
            "observed excess is treated as non-recoverable."
        ),
        payback_note="Control change plus sensor commissioning. Typical payback under 3 months.",
        target_fault_code=FAULT_LIGHTING_AFTER_HOURS,
        steps=[
            "Identify the affected lighting contactors and their control panel",
            "Re-enable the time-clock schedule and clear any manual hold",
            "Commission occupancy sensors on the affected floors",
            "Cap manual override at 60 minutes",
            "Monitor for 14 days and run verification",
        ],
    ),
    CAUSE_WATER_LEAK: RecommendationTemplate(
        title="Inspect and repair the water distribution branch",
        description=(
            "Isolate the affected riser section by section during the overnight "
            "window to locate the loss, then repair and re-pressure-test the "
            "branch."
        ),
        reason_template=(
            "Overnight flow is not returning to the building's standing "
            "baseline. Night-time flow averaged {night_flow:.1f} L/hour against "
            "a normal {night_flow_reference:.1f} L/hour, and flow persisted "
            "through {flow_persistence:.0f}% of intervals when the building was "
            "effectively empty. Pump runtime was normal, which places the loss "
            "on the distribution side."
        ),
        implementation=(
            "Carry out a night-time step test on the affected riser: close "
            "isolation valves in sequence between 01:00 and 04:00 and record the "
            "flow drop at each step to localise the loss, then repair and "
            "pressure-test."
        ),
        difficulty="MEDIUM",
        recoverable_fraction=0.93,
        recoverable_rationale=(
            "A repaired branch still carries a small standing flow for cistern "
            "top-up, so ~7% of the observed excess is treated as non-recoverable."
        ),
        payback_note="Maintenance callout plus fittings. Typically recovered within one billing cycle.",
        target_fault_code=FAULT_WATER_LEAK,
        steps=[
            "Schedule a night-time step test between 01:00 and 04:00",
            "Close isolation valves in sequence and log the flow drop at each step",
            "Localise the loss to the smallest isolatable section",
            "Repair the affected section and pressure-test the branch",
            "Confirm overnight flow returns to baseline, then run verification",
        ],
    ),
    CAUSE_PUMP: RecommendationTemplate(
        title="Re-tune the booster pump control",
        description=(
            "Replace the failed level control and restore the scheduled fill "
            "window so the pump stops cycling through the night."
        ),
        reason_template=(
            "The booster pump is running far beyond its scheduled window. Pump "
            "runtime averaged {pump_runtime:.0f} min/hour against a normal "
            "{pump_reference:.0f} min/hour for the same hours, with "
            "{offhours_share:.0f}% of the affected intervals falling outside "
            "operating hours."
        ),
        implementation=(
            "Replace the roof-tank float switch, restore the scheduled fill "
            "window, and add a runtime alarm that trips if the pump exceeds its "
            "expected duty in any 24-hour period."
        ),
        difficulty="MEDIUM",
        recoverable_fraction=0.85,
        recoverable_rationale=(
            "The pump must still meet genuine overnight demand, so ~15% of the "
            "observed excess is treated as non-recoverable."
        ),
        payback_note="Float switch replacement plus control commissioning. Payback typically under 2 months.",
        target_fault_code=FAULT_PUMP_OVERRUN,
        steps=[
            "Replace the roof-tank float switch and verify level feedback",
            "Restore the scheduled fill window in the pump controller",
            "Add a 24-hour runtime alarm above the expected duty",
            "Verify the pump holds off overnight for three consecutive nights",
            "Monitor for 14 days and run verification",
        ],
    ),
    CAUSE_BASE_LOAD: RecommendationTemplate(
        title="Investigate and clear the continuous parasitic load",
        description=(
            "Trace the always-on load with a circuit-level survey and correct "
            "the faulty or mis-configured equipment responsible."
        ),
        reason_template=(
            "A near-constant additional load is present around the clock. "
            "Consumption ran {deviation_pct:.0f}% above the occupancy- and "
            "weather-adjusted baseline across {hours_covered} distinct hours of "
            "the day, while HVAC and lighting runtimes stayed normal."
        ),
        implementation=(
            "Survey the distribution board circuit by circuit during an "
            "unoccupied period to isolate the constant draw, then service or "
            "reconfigure the equipment responsible."
        ),
        difficulty="MEDIUM",
        recoverable_fraction=0.78,
        recoverable_rationale=(
            "Part of the additional load may prove to be legitimate equipment "
            "that was recently commissioned, so ~22% is treated as "
            "non-recoverable until the survey confirms otherwise."
        ),
        payback_note="Engineering survey plus corrective maintenance. Payback depends on the fault found.",
        target_fault_code=FAULT_EQUIPMENT_FAULT,
        steps=[
            "Log circuit-level demand at the main distribution board overnight",
            "Identify the circuit carrying the constant additional draw",
            "Inspect the equipment on that circuit for fault or mis-configuration",
            "Service or reconfigure, then confirm the base load drops",
            "Monitor for 14 days and run verification",
        ],
    ),
    CAUSE_COOLING_DEMAND: RecommendationTemplate(
        title="Review setpoints and envelope performance during heat events",
        description=(
            "The additional load is weather-driven rather than a fault. Reduce "
            "exposure to heat events through setpoint and envelope measures "
            "rather than by changing the schedule."
        ),
        reason_template=(
            "Consumption rose with genuinely hotter conditions: outdoor "
            "temperature averaged {outdoor_temperature:.1f} C against a normal "
            "{outdoor_reference:.1f} C for the same hours, and indoor "
            "temperature reached {indoor_temperature:.1f} C, so comfort was not "
            "being met."
        ),
        implementation=(
            "Widen the cooling setpoint by 1 C during peak outdoor conditions, "
            "verify solar shading on the exposed facade, and pre-cool the "
            "thermal mass before the afternoon peak."
        ),
        difficulty="MEDIUM",
        recoverable_fraction=0.35,
        recoverable_rationale=(
            "Most of this load is meeting real cooling demand and is not waste. "
            "Only the portion attributable to setpoint and solar gain is "
            "treated as recoverable."
        ),
        payback_note="Setpoint change is free; shading measures carry capital cost.",
        target_fault_code=None,
        steps=[
            "Review the cooling setpoint schedule against the comfort standard",
            "Inspect solar shading on the exposed facade",
            "Trial a 1 C setpoint relaxation during peak outdoor conditions",
            "Trial pre-cooling ahead of the afternoon peak",
            "Monitor for 14 days and run verification",
        ],
    ),
    CAUSE_OCCUPANCY: RecommendationTemplate(
        title="Align plant capacity with the revised occupancy pattern",
        description=(
            "The additional consumption is being driven by genuinely higher "
            "occupancy. Update the plant schedule to match the new pattern "
            "instead of treating the load as a fault."
        ),
        reason_template=(
            "Occupancy during the affected intervals averaged "
            "{occupancy_pct:.0f}% of capacity against a normal "
            "{occupancy_reference:.0f}% for the same hours, with equipment "
            "runtimes staying proportional to the additional load."
        ),
        implementation=(
            "Update the published operating schedule to reflect the observed "
            "pattern, and stage plant so that only the zones in use are served."
        ),
        difficulty="LOW",
        recoverable_fraction=0.25,
        recoverable_rationale=(
            "This load is largely serving real demand. Only the portion "
            "attributable to conditioning unused zones is treated as recoverable."
        ),
        payback_note="Scheduling and zoning change. No capital cost.",
        target_fault_code=None,
        steps=[
            "Confirm the revised occupancy pattern with the building manager",
            "Update the published operating schedule",
            "Stage plant so unoccupied zones are not conditioned",
            "Monitor for 14 days and run verification",
        ],
    ),
    CAUSE_UNEXPLAINED: RecommendationTemplate(
        title="Commission a manual site audit",
        description=(
            "The deviation is statistically real but does not match a known "
            "failure signature. A site audit is required before any measure can "
            "be recommended with confidence."
        ),
        reason_template=(
            "Consumption ran {deviation_pct:.0f}% above the adjusted baseline "
            "across {n_intervals} intervals, but equipment runtimes, occupancy "
            "and weather do not individually account for it."
        ),
        implementation=(
            "Carry out a walk-through audit of the affected building during the "
            "hours identified, with sub-metering where available."
        ),
        difficulty="HIGH",
        recoverable_fraction=0.30,
        recoverable_rationale=(
            "Without a confirmed cause the recoverable share cannot be "
            "estimated reliably. A deliberately conservative figure is used."
        ),
        payback_note="Audit cost only. Savings cannot be estimated until a cause is confirmed.",
        target_fault_code=None,
        steps=[
            "Schedule a walk-through audit covering the affected hours",
            "Deploy temporary sub-metering on the major circuits or risers",
            "Re-run diagnosis once sub-metered data is available",
        ],
    ),
}


PRIORITY_BY_SEVERITY = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}


@dataclass
class RecommendationDraft:
    title: str
    description: str
    reason: str
    implementation: str
    evidence: list[dict]
    expected_saving_per_week: float
    expected_saving_unit: str
    estimated_cost_saving_per_week: float
    estimated_co2_reduction_per_week: float
    implementation_difficulty: str
    priority: str
    priority_score: float
    payback_note: str
    target_fault_code: str | None
    steps: list[str]
    recoverable_fraction: float
    recoverable_rationale: str


def _window_label(hours: list[int]) -> str:
    """Render the affected hours as a readable clock window."""
    if not hours:
        return "the affected hours"
    ordered = sorted(hours)
    # Detect a window that wraps past midnight (e.g. 19,20,21,22,23,0,1,2).
    gaps = [i for i in range(1, len(ordered)) if ordered[i] - ordered[i - 1] > 1]
    if len(gaps) == 1 and ordered[0] == 0 and ordered[-1] == 23:
        split = gaps[0]
        start, end = ordered[split], ordered[split - 1]
        return f"{start:02d}:00 and {(end + 1) % 24:02d}:00"
    return f"{ordered[0]:02d}:00 and {(ordered[-1] + 1) % 24:02d}:00"


def build_recommendation(
    diagnosis,
    context: dict,
    anomaly,
    electricity_tariff: float,
    water_tariff_per_kl: float,
    grid_emission_factor: float,
    water_emission_factor: float,
) -> RecommendationDraft:
    """
    Turn a diagnosis plus its measured context into a costed recommendation.

    All financial and carbon figures use the tariffs and emission factors
    passed in, which come from the runtime-configurable settings.
    """
    template = TEMPLATES.get(diagnosis.cause_code, TEMPLATES[CAUSE_UNEXPLAINED])
    resource = anomaly.resource_type

    # ---- expected saving from the measured excess ---------------------
    # Prefer the fault-footprint figure (excess across every interval the fault
    # touches). Fall back to the flagged-interval excess if the footprint could
    # not be measured, which under-states rather than over-states the saving.
    weekly_excess = float(context.get("weekly_excess") or 0.0)
    if weekly_excess <= 0.0:
        observed_days = max(1.0, float(getattr(anomaly, "occurrence_days", 1) or 1))
        excess_total = float(getattr(anomaly, "excess_total", 0.0) or 0.0)
        weekly_excess = excess_total / observed_days * 7.0
    expected_saving = max(0.0, weekly_excess * template.recoverable_fraction)

    if resource == "ENERGY":
        unit = "kWh"
        cost_saving = expected_saving * electricity_tariff
        co2_saving = expected_saving * grid_emission_factor
    else:
        unit = "L"
        cost_saving = expected_saving / 1000.0 * water_tariff_per_kl
        co2_saving = expected_saving / 1000.0 * water_emission_factor

    # ---- priority: severity first, then the size of the prize ---------
    severity_rank = PRIORITY_BY_SEVERITY.get(anomaly.severity, 3)
    priority_score = (4 - severity_rank) * 25.0 + min(50.0, cost_saving / 60.0)
    if template.difficulty == "LOW":
        priority_score += 12.0
    elif template.difficulty == "HIGH":
        priority_score -= 10.0

    if priority_score >= 90:
        priority = "CRITICAL"
    elif priority_score >= 65:
        priority = "HIGH"
    elif priority_score >= 40:
        priority = "MEDIUM"
    else:
        priority = "LOW"

    window = _window_label(context.get("hours", []))
    fmt = {
        **context,
        "window": window,
        "flow_persistence": context.get("flow_persistence", 0.0) * 100,
        "offhours_share": context.get("offhours_share", 0.0) * 100,
    }

    try:
        reason = template.reason_template.format(**fmt)
        implementation = template.implementation.format(**fmt)
    except (KeyError, IndexError, ValueError):
        # Never let a formatting slip break the pipeline.
        reason = diagnosis.narrative
        implementation = template.implementation.replace("{window}", window)

    return RecommendationDraft(
        title=template.title,
        description=template.description,
        reason=reason,
        implementation=implementation,
        evidence=diagnosis.evidence_dicts(),
        expected_saving_per_week=round(expected_saving, 2),
        expected_saving_unit=unit,
        estimated_cost_saving_per_week=round(cost_saving, 2),
        estimated_co2_reduction_per_week=round(co2_saving, 2),
        implementation_difficulty=template.difficulty,
        priority=priority,
        priority_score=round(priority_score, 1),
        payback_note=template.payback_note,
        target_fault_code=template.target_fault_code,
        steps=template.steps,
        recoverable_fraction=template.recoverable_fraction,
        recoverable_rationale=template.recoverable_rationale,
    )
