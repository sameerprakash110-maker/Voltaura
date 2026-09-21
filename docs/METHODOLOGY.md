# EcoTwin methodology

Technical reference for the four analytical stages. The [README](../README.md) gives the
overview; this document explains the reasoning behind each design decision, including the
ones that look unusual.

---

## 0. The single idea

Everything in EcoTwin follows from one distinction:

| | Examples | Role |
|---|---|---|
| **Drivers** | hour, day of week, occupancy, outdoor temperature, published schedule | What the building *cannot choose*. These set what consumption **should** be. |
| **Response** | HVAC runtime, lighting runtime, pump runtime, metered consumption | What the plant *does about it*. These are what we judge. |

The expected-consumption model sees **drivers only**. This is the load-bearing decision in
the whole system:

> If equipment runtime were a model feature, an air handler left running all night would
> simply raise the prediction, the residual would stay near zero, and the waste would
> disappear into the baseline. The model would learn to expect the fault.

Excluding runtime achieves two things at once:

1. `actual − expected` comes to mean **"wasted" rather than "different"**.
2. Runtime stays *uncontaminated* and is therefore available as independent **evidence**
   for the rule engine.

Every later stage depends on this separation.

---

## 1. Expected consumption

**Module:** [`ml/expected_consumption.py`](../ml/expected_consumption.py)
**Estimator:** `RandomForestRegressor` — 220 trees, `max_depth=14`,
`min_samples_leaf=3`, `max_features=0.8`

### Features

| Feature | Type | Why |
|---|---|---|
| `hour_sin`, `hour_cos` | cyclical | 23:00 and 00:00 are adjacent, not 23 units apart |
| `dow` | ordinal | weekday/weekend behaviour differs by more than a flag captures |
| `is_weekend` | binary | strong discrete break |
| `is_offhours` | binary | derived from each building's own published schedule |
| `occupancy_pct` | continuous | primary demand driver |
| `outdoor_temperature_c` | continuous | weather driver |
| `cooling_degrees` | continuous | `max(0, outdoor − 22)`; cooling load is non-linear and one-sided |

A Random Forest was chosen over linear regression because the relationships are genuinely
non-linear and interacting — cooling demand only matters when the building is occupied, and
occupancy only matters during operating hours. A tree ensemble captures those interactions
without hand-specified terms, and it needs no feature scaling.

### The robust re-fit

The training history *contains the faults we are trying to find*. A naive fit partially
learns them as normal.

```
1. fit on everything
2. residuals = y − ŷ
3. z = robust_z_by_hour(residuals)          # median / MAD, per hour of day
4. keep = |z| ≤ 2.6                          # never below 55% of the data
5. re-fit on the retained intervals
6. predict for ALL intervals with the re-fit model
```

This is the same move an energy analyst makes by hand when selecting a "representative"
baseline period, done automatically and without needing to know where the faults are.

**Why per-hour trimming.** A single global MAD is dominated by daytime variance. Applied to
water it trimmed ~25% of a *clean* building's data while barely touching real night-time
faults. Scoring within each hour of day dropped that to 1–15% and improved the fit.

### Fallback

Below 48 usable intervals the forest is skipped in favour of an **hour-of-week median**
baseline. The product still draws an expected curve rather than an empty chart.

### Measured fit (seeded dataset)

| Building | Resource | R² | CV(RMSE) | Trimmed |
|---|---|---|---|---|
| ADMIN | Energy | 0.999 | 2.3% | 10.2% |
| ENGG | Energy | 0.992 | 5.4% | 5.5% |
| CSE | Energy | 0.994 | 4.0% | 15.2% |
| LIB | Water | 0.997 | 4.8% | 12.4% |
| SC | Water | 0.999 | 2.5% | 7.9% |

ASHRAE Guideline 14 accepts CV(RMSE) ≤ 30% for hourly baseline models, so these sit well
inside the standard.

---

## 2. Anomaly detection

**Module:** [`ml/anomaly_detection.py`](../ml/anomaly_detection.py)

### Two detectors must agree

```python
is_anomaly = (
    iforest_flag                       # multivariate, unsupervised
    & (residual_z >= 2.5)              # directional, interpretable
    & (deviation_pct >= 12.0)          # materiality floor
    & (residual > 0)                   # over-consumption only
)
```

**Isolation Forest** (contamination 0.045) sees the full contextual vector: consumption,
occupancy, outdoor temperature, `hour_sin`/`hour_cos`, weekend flag, the baseline residual,
its z-score, and the relevant equipment runtimes. It catches odd *combinations* — high load
in an empty building — that no single threshold expresses.

