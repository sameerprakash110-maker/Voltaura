#pragma once

#include <Arduino.h>

// Local Wi-Fi credentials inclusion (secrets.h is gitignored; fallback to secrets.example.h template)
#if __has_include("secrets.h")
    #include "secrets.h"
#elif __has_include("secrets.example.h")
    #include "secrets.example.h"
#else
    #ifndef WIFI_SSID
        #define WIFI_SSID "YOUR_WIFI_SSID"
    #endif
    #ifndef WIFI_PASSWORD
        #define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
    #endif
    #ifndef BACKEND_HTTP_URL
        #define BACKEND_HTTP_URL "http://127.0.0.1:8000/api/telemetry"
    #endif
    #ifndef SENSOR_API_KEY
        #define SENSOR_API_KEY "dev-secret-key-lib-01"
    #endif
#endif

// Safety fallbacks in case secrets.h didn't define HTTP fields
#ifndef BACKEND_HTTP_URL
    #define BACKEND_HTTP_URL "http://127.0.0.1:8000/api/telemetry"
#endif
#ifndef SENSOR_API_KEY
    #define SENSOR_API_KEY "dev-secret-key-lib-01"
#endif

/**
 * ============================================================================
 * EcoTwin ESP32 Water Node Configuration
 * ============================================================================
 * 
 * References:
 *   - docs/TELEMETRY_CONTRACT.md (Frozen Telemetry Schema v1.0)
 *   - hardware/esp32/docs/WIRING.md (Provisional Hardware Pinout)
 * 
 * IMPORTANT:
 *   - Do NOT hard-code network credentials or secrets in this file.
 *   - Physical tank dimensions and calibration factors are placeholders
 *     and must be confirmed against the physical installation.
 *   - All GPIO pin assignments are PROVISIONAL and must be validated against
 *     the physical ESP32 board revision before connecting power.
 * ============================================================================
 */

namespace Config {

    // ========================================================================
    // 1. Device Identity & Deployment Metadata
    // ========================================================================
    // Canonical node identifier: <BUILDING_CODE>-<SUBSYSTEM>-<INDEX>
    // Must match a registered node in the deployment plan.
    constexpr const char* DEVICE_ID = "LIB-RISER-01";

    // Target Building ID in the EcoTwin database.
    // 1: ADMIN, 2: ENGG, 3: CSE, 4: LIB, 5: SC
    constexpr int BUILDING_ID = 4;

    // Schema version matching docs/TELEMETRY_CONTRACT.md
    constexpr const char* SCHEMA_VERSION = "1.0";
    constexpr const char* TELEMETRY_SOURCE = "esp32";

    // ========================================================================
    // 2. Reporting & Timing Configuration
    // ========================================================================
    // Telemetry reporting cadence in seconds (Valid bounds: 5 - 60 seconds).
    // Default: 15 seconds. Configurable per node deployment.
    constexpr uint32_t REPORT_INTERVAL_SECONDS = 15;

    // ========================================================================
    // 3. Tank Geometry & Water Level Calibration (HC-SR04)
    // ========================================================================
    // [PLACEHOLDER - REQUIRES CALIBRATION AGAINST ACTUAL PHYSICAL INSTALLATION]
    // Tank reference height: physical distance from sensor transducer face
    // to the effective tank bottom (in centimeters).
    // Default placeholder: 200.0 cm (must be calibrated on-site).
    constexpr float TANK_REFERENCE_HEIGHT_CM = 200.0f;

    // Backward-compatible alias
    constexpr float TANK_HEIGHT_CM = TANK_REFERENCE_HEIGHT_CM;

    // Minimum deadband / blind zone offset from sensor face to maximum fill line (cm).
    // Transducer acoustic ringing prevents accurate measurements below ~10 cm.
    constexpr float TANK_DEADBAND_CM = 10.0f;

    // Usable tank capacity in Liters (placeholder reference).
    constexpr float TANK_CAPACITY_LITERS = 1000.0f;

    // Ultrasonic operational limits & median filtering configuration
    constexpr float ULTRASONIC_MIN_DISTANCE_CM = 2.0f;         // Physical minimum range (~2 cm)
    constexpr float ULTRASONIC_MAX_DISTANCE_CM = 400.0f;       // Physical maximum reliable range (~400 cm)
    constexpr uint8_t ULTRASONIC_SAMPLE_COUNT = 5;             // Samples taken per measurement for median filter
    constexpr unsigned long ULTRASONIC_TIMEOUT_US = 25000;      // pulseIn timeout (~430 cm acoustic travel limit)
    constexpr unsigned long ULTRASONIC_SAMPLE_INTERVAL_MS = 30;// Echo ring-down dissipation delay between pings

    // ========================================================================
    // 4. Provisional GPIO Pin Assignments
    // ========================================================================
    // NOTE: MUST BE CONFIRMED AGAINST PHYSICAL ESP32 BOARD.
    // Refer to hardware/esp32/docs/WIRING.md for electrical rationale.

