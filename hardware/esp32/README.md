# EcoTwin ESP32 Water Node Firmware

## 1. Purpose of the Firmware

The EcoTwin ESP32 Water Node firmware provides edge telemetry acquisition for water monitoring across campus facilities. It samples physical water sensors, applies calibration conversions and multisample filtering, formats the measurements into the canonical JSON structure defined in [`docs/TELEMETRY_CONTRACT.md`](file:///C:/Voltaura/docs/TELEMETRY_CONTRACT.md), and will eventually transmit the packets to the EcoTwin backend over Wi-Fi via HTTP POST.

This firmware project is developed and maintained as an **Arduino IDE sketch**.

---

## 2. Supported Physical Hardware

The firmware is designed strictly for the following approved sensor suite:

| Sensor Type | Model / Part | Measured Metric | Native Output |
| :--- | :--- | :--- | :--- |
| **Microcontroller** | ESP32 Dev Board (e.g., WROOM-32) | Core compute, timing, telemetry packaging | 3.3V Logic |
| **Water Level** | HC-SR04 Ultrasonic Sensor | Tank depth (cm) and usable level (%) | 5V Echo pulse width |
| **Water Flow** | YF-S201 Turbine Flow Meter | Flow rate (L/min) and interval volume (L) | Hall-effect pulse frequency |
| **Purity** | Analog TDS Probe | Total Dissolved Solids (ppm) | Analog voltage (0–2.3V typ.) |
| **Clarity** | Analog Optical Turbidity Sensor | Turbidity / suspended solids (NTU) | Analog voltage (0–4.5V typ.) |

> **Hardware Boundary:** No temperature sensors, current transformers, or battery monitors are included in the baseline hardware suite.

---

## 3. Firmware Architecture & Data Flow

```text
ESP32
  ↓
Sensors (HC-SR04, YF-S201, TDS, Turbidity)
  ↓
Sensor abstraction (UltrasonicSensor, FlowMeter, TDSSensor, TurbiditySensor)
  ↓
Telemetry object (Telemetry::TelemetryPacket)
  ↓
Validation (Local physical bounds check, error flags)
  ↓
[Future Step] Wi-Fi (WPA2 Station connection, SNTP time sync)
  ↓
[Future Step] EcoTwin HTTP ingestion (POST /api/telemetry/water)
```

---

## 4. Project Structure (Arduino IDE)

```text
hardware/esp32/
├── README.md                   # Firmware architecture, status, and Arduino IDE instructions
├── esp32_water_node.ino        # Main Arduino sketch: setup(), loop(), non-blocking timer
├── config.h                    # Hardware pin definitions, tank geometry, calibration constants
├── secrets.example.h           # Safe credential template (copy to gitignored secrets.h)
├── secrets.h                   # Local Wi-Fi & backend credentials (gitignored, never committed)
├── telemetry.h                 # C++ telemetry struct declarations matching contract
├── telemetry.cpp               # Telemetry packet reset and canonical JSON serialization
├── network/
│   ├── wifi_manager.h          # WiFiManager class interface (bounded timeout, non-blocking reconnect)
│   ├── wifi_manager.cpp        # Wi-Fi station connectivity, RSSI acquisition, credential safety
│   ├── http_client.h           # TelemetryHttpClient interface (bounded timeout, X-Sensor-Key auth)
│   └── http_client.cpp         # HTTPClient transmission, status code handling, offline safety
├── sensors/
│   ├── ultrasonic.h            # HC-SR04 level sensor class interface
│   ├── ultrasonic.cpp          # Pulse timing and depth conversion
│   ├── flow_meter.h            # YF-S201 interrupt flow meter class interface
│   ├── flow_meter.cpp          # Critical-section ISR and interval volume calculation
│   ├── tds_sensor.h            # Analog TDS sensor class interface
│   ├── tds_sensor.cpp          # ADC multisampling and polynomial conversion
│   ├── turbidity_sensor.h      # Optical turbidity sensor class interface
│   └── turbidity_sensor.cpp    # ADC multisampling and optical clarity conversion
├── diagnostics/
│   ├── diagnostics.h           # DiagnosticsCollector class interface
│   └── diagnostics.cpp         # System heap, uptime, RSSI, and raw signal telemetry collection
└── docs/
    └── WIRING.md               # Electrical pinout, logic level warnings, level-shifter schematics
```

---

## 5. Arduino IDE Setup & Compilation Instructions

To open, configure, and compile this firmware in the Arduino IDE:

### Step A: Open the Sketch
1. Launch **Arduino IDE** (v1.8.19 or v2.x).
2. Open [`hardware/esp32/esp32_water_node.ino`](file:///C:/Voltaura/hardware/esp32/esp32_water_node.ino).  
   *(Note: Arduino IDE requires the sketch file to be in a folder with matching name. If your Arduino IDE prompts: `"The file needs to be inside a sketch folder named esp32_water_node. Create folder and move?"`, click **OK**, or rename/symlink the folder `hardware/esp32` to `hardware/esp32_water_node` per your local environment convention).*

### Step B: Configure Local Wi-Fi & Backend Credentials
1. In the `hardware/esp32/` directory, copy `secrets.example.h` to create `secrets.h`:
   ```bash
   cp hardware/esp32/secrets.example.h hardware/esp32/secrets.h
   ```
2. Edit `hardware/esp32/secrets.h` and configure your local Wi-Fi and EcoTwin backend settings:
   ```cpp
   #define WIFI_SSID "YourActualNetworkSSID"
   #define WIFI_PASSWORD "YourActualSecretPassword"
   #define BACKEND_HTTP_URL "http://192.168.1.100:8000/api/telemetry"
   #define SENSOR_API_KEY "dev-secret-key-lib-01"
   ```
3. **Security Note:** `secrets.h` is explicitly ignored by `.gitignore` and will never be committed to Git. Passwords and sensor keys are never logged to Serial.
4. **Offline Mode:** If `secrets.h` is omitted or contains default placeholder strings, the firmware automatically falls back to offline mode and continues executing all sensor measurements normally.

### Step C: Select the ESP32 Board
1. In Arduino IDE, navigate to **Tools → Board → esp32**.
2. Select the specific ESP32 board model matching your physical hardware (e.g., **ESP32 Dev Module**, **DOIT ESP32 DEVKIT V1**, or **NodeMCU-32S**). Do not guess; check the silk-screen labeling on your physical board.
3. If the `esp32` board package is not installed:
   - Go to **File → Preferences → Additional Boards Manager URLs**.
   - Add: `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
   - Open **Tools → Board → Boards Manager**, search for `esp32` by Espressif Systems, and click **Install**.

### Step D: Select the Port
1. Connect the ESP32 to your computer via micro-USB or USB-C.
2. Under **Tools → Port**, select the active serial COM port (e.g., `COM3`, `COM4`, `/dev/ttyUSB0`).

### Step E: Install Required Arduino Libraries
The firmware uses `ArduinoJson` for standards-compliant telemetry JSON serialization:
1. In Arduino IDE, open **Tools → Manage Libraries...** (or `Ctrl+Shift+I` / `Cmd+Shift+I`).
2. Search for: **ArduinoJson** (by *Benoit Blanchon*).
3. Select version **7.x** (or **6.x**) and click **Install**.

### Step F: Compile & Verify
1. Click the **Verify** checkmark button (or press `Ctrl+R`) to compile the sketch.
2. Click **Upload** (`Ctrl+U`) to flash the firmware onto the connected board.
3. Open **Tools → Serial Monitor** and set baud rate to **115200 baud** to view real-time diagnostic telemetry packets, Wi-Fi status, and HTTP ingestion logs.

---

## 6. HTTP Ingestion API Specification (Step 8)

### Ingestion Endpoints
- `POST /api/telemetry`
- `POST /api/telemetry/water` (alias)

### Authentication Header
- `X-Sensor-Key: <secret>` (Device-specific secret; verified against backend registry).

### Example Ingestion Request
```http
POST /api/telemetry HTTP/1.1
Host: 192.168.1.100:8000
Content-Type: application/json
X-Sensor-Key: dev-secret-key-lib-01

{
  "schema_version": "1.0",
  "device_id": "LIB-RISER-01",
  "building_id": 4,
  "timestamp": null,
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
    "free_heap_bytes": 178240
  }
}
```

### Successful Response (HTTP 200 OK)
```json
{
  "success": true,
  "message": "Telemetry accepted",
  "id": 1,
  "received_at": "2026-09-21T22:14:36.123456"
}
```

### Error Responses
- **401 Unauthorized:** Missing `X-Sensor-Key` header.
- **403 Forbidden:** Invalid sensor key, key not authorized for device, or device not authorized for building.
- **404 Not Found:** Building ID does not exist in the database.
- **422 Unprocessable Entity:** Payload violates contract constraints (e.g. interval outside 5–60s, level > 100%, negative flow, or source != "esp32").
- **500 Internal Server Error:** Database persistence error.

### Storage Isolation
Ingested packets are persisted directly to the dedicated **`raw_water_telemetry`** table. They are **not** written to the hourly `water_readings` table, preventing pollution of the existing ML / anomaly detection baseline pipeline.

---

## 7. Current Implementation Status (Step 8 Complete)

- [x] Converted to modular Arduino IDE sketch structure.
- [x] Configuration placeholders and provisional GPIO mappings established.
- [x] Clean, modular C++ sensor abstraction classes defined for all 4 physical sensors.
- [x] HC-SR04 ultrasonic driver implemented (10us trigger, 58.0 us/cm acoustic velocity math, timeout protection).
- [x] Multi-sample median noise filter implemented (5 samples, 30ms echo dissipation delay).
- [x] Distance-to-water-height and percentage calculation with physical clamping [0.0% - 100.0%].
- [x] YF-S201 Hall-effect flow meter driver implemented with hardware interrupt on FALLING edge.
- [x] Atomic snapshot / reset using FreeRTOS spinlock (`portMUX_TYPE`) preventing race conditions.
- [x] Dynamic interval flow rate (L/min) and interval volume (Liters) calculation from wall-clock elapsed seconds.
- [x] Physical sanity checks implemented (normal zero-flow handling, over-range warning, anomaly pulse error flag).
- [x] Analog TDS driver implemented (GPIO 34 / ADC1_CH6, 12-bit ADC, multisampling average, 25°C ref compensation, cubic polynomial).
- [x] Analog Turbidity driver implemented (GPIO 35 / ADC1_CH7, 12-bit ADC, multisampling average, optical transmission clear baseline conversion).
- [x] Voltage divider ratio configuration and electrical over-voltage protection limits.
- [x] Diagnostics collector integration with interval pulse count and estimated ADC-pin millivolts (`tds_voltage_mv`, `turbidity_voltage_mv`) under nominal Vref assumption.
- [x] Canonical telemetry packet integration: 10-step lifecycle, stale-value prevention, multi-sensor error aggregation, and duplicate error suppression (`addError`).
- [x] Strict null vs. valid zero serialization compliant with [`docs/TELEMETRY_CONTRACT.md`](file:///C:/Voltaura/docs/TELEMETRY_CONTRACT.md).
- [x] Electrical wiring documentation and 5V level-shifting guidelines created in [`docs/WIRING.md`](file:///C:/Voltaura/hardware/esp32/docs/WIRING.md).
- [x] Wi-Fi station connectivity and RSSI diagnostics integration (`WiFiManager`, Step 7).
- [x] Non-blocking state machine with periodic reconnection via `millis()` (never hangs main loop).
- [x] Offline-first architecture: bounded boot timeout (10s), continuous sensor acquisition even when offline.
- [x] Credential isolation: `secrets.example.h` template, gitignored `secrets.h`, no credentials logged to Serial.
- [x] Dedicated raw telemetry table (`raw_water_telemetry`) with normalized fields and verbatim JSON storage (Step 8).
- [x] Backend HTTP ingestion endpoints (`POST /api/telemetry`, `POST /api/telemetry/water`) with device authentication and building authorization (Step 8).
- [x] ESP32 HTTP POST client (`TelemetryHttpClient`) with bounded 3000ms timeout and offline safety (Step 8).
- [x] Hourly aggregation pipeline into `water_readings` with physical formulas and idempotency (Step 9).
- [x] Telemetry access APIs (`GET /api/telemetry/latest`, `GET /api/telemetry/history`, `POST /api/telemetry/aggregate`, `GET /api/telemetry/aggregates`) (Step 9).
- [x] Non-blocking SNTP Strict UTC time synchronization with ISO-8601 formatting (`NtpClient`, Step 10).
- [x] Verified Root-CA HTTPS support with strict certificate check (no insecure bypasses) (Step 10).
- [x] 29/29 automated test suite passing across [`backend/tests/test_telemetry.py`](file:///C:/Voltaura/backend/tests/test_telemetry.py), [`backend/tests/test_aggregation.py`](file:///C:/Voltaura/backend/tests/test_aggregation.py), and [`backend/tests/test_e2e_integration.py`](file:///C:/Voltaura/backend/tests/test_e2e_integration.py).

---

## 8. Raw Telemetry Aggregation & Access APIs (Step 9)

### Architecture & Pipeline
```text
ESP32 Node (15s cadence)
  ↓ HTTP POST
raw_water_telemetry (Immutable raw storage)
  ↓ Aggregation Service (`backend/app/services/telemetry_aggregation.py`)
hourly water_readings (Canonical table: source='esp32')
  ↓
Existing EcoTwin ML / Anomaly Detection Pipeline (Zero breaking changes)
```

### Physical Aggregation Formulas
| Metric | Aggregation Method | Rationale |
| :--- | :--- | :--- |
| **Water Volume** (`water_liters`) | $\sum \text{volume\_liters}$ | Volume is an extensive physical quantity. Sum of 15s interval volumes gives exact cumulative hourly consumption. |
| **Flow Rate** (`flow_lph`) | $\overline{\text{flow\_rate\_lpm}} \times 60$ | Flow rate is an intensive rate. Time-weighted average in L/min scaled to Liters/hour. |
| **Water Level** (`water_level_pct`) | $\overline{\text{water\_level\_pct}}$ | Null-aware arithmetic mean over valid samples in the hour. |
| **Purity** (`tds_ppm`) | $\overline{\text{tds\_ppm}}$ | Null-aware arithmetic mean of valid TDS readings. |
| **Clarity** (`turbidity_ntu`) | $\overline{\text{turbidity\_ntu}}$ | Null-aware arithmetic mean of valid optical turbidity readings. |

### Incomplete Hour & Coverage Safety
- **Current / Future Hour Gating:** Aggregation rejects in-progress or future hours (`SKIPPED_CURRENT_HOUR`, `SKIPPED_FUTURE_HOUR`) unless explicitly overridden with `allow_partial=true`.
- **Minimum Coverage Threshold:** Enforces $\ge 50\%$ data availability (e.g. 120 samples for 15s cadence) before promoting to `water_readings` to prevent biased baselines (`INSUFFICIENT_COVERAGE`).
- **Idempotence:** Re-running aggregation on a completed hour updates the existing `(building_id, ts)` record (`UPDATED`) without duplicate rows.

### Telemetry Access Endpoints
- `GET /api/telemetry/latest?building_id=4&device_id=LIB-RISER-01`: Retrieves newest raw edge packet ordered by `received_at DESC`.
- `GET /api/telemetry/history?building_id=4&start=...&end=...&limit=100`: Bounded time-series raw packet history.
- `POST /api/telemetry/aggregate`: On-demand or worker-triggered hourly aggregation for a specific device and building window.
- `GET /api/telemetry/aggregates?building_id=4&source=esp32`: Queries hourly aggregated water readings with provenance filtering.

---

## 9. Hardware Assumptions Requiring Physical Verification

1. **HC-SR04 Echo Level Shifting:** The Echo output is a $5.0\text{V}$ pulse. It **must not** be connected directly to ESP32 `GPIO 18` without a $1\text{k}\Omega / 2\text{k}\Omega$ resistive voltage divider or active level shifter.
2. **YF-S201 Output Voltage:** Confirm whether the specific flow meter module in hand pulls up to $5\text{V}$ or operates as an open collector.
3. **Turbidity Module Clear Voltage:** The analog output voltage of the turbidity module in clean tap water must be measured. If it exceeds $3.3\text{V}$, an input divider is required to protect `GPIO 35`.
4. **Nominal ADC Reference Voltage (`ADC_VREF_MV = 3300.0f`):** `3300 mV` is a nominal calibration assumption. Because uncalibrated ESP32 ADCs have chip-to-chip variations and non-linearities, `diagnostics.tds_voltage_mv` and `diagnostics.turbidity_voltage_mv` are **estimated ADC-pin voltages** based on this nominal reference, unless calibrated against the physical ESP32 board using `esp_adc_cal` / multimeter measurement.
5. **ADC1 vs Wi-Fi Coexistence:** The ESP32's Wi-Fi subsystem uses the internal radio ADC (ADC2), which prevents analog reads on ADC2 pins while Wi-Fi is active. In this firmware, both analog sensors are strictly allocated to **ADC1** (TDS on `GPIO 34` / ADC1_CH6, Turbidity on `GPIO 35` / ADC1_CH7), ensuring that Wi-Fi operation does not interfere with analog water quality sampling.
6. **2.4 GHz Network Compatibility:** The ESP32 hardware transceiver only supports 2.4 GHz 802.11 b/g/n networks. Ensure the deployment campus access point broadcasts a 2.4 GHz SSID.
7. **Physical Tank Geometry:** $H_{\text{tank}}$ (tank depth) and sensor blind zone offset ($D_{\text{deadband}}$) in `config.h` must be updated with the physical installation measurements before deploying in an actual storage tank.