**Robust residual** is the physical check. It is directional and explainable to a facilities
manager in one sentence.

Why require both: the forest alone flags merely *unusual* hours (a packed Saturday); the
residual alone flags ordinary model noise. The intersection is the interesting set.

### Per-hour residual scaling

This is the detail that makes water leaks findable.

```python
for h in range(24):
    bucket = residuals[hours == h]
    z[hours == h] = (bucket − median(bucket)) / max(1.4826 × MAD(bucket), min_scale)
```

A 41 L/h leak against a library:

| Context | Typical residual spread | Leak as z-score |
|---|---|---|
| Global (all hours) | ~200 L/h | ≈ 0.2σ — **invisible** |
| Hour 03:00 only | ~2 L/h | ≈ 20σ — **unmissable** |

`min_scale` (0.45 kWh / 1.2 L) floors the denominator so a near-degenerate hour bucket
cannot manufacture huge z-scores out of meter quantisation.

### Events, not hours

Raw hourly flags are unusable as a product surface — a three-week leak would be ninety rows.

```
stage 1   merge contiguous flagged intervals        gap ≤ 3h   → runs
stage 2   cluster runs that keep recurring          gap ≤ 72h  → one persistent event
          require                                   ≥ 3 intervals
```

Stage 2 is what turns "flagged every night for three weeks" into **one** anomaly with 68
affected intervals over 16 days. The individual timestamps are retained so the UI can shade
exactly those hours on the chart.

### Severity

From mean deviation, then escalated for persistence — because a modest deviation that never
goes away costs more than one large spike.

| Mean deviation | Base | Escalation |
|---|---|---|
| ≥ 70% | CRITICAL | |
| 40–70% | HIGH | +1 level if persistent and ≥ 40 intervals |
| 22–40% | MEDIUM | |
| < 22% | LOW | at least MEDIUM if ≥ 12 intervals |

### Measured performance

5 planted faults, 5 detected, 5 events, **0 false positives** across 21,600 intervals.

> **On recall.** Interval-level recall against "every hour inside the fault window" is
> intentionally low (13–67%) and that is *correct*. A constant 17 kW parasitic draw is only
> statistically detectable during low-load hours; a 41 L/h leak only at night. The system
> flags where the evidence exists and — importantly — the recommendation engine then sizes
> the saving across the **full fault footprint**, not just the flagged subset.

---

## 3. Root-cause analysis

**Module:** [`ml/root_cause.py`](../ml/root_cause.py)

Deterministic, weighted, and fully inspectable. Given the same telemetry it returns the same
diagnosis every time.

### Context is measured against the building's own normal

The reference set is the **same building's non-flagged intervals, restricted to the same
hours of day** as the event. Comparing 20:00 against 20:00 is the only fair comparison — an
absolute runtime threshold would call every summer afternoon an anomaly.

### The rules discriminate, they do not pattern-match

| Rule | HVAC runtime | Lighting runtime | Occupancy | Decisive evidence |
|---|---|---|---|---|
| RULE-1 HVAC scheduling | **high** ≥+40% | normal <+25% | low <30% | temp inside comfort band |
| RULE-2 Lighting control | normal <+25% | **high** ≥+40% | low <25% | off-hours share ≥50% |
| RULE-3 Water leakage | — | — | low <20% | **night flow ≥2×**, persists while empty |
| RULE-4 Pump operation | — | — | low <25% | **pump runtime ≥+50%**, off-hours |
| RULE-5 Base-load fault | normal | normal | **normal** 0.6–1.4× | **flat 24/7** (hour-spread <0.85) |
| RULE-6 Cooling demand | high | normal | normal | outdoor **above** normal, indoor at top of band |
| RULE-7 Occupancy driven | proportional | proportional | **high** ≥+35% | inside operating hours |

Each rule deliberately contains conditions that **rule out its neighbours** — RULE-1 requires
lighting to be normal, RULE-3 requires pump runtime to be normal. So a diagnosis is a choice
between competing explanations, not a threshold trip.

### Confidence

```
score        = satisfied_weight / total_weight
margin       = score_best − score_runner_up
margin_factor = 0.80 + 0.20 × clip(margin / 0.35, 0, 1)
sample_factor = 0.82 + 0.18 × clip(n_intervals / 24, 0, 1)

confidence   = clip(score × margin_factor × sample_factor, 0, 0.94)
```

Three deliberate properties:

- **Discounted for ambiguity.** A cause that only narrowly beats its alternative is reported
  with lower confidence. The Student Center pump fault scores 0.88 rather than 0.94 precisely
  because "water leakage" is a genuinely plausible competing reading of persistent night flow.
- **Discounted for sample size.** Three anomalous hours support a weaker claim than ninety.
- **Capped below certainty (0.94).** A rule engine can establish a *signature*. It cannot
  establish a fact about the physical world.

### Refusal

Below `ACCEPT_THRESHOLD = 0.50` the engine returns `UNEXPLAINED_DEVIATION`, recommends a
manual site audit, and reports a deliberately conservative recoverable fraction. It never
invents a cause to fill the gap.

### Measured accuracy

5/5 on the seeded dataset, evaluated blind — the engine never reads the `faults` table.

---

## 4. Savings verification

**Module:** [`ml/savings.py`](../ml/savings.py)
**Method:** IPMVP Option C (whole-facility) with routine adjustments

### Why a naive comparison is not evidence

If the fortnight after an intervention is cooler, or falls in a quieter teaching week,
consumption drops for reasons unrelated to the measure. Reporting that as a saving is
simply wrong.

### The procedure

```
1. fit baseline model on the PRE-intervention window      (drivers only)
2. evaluate that model on the POST period's OWN drivers   → adjusted baseline
3. saving = adjusted_baseline − actual_post
4. Welch t-test (one-sided) on hourly values
```

Step 2 is the whole point. The adjusted baseline answers *"what would this building have
consumed in this period had nothing changed?"* — using the weather and occupancy that
actually occurred.

The **unadjusted** difference is reported alongside so the effect of the normalisation is
visible rather than hidden.

### Verdict

| Status | Condition |
|---|---|
| `VERIFIED` | `saving_pct ≥ threshold` **and** `p < α` |
| `INCONCLUSIVE` | clears the threshold but not significance |
| `NOT_VERIFIED` | fails the threshold (including negative savings) |
| `INSUFFICIENT_DATA` | fewer than `min_post_days` of post telemetry |

Both defaults (5% materiality, α = 0.05) are configurable at runtime. Raising the threshold
in **Settings** and re-running flips a verified result to `NOT_VERIFIED` on the same data —
the fastest way to demonstrate that the system measures rather than asserts.

Only a `VERIFIED` saving is annualised. Projecting an unverified or negative result would
misrepresent it.

### Worked example (Engineering Block HVAC)

| | |
|---|---|
| Baseline, measured | 15,735 kWh/week |
| **Adjusted** baseline | 16,233 kWh/week |
| Post-intervention, measured | 14,274 kWh/week |
| **Saving** | **1,959 kWh/week (12.1%)** |
| Unadjusted difference | 9.3% |
| p-value | 0.00094 |
| Baseline model | R² 0.995, CV(RMSE) 3.7% |
| Verdict | **VERIFIED** |

Note the adjusted baseline is *higher* than the raw baseline: the post period was warmer,
so the building would have used more had nothing changed. The naive comparison would have
under-reported the saving by roughly a quarter.

---

## 5. Why applying an intervention changes the plant

**Module:** [`backend/app/services/intervention_service.py`](../backend/app/services/intervention_service.py)

`apply_recommendation()` does two things:

1. Creates the intervention record and moves the anomaly to `ACTIONED`.
2. Calls `simulation.close_fault(building, fault_code, implemented_at)`.

Step 2 is what makes the loop real. Without it, "apply intervention" is a status change and
the verified saving is theatre. With it, every hour of telemetry generated afterwards comes
from a plant that no longer has the fault — so the reduction the M&V engine measures is a
genuine consequence of the user's action.

In a real deployment `close_fault()` becomes a BMS write or a work-order ticket, and
verification is gated on confirmed completion rather than a click. The verification maths
does not change at all.

---

## 6. The optional LLM

**Module:** [`backend/app/services/llm.py`](../backend/app/services/llm.py)

EcoTwin runs the complete loop with no API key. When one is configured, the LLM does exactly
one job: rewrite an already-computed diagnosis into a fluent paragraph.

The constraints that make this safe:

- It receives the **finished** diagnosis as facts and is asked only to phrase it.
- It never decides a cause, a confidence, or any number.
- Every failure mode — no key, bad key, timeout, network error, SDK missing, short response
  — falls back silently to the deterministic narrative.
- Output is tagged `narrative_source = "llm"` and the UI displays which text is being read.

The LLM can improve how a finding reads. It cannot change what the finding is.