    // Ultrasonic Sensor (HC-SR04)
    // TRIG: Digital Output from ESP32 (3.3V logic is valid for HC-SR04 trigger).
    constexpr uint8_t PIN_ULTRASONIC_TRIG = 5;

    // ECHO: Digital Input to ESP32.
    // CAUTION: HC-SR04 Echo pin outputs 5.0V!
    // MUST BE LEVEL-SHIFTED to 3.3V before connecting to this pin!
    constexpr uint8_t PIN_ULTRASONIC_ECHO = 18;

    // Water Flow Meter (YF-S201)
    // Digital Input with Hardware Interrupt capability.
    // Evaluates pulse train from internal Hall-effect turbine.
    // PROVISIONAL: GPIO 19. Must be verified against physical board revision.
    constexpr uint8_t PIN_FLOW_PULSE = 19;

    // Analog TDS Sensor
    // Analog Input (ADC1 channel only - ADC2 cannot be used alongside WiFi).
    // GPIO 34 maps to ADC1_CH6 (input-only pin).
    // PROVISIONAL — MUST BE CONFIRMED AGAINST PHYSICAL ESP32 BOARD
    constexpr uint8_t PIN_TDS_ANALOG = 34;

    // Analog Optical Turbidity Sensor
    // Analog Input (ADC1 channel only - ADC2 cannot be used alongside WiFi).
    // GPIO 35 maps to ADC1_CH7 (input-only pin).
    // PROVISIONAL — MUST BE CONFIRMED AGAINST PHYSICAL ESP32 BOARD
    constexpr uint8_t PIN_TURBIDITY_ANALOG = 35;

    // ========================================================================
    // 5. Sensor Calibration Parameters
    // ========================================================================
    // YF-S201 Flow Sensor Calibration:
    // Nominal pulse count per 1.0 Liter of fluid passage.
    // Datasheet formula: Frequency f (Hz) = 7.5 * Q (Q in L/min).
    // Over 60 seconds (1 Liter): Pulses = 7.5 * 60 = 450.0 pulses/Liter.
    // [PLACEHOLDER - REQUIRES ON-RIG BUCKET / GRADUATED CYLINDER CALIBRATION]
    constexpr float YF_S201_PULSES_PER_LITER = 450.0f;
    constexpr float FLOW_PULSES_PER_LITER = YF_S201_PULSES_PER_LITER; // Backward-compatible alias

    // YF-S201 Physical Operational Bounds:
    // Rated operational flow range: 1.0 to 30.0 L/min.
    constexpr float YF_S201_MIN_RATED_FLOW_LPM = 1.0f;
    constexpr float YF_S201_MAX_RATED_FLOW_LPM = 30.0f;
    // Anomaly threshold: pulse rates exceeding 60.0 L/min indicate electrical noise / contact chatter
    // or floating input, violating physical sensor constraints (docs/TELEMETRY_CONTRACT.md).
    constexpr float YF_S201_ANOMALY_FLOW_LPM = 60.0f;

    // ------------------------------------------------------------------------
    // ESP32 ADC Global Settings & Nominal Reference Assumption
    // ------------------------------------------------------------------------
    // ADC resolution: 12-bit (0 - 4095 range)
    constexpr uint8_t ADC_RESOLUTION_BITS = 12;

    // Nominal ESP32 ADC full-scale reference voltage in millivolts with ADC_11db attenuation.
    // [NOMINAL CALIBRATION ASSUMPTION]:
    // 3300 mV (3.3V) is an idealized nominal reference assumption. Uncalibrated ESP32 internal
    // ADCs exhibit chip-to-chip factory Vref variations (typically 1000mV - 1200mV unattenuated,
    // yielding effective attenuated full-scale voltages between ~3100mV and ~3400mV) as well
    // as non-linearities near 0V and saturation near 3.2V.
    // Consequently, all derived voltages (diagnostics.tds_voltage_mv and diagnostics.turbidity_voltage_mv)
    // are ESTIMATED ADC-pin voltages based on this nominal assumption, unless physically calibrated
    // against the actual ESP32 board using eFuse data (esp_adc_cal) or precision multimeter measurements.
    constexpr float NOMINAL_ADC_VREF_MV = 3300.0f;
    constexpr float ADC_VREF_MV = NOMINAL_ADC_VREF_MV; // Backward-compatible alias (nominal assumption)

    // ------------------------------------------------------------------------
    // TDS Sensor Parameters (GPIO 34 / ADC1_CH6)
    // ------------------------------------------------------------------------
    // Number of ADC samples averaged per reading to filter high-frequency noise
    constexpr uint8_t TDS_SAMPLE_COUNT = 10;

    // Voltage divider ratio (V_sensor / V_adc_pin).
    // [PROVISIONAL]: Set to 1.0 if TDS module output connects directly to GPIO 34 (typical 0-2.3V).
    // If an external hardware resistive divider is installed, configure accordingly (e.g. 1.5).
    constexpr float TDS_VOLTAGE_DIVIDER_RATIO = 1.0f;

