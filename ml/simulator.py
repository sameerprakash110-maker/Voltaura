"""
VOLTAURA building telemetry simulator.

WHAT THIS IS
------------
A physics-inspired hourly simulator for campus electricity and water use. In a
real deployment every value produced here would arrive from smart meters, BMS
trend logs and flow sensors over MQTT/Modbus. The simulator is the *stand-in
for that IoT layer* and nothing else: the detection, diagnosis, recommendation
and verification stages downstream never learn anything from it beyond the raw
telemetry columns a real meter would also provide.

WHY IT MATTERS FOR THE PRODUCT LOOP
-----------------------------------
Because the simulator models the plant rather than replaying a fixed CSV, an
intervention can genuinely *remove a fault* and the telemetry generated
afterwards really is lower. That is what allows post-intervention savings to be
measured rather than asserted.

DETERMINISM
-----------
Every stochastic term is drawn from a generator seeded on
(global_seed, building_id, hour_epoch, channel). Re-generating any interval
yields the same value, so appending new hours later is perfectly continuous
with history and the whole dataset is reproducible from a single seed.
"""
from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

import numpy as np

HOUR = timedelta(hours=1)

# --------------------------------------------------------------------------
# Fault vocabulary
# --------------------------------------------------------------------------
FAULT_HVAC_OVERRUN = "HVAC_OVERRUN"
FAULT_LIGHTING_AFTER_HOURS = "LIGHTING_AFTER_HOURS"
FAULT_EQUIPMENT_FAULT = "EQUIPMENT_FAULT"
FAULT_WATER_LEAK = "WATER_LEAK"
FAULT_PUMP_OVERRUN = "PUMP_OVERRUN"

ENERGY_FAULTS = {FAULT_HVAC_OVERRUN, FAULT_LIGHTING_AFTER_HOURS, FAULT_EQUIPMENT_FAULT}
WATER_FAULTS = {FAULT_WATER_LEAK, FAULT_PUMP_OVERRUN}

FAULT_LABELS = {
    FAULT_HVAC_OVERRUN: "HVAC air-handling units running outside occupied hours",
    FAULT_LIGHTING_AFTER_HOURS: "Lighting circuits energised after working hours",
    FAULT_EQUIPMENT_FAULT: "Continuous parasitic load from faulty equipment",
    FAULT_WATER_LEAK: "Continuous water loss on a distribution branch",
    FAULT_PUMP_OVERRUN: "Booster pump cycling outside its scheduled window",
}


# --------------------------------------------------------------------------
# Occupancy archetypes
# --------------------------------------------------------------------------
# Hour-of-day occupancy weights (0..1 of building capacity), for a normal
# working day. Weekend/holiday multipliers are applied on top.
PROFILES: dict[str, dict[str, object]] = {
    "office": {
        "workday": [0.010, 0.005, 0.004, 0.004, 0.006, 0.02, 0.06, 0.18,
                    0.55, 0.85, 0.95, 0.97, 0.80, 0.62, 0.90, 0.93,
                    0.85, 0.60, 0.28, 0.12, 0.06, 0.04, 0.03, 0.02],
        "weekend_factor": 0.06,
        "holiday_factor": 0.03,
    },
    "academic": {
        "workday": [0.018, 0.010, 0.008, 0.008, 0.012, 0.03, 0.10, 0.32,
                    0.72, 0.92, 0.96, 0.94, 0.66, 0.70, 0.93, 0.90,
                    0.74, 0.46, 0.26, 0.16, 0.09, 0.05, 0.03, 0.02],
        "weekend_factor": 0.12,
        "holiday_factor": 0.05,
    },
    "library": {
        "workday": [0.020, 0.008, 0.005, 0.005, 0.008, 0.02, 0.08, 0.20,
                    0.44, 0.62, 0.74, 0.78, 0.60, 0.66, 0.80, 0.86,
                    0.88, 0.82, 0.74, 0.66, 0.52, 0.34, 0.14, 0.05],
        "weekend_factor": 0.42,
        "holiday_factor": 0.18,
    },
    "social": {
        "workday": [0.012, 0.006, 0.004, 0.004, 0.006, 0.02, 0.08, 0.22,
                    0.40, 0.48, 0.56, 0.72, 0.95, 0.88, 0.58, 0.62,
                    0.78, 0.86, 0.84, 0.70, 0.48, 0.26, 0.10, 0.04],
        "weekend_factor": 0.55,
        "holiday_factor": 0.25,
    },
}


