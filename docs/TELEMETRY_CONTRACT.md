# EcoTwin / Voltaura Telemetry Contract: Water Sensor Node (v1.0)

> **Contract Status:** FROZEN / CANONICAL (Refined)  
> **Target Endpoint:** `POST /api/telemetry/water`  
> **Protocol:** HTTP/1.1 or HTTP/2 over TLS/TCP  
> **Content-Type:** `application/json`  
> **Security:** Header `X-Sensor-Key` (pre-shared node token)

---

## 1. Architectural Role & Boundary

This document defines the canonical JSON telemetry payload transmitted by physical ESP32 water-sensing nodes to the EcoTwin backend.

```text
┌───────────────────────────────────────────────────────────────────────┐
│                           PHYSICAL LAYER                              │
│                                                                       │
│   HC-SR04 (Ultrasonic)     YF-S201 (Flow)      TDS / Turbidity Probes │
│      [Echo/Trigger]        [Pulse Train]           [Analog Volts]     │
│             │                     │                      │            │
│             └──────────────┬──────┴──────────────────────┘            │
│                            ▼                                          │
│                      ESP32 Firmware                                   │
│              (Sampling, Filtering, Pulse ISR)                         │
└────────────────────────────┬──────────────────────────────────────────┘
                             │
                             ▼  HTTP POST /api/telemetry/water
┌───────────────────────────────────────────────────────────────────────┐
│                           ECOTWIN BACKEND                             │
│                                                                       │
│  1. Authentication (`X-Sensor-Key`)                                   │
│  2. Schema & Boundary Validation (Pydantic)                           │
│  3. Raw Buffer Storage (`water_node_readings` table)                  │
│  4. Real-Time Water Quality Classification (Safe / Moderate / Unsafe) │
│  5. Hourly Aggregation Bridge (Rollup into `water_readings` table)    │
│  6. Downstream ML: Isolation Forest + Random Forest + Rule Engine     │
└───────────────────────────────────────────────────────────────────────┘
```

### Separation of Concerns: Hardware vs EcoTwin Backend
1. **The ESP32 is an observer, not an interpreter.**  
   The node measures physical state (pulses, microseconds of flight, millivolts) and transmits calibrated physical engineering units (`L/min`, `cm`, `ppm`, `NTU`).
2. **The ESP32 does NOT classify water quality.**  
   The firmware must not transmit `qualityStatus: "Safe"`. Water quality thresholds depend on building occupancy, potable versus non-potable distribution, and institutional standards. All quality classification is performed centrally by the EcoTwin backend.
3. **The ESP32 does NOT detect leaks.**  
   The firmware must not transmit `leakageDetected: true/false`. A sensor cannot know if a $15\text{ L/min}$ flow is a broken riser pipe or standard cafeteria dishwashing. EcoTwin's rule engine evaluates flow persistence against the building's occupancy schedule and standing night-time baseline.
4. **Physical Hardware Scope:**  
   The physical sensor deployment is strictly limited to:
   - ESP32 microcontroller
   - HC-SR04 ultrasonic level sensor
   - YF-S201 flow sensor
   - Analog TDS probe
   - Analog optical turbidity sensor  
   No external temperature sensors or motor current sensors are included in the initial contract.

---

## 2. Canonical JSON Schemas & Examples