    // Standard assumed reference water temperature in degrees Celsius.
    // NOTE: Hardware suite does NOT include a physical temperature probe.
    // 25.0 C is the standard laboratory compensation reference.
    constexpr float TDS_REFERENCE_TEMPERATURE_C = 25.0f;

    // Calibration factor: ratio multiplier derived from standard buffer solution (e.g. 1413 uS/cm).
    // [PLACEHOLDER - REQUIRES BUFFER SOLUTION CALIBRATION ON ACTUAL HARDWARE RIG]
    constexpr float TDS_CALIBRATION_FACTOR = 1.0f;

    // Voltage sanity check limits (ADC pin millivolts):
    // Below 20 mV indicates dry / disconnected probe in air.
    constexpr float TDS_MIN_VALID_VOLTAGE_MV = 20.0f;
    // Above 3200 mV indicates probe short-circuit or ADC saturation.
    constexpr float TDS_MAX_VALID_VOLTAGE_MV = 3200.0f;
    // Physical maximum rated TDS PPM per docs/TELEMETRY_CONTRACT.md
    constexpr int TDS_MAX_RATED_PPM = 1500;

    // ------------------------------------------------------------------------
    // Turbidity Sensor Parameters (GPIO 35 / ADC1_CH7)
    // ------------------------------------------------------------------------
    // Number of ADC samples averaged per reading
    constexpr uint8_t TURBIDITY_SAMPLE_COUNT = 10;

    // Voltage divider ratio (V_sensor / V_adc_pin).
    // [PROVISIONAL]: Set to 1.0 if module onboard potentiometer is adjusted to keep output <= 3.0V.
    // If a 1k/2k resistive divider is used to scale a 4.5V output down to 3.0V, set to 1.5f.
    // MUST BE CONFIRMED AGAINST PHYSICAL MODULE VOLTAGE MEASUREMENT.
    constexpr float TURBIDITY_VOLTAGE_DIVIDER_RATIO = 1.0f;

    // Turbidity clear-water baseline in millivolts (at the sensor output).
    // In clean tap water (~0.0 NTU), optical phototransistor voltage is at its maximum.
    // [PLACEHOLDER - REQUIRES ZERO-NTU DISTILLED / TAP WATER CALIBRATION]
    constexpr float TURBIDITY_CLEAR_VOLTAGE_MV = 3000.0f;

    // Provisional conversion slope (NTU per volt drop from clear baseline).
    // Turbidity = (V_clear - V_measured) * slope
    // [PLACEHOLDER - REQUIRES FORMAZIN TURBIDITY STANDARD PHYSICAL CALIBRATION]
    constexpr float TURBIDITY_CALIBRATION_SLOPE = 400.0f;

    // Voltage sanity check limits (ADC pin millivolts):
    // Below 50 mV indicates disconnected sensor or unpowered IR LED.
    constexpr float TURBIDITY_MIN_VALID_VOLTAGE_MV = 50.0f;
    // Above 3250 mV indicates pin saturation or missing voltage divider.
    constexpr float TURBIDITY_MAX_VALID_VOLTAGE_MV = 3250.0f;
    // Maximum physical sensor saturation ceiling per contract
    constexpr float TURBIDITY_MAX_RATED_NTU = 3000.0f;

    // Serial Debug Baud Rate
    constexpr uint32_t SERIAL_BAUD_RATE = 115200;

    // ========================================================================
    // 6. Wi-Fi & Network Configuration
    // ========================================================================
    // Local network credentials sourced securely from secrets.h (gitignored).
    constexpr const char* WIFI_NETWORK_SSID = WIFI_SSID;
    constexpr const char* WIFI_NETWORK_PASSWORD = WIFI_PASSWORD;

    // Bounded startup connection timeout in milliseconds.
    // Device will not hang indefinitely; continues in offline mode if unassociated.
    constexpr uint32_t WIFI_CONNECT_TIMEOUT_MS = 10000; // 10 seconds

    // Periodic non-blocking reconnection retry interval in milliseconds when disconnected.
    constexpr uint32_t WIFI_RECONNECT_INTERVAL_MS = 30000; // 30 seconds

    // Backend Ingestion Endpoint & Authentication
    constexpr const char* BACKEND_URL = BACKEND_HTTP_URL;
    constexpr const char* DEVICE_SENSOR_KEY = SENSOR_API_KEY;
    constexpr uint32_t HTTP_TIMEOUT_MS = 3000; // 3 seconds bounded timeout

    // ========================================================================
    // 7. NTP / SNTP Time Synchronization (Step 10)
    // ========================================================================
    // NTP server pool addresses (Strict UTC synchronization).
    constexpr const char* NTP_SERVER_1 = "pool.ntp.org";
    constexpr const char* NTP_SERVER_2 = "time.google.com";

} // namespace Config