@dataclass
class BuildingSpec:
    """Everything the simulator needs to know about one building."""

    id: int
    code: str
    name: str
    profile: str
    area_sqm: float
    floors: int
    occupancy_capacity: int
    operating_hours_start: int
    operating_hours_end: int
    hvac_capacity_kw: float
    lighting_capacity_kw: float
    plug_capacity_kw: float
    base_load_kw: float
    water_per_occupant_lph: float
    pump_flow_lph: float
    night_base_flow_lph: float

    @classmethod
    def from_model(cls, b) -> "BuildingSpec":
        profile = PROFILE_BY_CODE.get(b.code, "academic")
        return cls(
            id=b.id,
            code=b.code,
            name=b.name,
            profile=profile,
            area_sqm=b.area_sqm,
            floors=b.floors,
            occupancy_capacity=b.occupancy_capacity,
            operating_hours_start=b.operating_hours_start,
            operating_hours_end=b.operating_hours_end,
            hvac_capacity_kw=b.hvac_capacity_kw,
            lighting_capacity_kw=b.lighting_capacity_kw,
            plug_capacity_kw=b.plug_capacity_kw,
            base_load_kw=b.base_load_kw,
            water_per_occupant_lph=b.water_per_occupant_lph,
            pump_flow_lph=b.pump_flow_lph,
            night_base_flow_lph=b.night_base_flow_lph,
        )


@dataclass
class ActiveFault:
    code: str
    start_ts: datetime
    end_ts: datetime | None = None
    params: dict = field(default_factory=dict)

    def covers(self, ts: datetime) -> bool:
        if ts < self.start_ts:
            return False
        return self.end_ts is None or ts < self.end_ts


# Occupancy archetype per RIT block. Architecture is mapped to the "library"
# curve because studio culture keeps that block occupied late into the evening,
# which no other academic block does.
PROFILE_BY_CODE = {
    "ADMIN": "office",
    "ARCH": "library",
    "ESB": "academic",
    "APEX": "academic",
    "MPB": "social",
    "DES": "academic",
    "LHC": "academic",
}


# --------------------------------------------------------------------------
# Deterministic noise
# --------------------------------------------------------------------------
def _rng(seed: int, building_id: int, ts: datetime, channel: str) -> np.random.Generator:
    key = f"{seed}|{building_id}|{int(ts.timestamp() // 3600)}|{channel}".encode()
    digest = hashlib.blake2b(key, digest_size=8).digest()
    return np.random.default_rng(int.from_bytes(digest, "big"))


def _noise(seed: int, building_id: int, ts: datetime, channel: str,
           scale: float = 1.0) -> float:
    """Standard-normal draw, reproducible for a given interval + channel."""
    return float(_rng(seed, building_id, ts, channel).normal(0.0, scale))


def _uniform(seed: int, building_id: int, ts: datetime, channel: str,
             lo: float, hi: float) -> float:
    return float(_rng(seed, building_id, ts, channel).uniform(lo, hi))


# --------------------------------------------------------------------------
# Calendar
# --------------------------------------------------------------------------
def build_holiday_set(data_start: datetime, days: int) -> set[date]:
    """
    Campus holidays placed deterministically inside the simulated window:
    a mid-term break, two festival days and a maintenance shutdown.
    """
    offsets = [11, 12, 13, 29, 47, 48, 66, 79]
    return {(data_start + timedelta(days=o)).date() for o in offsets if o < days}


def day_type(ts: datetime, holidays: set[date]) -> str:
    if ts.date() in holidays:
        return "HOLIDAY"
    if ts.weekday() >= 5:
        return "WEEKEND"
    return "WORKDAY"


# --------------------------------------------------------------------------
# Environment
# --------------------------------------------------------------------------
def outdoor_temperature(ts: datetime, seed: int) -> float:
    """
    Warm-climate campus: seasonal mean 24-33 C with a ~9 C diurnal swing,
    plus a slow-moving weather term so consecutive days correlate.
    """
    doy = ts.timetuple().tm_yday
    seasonal = 28.5 + 4.5 * math.sin(2 * math.pi * (doy - 110) / 365.0)
    diurnal = 4.6 * math.sin(2 * math.pi * (ts.hour - 9.5) / 24.0)
    # Weather front: same value across a whole day, smooth across days.
    front_rng = np.random.default_rng(
        int.from_bytes(hashlib.blake2b(f"{seed}|weather|{ts.date()}".encode(),
                                       digest_size=8).digest(), "big")
    )
    front = float(front_rng.normal(0.0, 1.8))
    hourly = _noise(seed, 0, ts, "temp", 0.5)
    return round(seasonal + diurnal + front + hourly, 2)


def daylight_fraction(ts: datetime) -> float:
    """1.0 at solar noon, 0.0 at night. Drives lighting demand."""
    h = ts.hour + ts.minute / 60.0
    if h < 6.2 or h > 18.6:
        return 0.0
    return max(0.0, math.sin(math.pi * (h - 6.2) / (18.6 - 6.2)))


