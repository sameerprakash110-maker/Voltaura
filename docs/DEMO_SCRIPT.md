# VOLTAURA — live demo script

A 3-minute walkthrough for judges, plus the follow-up material for a longer conversation.

---

## Before you start

```bash
# terminal 1
python -m uvicorn app.main:app --reload --app-dir backend --port 8000

# terminal 2
cd frontend && npm run dev
```

Open **http://localhost:3000**. Check the sidebar footer reads **API connected**.

> If anything has been clicked through already, reset with `python scripts/seed.py`.

---

## The 3-minute run

### 0:00 — The claim (20s)

Land on `/` and read the headline aloud:

> **See Waste. Understand Why. Prove the Savings.**

> "Most building analytics tools stop at the first of those three. VOLTAURA does all
> three, and the third one is the hard part. Let me show you the loop."

The 3D campus is already rotating behind you. Click **Launch Digital Twin** or go straight
to `/dashboard`.

### 0:20 — The command centre (30s)

Point at the KPI row, then the pipeline rail underneath it:

> "Seven blocks, 30,240 hourly intervals, five anomalies detected, two interventions
> already verified. That rail is the product loop with live counts at every stage —
> data, monitor, detect, diagnose, recommend, intervene, verify."

Point at the campus chart:

> "Solid fill is metered reality. The dashed line is what the model expected given
> occupancy, weather and the building's own schedule. The gap between them is the waste."

### 0:50 — Jump into a scenario (10s)

Click **Demo** in the top bar → **ESB Block HVAC over-run**.

> "Three scenarios. Each one is a real fault that the detector found on its own — nothing
> here is pre-written."

### 1:00 — The diagnosis (45s)

You are now on `/anomalies/2`. Work down the page.

> "HVAC scheduling inefficiency, 94% confidence. But the confidence isn't the interesting
> part — the evidence is."

Point at the evidence list, **six of six conditions met**:

| Evidence | Value | What it rules out |
|---|---|---|
| Consumption above expected | +121% | — |
| Occupancy during affected hours | 1.8% | it isn't demand |
| HVAC runtime vs same hours on normal days | +148% (52 vs 21 min/h) | — |
| **Lighting runtime vs normal** | **−48%** | **rules out lighting** |
| **Indoor temperature** | **23.2 °C, in band** | **rules out cooling demand** |
| Share outside operating hours | 100% | it's a schedule, not usage |

> "Two of those conditions exist purely to *exclude* competing explanations. This isn't a
> threshold trip — the engine is choosing between seven possible causes and showing you
> why this one won."

Point at the hour-of-day chart:

> "And here's the signature. Normal evenings fall away after 18:00. These don't."

### 1:45 — Apply the intervention (15s)

Scroll to the recommendation.

> "Optimise the HVAC operating schedule. Estimated 1,151 kWh a week — and note it says
> **estimated**, because that's all it is right now."

Click **Apply Intervention**.

> "That didn't just change a status. It closed the underlying fault in the building model.
> From this timestamp on, the plant genuinely behaves differently."

### 2:00 — Verify (45s)

Click **Collect 14 days and verify**. It takes ~30 seconds — talk over it:

> "In a real deployment you'd wait a fortnight for the meters to report. Here the simulator
> generates those hours with the fault gone, and then the identical measurement engine runs.
> It's IPMVP Option C: we fit a baseline on the period *before* the change, then evaluate
> that baseline on the *new* period's own weather and occupancy. That gives an adjusted
> baseline — what the building would have used if we'd done nothing."

When it lands:

> "**Verified. 1,937 kWh a week, 11.9% below the adjusted baseline.** p-value 0.001, so it
> isn't noise. R² 0.995 on the baseline model. ₹856,000 a year, 71 tonnes of CO₂."

Point at the gap between estimate and measurement:

> "We estimated 1,151. We measured 1,937. The estimate is deliberately conservative — it's
> sized only from the hours where the fault was statistically visible."

### 2:45 — The honesty check (15s)

This is the strongest closing move. Go to **Settings** → set **Verification threshold** to
**45%** → **Save changes**. Go to **Verification** → re-run.

> "Same data. Now it says **NOT VERIFIED**, and tells you the shortfall. The system is
> allowed to say an intervention didn't work. That's the difference between measuring and
> asserting."

Reset to defaults.

---

## If you have longer

**The water leak** (`/anomalies` → Lecture Hall Complex)

> "Night flow went from 8.8 to 49.8 litres an hour and never comes back down, even on days
> the building is shut. During the day that leak is 5% of a building drawing 800 L/h — it's
> statistically invisible. We only find it because residuals are z-scored *within each hour
> of day*: at 3 a.m. the normal spread is two litres, so the same leak is a 20-sigma event."

**The digital twin** (`/digital-twin`)

> "Facade tint is status, the lit bands track live occupancy, the ground ring is severity,
> and the beam pulses faster when it's critical. Click any building for its live summary."

**Why runtime is not a model feature** (`/buildings/2` → Runtime tab)

> "The expected-consumption model is trained on occupancy, weather and time — never on
> equipment runtime. If runtime were a feature, an air handler left on all night would just
> raise the prediction and the waste would vanish into the baseline. Keeping it out is what
> makes 'actual vs expected' mean 'wasted vs needed' — and it leaves runtime free to be
> evidence."

**Reports** (`/reports`)

> "Full methodology and the tariff assumptions are printed in the report itself, so the
> numbers can be audited rather than taken on trust. Exports to CSV or JSON."

**The tariff demo** (`/settings`)

> "Change the electricity tariff and every financial figure in the product moves. Nothing
> on the dashboard is a constant."

---

## Likely questions

**"Is the data real?"**
No, and it's documented as synthetic in `data/README.md`. It's generated by a
physics-inspired building simulator — base load plus HVAC, lighting, plug and pump loads
driven by occupancy and weather — and calibrated against published benchmarks: 20–32 W/m²
peak, ~27 L/person/day office water, 7–10 L/h library night flow. Every column is one a real
smart meter also reports, so swapping in live telemetry changes the *source*, not the system.

**"How do you know detection actually works?"**
Five faults were planted. The detector found five, produced exactly one event per fault, and
raised zero false positives across 30,240 intervals. The rule engine got 5/5 causes right.
It never reads the ground-truth table — `scripts/export_dataset.py` dumps both so you can
score it yourself.

**"What's the AI, specifically?"**
Random Forest for expected consumption, Isolation Forest for multivariate anomaly detection,
a deterministic weighted rule engine for diagnosis, and a Welch t-test for verification. An
LLM is optional and only ever rewrites an already-computed finding into prose — it never
decides a cause, a confidence or a number.

**"Why is confidence capped at 94%?"**
Because a rule engine can establish a signature, not a fact about the physical world. It's
also discounted when a competing explanation scores closely and when the sample is small.

**"What would break first in production?"**
Data quality. Real telemetry has dead sensors, clock drift and meter rollover, and the
detection thresholds would need re-tuning on real data. Second is attribution: Option C
assumes one clean intervention per period. Both are written up in the README's Limitations
section.

---

## Reset

```bash
python scripts/seed.py
```

Takes about 25 seconds and restores the exact starting state.
