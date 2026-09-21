#include "telemetry.h"
#include <ArduinoJson.h>

namespace Telemetry {

    void TelemetryPacket::reset() {
        schema_version = "1.0";
        device_id = "";
        building_id = 0;
        timestamp = "";
        source = "esp32";
        interval_seconds = 15;

        has_water_level = false;
        water_level_pct = 0.0f;
        water_level_cm = 0.0f;

        has_flow = false;
        flow_rate_lpm = 0.0f;
        volume_liters = 0.0f;

        has_tds = false;
        tds_ppm = 0;

        has_turbidity = false;
        turbidity_ntu = 0.0f;

        sensor_errors.clear();

        has_diagnostics = false;
        diagnostics = DiagnosticsData{};
    }

    void TelemetryPacket::addError(const String& err) {
        if (err.length() == 0) {
            return;
        }
        for (const auto& existing : sensor_errors) {
            if (existing == err) {
                return; // Prevent duplicate error
            }
        }
        sensor_errors.push_back(err);
    }

    String TelemetryPacket::toJson() const {
        JsonDocument doc;

        // 1. Core Metadata
        doc["schema_version"] = schema_version;
        doc["device_id"] = device_id;
        doc["building_id"] = building_id;

        if (timestamp.length() > 0) {
            doc["timestamp"] = timestamp;
        } else {
            doc["timestamp"] = nullptr;
        }

        doc["source"] = source;
        doc["interval_seconds"] = interval_seconds;

        // 2. Water Level (HC-SR04) - serialized as null if unavailable
        if (has_water_level) {
            doc["water_level_pct"] = serialized(String(water_level_pct, 1));
            doc["water_level_cm"] = serialized(String(water_level_cm, 1));
        } else {
            doc["water_level_pct"] = nullptr;
            doc["water_level_cm"] = nullptr;
        }

        // 3. Water Flow (YF-S201) - serialized as null if unavailable; valid 0.00 / 0.000 preserved
        if (has_flow) {
            doc["flow_rate_lpm"] = serialized(String(flow_rate_lpm, 2));
            doc["volume_liters"] = serialized(String(volume_liters, 3));
        } else {
            doc["flow_rate_lpm"] = nullptr;
            doc["volume_liters"] = nullptr;
        }

        // 4. Water Quality: TDS - serialized as null if unavailable
        if (has_tds) {
            doc["tds_ppm"] = tds_ppm;
        } else {
            doc["tds_ppm"] = nullptr;
        }

        // 5. Water Quality: Turbidity - serialized as null if unavailable; valid 0.0 preserved
        if (has_turbidity) {
            doc["turbidity_ntu"] = serialized(String(turbidity_ntu, 1));
        } else {
            doc["turbidity_ntu"] = nullptr;
        }

        // 6. Hardware Error Codes Array (empty array [] if normal)
        JsonArray errArray = doc["sensor_errors"].to<JsonArray>();
        for (const auto& err : sensor_errors) {
            errArray.add(err);
        }

        // 7. Optional Diagnostics Block
        if (has_diagnostics && diagnostics.is_valid) {
            JsonObject diag = doc["diagnostics"].to<JsonObject>();
            diag["pulse_count"] = diagnostics.pulse_count;

            if (diagnostics.has_distance) {
                diag["distance_raw_cm"] = serialized(String(diagnostics.distance_raw_cm, 1));
            } else {
                diag["distance_raw_cm"] = nullptr;
            }

            diag["tds_voltage_mv"] = static_cast<int>(round(diagnostics.tds_voltage_mv));
            diag["turbidity_voltage_mv"] = static_cast<int>(round(diagnostics.turbidity_voltage_mv));

            if (diagnostics.has_rssi) {
                diag["rssi_dbm"] = diagnostics.rssi_dbm;
            } else {
                diag["rssi_dbm"] = nullptr;
            }

            diag["uptime_seconds"] = diagnostics.uptime_seconds;
            diag["free_heap_bytes"] = diagnostics.free_heap_bytes;
        }

        String output;
        serializeJson(doc, output);
        return output;
    }

} // namespace Telemetry
