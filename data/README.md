# EcoTwin dataset

## What this data represents

**This dataset is synthetic.** It stands in for the IoT telemetry that a real EcoTwin
deployment would receive from:

| Real-world source | Protocol | Channels it would supply |
|---|---|---|
| Electricity smart meters | Modbus TCP / M-Bus | `energy_kwh` |
| Water flow meters | Pulse output / ultrasonic | `water_liters`, `flow_lph` |
| Building management system | BACnet/IP trend logs | `hvac_runtime_min`, `lighting_runtime_min`, `pump_runtime_min`, `temperature_c` |
| Occupancy sensing | PIR, Wi-Fi association counts, turnstiles | `occupancy`, `occupancy_pct` |
| Weather station or API | HTTP | `outdoor_temperature_c` |

Every column in the dataset is one a real meter or BMS point also reports. Nothing in the
schema depends on the data being simulated, which is what makes the swap to live telemetry
a change of *source* rather than a change of *system*.

The generator lives in [`../ml/simulator.py`](../ml/simulator.py) and the campus definition
(buildings + fault plan) in [`../ml/campus.py`](../ml/campus.py).

---

## Shape

| | |
|---|---|
| Buildings | 5 |
| Resolution | 1 hour |
| History | 90 days (configurable) |
| Rows | 10,800 energy + 10,800 water = **21,600 intervals** |
| Channels per interval | 9 |
| Random seed | `20240917` (fully reproducible) |

### Buildings

| Code | Name | Type | Area (m²) | Floors | Capacity | Hours |
|---|---|---|---|---|---|---|
| `ADMIN` | Administration Block | Administrative | 4,200 | 4 | 180 | 09:00–18:00 |
| `ENGG` | Engineering Block | Academic / Laboratory | 7,800 | 5 | 420 | 08:00–18:00 |
| `CSE` | Computer Science Block | Academic / Data Centre | 6,100 | 4 | 380 | 08:00–19:00 |
| `LIB` | Central Library | Academic / Study | 5,200 | 3 | 260 | 08:00–22:00 |
| `SC` | Student Center | Amenity | 3,800 | 2 | 300 | 08:00–21:00 |

---

## How it is generated

The simulator models the **plant**, not a playback of recorded values:

```
energy_kw = base_load
          + hvac_capacity     × (hvac_runtime / 60)     × (0.55 + 0.45 × cooling_need)
          + lighting_capacity × (lighting_runtime / 60)
          + plug_capacity     × (0.16 + 0.84 × occupancy_fraction)
          + pump_load
          + fault_contribution

flow_lph  = occupancy × litres_per_occupant_hour
          + pump_flow × (pump_runtime / 60) × 0.22
          + standing_trickle
          + leak_contribution
```

Driving behaviours:

- **Occupancy archetypes** — four hourly curves (office, academic, library, social) with
  weekend and holiday multipliers, plus day-level attendance variation (σ ≈ 11%).
- **Calendar** — weekdays / weekends, and eight campus holidays placed deterministically
  inside the window (a mid-term break, festival days, a maintenance shutdown).
- **Weather** — seasonal mean 24–33 °C with a ~9 °C diurnal swing, plus a day-correlated
  weather front so consecutive days are not independent.
- **Lighting** — driven by occupancy and daylight (06:12–18:36), with a corridor/security
  floor overnight.
- **HVAC** — cooling demand normalised against a 22 °C setpoint, with unoccupied setback.
- **Pumping** — two scheduled tank-fill windows plus on-demand response.
- **Indoor temperature** — tracks the setpoint when the plant runs, drifts toward outdoor
  when it does not. Deliberately stays in range during HVAC over-run so the rule engine has
  to lean on runtime and occupancy rather than temperature.

### Determinism

Every stochastic term is drawn from a generator seeded on

```
blake2b(global_seed | building_id | hour_epoch | channel)
```

Re-generating any interval therefore yields the same value. Two consequences matter:

1. The whole dataset is reproducible from a single seed.
2. Hours appended later (post-intervention monitoring) are **perfectly continuous** with
   history — there is no seam where the simulation resumes.

---

## Injected faults

Five faults are planted. Their ground truth is stored in the `faults` table and mirrored
onto each affected reading as `fault_code`.