# --------------------------------------------------------------------------
# Core per-interval simulation
# --------------------------------------------------------------------------
def simulate_interval(
    spec: BuildingSpec,
    ts: datetime,
    faults: list[ActiveFault],
    holidays: set[date],
    seed: int,
) -> dict:
    """
    Produce one hour of telemetry for one building.

    Returns the exact set of channels a real meter/BMS stack would expose:
    electricity (kWh), water (L + instantaneous L/h), occupancy, indoor
    temperature, and equipment runtimes (minutes in the hour).
    """
    dtype = day_type(ts, holidays)
    profile = PROFILES[spec.profile]
    curve: list[float] = profile["workday"]  # type: ignore[assignment]

    # ---- occupancy ----------------------------------------------------
    base_w = curve[ts.hour]
    if dtype == "WEEKEND":
        base_w *= float(profile["weekend_factor"])
    elif dtype == "HOLIDAY":
        base_w *= float(profile["holiday_factor"])

    # Day-level attendance variation (exam weeks, weather, events).
    day_rng = np.random.default_rng(
        int.from_bytes(
            hashlib.blake2b(f"{seed}|att|{spec.id}|{ts.date()}".encode(),
                            digest_size=8).digest(), "big")
    )
    day_factor = float(np.clip(day_rng.normal(1.0, 0.11), 0.68, 1.30))

    occ_frac = base_w * day_factor * (1.0 + _noise(seed, spec.id, ts, "occ", 0.055))
    occ_frac = float(np.clip(occ_frac, 0.0, 1.05))
    occupancy = int(round(occ_frac * spec.occupancy_capacity))
    occupancy_pct = round(100.0 * occ_frac, 2)

    outdoor = outdoor_temperature(ts, seed)
    daylight = daylight_fraction(ts)

    # ---- HVAC ---------------------------------------------------------
    # Cooling demand normalised against a 22 C setpoint.
    cooling_need = float(np.clip((outdoor - 22.0) / 12.0, 0.0, 1.0))
    if occ_frac > 0.05:
        hvac_frac = 0.22 + 0.78 * cooling_need * (0.40 + 0.60 * occ_frac)
    else:
        hvac_frac = 0.08 * cooling_need  # unoccupied setback
    hvac_frac = float(np.clip(hvac_frac * (1.0 + _noise(seed, spec.id, ts, "hvac", 0.04)), 0.0, 1.0))
    hvac_runtime = hvac_frac * 60.0

    # ---- lighting -----------------------------------------------------
    if occ_frac > 0.03:
        light_frac = (0.32 + 0.68 * min(1.0, occ_frac * 1.15)) * (1.0 - 0.42 * daylight)
    else:
        light_frac = 0.10  # corridor / security lighting
    light_frac = float(np.clip(light_frac * (1.0 + _noise(seed, spec.id, ts, "light", 0.04)), 0.0, 1.0))
    lighting_runtime = light_frac * 60.0

    # ---- pumps --------------------------------------------------------
    # Overhead tanks are topped up in two scheduled windows plus on demand.
    in_pump_window = ts.hour in (5, 6, 7, 13, 14)
    pump_frac = (0.55 if in_pump_window else 0.05) + 0.35 * occ_frac
    pump_frac = float(np.clip(pump_frac * (1.0 + _noise(seed, spec.id, ts, "pump", 0.07)), 0.0, 1.0))
    pump_runtime = pump_frac * 60.0

    equipment_extra_kw = 0.0
    leak_lph = 0.0
    energy_fault_code: str | None = None
    water_fault_code: str | None = None

    # ---- inject active faults ------------------------------------------
    for f in faults:
        if not f.covers(ts):
            continue

        if f.code == FAULT_HVAC_OVERRUN:
            # AHUs never handed back to the night schedule: they keep running
            # through the evening even though the floor plate is empty.
            hours = f.params.get("hours", [18, 19, 20, 21, 22, 23])
            if ts.hour in hours and dtype != "HOLIDAY" and occ_frac < 0.25:
                forced = _uniform(seed, spec.id, ts, "f_hvac", 0.78, 0.96)
                if forced * 60.0 > hvac_runtime:
                    hvac_runtime = forced * 60.0
                    hvac_frac = forced
                    energy_fault_code = f.code

        elif f.code == FAULT_LIGHTING_AFTER_HOURS:
            hours = f.params.get("hours", [19, 20, 21, 22, 23, 0, 1, 2])
            if ts.hour in hours:
                forced = _uniform(seed, spec.id, ts, "f_light", 0.74, 0.95)
                if forced * 60.0 > lighting_runtime:
                    lighting_runtime = forced * 60.0
                    light_frac = forced
                    energy_fault_code = f.code

        elif f.code == FAULT_EQUIPMENT_FAULT:
            kw = float(f.params.get("extra_kw", 16.0))
            equipment_extra_kw += kw * (1.0 + _noise(seed, spec.id, ts, "f_equip", 0.05))
            energy_fault_code = f.code

        elif f.code == FAULT_WATER_LEAK:
            lph = float(f.params.get("leak_lph", 41.0))
            leak_lph += lph * (1.0 + _noise(seed, spec.id, ts, "f_leak", 0.06))
            water_fault_code = f.code

        elif f.code == FAULT_PUMP_OVERRUN:
            hours = f.params.get("hours", [22, 23, 0, 1, 2, 3, 4, 5])
            if ts.hour in hours:
                forced = _uniform(seed, spec.id, ts, "f_pump", 0.82, 1.0)
                if forced * 60.0 > pump_runtime:
                    pump_runtime = forced * 60.0
                    pump_frac = forced
                    water_fault_code = f.code
                    # The tank is already full, so the pumped volume goes over
                    # the top. Overflow is the dominant loss in this fault.
                    overflow = float(f.params.get("overflow_lph", 115.0))
                    leak_lph += overflow * forced * (
                        1.0 + _noise(seed, spec.id, ts, "f_overflow", 0.08)
                    )

    # ---- electricity ---------------------------------------------------
    hvac_kw = spec.hvac_capacity_kw * (hvac_runtime / 60.0) * (0.55 + 0.45 * cooling_need)
    lighting_kw = spec.lighting_capacity_kw * (lighting_runtime / 60.0)
    plug_kw = spec.plug_capacity_kw * (0.16 + 0.84 * occ_frac)
    pump_kw = 0.055 * spec.pump_flow_lph * (pump_runtime / 60.0) / 10.0

    energy_kw = (
        spec.base_load_kw + hvac_kw + lighting_kw + plug_kw + pump_kw + equipment_extra_kw
    )
    energy_kwh = max(0.5, energy_kw * (1.0 + _noise(seed, spec.id, ts, "ekwh", 0.022)))

    # ---- indoor temperature --------------------------------------------
    # Conditioned space tracks the setpoint; it drifts toward outdoor when the
    # plant is off. Deliberately stays in-range during HVAC over-run so the
    # rule engine has to lean on runtime + occupancy, not temperature.
    conditioning = min(1.0, hvac_runtime / 45.0)
    indoor = 23.2 + (1.0 - conditioning) * (outdoor - 23.2) * 0.42
    indoor += 0.9 * occ_frac + _noise(seed, spec.id, ts, "tin", 0.22)
    indoor = round(float(np.clip(indoor, 19.5, 33.0)), 2)

    # ---- water ----------------------------------------------------------
    domestic_lph = occupancy * spec.water_per_occupant_lph
    # Pumping contributes distribution losses / irrigation / cooling make-up.
    pump_lph = spec.pump_flow_lph * (pump_runtime / 60.0) * 0.22
    trickle = spec.night_base_flow_lph * (1.0 + _noise(seed, spec.id, ts, "trickle", 0.10))

    flow_lph = max(0.0, domestic_lph + pump_lph + trickle + leak_lph)
    flow_lph *= 1.0 + _noise(seed, spec.id, ts, "wflow", 0.03)
    water_liters = max(0.0, flow_lph)  # one hour of flow

    return {
        "ts": ts,
        "building_id": spec.id,
        "occupancy": occupancy,
        "occupancy_pct": occupancy_pct,
        "temperature_c": indoor,
        "outdoor_temperature_c": outdoor,
        "hvac_runtime_min": round(hvac_runtime, 2),
        "lighting_runtime_min": round(lighting_runtime, 2),
        "pump_runtime_min": round(pump_runtime, 2),
        "equipment_kw": round(equipment_extra_kw, 3),
        "energy_kwh": round(energy_kwh, 3),
        "water_liters": round(water_liters, 2),
        "flow_lph": round(flow_lph, 2),
        "energy_fault_code": energy_fault_code,
        "water_fault_code": water_fault_code,
        "day_type": dtype,
    }


def simulate_range(
    spec: BuildingSpec,
    start: datetime,
    end: datetime,
    faults: list[ActiveFault],
    holidays: set[date],
    seed: int,
) -> list[dict]:
    """Simulate [start, end) at hourly resolution."""
    rows: list[dict] = []
    ts = start
    while ts < end:
        rows.append(simulate_interval(spec, ts, faults, holidays, seed))
        ts += HOUR
    return rows
