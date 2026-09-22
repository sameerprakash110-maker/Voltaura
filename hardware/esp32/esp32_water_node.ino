#include <Arduino.h>

#include "config.h"
#include "telemetry.h"
#include "sensors/ultrasonic.h"
#include "sensors/flow_meter.h"
#include "sensors/tds_sensor.h"
#include "sensors/turbidity_sensor.h"
#include "diagnostics/diagnostics.h"
#include "network/wifi_manager.h"
#include "network/http_client.h"
#include "network/ntp_client.h"

/**
 * ============================================================================
 * EcoTwin ESP32 Water Node - Main Firmware Entry Point
 * ============================================================================
 * 
 * Target: Generic ESP32 (WROOM-32 / DevKitC)
 * Specification: docs/TELEMETRY_CONTRACT.md (v1.0)
 * 
 * STEP 10 SCOPE:
 *   - End-to-End System Integration & Deployment Verification
 *   - Non-blocking SNTP UTC time synchronization (NtpClient)
 *   - ISO-8601 UTC timestamp generation ("YYYY-MM-DDTHH:MM:SSZ")
 *   - Resilient timestamp fallback ("timestamp": null) during offline / desync
 *   - HTTP Telemetry Ingestion Client with X-Sensor-Key Authentication (Step 8)
 *   - Bounded HTTP POST (3000ms socket timeout, non-blocking sensor loop)
 *   - Offline-safe transmission (HTTP skipped when Wi-Fi is disconnected)
 *   - Wi-Fi Station Connectivity & Diagnostics RSSI Integration (Step 7)
 *   - HC-SR04 ultrasonic water level driver (Step 3)
 *   - YF-S201 Hall-effect turbine flow meter driver with interrupt (Step 4)
 *   - Analog TDS sensor driver with multisampling & reference compensation (Step 5)
 *   - Analog optical turbidity sensor driver with clear baseline conversion (Step 5)
 *   - Canonical JSON telemetry packet preservation (docs/TELEMETRY_CONTRACT.md v1.0)
 *   - Local Serial diagnostic printing
 * ============================================================================
 */

// Global sensor driver instances configured from config.h
static UltrasonicSensor g_ultrasonic(
    Config::PIN_ULTRASONIC_TRIG,
    Config::PIN_ULTRASONIC_ECHO,
    Config::TANK_REFERENCE_HEIGHT_CM,
    Config::TANK_DEADBAND_CM,
    Config::ULTRASONIC_MIN_DISTANCE_CM,
    Config::ULTRASONIC_MAX_DISTANCE_CM,
    Config::ULTRASONIC_SAMPLE_COUNT,
    Config::ULTRASONIC_TIMEOUT_US,
    Config::ULTRASONIC_SAMPLE_INTERVAL_MS
);

static FlowMeter g_flowMeter(
    Config::PIN_FLOW_PULSE,
    Config::FLOW_PULSES_PER_LITER,
    Config::YF_S201_MAX_RATED_FLOW_LPM,
    Config::YF_S201_ANOMALY_FLOW_LPM
);

static TDSSensor g_tdsSensor(
    Config::PIN_TDS_ANALOG,
    Config::ADC_VREF_MV,
    Config::TDS_CALIBRATION_FACTOR,
    Config::TDS_VOLTAGE_DIVIDER_RATIO,
    Config::TDS_REFERENCE_TEMPERATURE_C,
    Config::TDS_SAMPLE_COUNT,
    Config::TDS_MIN_VALID_VOLTAGE_MV,
    Config::TDS_MAX_VALID_VOLTAGE_MV,
    Config::TDS_MAX_RATED_PPM
);

static TurbiditySensor g_turbiditySensor(
    Config::PIN_TURBIDITY_ANALOG,
    Config::ADC_VREF_MV,
    Config::TURBIDITY_CLEAR_VOLTAGE_MV,
    Config::TURBIDITY_VOLTAGE_DIVIDER_RATIO,
    Config::TURBIDITY_CALIBRATION_SLOPE,
    Config::TURBIDITY_SAMPLE_COUNT,
    Config::TURBIDITY_MIN_VALID_VOLTAGE_MV,
    Config::TURBIDITY_MAX_VALID_VOLTAGE_MV,
    Config::TURBIDITY_MAX_RATED_NTU
);

