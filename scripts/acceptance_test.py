"""
VOLTAURA acceptance test.

Drives the entire product loop over HTTP against a running backend and asserts
every item on the project's acceptance checklist. Exits non-zero on any failure.

    # terminal 1
    python -m uvicorn app.main:app --app-dir backend --port 8000
    # terminal 2
    python scripts/acceptance_test.py

The test mutates the database (it applies a real intervention and fast-forwards
the simulator). It re-seeds at the end so the demo is left in a clean state.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = "http://127.0.0.1:8000"

PASS, FAIL = "PASS", "FAIL"
results: list[tuple[str, str, str]] = []


def call(method: str, path: str, body: dict | None = None, timeout: int = 300):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        BASE + path, data=data, method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode()
            try:
                return response.status, json.loads(raw)
            except json.JSONDecodeError:
                return response.status, raw
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode()[:300]
    except Exception as exc:  # noqa: BLE001
        return 0, str(exc)[:300]


def check(name: str, condition: bool, detail: str = "") -> bool:
    results.append((name, PASS if condition else FAIL, detail))
    marker = "[x]" if condition else "[ ]"
    status = "" if condition else "   <-- FAILED"
    print(f"  {marker} {name:52} {detail}{status}")
    return condition


def section(title: str) -> None:
    print(f"\n{title}\n{'-' * 74}")


def main() -> int:
    parser = argparse.ArgumentParser(description="VOLTAURA acceptance test")
    parser.add_argument("--no-reseed", action="store_true",
                        help="leave the mutated database in place")
    args = parser.parse_args()

    print("=" * 74)
    print("  VOLTAURA - acceptance test")
    print("=" * 74)

    # ---- infrastructure ------------------------------------------------
    section("Infrastructure")
    status, health = call("GET", "/api/health")
    if not check("Backend starts and responds", status == 200,
                 f"HTTP {status}"):
        print("\nBackend unreachable. Start it with:\n"
              "  python -m uvicorn app.main:app --app-dir backend --port 8000")
        return 1

    check("Database initialises", health.get("database") == "connected")
    check("Seed data loads", health.get("seeded") is True,
          f"{health.get('buildings')} buildings")
    check("Energy telemetry present", health.get("energy_readings", 0) >= 14000,
          f"{health.get('energy_readings'):,} intervals")
    check("Water telemetry present", health.get("water_readings", 0) >= 14000,
          f"{health.get('water_readings'):,} intervals")

    # ---- dashboard -----------------------------------------------------
    section("Dashboard")
    status, dash = call("GET", "/api/dashboard?days=30&resource=ALL")
    check("Dashboard returns real backend data", status == 200)
    check("Five KPI cards", len(dash.get("kpis", [])) == 5)
    check("KPIs carry period-over-period change",
          any(k.get("change_pct") is not None for k in dash.get("kpis", [])))
    check("Campus time series populated", len(dash.get("series", [])) > 0,
          f"{len(dash.get('series', []))} points")
    check("Building comparison populated", len(dash.get("buildings", [])) == 7)
    check("Pipeline stages exposed", len(dash.get("pipeline", {}).get("stages", [])) == 7)
    for days in (7, 30, 90):
        status, _ = call("GET", f"/api/dashboard?days={days}")
        check(f"Date range filter: {days} days", status == 200)
    for resource in ("ENERGY", "WATER", "ALL"):
        status, _ = call("GET", f"/api/dashboard?resource={resource}")
        check(f"Resource filter: {resource}", status == 200)

    # ---- digital twin --------------------------------------------------
    section("Digital twin")
    status, buildings = call("GET", "/api/buildings?days=30")
    check("Buildings endpoint powers the twin", status == 200 and len(buildings) == 7,
          f"{len(buildings)} RIT blocks")
    check("Twin geometry present on every building",
          all(b.get("twin_w", 0) > 0 and b.get("twin_h", 0) > 0 for b in buildings))
    check("Buildings carry a status for colouring",
          all(b.get("status") in ("NORMAL", "WARNING", "CRITICAL") for b in buildings))
    check("At least one building flagged",
          any(b["status"] != "NORMAL" for b in buildings),
          f"{sum(1 for b in buildings if b['status'] != 'NORMAL')} flagged")
    status, detail = call("GET", f"/api/buildings/{buildings[0]['id']}?days=30")
    check("Building detail loads", status == 200)
    check("Building detail has resource cards", len(detail.get("subsystems", [])) == 4)
    check("Building detail has both series",
          len(detail.get("energy_series", [])) > 0 and len(detail.get("water_series", [])) > 0)
    status, _ = call("GET", "/api/buildings/99999")
    check("Invalid building id returns 404", status == 404)

    # ---- detection -----------------------------------------------------
    section("Anomaly detection")
    status, anomalies = call("GET", "/api/anomalies")
    check("Anomalies endpoint responds", status == 200)
    check("Anomalies detected", len(anomalies) >= 5, f"{len(anomalies)} events")

    energy_anoms = [a for a in anomalies if a["resource_type"] == "ENERGY"]
    water_anoms = [a for a in anomalies if a["resource_type"] == "WATER"]
    check("Energy anomaly appears", len(energy_anoms) > 0, f"{len(energy_anoms)} events")
    check("Water anomaly appears", len(water_anoms) > 0, f"{len(water_anoms)} events")
    check("Every anomaly has the required fields",
          all(all(a.get(f) is not None for f in
                  ("id", "building_id", "resource_type", "start_ts", "severity",
                   "actual_value", "expected_value", "deviation_pct", "status"))
              for a in anomalies))
    check("Severity uses the defined scale",
          all(a["severity"] in ("LOW", "MEDIUM", "HIGH", "CRITICAL") for a in anomalies))
    check("All anomalies are over-consumption",
          all(a["deviation_pct"] > 0 for a in anomalies))

    # ---- diagnosis -----------------------------------------------------
    section("Root-cause analysis")
    check("Every anomaly is diagnosed",
          all(a.get("cause_code") for a in anomalies))
    check("Every diagnosis carries evidence",
          all(a.get("evidence") for a in anomalies))
    check("Every diagnosis carries a confidence",
          all(0 < (a.get("confidence") or 0) <= 1 for a in anomalies))
    check("Diagnoses name an affected subsystem",
          all(a.get("affected_subsystem") for a in anomalies))

    causes = {a["cause_code"] for a in anomalies}
    check("Distinct causes identified", len(causes) >= 4, ", ".join(sorted(causes))[:80])

    target = next((a for a in anomalies if a["cause_code"] == "HVAC_SCHEDULING_INEFFICIENCY"),
                  anomalies[0])
    status, analysed = call("POST", f"/api/anomalies/{target['id']}/analyze")
    check("AI diagnosis runs on demand", status == 200)
    check("Diagnosis is deterministic",
          analysed["anomaly"]["cause_code"] == target["cause_code"],
          target["cause_code"])
    check("Evidence conditions are individually reported",
          all("satisfied" in e and "criterion" in e
              for e in analysed["anomaly"].get("evidence", [])))
    check("Anomaly detail returns an hour-of-day profile",
          len(analysed.get("hourly_profile", {}).get("hours", [])) == 24)

    # ---- recommendations ------------------------------------------------
    section("Recommendations")
    status, recs = call("GET", "/api/recommendations?status=PENDING")
    check("Recommendations endpoint responds", status == 200)
    check("Recommendations exist", len(recs) > 0, f"{len(recs)} pending")
    check("Every recommendation is costed",
          all(r.get("expected_saving_per_week", 0) > 0
              and r.get("estimated_cost_saving_per_week", 0) > 0
              and r.get("estimated_co2_reduction_per_week", 0) > 0 for r in recs))
    check("Recommendations carry difficulty and priority",
          all(r.get("implementation_difficulty") in ("LOW", "MEDIUM", "HIGH")
              and r.get("priority") in ("LOW", "MEDIUM", "HIGH", "CRITICAL")
              for r in recs))
    check("Recommendations carry supporting evidence",
          all(r.get("evidence") for r in recs))

    chosen = next((r for r in recs if r["anomaly_id"] == target["id"]), recs[0])

    # ---- intervention ---------------------------------------------------
    section("Intervention")
    status, intervention = call("POST", f"/api/recommendations/{chosen['id']}/apply", {})
    check("Intervention can be applied", status == 200, f"#{intervention.get('id')}")
    check("Intervention enters the lifecycle",
          intervention.get("status") in ("PLANNED", "ACTIVE", "MONITORING"))
    check("Intervention records an audit timeline",
          len(intervention.get("timeline", [])) >= 2)

    status, _ = call("POST", f"/api/recommendations/{chosen['id']}/apply", {})
    check("Duplicate apply is rejected", status == 409)

    status, anomaly_after = call("GET", f"/api/anomalies/{target['id']}")
    check("Source anomaly moves to ACTIONED",
          anomaly_after["anomaly"]["status"] == "ACTIONED")

    # ---- verification ----------------------------------------------------
    section("Savings verification")
    status, premature = call("POST", f"/api/verification/{intervention['id']}/run", {})
    check("Verification refuses without enough post data",
          status == 200 and premature.get("status") == "INSUFFICIENT_DATA",
          premature.get("status", ""))

    print("      collecting 14 days of post-intervention telemetry ...")
    status, verified = call(
        "POST", f"/api/interventions/{intervention['id']}/monitor", {"days": 14}
    )
    check("Post-intervention monitoring runs", status == 200)
    check("Verification can be executed", verified.get("status") is not None)
    check("Verified status appears", verified.get("status") == "VERIFIED",
          verified.get("status", ""))
    check("Before/after savings are calculated",
          verified.get("absolute_saving", 0) > 0,
          f"{verified.get('absolute_saving', 0):,.0f} {verified.get('unit')}/wk")
    check("Saving is normalised against an adjusted baseline",
          verified.get("adjusted_baseline_value", 0) > 0)
    check("Result is statistically significant",
          (verified.get("p_value") or 1) < 0.05,
          f"p = {verified.get('p_value'):.2g}" if verified.get("p_value") else "")
    check("Financial saving computed", verified.get("financial_saving_per_year", 0) > 0)
    check("CO2 reduction computed", verified.get("co2_reduction_per_year", 0) > 0)
    check("Before/after chart series present",
          len(verified.get("series", {}).get("baseline", [])) > 0
          and len(verified.get("series", {}).get("post", [])) > 0)
    check("Hour-of-day profile present",
          len(verified.get("hourly_profile", {}).get("baseline", [])) == 24)
    check("Baseline model fit reported",
          verified.get("baseline_model_r2") is not None,
          f"R2 = {verified.get('baseline_model_r2')}")
    check("Explanation is human-readable",
          len(verified.get("explanation", "")) > 80)

    status, iv = call("GET", f"/api/interventions/{intervention['id']}")
    check("Intervention status advances to VERIFIED", iv.get("status") == "VERIFIED")

    # ---- the engine is allowed to say no ---------------------------------
    section("Verification honesty")
    call("PUT", "/api/settings", {"values": {"verification_threshold_pct": 45}})
    status, strict = call("POST", f"/api/verification/{intervention['id']}/run", {})
    check("Raising the threshold flips the same data to NOT_VERIFIED",
          strict.get("status") == "NOT_VERIFIED",
          f"{strict.get('saving_pct', 0):.1f}% vs 45% required")
    call("POST", "/api/settings/reset", {})
    status, restored = call("POST", f"/api/verification/{intervention['id']}/run", {})
    check("Resetting the threshold restores VERIFIED",
          restored.get("status") == "VERIFIED")

    # ---- data integrity ---------------------------------------------------
    section("Data integrity")
    status, buildings_after = call("GET", "/api/buildings?days=30")
    worst = max(abs(b["energy_deviation_pct"]) for b in buildings_after)
    check("Deviations stay plausible after a fast-forward", worst < 50,
          f"max |deviation| = {worst:.1f}%")
    check("Expected consumption is populated campus-wide",
          all(b["energy_expected_kwh"] > 0 for b in buildings_after))

    # ---- reporting ---------------------------------------------------------
    section("Reporting")
    status, report = call("GET", "/api/reports/summary?days=90")
    check("Report endpoint responds", status == 200)
    totals = report.get("totals", {})
    check("Total energy saved reported", totals.get("energy_saved_per_week", 0) > 0)
    check("Total water saved reported", totals.get("water_saved_per_week_kl", 0) > 0)
    check("Financial savings reported", totals.get("financial_saving_per_year", 0) > 0)
    check("CO2 reduction reported", totals.get("co2_reduction_per_year_tonnes", 0) > 0)
    check("Anomaly count reported", totals.get("anomalies_detected", 0) > 0)
    check("Verified intervention count reported",
          totals.get("interventions_verified", 0) > 0)
    check("Methodology documented in the report",
          len(report.get("methodology", [])) == 4)
    for fmt in ("csv", "json"):
        status, _ = call("GET", f"/api/reports/export?days=90&format={fmt}")
        check(f"Report exports as {fmt.upper()}", status == 200)

    # ---- demo mode ----------------------------------------------------------
    section("Demo mode")
    status, demo = call("GET", "/api/demo/scenarios")
    check("Demo scenarios exposed", status == 200 and len(demo.get("scenarios", [])) == 3)
    check("Every scenario resolves to a real detected anomaly",
          all(s.get("anomaly_id") for s in demo.get("scenarios", [])))
    for s in demo.get("scenarios", []):
        check(f"Scenario: {s['title'][:40]}", s.get("available") is True,
              f"stage={s.get('stage')}")

    # ---- settings -----------------------------------------------------------
    section("Settings")
    status, settings_payload = call("GET", "/api/settings")
    check("Settings endpoint responds", status == 200)
    check("Settings expose form metadata",
          len(settings_payload.get("metadata", [])) >= 10)
    check("Configurable tariff present",
          settings_payload["values"].get("electricity_tariff", 0) > 0)
    check("Configurable emission factor present",
          settings_payload["values"].get("grid_emission_factor", 0) > 0)
    check("Configurable verification threshold present",
          settings_payload["values"].get("verification_threshold_pct", 0) > 0)
    check("LLM is optional and reported",
          "llm_enabled" in settings_payload,
          f"enabled={settings_payload.get('llm_enabled')}")

    # ---- error handling ------------------------------------------------------
    section("Error handling")
    for label, method, path, body, expected in [
        ("Unknown building", "GET", "/api/buildings/99999", None, 404),
        ("Unknown anomaly", "GET", "/api/anomalies/99999", None, 404),
        ("Unknown recommendation", "POST", "/api/recommendations/99999/apply", {}, 404),
        ("Unknown intervention", "POST", "/api/verification/99999/run", {}, 404),
        ("Unknown demo scenario", "GET", "/api/demo/scenarios/nope", None, 404),
        ("Invalid intervention status", "PATCH",
         "/api/interventions/1/status?status=BOGUS", None, 422),
        ("Incomplete intervention payload", "POST", "/api/interventions",
         {"description": "x"}, 422),
    ]:
        status, _ = call(method, path, body)
        check(f"{label} -> HTTP {expected}", status == expected, f"got {status}")

    # ---- summary --------------------------------------------------------------
    passed = sum(1 for _, r, _ in results if r == PASS)
    failed = [n for n, r, _ in results if r == FAIL]

    print("\n" + "=" * 74)
    print(f"  {passed}/{len(results)} checks passed")
    if failed:
        print(f"  {len(failed)} FAILED:")
        for name in failed:
            print(f"    - {name}")
    print("=" * 74)

    if not args.no_reseed:
        print("\nRestoring the clean demo state ...")
        subprocess.run([sys.executable, str(ROOT / "scripts" / "seed.py")],
                       capture_output=True, check=False)
        print("Done. Re-start or refresh the app to pick it up.")

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