> **The detection pipeline never reads either.** `fault_code` exists for documentation and
> offline evaluation only. Detection, diagnosis and verification see nothing but the raw
> telemetry columns a real meter would also provide.

| Building | Fault code | Resource | Window (days before end) | Mechanism |
|---|---|---|---|---|
| `ENGG` | `HVAC_OVERRUN` | Energy | −26 → live | AHU runtime forced to 78–96% duty at 18:00–23:59 when occupancy < 25% |
| `LIB` | `WATER_LEAK` | Water | −22 → live | Constant +41 L/h on the distribution branch, 24/7 |
| `ADMIN` | `LIGHTING_AFTER_HOURS` | Energy | −18 → live | Lighting runtime forced to 74–95% at 19:00–02:59 |
| `CSE` | `EQUIPMENT_FAULT` | Energy | −74 → −52 | Constant +17 kW parasitic draw, 24/7 |
| `SC` | `PUMP_OVERRUN` | Water | −62 → −41 | Pump forced to 82–100% duty at 22:00–05:59, **plus** roof-tank overflow at ~130 L/h |

The first three are still active at the end of the history and drive the live demo. The
last two were already remediated inside the window, which gives the Verification and
Reports pages real measured savings the moment the app loads.

### Measured fault signatures

Each fault produces a **distinct evidence signature**, which is what allows the rule engine
to discriminate between causes rather than pattern-match a threshold:

| Building | Window | Consumption | Occupancy | HVAC runtime | Lighting runtime |
|---|---|---|---|---|---|
| `ENGG` | 18:00–23:59 | 62 → 102 kWh (**+64%**) | 7.2% | 15.8 → **47.3** min/h | 15.8 → 15.8 min/h |
| `ADMIN` | 19:00–02:59 | 20.4 → 32.4 kWh (**+59%**) | 2.4% | 7.4 → 7.4 min/h | 10.6 → **50.6** min/h |
| `LIB` | 01:00–04:59 | 8.8 → 49.8 L/h (**+467%**) | 0.5% | — | — |

Note the Library figure against the problem brief's target of *"normal 7–10 L/h, leak
45–55 L/h"* — the simulator was calibrated to land inside that band.

---

## Plausibility checks

The parameters were tuned against published benchmarks rather than chosen for convenience:

| Metric | Simulated | Typical real range |
|---|---|---|
| Peak electrical intensity | 20–32 W/m² | 15–35 W/m² (air-conditioned, warm climate) |
| Annualised energy intensity | 80–110 kWh/m²/yr | 80–150 kWh/m²/yr (lab/academic) |
| Office water use | ~27 L/person/day | 25–45 L/person/day |
| Library overnight standing flow | 7–10 L/h | small standing draw on a closed building |
| Server-room base load (`CSE`) | 26 kW always-on | consistent with a campus data room |

---

## Files

| Path | Contents |
|---|---|
| `ecotwin.db` | SQLite database — all tables (created by `scripts/seed.py`) |
| `exports/*.csv` | Optional flat exports (created by `scripts/export_dataset.py`) |

The database is regenerated from scratch by `python scripts/seed.py` and is not intended to
be edited by hand.

---

## Regenerating

```bash
python scripts/seed.py                 # 90 days, full pipeline, ~25 s
python scripts/seed.py --days 120      # longer history
python scripts/seed.py --keep          # re-run analysis on existing telemetry
python scripts/export_dataset.py       # write CSVs to data/exports/
python scripts/export_dataset.py --building ENGG --resource energy
```

---

## Using your own data

Replace the generator, keep everything else. The contract is the reading tables:

**`energy_readings`** — `building_id`, `ts`, `energy_kwh`, `occupancy`, `occupancy_pct`,
`temperature_c`, `outdoor_temperature_c`, `hvac_runtime_min`, `lighting_runtime_min`

**`water_readings`** — `building_id`, `ts`, `water_liters`, `flow_lph`, `occupancy`,
`occupancy_pct`, `temperature_c`, `outdoor_temperature_c`, `pump_runtime_min`

Populate those two tables at hourly resolution, leave `expected_*` and `fault_code` null,
then run:

```bash
curl -X POST http://127.0.0.1:8000/api/anomalies/detect
```

The pipeline will fit baselines, detect anomalies, diagnose causes and raise costed
recommendations against your data with no code changes. If a building has fewer than 48
intervals the model falls back to an hour-of-week median baseline rather than failing.
