"""
Campus definition: Ramaiah Institute of Technology (RIT / MSRIT), Bengaluru.

Approximate centre: 13.0307823 N, 77.5649893 E.

SPATIAL MODEL
-------------
Block identification and arrangement follow the hand-drawn campus map supplied
by the user; the satellite view informs the irregular spacing and the dominance
of the central quadrangle. Nothing here is surveyed - footprints and offsets are
approximations chosen so the model reads as *this* campus rather than a grid.

    twin_x   metres east of the quadrangle centre  (negative = west)
    twin_z   metres south of the quadrangle centre (negative = north)
    twin_w   footprint extent along local X, before rotation
    twin_d   footprint extent along local Z, before rotation
    twin_h   parapet height in metres

                      ADMIN            ARCHITECTURE
        MULTIPURPOSE        QUADRANGLE          ESB
                                                   APEX
              LHC       DES

Deliberately not symmetric: blocks sit at different offsets and rotations, as
they do on the real site.

PLANT SIZING
------------
`area_sqm` is roughly footprint x floors, and the nameplate capacities are set
so peak demand lands at 20-30 W/m2 - the band an air-conditioned institutional
building in a warm climate actually occupies.

The fault plan is split in two:

  * LIVE        still present at the end of the seeded history. These are the
                open anomalies a reviewer drives through the
                detect -> diagnose -> recommend -> intervene -> verify loop.
  * HISTORICAL  already remediated inside the window, so the Verification and
                Reports pages carry real measured savings on first load.
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
# Site
# --------------------------------------------------------------------------
CAMPUS_NAME = "Ramaiah Institute of Technology"
CAMPUS_SHORT = "RIT Bengaluru"
CAMPUS_LAT = 13.0307823
CAMPUS_LON = 77.5649893

# The quadrangle is the visual and spatial anchor of the whole campus.
QUADRANGLE = {
    "width": 110.0,   # east-west, metres
    "depth": 80.0,    # north-south, metres
    "center_x": 0.0,
    "center_z": 0.0,
}


# --------------------------------------------------------------------------
# Blocks
# --------------------------------------------------------------------------
BUILDINGS: list[dict] = [
    {
        "code": "ADMIN",
        "name": "Admin Block",
        "category": "Administration",
        "description": (
            "Principal's office, registrar, admissions and accounts, on the "
            "north side of the quadrangle. Weekday office occupancy with a hard "
            "evening close."
        ),
        "area_sqm": 4320,
        "floors": 4,
        "occupancy_capacity": 190,
        "operating_hours_start": 9,
        "operating_hours_end": 18,
        "year_built": 2004,
        # north of the quadrangle, offset west of centre
        "twin_x": -28.0, "twin_z": -58.0, "twin_w": 60.0, "twin_d": 18.0,
        "twin_h": 15.2, "twin_rotation": 0.025,
        "hvac_capacity_kw": 50.0,
        "lighting_capacity_kw": 20.0,
        "plug_capacity_kw": 26.0,
        "base_load_kw": 9.0,
        "water_per_occupant_lph": 3.0,
        "pump_flow_lph": 140.0,
        "night_base_flow_lph": 4.0,
    },
    {
        "code": "ARCH",
        "name": "Architecture Block",
        "category": "Academic / Studio",
        "description": (
            "Design studios, model workshop and jury halls, north-east of the "
            "quadrangle. Studio culture keeps this block occupied far later than "
            "the rest of the campus."
        ),
        "area_sqm": 5376,
        "floors": 4,
        "occupancy_capacity": 300,
        "operating_hours_start": 8,
        "operating_hours_end": 21,
        "year_built": 2011,
        # north of the quadrangle, offset east
        "twin_x": 42.0, "twin_z": -56.0, "twin_w": 64.0, "twin_d": 21.0,
        "twin_h": 15.2, "twin_rotation": -0.035,
        "hvac_capacity_kw": 62.0,
        "lighting_capacity_kw": 28.0,
        "plug_capacity_kw": 36.0,
        "base_load_kw": 11.0,
        "water_per_occupant_lph": 2.4,
        "pump_flow_lph": 180.0,
        "night_base_flow_lph": 5.0,
    },
    {
        "code": "ESB",
        "name": "ESB Block",
        "category": "Academic / Laboratory",
        "description": (
            "Electronic Sciences Block. Electronics, telecommunication and "
            "instrumentation labs along the eastern edge of the quadrangle. "
            "Carries the campus's largest air-handling plant."
        ),
        "area_sqm": 8580,
        "floors": 5,
        "occupancy_capacity": 480,
        "operating_hours_start": 8,
        "operating_hours_end": 18,
        "year_built": 2009,
        # long slab running north-south along the east side
        "twin_x": 80.0, "twin_z": -6.0, "twin_w": 22.0, "twin_d": 78.0,
        "twin_h": 19.0, "twin_rotation": -0.02,
        "hvac_capacity_kw": 95.0,
        "lighting_capacity_kw": 38.0,
        "plug_capacity_kw": 70.0,
        "base_load_kw": 22.0,
        "water_per_occupant_lph": 2.6,
        "pump_flow_lph": 260.0,
        "night_base_flow_lph": 6.5,
    },
    {
        "code": "APEX",
        "name": "Apex Block",
        "category": "Academic / Data Centre",
        "description": (
            "Newest block, on the south-east corner. Seminar halls, research "
            "centres and the campus server room, which draws a heavy always-on "
            "base load."
        ),
        "area_sqm": 7250,
        "floors": 5,
        "occupancy_capacity": 420,
        "operating_hours_start": 8,
        "operating_hours_end": 19,
        "year_built": 2018,
        # south-east corner, noticeably angled off the site grid
        "twin_x": 76.0, "twin_z": 62.0, "twin_w": 58.0, "twin_d": 25.0,
        "twin_h": 19.0, "twin_rotation": 0.20,
        "hvac_capacity_kw": 78.0,
        "lighting_capacity_kw": 30.0,
        "plug_capacity_kw": 62.0,
        "base_load_kw": 30.0,
        "water_per_occupant_lph": 2.2,
        "pump_flow_lph": 200.0,
        "night_base_flow_lph": 5.0,
    },
    {
        "code": "MPB",
        "name": "Multipurpose Block",
        "category": "Amenity",
        "description": (
            "Auditorium, examination halls and the main canteen on the western "
            "edge. Highest per-person water draw on campus, served by a roof "
            "tank and booster pump."
        ),
        "area_sqm": 4752,
        "floors": 3,
        "occupancy_capacity": 600,
        "operating_hours_start": 8,
        "operating_hours_end": 21,
        "year_built": 2007,
        # long slab running north-south along the west side
        "twin_x": -82.0, "twin_z": -4.0, "twin_w": 24.0, "twin_d": 66.0,
        "twin_h": 14.0, "twin_rotation": 0.04,
        "hvac_capacity_kw": 58.0,
        "lighting_capacity_kw": 26.0,
        "plug_capacity_kw": 38.0,
        "base_load_kw": 10.0,
        "water_per_occupant_lph": 2.8,
        "pump_flow_lph": 320.0,
        "night_base_flow_lph": 6.0,
    },
    {
        "code": "DES",
        "name": "DES Block",
        "category": "Academic",
        "description": (
            "Departmental teaching block on the southern edge of the "
            "quadrangle: classrooms, staff rooms and departmental offices."
        ),
        "area_sqm": 6160,
        "floors": 4,
        "occupancy_capacity": 380,
        "operating_hours_start": 8,
        "operating_hours_end": 18,
        "year_built": 2006,
        # south of the quadrangle, slightly east of centre
        "twin_x": 6.0, "twin_z": 64.0, "twin_w": 70.0, "twin_d": 22.0,
        "twin_h": 15.2, "twin_rotation": 0.04,
        "hvac_capacity_kw": 70.0,
        "lighting_capacity_kw": 30.0,
        "plug_capacity_kw": 46.0,
        "base_load_kw": 14.0,
        "water_per_occupant_lph": 2.3,
        "pump_flow_lph": 190.0,
        "night_base_flow_lph": 5.0,
    },
    {
        "code": "LHC",
        "name": "Lecture Hall Complex",
        "category": "Academic / Teaching",
        "description": (
            "Tiered lecture theatres on the south-west corner, shared across "
            "departments. Served by a single water riser on its north face."
        ),
        "area_sqm": 5022,
        "floors": 3,
        "occupancy_capacity": 450,
        "operating_hours_start": 8,
        "operating_hours_end": 18,
        "year_built": 2013,
        # south-west corner
        "twin_x": -66.0, "twin_z": 66.0, "twin_w": 62.0, "twin_d": 27.0,
        "twin_h": 12.0, "twin_rotation": -0.05,
        "hvac_capacity_kw": 56.0,
        "lighting_capacity_kw": 26.0,
        "plug_capacity_kw": 34.0,
        "base_load_kw": 10.0,
        "water_per_occupant_lph": 2.0,
        "pump_flow_lph": 170.0,
        "night_base_flow_lph": 4.5,
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
        building_code="ESB",
        code=FAULT_HVAC_OVERRUN,
        resource_type="ENERGY",
        label="AHU-2/AHU-3 not returning to night setback after 18:00",
        start_days_before_end=26,
        end_days_before_end=None,
        params={"hours": [18, 19, 20, 21, 22, 23]},
        scenario_key="hvac-esb",
    ),
    PlannedFault(
        building_code="LHC",
        code=FAULT_WATER_LEAK,
        resource_type="WATER",
        label="Continuous loss on the north riser serving the ground-floor theatres",
        start_days_before_end=22,
        end_days_before_end=None,
        params={"leak_lph": 41.0},
        scenario_key="leak-lhc",
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
    PlannedFault(
        building_code="APEX",
        code=FAULT_EQUIPMENT_FAULT,
        resource_type="ENERGY",
        label="Server-room UPS stuck in bypass, drawing continuous parasitic load",
        start_days_before_end=74,
        end_days_before_end=52,
        params={"extra_kw": 17.0},
        scenario_key="ups-apex",
    ),
    PlannedFault(
        building_code="MPB",
        code=FAULT_PUMP_OVERRUN,
        resource_type="WATER",
        label=(
            "Roof-tank booster pump cycling through the night on a failed float "
            "switch, overflowing the tank"
        ),
        start_days_before_end=62,
        end_days_before_end=41,
        params={"hours": [22, 23, 0, 1, 2, 3, 4, 5], "overflow_lph": 290.0},
        scenario_key="pump-mpb",
    ),
]


# --------------------------------------------------------------------------
# Demo scenarios exposed through /api/demo/scenarios
# --------------------------------------------------------------------------
DEMO_SCENARIOS: list[dict] = [
    {
        "key": "hvac-esb",
        "order": 1,
        "title": "ESB Block HVAC over-run",
        "resource_type": "ENERGY",
        "building_code": "ESB",
        "fault_code": FAULT_HVAC_OVERRUN,
        "headline": "Air handling units never hand back to night setback",
        "summary": (
            "Evening electricity in the ESB Block runs far above the "
            "occupancy-adjusted baseline. Lab occupancy after 18:00 is under "
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
        "key": "leak-lhc",
        "order": 2,
        "title": "Lecture Hall Complex water leakage",
        "resource_type": "WATER",
        "building_code": "LHC",
        "fault_code": FAULT_WATER_LEAK,
        "headline": "Night flow will not fall to the building's standing baseline",
        "summary": (
            "Overnight flow at the Lecture Hall Complex has risen from roughly "
            "8 L/hour to the high forties and never returns to baseline, even on "
            "days when the theatres are closed and unoccupied."
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
        "title": "Admin Block lighting anomaly",
        "resource_type": "ENERGY",
        "building_code": "ADMIN",
        "fault_code": FAULT_LIGHTING_AFTER_HOURS,
        "headline": "Lighting circuits energised long after the block closes",
        "summary": (
            "The Admin Block closes at 18:00, but lighting runtime stays near "
            "full through the night. Overnight electricity is several times the "
            "expected standing load."
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