static DiagnosticsCollector g_diagnostics;

static WiFiManager g_wifiManager(
    Config::WIFI_NETWORK_SSID,
    Config::WIFI_NETWORK_PASSWORD,
    Config::WIFI_CONNECT_TIMEOUT_MS,
    Config::WIFI_RECONNECT_INTERVAL_MS
);

static TelemetryHttpClient g_httpClient(
    Config::BACKEND_URL,
    Config::DEVICE_SENSOR_KEY,
    Config::HTTP_TIMEOUT_MS
);

static NtpClient g_ntpClient(
    Config::NTP_SERVER_1,
    Config::NTP_SERVER_2
);

// Telemetry state
static Telemetry::TelemetryPacket g_packet;
static unsigned long g_lastReportMillis = 0;

void setup() {
    Serial.begin(Config::SERIAL_BAUD_RATE);
    delay(1000);

    Serial.println();
    Serial.println("==================================================");
    Serial.println("  EcoTwin ESP32 Water Node - Firmware v1.0");
    Serial.println("  Status: Step 10 Complete (E2E Integration Active)");
    Serial.println("==================================================");
    Serial.printf("Device ID:        %s\n", Config::DEVICE_ID);
    Serial.printf("Building ID:      %d\n", Config::BUILDING_ID);
    Serial.printf("Report Interval:  %d seconds\n", Config::REPORT_INTERVAL_SECONDS);
    Serial.println("==================================================");

    // Explicitly configure ESP32 ADC global resolution
    analogReadResolution(Config::ADC_RESOLUTION_BITS);

    // Initialize sensor abstractions
    Serial.print("Initializing Ultrasonic Sensor (HC-SR04)... ");
    g_ultrasonic.begin();
    Serial.println("OK");

    Serial.print("Initializing Flow Meter (YF-S201)... ");
    g_flowMeter.begin();
    Serial.println("OK");

    Serial.print("Initializing TDS Sensor (GPIO 34)... ");
    g_tdsSensor.begin();
    Serial.println("OK");

    Serial.print("Initializing Turbidity Sensor (GPIO 35)... ");
    g_turbiditySensor.begin();
    Serial.println("OK");

    Serial.print("Initializing Diagnostics Collector... ");
    g_diagnostics.begin();
    Serial.println("OK");

    Serial.print("Initializing Telemetry HTTP Client... ");
    g_httpClient.begin();
    Serial.println("OK");

    // Initialize Wi-Fi connectivity (bounded timeout, offline-first resilient fallback)
    Serial.println();
    g_wifiManager.begin();
    Serial.println();

    // Initialize NTP time synchronization (non-blocking SNTP in background)
    Serial.print("Initializing NTP Client (UTC)... ");
    g_ntpClient.begin();
    Serial.println("OK");
    Serial.println();

    Serial.println("Setup completed. Entering periodic sampling loop.");
    Serial.println();

    g_lastReportMillis = millis();
}

