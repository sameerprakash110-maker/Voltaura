"""Sustainability reporting and export."""
from __future__ import annotations

import csv
import io
import json
from typing import Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Intervention
from ..schemas import ReportResponse, VerificationOut
from ..services import analytics
from .common import building_lookup, verification_payload

router = APIRouter(tags=["reports"])


def _report(db: Session, days: int) -> dict:
    data = analytics.build_report(db, days)
    buildings = building_lookup(db)
    data["verified_interventions"] = [
        VerificationOut(**verification_payload(
            v, buildings, db.get(Intervention, v.intervention_id)))
        for v in data.pop("verified")
    ]
    return data


@router.get("/reports/summary", response_model=ReportResponse)
def report_summary(
    days: int = Query(90, ge=1, le=365),
    db: Session = Depends(get_db),
) -> ReportResponse:
    """Campus sustainability report for the selected period."""
    return ReportResponse(**_report(db, days))


@router.get("/reports/export")
def export_report(
    days: int = Query(90, ge=1, le=365),
    format: Literal["csv", "json"] = Query("csv"),
    db: Session = Depends(get_db),
):
    """Download the report as CSV or JSON."""
    data = _report(db, days)
    stamp = data["generated_at"].strftime("%Y%m%d-%H%M")

    if format == "json":
        payload = json.dumps(data, indent=2, default=str)
        return StreamingResponse(
            io.StringIO(payload),
            media_type="application/json",
            headers={
                "Content-Disposition": f'attachment; filename="ecotwin-report-{stamp}.json"'
            },
        )

    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    totals = data["totals"]
    currency = data["economics"]["currency"]

    writer.writerow(["EcoTwin Sustainability Report"])
    writer.writerow(["Generated", data["generated_at"].strftime("%Y-%m-%d %H:%M")])
    writer.writerow([
        "Period",
        f"{data['period_start']:%Y-%m-%d} to {data['period_end']:%Y-%m-%d}",
    ])
    writer.writerow([])

    writer.writerow(["VERIFIED SAVINGS (measured against an adjusted baseline)"])
    writer.writerow(["Metric", "Value", "Unit"])
    for label, key, unit in [
        ("Energy saved", "energy_saved_per_week", "kWh/week"),
        ("Energy saved", "energy_saved_per_year", "kWh/year"),
        ("Water saved", "water_saved_per_week_kl", "kL/week"),
        ("Water saved", "water_saved_per_year_kl", "kL/year"),
        ("Financial saving", "financial_saving_per_week", f"{currency}/week"),
        ("Financial saving", "financial_saving_per_year", f"{currency}/year"),
        ("CO2 reduction", "co2_reduction_per_week", "kg CO2e/week"),
        ("CO2 reduction", "co2_reduction_per_year_tonnes", "t CO2e/year"),
        ("Anomalies detected", "anomalies_detected", "events"),
        ("Interventions applied", "interventions_applied", "count"),
        ("Interventions verified", "interventions_verified", "count"),
        ("Verification rate", "verification_rate_pct", "%"),
    ]:
        writer.writerow([label, totals.get(key), unit])
    writer.writerow([])

    writer.writerow(["CONSUMPTION BY BUILDING"])
    writer.writerow([
        "Code", "Name", "Area (m2)", "Energy (kWh)", "Water (kL)",
        "Intensity (kWh/m2)", "Anomalies",
        "Verified energy saving (kWh/wk)", "Verified water saving (L/wk)",
    ])
    for b in data["by_building"]:
        writer.writerow([
            b["code"], b["name"], b["area_sqm"], b["energy_kwh"], b["water_kl"],
            b["energy_intensity"], b["anomalies"],
            b["verified_energy_saving_week"], b["verified_water_saving_week"],
        ])
    writer.writerow([])

    writer.writerow(["VERIFIED INTERVENTIONS"])
    writer.writerow([
        "Building", "Intervention", "Resource", "Adjusted baseline",
        "Post-intervention", "Saving", "Unit", "Reduction %", "p-value", "Status",
    ])
    for v in data["verified_interventions"]:
        writer.writerow([
            v.building_name, v.intervention_title, v.resource_type,
            v.adjusted_baseline_value, v.post_value, v.absolute_saving,
            f"{v.unit}/week", v.saving_pct, v.p_value, v.status,
        ])
    writer.writerow([])

    writer.writerow(["ANOMALY BREAKDOWN"])
    writer.writerow(["Severity", "Count"])
    for severity, count in data["anomaly_breakdown"]["by_severity"].items():
        writer.writerow([severity, count])
    writer.writerow([])
    writer.writerow(["Probable cause", "Count"])
    for cause, count in data["anomaly_breakdown"]["by_cause"].items():
        writer.writerow([cause, count])
    writer.writerow([])

    writer.writerow(["METHODOLOGY"])
    writer.writerow(["Stage", "Method"])
    for m in data["methodology"]:
        writer.writerow([m["stage"], m["method"]])
    writer.writerow([])

    writer.writerow(["ASSUMPTIONS"])
    writer.writerow(["Electricity tariff", data["economics"]["electricity_tariff"],
                     f"{currency}/kWh"])
    writer.writerow(["Water tariff", data["economics"]["water_tariff_per_kl"],
                     f"{currency}/kL"])
    writer.writerow(["Grid emission factor", data["economics"]["grid_emission_factor"],
                     "kg CO2e/kWh"])
    writer.writerow(["Water emission factor", data["economics"]["water_emission_factor"],
                     "kg CO2e/kL"])

    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="ecotwin-report-{stamp}.csv"'},
    )