### 2.1 Complete Canonical Packet (Riser Flow + Tank Quality Node)
```json
{
  "schema_version": "1.0",
  "device_id": "LIB-RISER-01",
  "building_id": 4,
  "timestamp": "2026-09-21T12:30:00Z",
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

### 2.2 Minimal Flow-Only Node Packet (Distribution Pipe Node)
Used when a node only carries a `YF-S201` flow meter on a secondary distribution pipe without a tank or quality probes:
```json
{
  "schema_version": "1.0",
  "device_id": "ENGG-RISER-02",
  "building_id": 2,
  "timestamp": "2026-09-21T12:30:00Z",
  "source": "esp32",
  "interval_seconds": 30,
  "water_level_pct": null,
  "water_level_cm": null,
  "flow_rate_lpm": 8.45,
  "volume_liters": 4.225,
  "tds_ppm": null,
  "turbidity_ntu": null,
  "sensor_errors": []
}
```

### 2.3 Sensor Fault / Partial Failure Packet
Demonstrating explicit missing-value handling when the ultrasonic echo times out:
```json
{
  "schema_version": "1.0",
  "device_id": "SC-ROOFTANK-01",
  "building_id": 5,
  "timestamp": "2026-09-21T12:30:00Z",
  "source": "esp32",
  "interval_seconds": 15,
  "water_level_pct": null,
  "water_level_cm": null,
  "flow_rate_lpm": 0.00,
  "volume_liters": 0.000,
  "tds_ppm": 295,
  "turbidity_ntu": 2.8,
  "sensor_errors": ["ULTRASONIC_ECHO_TIMEOUT"]
}
```

---

## 3. Comprehensive Field Specification Table

| Field Name | Type | Unit | Status | Valid Bounds | Physical Sensor / Origin | Description & Role | Example |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `schema_version` | String | - | **Required** | Must be `"1.0"` | Firmware constant | Contract specification version. Prevents silent parser breakages. | `"1.0"` |
| `device_id` | String | - | **Required** | Regex `^[A-Z0-9]+-[A-Z0-9]+-[0-9]{2}$` | Hardware Flash / EEPROM | Stable unique node identifier. | `"LIB-RISER-01"` |
| `building_id` | Integer | - | **Required** | Positive integer | Deployment configuration | Foreign key referencing an existing building in Voltaura's database. | `4` |
| `timestamp` | String / null | ISO-8601 | **Required** | Year $\ge 2024$, UTC (`Z`) | ESP32 RTC / SNTP clock | Time of measurement. Set to `null` if SNTP has not synchronized. | `"2026-09-21T12:30:00Z"` |
| `source` | String | - | **Required** | `"esp32"` or `"simulator"` | Node runtime environment | Provenance flag. Strictly prevents synthetic data masquerading as hardware data. | `"esp32"` |
| `interval_seconds` | Integer | Seconds | **Required** | `5` to `60` | Firmware timer interval | Measurement window duration. Default: **15 seconds** (configurable). | `15` |
| `water_level_pct` | Float / null | % | Optional | `0.0` to `100.0` | Derived from HC-SR04 + tank config | Water depth as a percentage of total usable tank height. | `72.5` |
| `water_level_cm` | Float / null | cm | Optional | `0.0` to `500.0` | Derived from HC-SR04 echo | Current water depth in centimeters (calculated: $H_{\text{tank}} - D_{\text{surface}}$). | `145.0` |
| `flow_rate_lpm` | Float / null | L/min | Optional | `0.0` to `60.0` | YF-S201 pulse rate | Average water flow rate over current reporting interval. | `12.30` |
| `volume_liters` | Float / null | Liters | Optional | `0.0` to `60.0` | YF-S201 pulse count | **Volume measured during current reporting interval.** Not cumulative. | `3.075` |
| `tds_ppm` | Integer / null| ppm | Optional | `0` to `1500` | Analog TDS probe | Total Dissolved Solids in parts per million. | `340` |
| `turbidity_ntu` | Float / null | NTU | Optional | `0.0` to `3000.0` | Analog Turbidity probe | Water cloudiness / suspended solids in Nephelometric Turbidity Units. | `4.1` |
| `sensor_errors` | List[String] | - | **Required** | Known error codes | Node self-diagnostics | List of active hardware error codes (empty array if normal). | `[]` |
| `diagnostics` | Object / null| - | Optional | Valid sub-object | Internal ESP32 registers | Low-level hardware diagnostics for device health and signal monitoring. | *(Nested object)* |

---

## 4. Specific Field Semantics & Rules

### 4.1 Device Identity & Building Mapping
- Every packet must identify a physical node using `device_id`.
- The format follows the project's standard subsystem naming: `<BUILDING_CODE>-<SUBSYSTEM>-<INDEX>`.
- The `building_id` must reference an existing building record in Voltaura's database. The backend dynamically validates this relationship during ingestion (rejecting unknown IDs with HTTP 422).
- Example deployments across current campus buildings:
  - `LIB-RISER-01`: Central Library east distribution riser (target for riser leak detection).
  - `SC-ROOFTANK-01`: Student Center roof storage tank (target for tank overflow/loss monitoring).
  - `ENGG-RISER-02`: Engineering Block distribution branch.

### 4.2 Timestamp & Clock Authority
- All timestamps must be ISO-8601 formatted in UTC with a trailing `Z` (e.g. `YYYY-MM-DDTHH:MM:SSZ`).
- **Clock Authority Hierarchy:**
  1. If the ESP32 has valid SNTP synchronization, it transmits the measurement timestamp.
  2. If the ESP32 has not obtained NTP lock (e.g. RTC returns year < 2024), it **must transmit `"timestamp": null`**.
  3. The EcoTwin backend always records `server_received_at` upon ingestion. If `"timestamp"` is `null`, `server_received_at` becomes the authoritative record timestamp.
- **Idempotency & Out-of-Order Handling:**
  - Duplicate packets with identical `(device_id, timestamp)` within a 60-second window are safely de-duplicated by the database uniqueness constraints.
  - Telemetry packets dated older than 60 minutes behind current server time are accepted into the raw log but flagged as out-of-order so they do not distort real-time aggregations.

### 4.3 Data Source (`source`)
- Permitted values: `"esp32"` or `"simulator"`.
- This field guarantees architectural transparency: EcoTwin's verification and analytics pipelines can explicitly filter on `source == "esp32"` when rendering the judge-facing M&V dashboard, preventing any confusion between synthetic and physical measurements.

### 4.4 Water Level (Ultrasonic Sensor HC-SR04)
- The HC-SR04 measures time-of-flight, returning distance from the sensor face to the water surface:
  $$D_{\text{raw}} = \frac{\Delta t \times v_{\text{sound}}}{2}$$
- The telemetry node calculates:
  $$\text{water\_level\_cm} = H_{\text{tank}} - D_{\text{raw}}$$
  $$\text{water\_level\_pct} = \left(\frac{\text{water\_level\_cm}}{H_{\text{tank}} - D_{\text{deadband}}}\right) \times 100.0$$
- **Strict Percentage Bounds:** Valid range is strictly **`0.0% to 100.0%`**. Values $>100.0\%$ are rejected. If overflow detection is needed later, it must be implemented as backend interpretation/configuration rather than making the percentage exceed 100%.
- **Calibration Rule:** $H_{\text{tank}}$ (tank physical depth) and $D_{\text{deadband}}$ (sensor minimum distance, typical $2\text{ cm} - 15\text{ cm}$) are configuration values stored on the node or backend, **never hardcoded into the telemetry contract schema**.
- **Blind Zone Bounds:** Distance $< 2\text{ cm}$ produces erroneous echo reflections. The node must emit `"water_level_pct": null` and add `"ULTRASONIC_DEADBAND_VIOLATION"` to `sensor_errors`.

### 4.5 Flow Rate & Interval Volume (YF-S201)
- The sensor emits pulses via a Hall-effect sensor on an interrupt pin.
- Default nominal calibration: approximately $450\text{ pulses/Liter}$, or frequency $f = 7.5 \times Q$ ($Q$ in $\text{L/min}$).
- `interval_seconds`: The reporting window (default: **$15\text{ seconds}$**, configurable between $5\text{ s}$ and $60\text{ s}$).
- `flow_rate_lpm`: Average flow rate in $\text{L/min}$ during that interval:
  $$\text{flow\_rate\_lpm} = \frac{\text{pulses}}{K \times (\text{interval\_seconds} / 60)}$$
- `volume_liters`: **Water volume measured strictly during the current reporting interval.** It is **NOT** lifetime cumulative volume.
  $$\text{volume\_liters} = \frac{\text{pulses}}{K} \approx \text{flow\_rate\_lpm} \times \left(\frac{\text{interval\_seconds}}{60}\right)$$
  *Example:* At $\text{flow\_rate\_lpm} = 12.0\text{ L/min}$ over $\text{interval\_seconds} = 15\text{ s}$:
  $$\text{volume\_liters} \approx 12.0 \times \left(\frac{15}{60}\right) = 3.0\text{ L}$$
- The calibration factor $K$ must remain configurable in node firmware flash or via downlink, not fixed permanently in the API parser.

### 4.6 Water Quality: TDS (Total Dissolved Solids)
- Unit: `ppm` (parts per million).
- Valid physical range: `0` to `1500` ppm.
- Values for potable campus water typically range between $100\text{ ppm}$ and $500\text{ ppm}$.
- Values $> 1200\text{ ppm}$ indicate severe mineral contamination or electrode short-circuiting.
- **Critical Clarification:** TDS measures dissolved mineral concentration; it is **NOT a leak detection mechanism**.

### 4.7 Water Quality: Turbidity
- Unit: `NTU` (Nephelometric Turbidity Units).
- Valid physical range: `0.0` to `3000.0` NTU.
- Potable municipal water is typically $< 1.0\text{ NTU}$ (acceptable up to $5.0\text{ NTU}$). Values $> 10.0\text{ NTU}$ indicate silt, rust, or pipe scouring.
- **Critical Clarification:** Turbidity measures water clarity; it is **NOT a leak detection mechanism**.

### 4.8 Diagnostics Block (Optional)
When included, provides hardware health telemetry:
- `pulse_count`: Exact integer count of Hall pulses in this interval (enables the backend to re-verify volume math without rounding error).
- `distance_raw_cm`: Unadjusted ultrasonic distance in centimeters.
- `tds_voltage_mv`: Raw ADC millivolts from TDS circuit (identifies probe oxidation or calibration drift).
- `turbidity_voltage_mv`: Raw ADC millivolts from turbidity optical sensor (identifies LED degradation).
- `rssi_dbm`: WiFi Received Signal Strength Indicator ($-30\text{ dBm}$ = excellent, $<-85\text{ dBm}$ = poor).
- `uptime_seconds`: Node uptime counter since boot (reveals brownouts or watchdog resets).
- `free_heap_bytes`: Free SRAM on the ESP32 (monitors potential memory fragmentation).

---

## 5. Missing Values & Sensor Fault Handling

### Strict Null Convention
* **Never use `0` or `0.0` to represent a missing or uninstalled sensor.**
* Zero is a meaningful, valid measurement:
  - `flow_rate_lpm: 0.0` means water is standing still (valves closed).
  - `water_level_pct: 0.0` means the tank is completely empty.
  - `turbidity_ntu: 0.0` means pure optical clarity.
* An absent sensor, disconnected probe, or read error **MUST BE TRANSMITTED AS `null`**.
* Whenever a primary metric is `null` due to hardware fault, the node must populate `sensor_errors` with the corresponding failure code:
  - `ULTRASONIC_DISCONNECTED`
  - `ULTRASONIC_ECHO_TIMEOUT`
  - `TDS_PROBE_DRY`
  - `TURBIDITY_OUT_OF_BOUNDS`
  - `FLOW_SENSOR_PULSE_ERROR`

---

## 6. Numerical Validation & Rejection Boundaries

The ingestion endpoint must strictly reject or invalidate any payload that violates physical reality:

| Field | Rejection Criteria | Physical Rationale |
| :--- | :--- | :--- |
| `water_level_pct` | $< 0.0$ or $> 100.0$ | Percentages below 0% or above 100% are physically impossible. Overflows are evaluated by backend logic. |
| `water_level_cm` | $< 0.0$ or $> 600.0$ | Negative depth is impossible; standard campus storage tanks do not exceed $6\text{ m}$ height. |
| `flow_rate_lpm` | $< 0.0$ or $> 60.0$ | YF-S201 physical mechanical rotor saturation occurs at $30-40\text{ L/min}$; readings $>60\text{ L/min}$ indicate electrical noise. |
| `volume_liters` | $< 0.0$ or $> (\text{flow\_rate\_lpm} \times \frac{\text{interval}}{60} \times 1.5)$ | Volume cannot be negative and cannot exceed theoretical maximum flow in that time window. |
| `tds_ppm` | $< 0$ or $> 2000$ | Negative PPM is impossible; values $>2000\text{ ppm}$ exceed probe physical limit (indicating pin short). |
| `turbidity_ntu`| $< 0.0$ or $> 3500.0$ | Nephelometric units cannot be negative and sensor saturates at $3000\text{ NTU}$. |
| `interval_seconds` | $< 5$ or $> 60$ | Intervals under 5s flood the network/DB; intervals over 60s degrade live flow tracking. |
| `building_id` | Does not exist in `buildings` DB | Must reference a valid, existing building in Voltaura. Ingestion validates relationship dynamically. |

---

## 7. Backend Rollup & Simulator Alignment

### 7.1 Rollup into Hourly `water_readings`
EcoTwin's existing ML models ([`ml/expected_consumption.py`](file:///C:/Voltaura/ml/expected_consumption.py) and [`ml/anomaly_detection.py`](file:///C:/Voltaura/ml/anomaly_detection.py)) operate on hourly intervals. High-frequency telemetry is ingested as follows:

```text
[ESP32 Node @ 15-second intervals]
       │  (HTTP POST)
       ▼
