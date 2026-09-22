"""
Automated Test Suite for Raw Telemetry Aggregation & Telemetry Access APIs (Step 9).

Validates:
  1. Physical formulas: Volume is SUMMED, Flow is time-averaged and scaled to L/hour (LPM * 60).
  2. Water level, TDS, and turbidity null-aware arithmetic averaging.
  3. Strict zero vs null preservation (zero flow is 0.0, all-null sensor is None).
  4. Incomplete hour and future hour gating (SKIPPED_CURRENT_HOUR, SKIPPED_FUTURE_HOUR).
  5. Minimum coverage threshold gating (INSUFFICIENT_COVERAGE unless allow_partial=True).
  6. Idempotence: re-running aggregation updates the existing row without duplicate WaterReading entries.
  7. Strict scoping isolation across devices and buildings.
  8. Telemetry Access APIs:
     - GET /api/telemetry/latest
     - GET /api/telemetry/history
     - POST /api/telemetry/aggregate
     - GET /api/telemetry/aggregates
  9. Coexistence with simulator records (source="simulator" vs source="esp32").
"""
import unittest
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import select

from backend.app.config import settings
from backend.app.database import SessionLocal, init_db
from backend.app.main import app
from backend.app.models import Building, RawWaterTelemetry, WaterReading, utcnow
from backend.app.services.telemetry_aggregation import (
    aggregate_completed_hours,
    aggregate_device_hour,
    compute_hour_aggregate,
    floor_to_hour,
    to_utc_naive,
)

VALID_KEY = "dev-secret-key-lib-01"
DEVICE_LIB = "LIB-RISER-01"
DEVICE_LIB_2 = "LIB-ROOF-02"
BUILDING_LIB = 4  # Central Library
BUILDING_ADMIN = 1  # Admin Block


