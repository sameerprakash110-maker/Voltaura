#pragma once

#include <Arduino.h>
#include <vector>

/**
 * ============================================================================
 * EcoTwin Firmware Telemetry Data Structures
 * ============================================================================
 * 
 * Direct firmware C++ representation of the canonical telemetry contract
 * defined in docs/TELEMETRY_CONTRACT.md (Schema Version 1.0).
 * 
 * Rules:
 *   - Fields that are absent or invalid MUST be serialized as JSON `null`.
 *   - Zero (0.0) represents a legitimate measurement (e.g., zero flow).
 *   - Any sensor read failure populates `sensor_errors`.
 *   - Leak detection & quality interpretation are performed by the backend.
 * ============================================================================
 */

namespace Telemetry {

    /**
     * Low-level hardware diagnostics (optional block).
     * Used for remote device health monitoring, signal quality, and calibration audit.
     */
    struct DiagnosticsData {
        uint32_t pulse_count = 0;          // Total Hall-effect pulses counted in interval
        bool has_distance = false;         // True if ultrasonic distance was valid
        float distance_raw_cm = 0.0f;       // Unadjusted distance to surface from HC-SR04 (null if invalid)
        float tds_voltage_mv = 0.0f;        // Estimated ADC-pin millivolts from TDS probe (nominal Vref assumption)
        float turbidity_voltage_mv = 0.0f;  // Estimated ADC-pin millivolts from optical turbidity probe (nominal Vref assumption)
        bool has_rssi = false;             // True if Wi-Fi RSSI is valid
        int16_t rssi_dbm = 0;              // Wi-Fi signal strength in dBm (valid when has_rssi is true; serialized as null when false)
        uint32_t uptime_seconds = 0;        // ESP32 uptime in seconds
        uint32_t free_heap_bytes = 0;       // Free dynamic SRAM in bytes

        bool is_valid = false;
    };

    /**
     * Primary Telemetry Packet structure mapping 1:1 to docs/TELEMETRY_CONTRACT.md
     */
    struct TelemetryPacket {
        // ---- Metadata & Routing --------------------------------------------
        String schema_version = "1.0";
        String device_id = "";
        int building_id = 0;
        String timestamp = "";              // ISO-8601 UTC (empty string -> serialized as null)
        String source = "esp32";
        uint32_t interval_seconds = 15;

        // ---- Water Level (HC-SR04) -----------------------------------------
        bool has_water_level = false;
        float water_level_pct = 0.0f;       // 0.0% to 100.0%
        float water_level_cm = 0.0f;        // 0.0 cm to 500.0 cm

        // ---- Flow Meter (YF-S201) ------------------------------------------
        bool has_flow = false;
        float flow_rate_lpm = 0.0f;         // Liters per minute
        float volume_liters = 0.0f;         // Interval volume (Liters in current interval)

        // ---- Water Quality (TDS & Turbidity) -------------------------------
        bool has_tds = false;
        int tds_ppm = 0;                    // Total Dissolved Solids in ppm

        bool has_turbidity = false;
        float turbidity_ntu = 0.0f;         // Turbidity in NTU

        // ---- Hardware Error Codes ------------------------------------------
        std::vector<String> sensor_errors;

        // ---- Optional Diagnostics ------------------------------------------
        bool has_diagnostics = false;
        DiagnosticsData diagnostics;

        /**
         * Reset all packet fields to clean initial state.
         * Ensures no stale sensor values or errors leak across reporting intervals.
         */
        void reset();

        /**
         * Appends an error code to sensor_errors, preventing duplicate entries
         * while aggregating errors across all four sensor subsystems.
         */
        void addError(const String& err);

        /**
         * Serializes the packet into canonical JSON matching docs/TELEMETRY_CONTRACT.md.
         * Ensures missing/uninstalled sensors produce JSON `null` rather than fake numbers.
         */
        String toJson() const;
    };

} // namespace Telemetry
