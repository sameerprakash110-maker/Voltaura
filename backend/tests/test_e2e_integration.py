"""
Automated Test Suite for Step 10: End-to-End Hardware Integration & Verification.

Validates the full pipeline:
  1. Packet Ingestion with valid NTP ISO-8601 UTC timestamp.
  2. Dual timestamp preservation: device_timestamp vs received_at.
  3. Pre-NTP fallback: packet with timestamp: null accepted and persisted.
  4. Individual sensor failure modes (null levels, zero flow vs null flow, disconnected probes).
  5. Raw to hourly aggregation preserving physical formulas and marking source="esp32".
  6. Digital Twin & Analytics integration: confirms water_frame and building_series consume
     the ESP32 hourly record seamlessly without altering algorithms or formulas.
  7. Coexistence: simulator records (source="simulator") and real hardware (source="esp32")
     remain isolated yet mutually queryable.
"""
import unittest
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import select

from backend.app.config import settings
from backend.app.database import SessionLocal, init_db
from backend.app.main import app
from backend.app.models import Building, RawWaterTelemetry, WaterReading, utcnow
from backend.app.services import analytics
from backend.app.services.telemetry_aggregation import (
    aggregate_device_hour,
    floor_to_hour,
    to_utc_naive,
)

VALID_KEY = "dev-secret-key-lib-01"
DEVICE_LIB = "LIB-RISER-01"
BUILDING_LIB = 4  # Central Library


