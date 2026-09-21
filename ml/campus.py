"""
Campus definition for the EcoTwin demo deployment.

Holds (a) the five buildings with their physical and plant characteristics and
(b) the fault plan injected into the simulated telemetry.

The fault plan is intentionally split into two groups:

  * LIVE faults     - still present at the end of the seeded history. These are
                      what the judge sees as open anomalies and drives through
                      the detect -> diagnose -> recommend -> intervene -> verify
                      loop during the demo.
  * HISTORICAL      - faults that were already remediated inside the history
                      window. These give the Verification and Reports pages
                      real, fully-measured savings the moment the app loads.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from .simulator import (
    FAULT_EQUIPMENT_FAULT,
    FAULT_HVAC_OVERRUN,
    FAULT_LIGHTING_AFTER_HOURS,
    FAULT_PUMP_OVERRUN,
    FAULT_WATER_LEAK,
)

# --------------------------------------------------------------------------
# Buildings
# --------------------------------------------------------------------------
BUILDINGS: list[dict] = [
    {
        "code": "ADMIN",
        "name": "Administration Block",
        "category": "Administrative",
        "description": (
            "Central administration, registrar and finance offices. "
            "Weekday office occupancy with a hard 18:00 close."
        ),
        "area_sqm": 4200,
        "floors": 4,
        "occupancy_capacity": 180,
        "operating_hours_start": 9,
        "operating_hours_end": 18,
        "year_built": 2009,
        "twin_x": -17.0, "twin_z": 13.0, "twin_w": 14.0, "twin_d": 10.0,
        "twin_h": 13.0, "twin_rotation": 0.06,
        "hvac_capacity_kw": 45.0,
        "lighting_capacity_kw": 18.0,
        "plug_capacity_kw": 22.0,
        "base_load_kw": 8.0,
        "water_per_occupant_lph": 3.0,
        "pump_flow_lph": 140.0,
        "night_base_flow_lph": 4.0,
    },
    {
        "code": "ENGG",
        "name": "Engineering Block",
        "category": "Academic / Laboratory",
        "description": (
            "Mechanical and electrical teaching labs plus lecture theatres. "
            "Heavy plug load and the campus's largest air-handling plant."
        ),
        "area_sqm": 7800,
        "floors": 5,
        "occupancy_capacity": 420,
        "operating_hours_start": 8,
        "operating_hours_end": 18,
        "year_built": 2014,
        "twin_x": 15.0, "twin_z": 9.0, "twin_w": 16.0, "twin_d": 12.0,
        "twin_h": 16.0, "twin_rotation": -0.05,
        "hvac_capacity_kw": 85.0,
        "lighting_capacity_kw": 34.0,
        "plug_capacity_kw": 62.0,
        "base_load_kw": 18.0,
        "water_per_occupant_lph": 2.6,
        "pump_flow_lph": 240.0,
        "night_base_flow_lph": 6.0,
    },
    {
        "code": "CSE",
        "name": "Computer Science Block",
        "category": "Academic / Data Centre",
        "description": (
            "Lecture halls, project labs and the campus server room. "
            "High always-on base load from IT infrastructure."
        ),
        "area_sqm": 6100,
        "floors": 4,
        "occupancy_capacity": 380,
        "operating_hours_start": 8,
        "operating_hours_end": 19,
        "year_built": 2017,
        "twin_x": 13.0, "twin_z": -15.0, "twin_w": 14.0, "twin_d": 11.0,
        "twin_h": 13.0, "twin_rotation": 0.04,
        "hvac_capacity_kw": 68.0,
        "lighting_capacity_kw": 26.0,
        "plug_capacity_kw": 55.0,
        "base_load_kw": 26.0,
        "water_per_occupant_lph": 2.2,
        "pump_flow_lph": 180.0,
        "night_base_flow_lph": 4.5,
    },
    {
        "code": "LIB",
        "name": "Central Library",
        "category": "Academic / Study",
        "description": (
            "Three-floor reading hall and archive, open until 22:00 including "
            "weekends. Served by a single water riser on the east branch."
        ),
        "area_sqm": 5200,
        "floors": 3,
        "occupancy_capacity": 260,
        "operating_hours_start": 8,
        "operating_hours_end": 22,
        "year_built": 2011,
        "twin_x": -4.0, "twin_z": -7.0, "twin_w": 13.0, "twin_d": 13.0,
        "twin_h": 11.0, "twin_rotation": 0.0,
        "hvac_capacity_kw": 58.0,
        "lighting_capacity_kw": 30.0,
        "plug_capacity_kw": 20.0,
        "base_load_kw": 10.0,
        "water_per_occupant_lph": 2.0,
        "pump_flow_lph": 170.0,
        "night_base_flow_lph": 4.5,
    },
    {
        "code": "SC",
        "name": "Student Center",
        "category": "Amenity",
        "description": (
            "Cafeteria, common rooms and sports desk. Highest per-person water "
            "draw on campus and a booster pump serving the roof tank."
        ),
        "area_sqm": 3800,
        "floors": 2,
        "occupancy_capacity": 300,
        "operating_hours_start": 8,
        "operating_hours_end": 21,
        "year_built": 2016,
        "twin_x": -19.0, "twin_z": -15.0, "twin_w": 12.0, "twin_d": 10.0,
        "twin_h": 8.0, "twin_rotation": -0.08,
        "hvac_capacity_kw": 40.0,
        "lighting_capacity_kw": 20.0,
        "plug_capacity_kw": 46.0,
        "base_load_kw": 12.0,
        "water_per_occupant_lph": 4.8,
        "pump_flow_lph": 320.0,
        "night_base_flow_lph": 5.5,
    },
]


# --------------------------------------------------------------------------
# Fault plan
# --------------------------------------------------------------------------
@dataclass
class PlannedFault:
    building_code: str
    code: str
    resource_type: str
    label: str
    #  Offsets in days measured backwards from the end of the history window.
    start_days_before_end: int
    end_days_before_end: int | None  # None == still active at the end of history
    params: dict = field(default_factory=dict)
    scenario_key: str | None = None

    def window(self, data_end: datetime) -> tuple[datetime, datetime | None]:
        start = data_end - timedelta(days=self.start_days_before_end)
        end = (
            None
            if self.end_days_before_end is None
            else data_end - timedelta(days=self.end_days_before_end)
        )
        return start, end


FAULT_PLAN: list[PlannedFault] = [
    # ---- LIVE: drives the judge-facing demo loop ----------------------
    PlannedFault(
        building_code="ENGG",
        code=FAULT_HVAC_OVERRUN,
        resource_type="ENERGY",
        label="AHU-2/AHU-3 not returning to night setback after 18:00",
        start_days_before_end=26,
        end_days_before_end=None,
        params={"hours": [18, 19, 20, 21, 22, 23]},
        scenario_key="hvac-engineering",
    ),
    PlannedFault(
        building_code="LIB",
        code=FAULT_WATER_LEAK,
        resource_type="WATER",
        label="Continuous loss on the east riser between the 1st and 2nd floor",
        start_days_before_end=22,
        end_days_before_end=None,
        params={"leak_lph": 41.0},
        scenario_key="leak-library",
    ),
    PlannedFault(
        building_code="ADMIN",
        code=FAULT_LIGHTING_AFTER_HOURS,
        resource_type="ENERGY",
        label="Floor 2 and 3 lighting contactors held on overnight",
        start_days_before_end=18,
        end_days_before_end=None,
        params={"hours": [19, 20, 21, 22, 23, 0, 1, 2]},
        scenario_key="lighting-admin",
    ),
    # ---- HISTORICAL: already remediated inside the history window -----
    # These give Verification / Reports real measured savings at first load.
    PlannedFault(
        building_code="CSE",
        code=FAULT_EQUIPMENT_FAULT,
        resource_type="ENERGY",
        label="Server-room UPS stuck in bypass, drawing continuous parasitic load",
        start_days_before_end=74,
        end_days_before_end=52,
        params={"extra_kw": 17.0},
        scenario_key="ups-cse",
    ),
    PlannedFault(
        building_code="SC",
        code=FAULT_PUMP_OVERRUN,
        resource_type="WATER",
        label="Roof-tank booster pump cycling through the night on a failed float switch, overflowing the tank",
        start_days_before_end=62,
        end_days_before_end=41,
        params={"hours": [22, 23, 0, 1, 2, 3, 4, 5], "overflow_lph": 130.0},
        scenario_key="pump-student-center",
    ),
]


# --------------------------------------------------------------------------
# Demo scenarios exposed through /api/demo/scenarios
# --------------------------------------------------------------------------
DEMO_SCENARIOS: list[dict] = [
    {
        "key": "hvac-engineering",
        "order": 1,
        "title": "Engineering Block HVAC over-run",
        "resource_type": "ENERGY",
        "building_code": "ENGG",
        "fault_code": FAULT_HVAC_OVERRUN,
        "headline": "Air handling units never hand back to night setback",
        "summary": (
            "Evening electricity at the Engineering Block runs far above the "
            "occupancy-adjusted baseline. Floor occupancy after 18:00 is under "
            "10% yet the AHUs keep running near full duty."
        ),
        "what_to_look_for": [
            "Evening load sits well above the expected-consumption band",
            "HVAC runtime stays high while occupancy collapses after 18:00",
            "Indoor temperature stays inside the comfort band, so this is not a cooling-demand problem",
        ],
        "expected_cause": "HVAC scheduling inefficiency",
    },
    {
        "key": "leak-library",
        "order": 2,
        "title": "Central Library water leakage",
        "resource_type": "WATER",
        "building_code": "LIB",
        "fault_code": FAULT_WATER_LEAK,
        "headline": "Night flow will not fall to the building's standing baseline",
        "summary": (
            "Overnight flow at the Central Library has risen from roughly "
            "8 L/hour to the high forties and never returns to baseline, even "
            "on days when the building is closed and unoccupied."
        ),
        "what_to_look_for": [
            "Minimum night-time flow no longer drops toward zero",
            "Flow persists on closed days with near-zero occupancy",
            "Daytime totals look almost normal - the signal only shows at night",
        ],
        "expected_cause": "Probable water leakage on a distribution branch",
    },
    {
        "key": "lighting-admin",
        "order": 3,
        "title": "Administration Block lighting anomaly",
        "resource_type": "ENERGY",
        "building_code": "ADMIN",
        "fault_code": FAULT_LIGHTING_AFTER_HOURS,
        "headline": "Lighting circuits energised long after the building closes",
        "summary": (
            "The Administration Block closes at 18:00, but lighting runtime "
            "stays near full through the night. Overnight electricity is "
            "several times the expected standing load."
        ),
        "what_to_look_for": [
            "Lighting runtime near 60 min/hour between 19:00 and 02:00",
            "Occupancy effectively zero across the same window",
            "HVAC runtime normal, which isolates the cause to the lighting subsystem",
        ],
        "expected_cause": "Lighting control inefficiency",
    },
]

SCENARIOS_BY_KEY = {s["key"]: s for s in DEMO_SCENARIOS}
BUILDINGS_BY_CODE = {b["code"]: b for b in BUILDINGS}
