#include "diagnostics.h"

DiagnosticsCollector::DiagnosticsCollector()
    : _initialized(false) {}

void DiagnosticsCollector::begin() {
    _initialized = true;
}

Telemetry::DiagnosticsData DiagnosticsCollector::collect(
    uint32_t pulseCount,
    float distanceRawCm,
    float tdsVoltageMv,
    float turbidityVoltageMv,
    bool hasRssi,
    int16_t rssiDbm,
    bool hasDistance
) {
    Telemetry::DiagnosticsData data;

    data.pulse_count = pulseCount;
    data.has_distance = hasDistance && (distanceRawCm >= 0.0f);
    data.distance_raw_cm = data.has_distance ? distanceRawCm : 0.0f;
    data.tds_voltage_mv = tdsVoltageMv;
    data.turbidity_voltage_mv = turbidityVoltageMv;
    data.has_rssi = hasRssi;
    data.rssi_dbm = hasRssi ? rssiDbm : 0;
    data.uptime_seconds = millis() / 1000;
    data.free_heap_bytes = ESP.getFreeHeap();
    data.is_valid = true;

    return data;
}