void loop() {
    // 1. Maintain Wi-Fi state machine (non-blocking periodic reconnects)
    g_wifiManager.update();

    // 2. Maintain NTP time synchronization state machine (non-blocking)
    g_ntpClient.update();

    unsigned long currentMillis = millis();
    unsigned long intervalMs = Config::REPORT_INTERVAL_SECONDS * 1000UL;

    // Non-blocking timer check
    if (currentMillis - g_lastReportMillis >= intervalMs) {
        // 1. Start/prepare telemetry interval
        float elapsedSeconds = (currentMillis - g_lastReportMillis) / 1000.0f;
        g_lastReportMillis = currentMillis;

        // 2. Reset packet for new interval (prevents stale sensor values across cycles)
        g_packet.reset();

        // Populate core identity metadata from configuration
        g_packet.schema_version = Config::SCHEMA_VERSION;
        g_packet.device_id = Config::DEVICE_ID;
        g_packet.building_id = Config::BUILDING_ID;
        g_packet.source = Config::TELEMETRY_SOURCE;
        g_packet.interval_seconds = Config::REPORT_INTERVAL_SECONDS;

        // 3. NTP Timestamp: ISO-8601 UTC if synchronized, or empty string -> JSON null
        if (g_ntpClient.isSynchronized()) {
            g_packet.timestamp = g_ntpClient.getIsoUtcTimestamp();
        } else {
            g_packet.timestamp = "";
        }

        // Temporary diagnostic variables
        float rawDistanceCm = -1.0f;
        uint32_t intervalPulses = 0;
        float rawTdsMv = 0.0f;
        float rawTurbidityMv = 0.0f;

        // 3. Read Ultrasonic Sensor (HC-SR04)
        float levelPct = 0.0f;
        float levelCm = 0.0f;
        String ultrasonicError = "";
        bool ultrasonicSuccess = g_ultrasonic.read(levelPct, levelCm, rawDistanceCm, ultrasonicError);
        if (ultrasonicSuccess) {
            g_packet.has_water_level = true;
            g_packet.water_level_pct = levelPct;
            g_packet.water_level_cm = levelCm;
        } else {
            g_packet.has_water_level = false;
            g_packet.addError(ultrasonicError);
        }

        // 4. Read Flow Meter (YF-S201)
        float flowRateLpm = 0.0f;
        float volumeLiters = 0.0f;
        String flowError = "";
        bool flowSuccess = g_flowMeter.readInterval(
            elapsedSeconds,
            flowRateLpm,
            volumeLiters,
            intervalPulses,
            flowError
        );
        if (flowSuccess) {
            g_packet.has_flow = true;
            g_packet.flow_rate_lpm = flowRateLpm;
            g_packet.volume_liters = volumeLiters;
            if (flowError.length() > 0) {
                g_packet.addError(flowError);
            }
        } else {
            g_packet.has_flow = false;
            g_packet.addError(flowError);
        }

        // 5. Read TDS Sensor (GPIO 34)
        int tdsPpm = 0;
        String tdsError = "";
        bool tdsSuccess = g_tdsSensor.read(tdsPpm, rawTdsMv, tdsError);
        if (tdsSuccess) {
            g_packet.has_tds = true;
            g_packet.tds_ppm = tdsPpm;
        } else {
            g_packet.has_tds = false;
            g_packet.addError(tdsError);
        }

        // 6. Read Turbidity Sensor (GPIO 35)
        float turbidityNtu = 0.0f;
        String turbidityError = "";
        bool turbiditySuccess = g_turbiditySensor.read(turbidityNtu, rawTurbidityMv, turbidityError);
        if (turbiditySuccess) {
            g_packet.has_turbidity = true;
            g_packet.turbidity_ntu = turbidityNtu;
        } else {
            g_packet.has_turbidity = false;
            g_packet.addError(turbidityError);
        }

        // 7. Collect Diagnostics (Captures estimated ADC-pin millivolts under nominal Vref assumption)
        int16_t currentRssi = 0;
        bool hasRssi = g_wifiManager.getRssi(currentRssi);

        g_packet.diagnostics = g_diagnostics.collect(
            intervalPulses,
            rawDistanceCm,
            rawTdsMv,
            rawTurbidityMv,
            hasRssi,
            currentRssi,
            ultrasonicSuccess
        );
        g_packet.has_diagnostics = true;

        // 8. Error aggregation verified: g_packet.addError() collected and deduplicated all sensor errors

        // 9. Serialize canonical JSON
        String jsonPayload = g_packet.toJson();

        // 10. Print local diagnostic monitor output and canonical JSON for local testing
        Serial.println("==================================================");
        Serial.println("[LOCAL SENSOR READINGS]");
        Serial.println("HC-SR04:");
        if (g_packet.has_water_level) {
            Serial.printf("  Distance: %.1f cm\n", rawDistanceCm);
            Serial.printf("  Water Height: %.1f cm\n", levelCm);
            Serial.printf("  Water Level: %.1f %%\n", levelPct);
            if (levelPct < Config::WATER_LEVEL_LOW_ALERT_THRESHOLD_PCT) {
                Serial.printf("  [ALERT] Critical Low Water Level: %.1f%% (< %.0f%% threshold) - REFILL REQUIRED!\n",
                              levelPct, Config::WATER_LEVEL_LOW_ALERT_THRESHOLD_PCT);
            }
        } else {
            Serial.println("  Measurement timeout / invalid");
            Serial.println("  Water level unavailable (null)");
        }
        Serial.println();

        Serial.println("YF-S201:");
        Serial.printf("  Pulses: %u\n", intervalPulses);
        Serial.printf("  Flow Rate: %.2f L/min\n", flowRateLpm);
        Serial.printf("  Interval Volume: %.3f L\n", volumeLiters);
        if (flowError.length() > 0) {
            Serial.printf("  Diagnostic Warning: %s\n", flowError.c_str());
        }
        Serial.println();

        Serial.println("TDS (GPIO 34):");
        Serial.printf("  Estimated ADC Pin Voltage: %.0f mV (nominal Vref)\n", rawTdsMv);
        if (g_packet.has_tds) {
            Serial.printf("  TDS: %d ppm (estimated @ %.1f C ref)\n", g_packet.tds_ppm, Config::TDS_REFERENCE_TEMPERATURE_C);
        } else {
            Serial.println("  TDS: Unavailable (null)");
            if (tdsError.length() > 0) {
                Serial.printf("  Diagnostic Error: %s\n", tdsError.c_str());
            }
        }
        Serial.println();

        Serial.println("Turbidity (GPIO 35):");
        Serial.printf("  Estimated ADC Pin Voltage: %.0f mV (nominal Vref)\n", rawTurbidityMv);
        if (g_packet.has_turbidity) {
            Serial.printf("  Turbidity: %.1f NTU (estimated)\n", g_packet.turbidity_ntu);
        } else {
            Serial.println("  Turbidity: Unavailable (null)");
            if (turbidityError.length() > 0) {
                Serial.printf("  Diagnostic Error: %s\n", turbidityError.c_str());
            }
        }
        Serial.println();

        Serial.println("Network / Wi-Fi:");
        if (hasRssi) {
            Serial.printf("  Status: Connected (SSID: %s)\n", g_wifiManager.getSsid());
            Serial.printf("  IP Address: %s\n", g_wifiManager.getLocalIp().c_str());
            Serial.printf("  Signal Strength: %d dBm\n", currentRssi);
        } else {
            Serial.printf("  Status: Offline (SSID: %s)\n", g_wifiManager.getSsid());
            Serial.println("  IP Address: Disconnected");
            Serial.println("  Signal Strength: Unavailable (null in telemetry)");
        }
        Serial.println();

        Serial.println("Timing & Synchronization (NTP):");
        if (g_ntpClient.isSynchronized()) {
            Serial.printf("  Status: Synchronized (Strict UTC)\n");
            Serial.printf("  Device Timestamp: %s\n", g_packet.timestamp.c_str());
        } else {
            Serial.println("  Status: Pending / Unsynchronized");
            Serial.println("  Device Timestamp: null (server arrival time authoritative)");
        }
        Serial.println();

        Serial.println("[CANONICAL TELEMETRY PACKET]");
        Serial.println(jsonPayload);
        Serial.println();

        // 11. Transmit Telemetry over HTTP (Step 8)
        // Bounded non-blocking HTTP POST: executes only if Wi-Fi is actively connected
        if (g_wifiManager.isConnected()) {
            Serial.println("[HTTP INGESTION]");
            Serial.printf("  Endpoint: %s\n", g_httpClient.getEndpointUrl());
            Serial.print("  Posting telemetry packet... ");

            HttpResponse httpResp = g_httpClient.postTelemetry(jsonPayload);
            if (httpResp.success) {
                Serial.printf("SUCCESS (HTTP %d)\n", httpResp.httpCode);
                if (httpResp.responseBody.length() > 0) {
                    Serial.printf("  Server Response: %s\n", httpResp.responseBody.c_str());
                }
            } else {
                Serial.printf("FAILED (HTTP %d: %s)\n", httpResp.httpCode, httpResp.errorMessage.c_str());
                if (httpResp.responseBody.length() > 0) {
                    Serial.printf("  Server Detail: %s\n", httpResp.responseBody.c_str());
                }
                Serial.println("  Packet dropped. Sensor loop continues uninterrupted.");
            }
        } else {
            Serial.println("[HTTP INGESTION]");
            Serial.println("  Skipped: Node is OFFLINE (Wi-Fi disconnected). Continuing local monitoring.");
        }
        Serial.println("==================================================");
        Serial.println();
    }

    // Yield to FreeRTOS watchdog / background tasks
    delay(10);
}