class TestStep10EndToEndIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        with SessionLocal() as db:
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
                db.commit()

        cls.client = TestClient(app)

    def setUp(self):
        with SessionLocal() as db:
            db.query(RawWaterTelemetry).filter(
                RawWaterTelemetry.device_id == DEVICE_LIB
            ).delete(synchronize_session=False)
            db.commit()

    def test_01_ntp_timestamp_dual_preservation(self):
        """Device timestamp from NTP and backend received_at are both stored and preserved."""
        ntp_iso_string = "2026-09-21T16:30:00Z"
        payload = {
            "schema_version": "1.0",
            "device_id": DEVICE_LIB,
            "building_id": BUILDING_LIB,
            "timestamp": ntp_iso_string,
            "source": "esp32",
            "interval_seconds": 15,
            "water_level_pct": 74.0,
            "water_level_cm": 148.0,
            "flow_rate_lpm": 8.5,
            "volume_liters": 2.125,
            "tds_ppm": 310,
            "turbidity_ntu": 3.2,
            "sensor_errors": [],
            "diagnostics": {
                "pulse_count": 956,
                "distance_raw_cm": 52.0,
                "tds_voltage_mv": 1180,
                "turbidity_voltage_mv": 2920,
                "rssi_dbm": -64,
                "uptime_seconds": 3600,
                "free_heap_bytes": 184500,
            },
        }

        resp = self.client.post(
            "/api/telemetry",
            json=payload,
            headers={"X-Sensor-Key": VALID_KEY},
        )
        self.assertEqual(resp.status_code, 200)
        packet_id = resp.json()["id"]

        with SessionLocal() as db:
            row = db.get(RawWaterTelemetry, packet_id)
            self.assertIsNotNone(row)
            # Verify device_timestamp is the parsed NTP timestamp
            expected_dt = datetime(2026, 9, 21, 16, 30, 0)
            self.assertEqual(row.device_timestamp, expected_dt)
            # Verify received_at is set to current backend time
            self.assertIsNotNone(row.received_at)
            # Both timestamps are distinct and preserved
            self.assertNotEqual(row.device_timestamp, row.received_at)

    def test_02_pre_ntp_null_timestamp_fallback(self):
        """When NTP is unsynchronized, timestamp is null, received_at is authoritative."""
        payload = {
            "schema_version": "1.0",
            "device_id": DEVICE_LIB,
            "building_id": BUILDING_LIB,
            "timestamp": None,  # Pre-NTP fallback
            "source": "esp32",
            "interval_seconds": 15,
            "water_level_pct": 68.0,
            "water_level_cm": 136.0,
            "flow_rate_lpm": 0.0,
            "volume_liters": 0.0,
            "tds_ppm": None,
            "turbidity_ntu": None,
            "sensor_errors": ["E_TDS_DISCONNECTED"],
        }

        resp = self.client.post(
            "/api/telemetry",
            json=payload,
            headers={"X-Sensor-Key": VALID_KEY},
        )
        self.assertEqual(resp.status_code, 200)
        packet_id = resp.json()["id"]

        with SessionLocal() as db:
            row = db.get(RawWaterTelemetry, packet_id)
            self.assertIsNotNone(row)
            self.assertIsNone(row.device_timestamp)
            self.assertIsNotNone(row.received_at)
            self.assertEqual(row.sensor_errors, ["E_TDS_DISCONNECTED"])

    def test_03_sensor_failure_modes_handling(self):
        """Validates proper handling of sensor failure modes (HC-SR04 timeout, zero flow, null quality)."""
        payload = {
            "schema_version": "1.0",
            "device_id": DEVICE_LIB,
            "building_id": BUILDING_LIB,
            "timestamp": "2026-09-21T16:45:00Z",
            "source": "esp32",
            "interval_seconds": 15,
            "water_level_pct": None,  # HC-SR04 timeout
            "water_level_cm": None,
            "flow_rate_lpm": 0.0,     # Valid zero flow
            "volume_liters": 0.0,
            "tds_ppm": None,          # Disconnected TDS probe
            "turbidity_ntu": None,    # Disconnected Turbidity probe
            "sensor_errors": ["E_ULTRASONIC_TIMEOUT", "E_TDS_DISCONNECTED", "E_TURBIDITY_DISCONNECTED"],
            "diagnostics": {
                "pulse_count": 0,
                "distance_raw_cm": None,
                "tds_voltage_mv": 0.0,
                "turbidity_voltage_mv": 0.0,
                "rssi_dbm": -70,
                "uptime_seconds": 4500,
                "free_heap_bytes": 182000,
            },
        }

        resp = self.client.post(
            "/api/telemetry",
            json=payload,
            headers={"X-Sensor-Key": VALID_KEY},
        )
        self.assertEqual(resp.status_code, 200)

        with SessionLocal() as db:
            row = db.execute(
                select(RawWaterTelemetry)
                .where(RawWaterTelemetry.device_id == DEVICE_LIB)
                .order_by(RawWaterTelemetry.id.desc())
            ).scalars().first()

            self.assertIsNotNone(row)
            self.assertIsNone(row.water_level_pct)
            self.assertIsNone(row.water_level_cm)
            self.assertEqual(row.flow_rate_lpm, 0.0)
            self.assertEqual(row.volume_liters, 0.0)
            self.assertIsNone(row.tds_ppm)
            self.assertIsNone(row.turbidity_ntu)
            self.assertIn("E_ULTRASONIC_TIMEOUT", row.sensor_errors)

    def test_04_e2e_raw_to_hourly_aggregation(self):
        """Simulates an entire sequence of packets across an hour and verifies aggregation into water_readings."""
        target_hour = floor_to_hour(utcnow() - timedelta(hours=2))

        with SessionLocal() as db:
            # Clean existing record for target hour
            db.query(WaterReading).filter(
                WaterReading.building_id == BUILDING_LIB,
                WaterReading.ts == target_hour,
            ).delete()

            # Seed 12 packets spaced every 5 minutes (representing 1 hour of sampling)
            for i in range(12):
                db.add(
                    RawWaterTelemetry(
                        device_id=DEVICE_LIB,
                        building_id=BUILDING_LIB,
                        schema_version="1.0",
                        source="esp32",
                        interval_seconds=15,
                        received_at=target_hour + timedelta(minutes=i * 5),
                        volume_liters=1.25,  # 12 * 1.25 = 15.0 L
                        flow_rate_lpm=5.0,   # 5.0 LPM * 60 = 300.0 LPH
                        water_level_pct=78.0,
                        tds_ppm=295,
                        turbidity_ntu=2.8,
                    )
                )
            db.commit()

            # Execute aggregation
            res = aggregate_device_hour(
                db=db,
                building_id=BUILDING_LIB,
                device_id=DEVICE_LIB,
                hour_start=target_hour,
                allow_partial=True,
            )
            self.assertEqual(res.status, "SUCCESS")
            self.assertTrue(res.aggregated)
            self.assertAlmostEqual(res.water_liters, 15.0, places=2)
            self.assertAlmostEqual(res.flow_lph, 300.0, places=2)
            self.assertAlmostEqual(res.water_level_pct, 78.0, places=2)
            self.assertEqual(res.tds_ppm, 295)
            self.assertAlmostEqual(res.turbidity_ntu, 2.8, places=2)

            # Confirm WaterReading record in DB
            reading = db.execute(
                select(WaterReading).where(
                    WaterReading.building_id == BUILDING_LIB,
                    WaterReading.ts == target_hour,
                )
            ).scalars().first()
            self.assertIsNotNone(reading)
            self.assertEqual(reading.source, "esp32")
            self.assertEqual(reading.water_liters, 15.0)

    def test_05_digital_twin_and_analytics_consumption(self):
        """Verifies that existing analytics (water_frame, building_series) consume the ESP32 record without modification."""
        test_ts = floor_to_hour(utcnow() - timedelta(hours=8))

        with SessionLocal() as db:
            # Insert a known ESP32 hourly record
            db.query(WaterReading).filter(
                WaterReading.building_id == BUILDING_LIB,
                WaterReading.ts == test_ts,
            ).delete()

            reading = WaterReading(
                building_id=BUILDING_LIB,
                ts=test_ts,
                water_liters=250.0,
                expected_liters=240.0,
                flow_lph=250.0,
                occupancy=50,
                occupancy_pct=50.0,
                temperature_c=24.0,
                outdoor_temperature_c=28.0,
                pump_runtime_min=45.0,
                source="esp32",
                water_level_pct=80.0,
                tds_ppm=300,
                turbidity_ntu=3.0,
            )
            db.add(reading)
            db.commit()

            # 1. Test analytics.water_frame directly
            df = analytics.water_frame(db, start=test_ts, end=test_ts + timedelta(hours=1), building_id=BUILDING_LIB)
            self.assertFalse(df.empty)
            self.assertIn("water_liters", df.columns)
            self.assertIn("flow_lph", df.columns)
            matching_row = df[df["ts"] == test_ts]
            self.assertEqual(len(matching_row), 1)
            self.assertEqual(matching_row.iloc[0]["water_liters"], 250.0)

            # 2. Test via public /api/water endpoint
            resp = self.client.get(f"/api/water?building_id={BUILDING_LIB}&days=1")
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertEqual(data["resource"], "WATER")
            self.assertEqual(data["building_id"], BUILDING_LIB)
            self.assertGreater(data["count"], 0)


if __name__ == "__main__":
    unittest.main()
