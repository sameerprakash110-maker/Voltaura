"""
Automated Test Suite for IoT Telemetry Ingestion (Step 8).

Validates:
  1. Valid canonical telemetry packet ingestion and database persistence (HTTP 200).
  2. Missing X-Sensor-Key authentication header (HTTP 401).
  3. Invalid X-Sensor-Key authentication header (HTTP 403).
  4. Unknown / non-existent building ID (HTTP 404).
  5. Invalid interval_seconds (<5s or >60s) (HTTP 422).
  6. Non-esp32 source rejection (e.g. 'simulator') (HTTP 422).
  7. Null device timestamp acceptance with backend-generated received_at.
  8. Null diagnostics RSSI acceptance (rssi_dbm: null).
  9. Strict zero vs null preservation (flow_rate_lpm: 0.0 vs null).
 10. Multi-sensor error codes array persistence.
 11. Unauthorized device-to-building mismatch rejection (HTTP 403).
 12. Physical bounds validation (water_level_pct > 100%, negative values) (HTTP 422).
 13. Telemetry query endpoint (GET /api/telemetry).
"""
import unittest
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from backend.app.config import settings
from backend.app.database import SessionLocal, init_db
from backend.app.main import app
from backend.app.models import Building, RawWaterTelemetry

VALID_KEY = "dev-secret-key-lib-01"
VALID_DEVICE = "LIB-RISER-01"
VALID_BUILDING = 4  # Central Library (LIB)