class TestTelemetryAggregation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        with SessionLocal() as db:
            # Ensure test buildings exist
            if not db.get(Building, BUILDING_LIB):
                db.add(
                    Building(
                        id=BUILDING_LIB,
                        code="LIB",
                        name="Central Library",
                        area_sqm=12000.0,
                        floors=4,
                        occupancy_capacity=600,
                    )
                )
            if not db.get(Building, BUILDING_ADMIN):
                db.add(
                    Building(
                        id=BUILDING_ADMIN,
                        code="ADMIN",
                        name="Administration Block",
                        area_sqm=8000.0,
                        floors=3,
                        occupancy_capacity=400,
                    )
                )
            db.commit()

        cls.client = TestClient(app)

    def setUp(self):
        # Clean up test telemetry and water_readings created during tests
        with SessionLocal() as db:
            db.query(RawWaterTelemetry).filter(
                RawWaterTelemetry.device_id.in_([DEVICE_LIB, DEVICE_LIB_2, "TEST-DEV-01", "TEST-DEV-02"])
            ).delete(synchronize_session=False)
            db.commit()

    def test_01_compute_hour_aggregate_formulas(self):
        """Volume is strictly summed, Flow rate is averaged * 60, Level/Quality are averaged."""
        # Create dummy packets:
        # Packet 1: 0.25 L, 10.0 LPM, level 70%, TDS 300, Turbidity 2.0
        # Packet 2: 0.30 L, 20.0 LPM, level 80%, TDS 400, Turbidity 4.0
        # Packet 3: 0.20 L, 15.0 LPM, level 90%, TDS None, Turbidity 6.0
        p1 = RawWaterTelemetry(
            device_id="TEST-DEV-01",
            building_id=BUILDING_LIB,
            interval_seconds=15,
            volume_liters=0.25,
            flow_rate_lpm=10.0,
            water_level_pct=70.0,
            water_level_cm=140.0,
            tds_ppm=300,
            turbidity_ntu=2.0,
            pulse_count=100,
            sensor_errors=["E_FLOW"],
        )
        p2 = RawWaterTelemetry(
            device_id="TEST-DEV-01",
            building_id=BUILDING_LIB,
            interval_seconds=15,
            volume_liters=0.30,
            flow_rate_lpm=20.0,
            water_level_pct=80.0,
            water_level_cm=160.0,
            tds_ppm=400,
            turbidity_ntu=4.0,
            pulse_count=120,
            sensor_errors=[],
        )
        p3 = RawWaterTelemetry(
            device_id="TEST-DEV-01",
            building_id=BUILDING_LIB,
            interval_seconds=15,
            volume_liters=0.20,
            flow_rate_lpm=15.0,
            water_level_pct=90.0,
            water_level_cm=180.0,
            tds_ppm=None,  # missing TDS
            turbidity_ntu=6.0,
            pulse_count=80,
            sensor_errors=["E_TURB"],
        )

        metrics = compute_hour_aggregate([p1, p2, p3], nominal_interval_seconds=15)

        # 1. Volume: 0.25 + 0.30 + 0.20 = 0.75 L (SUM, not average!)
        self.assertAlmostEqual(metrics["water_liters"], 0.75, places=3)

        # 2. Flow rate: mean(10.0, 20.0, 15.0) = 15.0 LPM -> 15.0 * 60 = 900.0 L/hour
        self.assertAlmostEqual(metrics["avg_flow_lpm"], 15.0, places=2)
        self.assertAlmostEqual(metrics["flow_lph"], 900.0, places=2)

        # 3. Water level pct: mean(70, 80, 90) = 80.0%
        self.assertAlmostEqual(metrics["water_level_pct"], 80.0, places=2)
        self.assertAlmostEqual(metrics["min_water_level_pct"], 70.0, places=2)
        self.assertAlmostEqual(metrics["max_water_level_pct"], 90.0, places=2)
        self.assertAlmostEqual(metrics["water_level_cm"], 160.0, places=2)

        # 4. TDS: mean(300, 400) = 350 ppm (packet 3 ignored because None)
        self.assertEqual(metrics["tds_ppm"], 350)

        # 5. Turbidity: mean(2.0, 4.0, 6.0) = 4.0 NTU
        self.assertAlmostEqual(metrics["turbidity_ntu"], 4.0, places=2)

        # 6. Pulse count: 100 + 120 + 80 = 300
        self.assertEqual(metrics["pulse_count"], 300)

        # 7. Unique error codes
        self.assertEqual(metrics["sensor_errors"], ["E_FLOW", "E_TURB"])

    def test_02_zero_flow_vs_null_preservation(self):
        """Zero flow rate (0.0) produces 0.0 flow_lph, and all-null sensors remain None."""
        p1 = RawWaterTelemetry(
            device_id="TEST-DEV-01",
            building_id=BUILDING_LIB,
            interval_seconds=15,
            volume_liters=0.0,
            flow_rate_lpm=0.0,
            water_level_pct=None,
            tds_ppm=None,
            turbidity_ntu=None,
        )
        p2 = RawWaterTelemetry(
            device_id="TEST-DEV-01",
            building_id=BUILDING_LIB,
            interval_seconds=15,
            volume_liters=0.0,
            flow_rate_lpm=0.0,
            water_level_pct=None,
            tds_ppm=None,
            turbidity_ntu=None,
        )

        metrics = compute_hour_aggregate([p1, p2], nominal_interval_seconds=15)

        # Zero is preserved, not converted to None
        self.assertEqual(metrics["water_liters"], 0.0)
        self.assertEqual(metrics["flow_lph"], 0.0)
        self.assertEqual(metrics["avg_flow_lpm"], 0.0)

        # All-null sensors are preserved as None, not converted to 0
        self.assertIsNone(metrics["water_level_pct"])
        self.assertIsNone(metrics["tds_ppm"])
        self.assertIsNone(metrics["turbidity_ntu"])

    def test_03_incomplete_and_future_hour_gating(self):
        """Aggregation rejects future hours and in-progress current hours unless allow_partial=True."""
        now = utcnow()
        current_hour = floor_to_hour(now)
        future_hour = current_hour + timedelta(hours=2)

        with SessionLocal() as db:
            # Future hour
            res_future = aggregate_device_hour(
                db=db,
                building_id=BUILDING_LIB,
                device_id=DEVICE_LIB,
                hour_start=future_hour,
                allow_partial=False,
            )
            self.assertEqual(res_future.status, "SKIPPED_FUTURE_HOUR")
            self.assertFalse(res_future.aggregated)

            # In-progress current hour without allow_partial
            res_current = aggregate_device_hour(
                db=db,
                building_id=BUILDING_LIB,
                device_id=DEVICE_LIB,
                hour_start=current_hour,
                allow_partial=False,
            )
            self.assertEqual(res_current.status, "SKIPPED_CURRENT_HOUR")
            self.assertFalse(res_current.aggregated)

    def test_04_coverage_threshold_gating(self):
        """Hours with coverage < min_coverage_pct are rejected unless allow_partial=True."""
        completed_hour = floor_to_hour(utcnow() - timedelta(hours=3))

        with SessionLocal() as db:
            # Seed only 2 packets (expected 240 for 15s interval -> coverage < 1%)
            for i in range(2):
                db.add(
                    RawWaterTelemetry(
                        device_id="TEST-DEV-01",
                        building_id=BUILDING_LIB,
                        schema_version="1.0",
                        source="esp32",
                        interval_seconds=15,
                        received_at=completed_hour + timedelta(minutes=i * 5),
                        volume_liters=1.5,
                        flow_rate_lpm=6.0,
                    )
                )
            db.commit()

            # Normal run with default 50% coverage requirement
            res = aggregate_device_hour(
                db=db,
                building_id=BUILDING_LIB,
                device_id="TEST-DEV-01",
                hour_start=completed_hour,
                allow_partial=False,
                min_coverage_pct=50.0,
            )
            self.assertEqual(res.status, "INSUFFICIENT_COVERAGE")
            self.assertFalse(res.aggregated)
            self.assertLess(res.coverage_pct, 50.0)

            # Re-run with allow_partial=True
            res_partial = aggregate_device_hour(
                db=db,
                building_id=BUILDING_LIB,
                device_id="TEST-DEV-01",
                hour_start=completed_hour,
                allow_partial=True,
                min_coverage_pct=50.0,
            )
            self.assertEqual(res_partial.status, "SUCCESS")
            self.assertTrue(res_partial.aggregated)
            self.assertAlmostEqual(res_partial.water_liters, 3.0, places=2)

    def test_05_idempotent_upsert_and_source_esp32(self):
        """Aggregation updates existing WaterReading without duplicate rows and marks source='esp32'."""
        target_hour = floor_to_hour(utcnow() - timedelta(hours=4))

        with SessionLocal() as db:
            # Clean any existing reading for this test hour
            db.query(WaterReading).filter(
                WaterReading.building_id == BUILDING_LIB,
                WaterReading.ts == target_hour,
            ).delete()
            db.commit()

            # Seed 10 packets
            for i in range(10):
                db.add(
                    RawWaterTelemetry(
                        device_id=DEVICE_LIB,
                        building_id=BUILDING_LIB,
                        schema_version="1.0",
                        source="esp32",
                        interval_seconds=15,
                        received_at=target_hour + timedelta(minutes=i),
                        volume_liters=1.0,
                        flow_rate_lpm=4.0,
                        water_level_pct=75.0,
                        tds_ppm=320,
                        turbidity_ntu=3.5,
                    )
                )
            db.commit()

            # First run: should be CREATED
            res1 = aggregate_device_hour(
                db=db,
                building_id=BUILDING_LIB,
                device_id=DEVICE_LIB,
                hour_start=target_hour,
                allow_partial=True,
            )
            self.assertEqual(res1.status, "SUCCESS")
            self.assertEqual(res1.action, "CREATED")
            self.assertEqual(res1.water_liters, 10.0)
            self.assertEqual(res1.flow_lph, 240.0)  # 4.0 * 60

            # Verify in DB
            rows = db.query(WaterReading).filter(
                WaterReading.building_id == BUILDING_LIB,
                WaterReading.ts == target_hour,
            ).all()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0].source, "esp32")
            self.assertEqual(rows[0].water_level_pct, 75.0)
            self.assertEqual(rows[0].tds_ppm, 320)
            self.assertEqual(rows[0].turbidity_ntu, 3.5)

            # Second run on the same hour: should be UPDATED (idempotent, no duplicates)
            res2 = aggregate_device_hour(
                db=db,
                building_id=BUILDING_LIB,
                device_id=DEVICE_LIB,
                hour_start=target_hour,
                allow_partial=True,
            )
            self.assertEqual(res2.status, "SUCCESS")
            self.assertEqual(res2.action, "UPDATED")
            self.assertEqual(res2.reading_id, res1.reading_id)

            # Confirm still exactly 1 row
            rows_after = db.query(WaterReading).filter(
                WaterReading.building_id == BUILDING_LIB,
                WaterReading.ts == target_hour,
            ).all()
            self.assertEqual(len(rows_after), 1)

    def test_06_device_and_building_scoping_isolation(self):
        """Packets from different devices or buildings are strictly segregated."""
        test_hour = floor_to_hour(utcnow() - timedelta(hours=5))

        with SessionLocal() as db:
            # Device 1 in Building LIB: 5 packets with 1.0 L each = 5.0 L
            for i in range(5):
                db.add(
                    RawWaterTelemetry(
                        device_id="TEST-DEV-01",
                        building_id=BUILDING_LIB,
                        interval_seconds=15,
                        received_at=test_hour + timedelta(minutes=i),
                        volume_liters=1.0,
                        flow_rate_lpm=4.0,
                    )
                )
            # Device 2 in Building LIB: 3 packets with 2.0 L each = 6.0 L
            for i in range(3):
                db.add(
                    RawWaterTelemetry(
                        device_id="TEST-DEV-02",
                        building_id=BUILDING_LIB,
                        interval_seconds=15,
                        received_at=test_hour + timedelta(minutes=i),
                        volume_liters=2.0,
                        flow_rate_lpm=8.0,
                    )
                )
            # Device 1 in Building ADMIN: 2 packets with 5.0 L each = 10.0 L
            for i in range(2):
                db.add(
                    RawWaterTelemetry(
                        device_id="TEST-DEV-01",
                        building_id=BUILDING_ADMIN,
                        interval_seconds=15,
                        received_at=test_hour + timedelta(minutes=i),
                        volume_liters=5.0,
                        flow_rate_lpm=20.0,
                    )
                )
            db.commit()

            # Aggregate TEST-DEV-01 for BUILDING_LIB
            res_dev1_lib = aggregate_device_hour(
                db=db,
                building_id=BUILDING_LIB,
                device_id="TEST-DEV-01",
                hour_start=test_hour,
                allow_partial=True,
            )
            self.assertEqual(res_dev1_lib.sample_count, 5)
            self.assertEqual(res_dev1_lib.water_liters, 5.0)

            # Aggregate TEST-DEV-02 for BUILDING_LIB
            res_dev2_lib = aggregate_device_hour(
                db=db,
                building_id=BUILDING_LIB,
                device_id="TEST-DEV-02",
                hour_start=test_hour,
                allow_partial=True,
            )
            self.assertEqual(res_dev2_lib.sample_count, 3)
            self.assertEqual(res_dev2_lib.water_liters, 6.0)

            # Aggregate TEST-DEV-01 for BUILDING_ADMIN
            res_dev1_admin = aggregate_device_hour(
                db=db,
                building_id=BUILDING_ADMIN,
                device_id="TEST-DEV-01",
                hour_start=test_hour,
                allow_partial=True,
            )
            self.assertEqual(res_dev1_admin.sample_count, 2)
            self.assertEqual(res_dev1_admin.water_liters, 10.0)

    def test_07_api_get_latest_telemetry(self):
        """GET /api/telemetry/latest returns newest raw packet ordered by received_at DESC."""
        now = utcnow()
        with SessionLocal() as db:
            p_old = RawWaterTelemetry(
                device_id=DEVICE_LIB,
                building_id=BUILDING_LIB,
                interval_seconds=15,
                received_at=now - timedelta(minutes=10),
                water_level_pct=60.0,
                flow_rate_lpm=5.0,
            )
            p_new = RawWaterTelemetry(
                device_id=DEVICE_LIB,
                building_id=BUILDING_LIB,
                interval_seconds=15,
                received_at=now - timedelta(minutes=1),
                water_level_pct=85.0,
                flow_rate_lpm=14.0,
            )
            db.add_all([p_old, p_new])
            db.commit()

        # Query latest for DEVICE_LIB
        resp = self.client.get(
            f"/api/telemetry/latest?building_id={BUILDING_LIB}&device_id={DEVICE_LIB}"
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["device_id"], DEVICE_LIB)
        self.assertEqual(data["water_level_pct"], 85.0)
        self.assertEqual(data["flow_rate_lpm"], 14.0)

        # Query unknown building returns 404
        resp_404 = self.client.get("/api/telemetry/latest?building_id=9999")
        self.assertEqual(resp_404.status_code, 404)

    def test_08_api_get_telemetry_history(self):
        """GET /api/telemetry/history returns bounded time-series sorted newest first."""
        now = utcnow()
        with SessionLocal() as db:
            for i in range(5):
                db.add(
                    RawWaterTelemetry(
                        device_id=DEVICE_LIB,
                        building_id=BUILDING_LIB,
                        interval_seconds=15,
                        received_at=now - timedelta(minutes=i * 2),
                        water_level_pct=70.0 + i,
                        flow_rate_lpm=10.0 + i,
                    )
                )
            db.commit()

        resp = self.client.get(
            f"/api/telemetry/history?building_id={BUILDING_LIB}&device_id={DEVICE_LIB}&limit=3"
        )
        self.assertEqual(resp.status_code, 200)
        items = resp.json()
        self.assertEqual(len(items), 3)
        # Check sorted received_at DESC (newest first)
        dt0 = datetime.fromisoformat(items[0]["received_at"])
        dt1 = datetime.fromisoformat(items[1]["received_at"])
        self.assertGreaterEqual(dt0, dt1)

    def test_09_api_post_aggregate_endpoint(self):
        """POST /api/telemetry/aggregate triggers on-demand aggregation."""
        target_hour = floor_to_hour(utcnow() - timedelta(hours=6))

        with SessionLocal() as db:
            for i in range(4):
                db.add(
                    RawWaterTelemetry(
                        device_id=DEVICE_LIB,
                        building_id=BUILDING_LIB,
                        interval_seconds=15,
                        received_at=target_hour + timedelta(minutes=i * 10),
                        volume_liters=2.5,
                        flow_rate_lpm=10.0,
                        water_level_pct=65.0,
                        tds_ppm=280,
                        turbidity_ntu=1.8,
                    )
                )
            db.commit()

        payload = {
            "building_id": BUILDING_LIB,
            "device_id": DEVICE_LIB,
            "hour_start": target_hour.isoformat(),
            "allow_partial": True,
            "min_coverage_pct": 0.0,
        }

        resp = self.client.post("/api/telemetry/aggregate", json=payload)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "SUCCESS")
        self.assertTrue(data["aggregated"])
        self.assertEqual(data["sample_count"], 4)
        self.assertAlmostEqual(data["water_liters"], 10.0, places=2)
        self.assertAlmostEqual(data["flow_lph"], 600.0, places=2)  # 10.0 LPM * 60
        self.assertEqual(data["tds_ppm"], 280)

    def test_10_api_get_aggregates_provenance_filter(self):
        """GET /api/telemetry/aggregates returns hourly readings and filters by source."""
        now = floor_to_hour(utcnow() - timedelta(hours=10))

        with SessionLocal() as db:
            # Seed 1 simulator record and 1 esp32 record
            db.query(WaterReading).filter(
                WaterReading.building_id == BUILDING_LIB,
                WaterReading.ts.in_([now, now + timedelta(hours=1)]),
            ).delete()

            r_sim = WaterReading(
                building_id=BUILDING_LIB,
                ts=now,
                water_liters=150.0,
                flow_lph=150.0,
                source="simulator",
            )
            r_esp = WaterReading(
                building_id=BUILDING_LIB,
                ts=now + timedelta(hours=1),
                water_liters=200.0,
                flow_lph=200.0,
                source="esp32",
                water_level_pct=82.0,
                tds_ppm=310,
                turbidity_ntu=2.5,
            )
            db.add_all([r_sim, r_esp])
            db.commit()

        # Query all for building
        resp_all = self.client.get(f"/api/telemetry/aggregates?building_id={BUILDING_LIB}&limit=10")
        self.assertEqual(resp_all.status_code, 200)
        all_items = resp_all.json()
        self.assertGreaterEqual(len(all_items), 2)

        # Query only source=esp32
        resp_esp = self.client.get(f"/api/telemetry/aggregates?building_id={BUILDING_LIB}&source=esp32&limit=10")
        self.assertEqual(resp_esp.status_code, 200)
        esp_items = resp_esp.json()
        self.assertTrue(all(item["source"] == "esp32" for item in esp_items))
        self.assertTrue(any(item["water_level_pct"] == 82.0 for item in esp_items))

        # Query only source=simulator
        resp_sim = self.client.get(f"/api/telemetry/aggregates?building_id={BUILDING_LIB}&source=simulator&limit=10")
        self.assertEqual(resp_sim.status_code, 200)
        sim_items = resp_sim.json()
        self.assertTrue(all(item["source"] == "simulator" for item in sim_items))


if __name__ == "__main__":
    unittest.main()