[Table: water_node_readings] ──────────► [Live Tank/Quality UI & WebSockets]
       │
       ▼  (Periodic Aggregation Service / Rollup Bridge)
[Hourly Rollup for current hour: ts = floor(now, 'hour')]
  • water_liters = sum(volume_liters)
  • flow_lph = mean(flow_rate_lpm) * 60.0
       │
       ▼  (Update / Upsert)
[Table: water_readings (building_id, ts)]
       │
       ▼
[Downstream Pipeline] ──► Expected Regressor ──► Isolation Forest ──► Root Cause
```

### 7.2 Simulator Alignment (Dual-Source Architecture)
The Python simulator in [`ml/simulator.py`](file:///C:/Voltaura/ml/simulator.py) will be adapted in a future step to support an emulation mode:
- When running in hardware emulation, the simulator generates individual packets matching this exact contract with `"source": "simulator"`.
- Both the physical ESP32 and the simulator will post to the exact same ingestion pipeline.

---

## 8. Security & Ingestion Transport

1. **Endpoint:** `POST /api/telemetry/water`
2. **Authentication:**  
   The ESP32 must provide an HTTP header:
   ```http
   X-Sensor-Key: <SECRET_TELEMETRY_TOKEN>
   ```
   Configured in backend environment as `ECOTWIN_TELEMETRY_API_KEY`.
3. **Transport Optimization:**  
   ESP32 firmware will use persistent HTTP connections (`Keep-Alive`) to minimize TLS handshake overhead on constrained microcontrollers.
4. **Failure Recovery:**  
   If the backend returns a 5xx error or is unreachable, the node buffers up to 64 packets in internal SPIFFS / RAM and retries with exponential backoff.