class TestTelemetryIngestion(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Ensure schema is created and buildings exist
        init_db()
        with SessionLocal() as db:
            building = db.get(Building, VALID_BUILDING)
            if not building:
                # Insert building if testing on clean database
                b = Building(
                    id=VALID_BUILDING,
                    code="LIB",
                    name="Central Library",
                    area_sqm=12000.0,
                    floors=4,
                    occupancy_capacity=600,
                )
                db.add(b)
                db.commit()

            admin_building = db.get(Building, 1)
            if not admin_building:
                b1 = Building(
                    id=1,
                    code="ADMIN",
                    name="Administration Block",
                    area_sqm=8000.0,
                    floors=3,
                    occupancy_capacity=400,
                )
                db.add(b1)
                db.commit()

        cls.client = TestClient(app)

    def test_01_valid_packet_ingestion(self):
        """Valid canonical packet with all sensors populated is accepted and stored."""
        payload = {
            "schema_version": "1.0",
            "device_id": VALID_DEVICE,
            "building_id": VALID_BUILDING,
            "timestamp": "2026-09-21T15:00:00Z",
            "source": "esp32",
            "interval_seconds": 15,
            "water_level_pct": 72.5,
            "water_level_cm": 145.0,
            "flow_rate_lpm": 12.30,
            "volume_liters": 3.075,
            "tds_ppm": 340,
            "turbidity_ntu": 4.1,
            "sensor_errors": [],
            "diagnostics": {
                "pulse_count": 1384,
                "distance_raw_cm": 55.0,
                "tds_voltage_mv": 1240,
                "turbidity_voltage_mv": 2850,
                "rssi_dbm": -68,
                "uptime_seconds": 84210,
                "free_heap_bytes": 178240,
            },
        }

        response = self.client.post(
            "/api/telemetry",
            json=payload,
            headers={"X-Sensor-Key": VALID_KEY},
        )
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["message"], "Telemetry accepted")
        self.assertIn("id", data)
        self.assertIn("received_at", data)
        record_id = data["id"]

        # Verify database record
        with SessionLocal() as db:
            record = db.get(RawWaterTelemetry, record_id)
            self.assertIsNotNone(record)
            self.assertEqual(record.device_id, VALID_DEVICE)
            self.assertEqual(record.building_id, VALID_BUILDING)
            self.assertEqual(record.source, "esp32")
            self.assertEqual(record.schema_version, "1.0")
            self.assertEqual(record.interval_seconds, 15)
            self.assertAlmostEqual(record.water_level_pct, 72.5)
            self.assertAlmostEqual(record.water_level_cm, 145.0)
            self.assertAlmostEqual(record.flow_rate_lpm, 12.30)
            self.assertAlmostEqual(record.volume_liters, 3.075)
            self.assertEqual(record.tds_ppm, 340)
            self.assertAlmostEqual(record.turbidity_ntu, 4.1)
            self.assertEqual(record.sensor_errors, [])
            self.assertEqual(record.pulse_count, 1384)
            self.assertAlmostEqual(record.distance_raw_cm, 55.0)
            self.assertEqual(record.tds_voltage_mv, 1240)
            self.assertEqual(record.turbidity_voltage_mv, 2850)
            self.assertEqual(record.rssi_dbm, -68)
            self.assertEqual(record.uptime_seconds, 84210)
            self.assertEqual(record.free_heap_bytes, 178240)
            self.assertIsNotNone(record.received_at)
            self.assertIsNotNone(record.raw_payload)

    def test_02_missing_api_key(self):
        """Missing X-Sensor-Key header returns HTTP 401."""
        payload = {
            "schema_version": "1.0",
            "device_id": VALID_DEVICE,
            "building_id": VALID_BUILDING,
            "source": "esp32",
            "interval_seconds": 15,
        }
        response = self.client.post("/api/telemetry", json=payload)
        self.assertEqual(response.status_code, 401)
        self.assertIn("X-Sensor-Key", response.json()["detail"])

    def test_03_invalid_api_key(self):
        """Unrecognized X-Sensor-Key returns HTTP 403."""
        payload = {
            "schema_version": "1.0",
            "device_id": VALID_DEVICE,
            "building_id": VALID_BUILDING,
            "source": "esp32",
            "interval_seconds": 15,
        }
        response = self.client.post(
            "/api/telemetry",
            json=payload,
            headers={"X-Sensor-Key": "invalid-hacker-key"},
        )
        self.assertEqual(response.status_code, 403)
        self.assertIn("Invalid", response.json()["detail"])

    def test_04_unknown_building(self):
        """Telemetry referencing non-existent building ID returns HTTP 404."""
        # dev-sensor-key-unregistered-building is mapped to GHOST-01 / building 9999
        payload = {
            "schema_version": "1.0",
            "device_id": "GHOST-01",
            "building_id": 9999,
            "source": "esp32",
            "interval_seconds": 15,
        }
        response = self.client.post(
            "/api/telemetry",
            json=payload,
            headers={"X-Sensor-Key": "dev-sensor-key-unregistered-building"},
        )
        self.assertEqual(response.status_code, 404)
        self.assertIn("does not exist", response.json()["detail"])

    def test_05_invalid_interval(self):
        """interval_seconds out of bounds (<5s or >60s) returns HTTP 422."""
        # Case A: interval = 100s
        payload_100 = {
            "schema_version": "1.0",
            "device_id": VALID_DEVICE,
            "building_id": VALID_BUILDING,
            "source": "esp32",
            "interval_seconds": 100,
        }
        resp1 = self.client.post(
            "/api/telemetry",
            json=payload_100,
            headers={"X-Sensor-Key": VALID_KEY},
        )
        self.assertEqual(resp1.status_code, 422)

        # Case B: interval = 2s
        payload_2 = {
            "schema_version": "1.0",
            "device_id": VALID_DEVICE,
            "building_id": VALID_BUILDING,
            "source": "esp32",
            "interval_seconds": 2,
        }
        resp2 = self.client.post(
            "/api/telemetry",
            json=payload_2,
            headers={"X-Sensor-Key": VALID_KEY},
        )
        self.assertEqual(resp2.status_code, 422)

    def test_06_non_esp32_source_rejected(self):
        """source != 'esp32' (e.g. 'simulator') returns HTTP 422."""
        payload = {
            "schema_version": "1.0",
            "device_id": VALID_DEVICE,
            "building_id": VALID_BUILDING,
            "source": "simulator",
            "interval_seconds": 15,
        }
        response = self.client.post(
            "/api/telemetry",
            json=payload,
            headers={"X-Sensor-Key": VALID_KEY},
        )
        self.assertEqual(response.status_code, 422)

    def test_07_null_timestamp_handling(self):
        """null timestamp (pre-NTP) is accepted and backend received_at is populated."""
        payload = {
            "schema_version": "1.0",
            "device_id": VALID_DEVICE,
            "building_id": VALID_BUILDING,
            "timestamp": None,
            "source": "esp32",
            "interval_seconds": 15,
            "water_level_pct": 50.0,
        }
        response = self.client.post(
            "/api/telemetry",
            json=payload,
            headers={"X-Sensor-Key": VALID_KEY},
        )
        self.assertEqual(response.status_code, 200)
        record_id = response.json()["id"]

        with SessionLocal() as db:
            record = db.get(RawWaterTelemetry, record_id)
            self.assertIsNone(record.device_timestamp)
            self.assertIsNotNone(record.received_at)

    def test_08_null_rssi_handling(self):
        """null rssi_dbm (offline/unassociated) is accepted and stored as null."""
        payload = {
            "schema_version": "1.0",
            "device_id": VALID_DEVICE,
            "building_id": VALID_BUILDING,
            "source": "esp32",
            "interval_seconds": 15,
            "diagnostics": {
                "rssi_dbm": None,
                "uptime_seconds": 120,
            },
        }
        response = self.client.post(
            "/api/telemetry",
            json=payload,
            headers={"X-Sensor-Key": VALID_KEY},
        )
        self.assertEqual(response.status_code, 200)
        record_id = response.json()["id"]

        with SessionLocal() as db:
            record = db.get(RawWaterTelemetry, record_id)
            self.assertIsNone(record.rssi_dbm)
            self.assertEqual(record.uptime_seconds, 120)

    def test_09_zero_vs_null_semantics(self):
        """Preserves zero as real measurement (0.0 L/min) and null as unavailable."""
        # Case A: Valid Zero flow (no water running)
        payload_zero = {
            "schema_version": "1.0",
            "device_id": VALID_DEVICE,
            "building_id": VALID_BUILDING,
            "source": "esp32",
            "interval_seconds": 15,
            "flow_rate_lpm": 0.0,
            "volume_liters": 0.0,
            "water_level_pct": 0.0,
        }
        resp_zero = self.client.post(
            "/api/telemetry",
            json=payload_zero,
            headers={"X-Sensor-Key": VALID_KEY},
        )
        self.assertEqual(resp_zero.status_code, 200)
        id_zero = resp_zero.json()["id"]

        with SessionLocal() as db:
            rec_zero = db.get(RawWaterTelemetry, id_zero)
            self.assertEqual(rec_zero.flow_rate_lpm, 0.0)
            self.assertEqual(rec_zero.volume_liters, 0.0)
            self.assertEqual(rec_zero.water_level_pct, 0.0)

        # Case B: Sensor failure / unavailable (null)
        payload_null = {
            "schema_version": "1.0",
            "device_id": VALID_DEVICE,
            "building_id": VALID_BUILDING,
            "source": "esp32",
            "interval_seconds": 15,
            "flow_rate_lpm": None,
            "volume_liters": None,
            "water_level_pct": None,
            "tds_ppm": None,
            "turbidity_ntu": None,
        }
        resp_null = self.client.post(
            "/api/telemetry",
            json=payload_null,
            headers={"X-Sensor-Key": VALID_KEY},
        )
        self.assertEqual(resp_null.status_code, 200)
        id_null = resp_null.json()["id"]

        with SessionLocal() as db:
            rec_null = db.get(RawWaterTelemetry, id_null)
            self.assertIsNone(rec_null.flow_rate_lpm)
            self.assertIsNone(rec_null.volume_liters)
            self.assertIsNone(rec_null.water_level_pct)
            self.assertIsNone(rec_null.tds_ppm)
            self.assertIsNone(rec_null.turbidity_ntu)

    def test_10_sensor_error_persistence(self):
        """Packets with active sensor errors are persisted with error codes preserved."""
        payload = {
            "schema_version": "1.0",
            "device_id": VALID_DEVICE,
            "building_id": VALID_BUILDING,
            "source": "esp32",
            "interval_seconds": 15,
            "water_level_pct": None,
            "sensor_errors": ["ULTRASONIC_TIMEOUT", "TDS_PROBE_DISCONNECTED"],
        }
        response = self.client.post(
            "/api/telemetry",
            json=payload,
            headers={"X-Sensor-Key": VALID_KEY},
        )
        self.assertEqual(response.status_code, 200)
        record_id = response.json()["id"]

        with SessionLocal() as db:
            record = db.get(RawWaterTelemetry, record_id)
            self.assertEqual(
                record.sensor_errors,
                ["ULTRASONIC_TIMEOUT", "TDS_PROBE_DISCONNECTED"],
            )

    def test_11_unauthorized_device_building_mismatch(self):
        """Device authenticated for Building 4 cannot post for Building 1 (HTTP 403)."""
        payload = {
            "schema_version": "1.0",
            "device_id": VALID_DEVICE,  # Authorized for Building 4
            "building_id": 1,          # Building 1 (ADMIN)
            "source": "esp32",
            "interval_seconds": 15,
        }
        response = self.client.post(
            "/api/telemetry",
            json=payload,
            headers={"X-Sensor-Key": VALID_KEY},
        )
        self.assertEqual(response.status_code, 403)
        self.assertIn("not authorized for building 1", response.json()["detail"])

    def test_12_physical_bounds_validation(self):
        """Values outside physical ranges are rejected with HTTP 422."""
        # Level percentage > 100.0%
        bad_pct = {
            "schema_version": "1.0",
            "device_id": VALID_DEVICE,
            "building_id": VALID_BUILDING,
            "source": "esp32",
            "interval_seconds": 15,
            "water_level_pct": 105.0,
        }
        resp1 = self.client.post("/api/telemetry", json=bad_pct, headers={"X-Sensor-Key": VALID_KEY})
        self.assertEqual(resp1.status_code, 422)

        # Negative flow
        bad_flow = {
            "schema_version": "1.0",
            "device_id": VALID_DEVICE,
            "building_id": VALID_BUILDING,
            "source": "esp32",
            "interval_seconds": 15,
            "flow_rate_lpm": -5.0,
        }
        resp2 = self.client.post("/api/telemetry", json=bad_flow, headers={"X-Sensor-Key": VALID_KEY})
        self.assertEqual(resp2.status_code, 422)

    def test_13_water_alias_endpoint(self):
        """Alias POST /api/telemetry/water functions identically."""
        payload = {
            "schema_version": "1.0",
            "device_id": VALID_DEVICE,
            "building_id": VALID_BUILDING,
            "source": "esp32",
            "interval_seconds": 15,
            "water_level_pct": 80.0,
        }
        response = self.client.post(
            "/api/telemetry/water",
            json=payload,
            headers={"X-Sensor-Key": VALID_KEY},
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["success"])

    def test_14_get_telemetry_query(self):
        """GET /api/telemetry returns persisted raw records with filters."""
        response = self.client.get(
            "/api/telemetry",
            params={"building_id": VALID_BUILDING, "limit": 10},
        )
        self.assertEqual(response.status_code, 200)
        items = response.json()
        self.assertIsInstance(items, list)
        self.assertGreater(len(items), 0)
        self.assertEqual(items[0]["building_id"], VALID_BUILDING)


if __name__ == "__main__":
    unittest.main()
