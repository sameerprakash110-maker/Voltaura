#pragma once

#include <Arduino.h>
#include "../telemetry.h"

/**
 * ============================================================================
 * DiagnosticsCollector Interface
 * ============================================================================
 * 
 * Hardware health and telemetry diagnostics collector.
 * Gathers low-level hardware indicators:
 *   - pulse_count: Hall pulses accumulated in interval
 *   - distance_raw_cm: Raw ultrasonic echo distance
 *   - tds_voltage_mv: Estimated ADC-pin millivolts from TDS probe (nominal Vref assumption)
 *   - turbidity_voltage_mv: Estimated ADC-pin millivolts from turbidity optical probe (nominal Vref assumption)
 *   - rssi_dbm: Wi-Fi signal strength in dBm (valid when has_rssi is true)
 *   - uptime_seconds: Device operating time since last boot
 *   - free_heap_bytes: Available dynamic memory (detects leaks/fragmentation)
 * ============================================================================
 */

class DiagnosticsCollector {
public:
    DiagnosticsCollector();

    void begin();

    /**
     * Collects diagnostics data from sensor inputs and ESP32 system registers.
     * 
     * @param pulseCount Exact Hall-effect pulses counted during current interval
     * @param distanceRawCm Unadjusted ultrasonic distance in cm
     * @param tdsVoltageMv Estimated ADC-pin millivolts from TDS sensor (nominal Vref assumption)
     * @param turbidityVoltageMv Estimated ADC-pin millivolts from turbidity sensor (nominal Vref assumption)
     * @param hasRssi True if valid Wi-Fi RSSI signal strength is available
     * @param rssiDbm Wi-Fi RSSI in dBm (meaningful when hasRssi is true)
     * @param hasDistance True if ultrasonic distance measurement was successful
     * @return Telemetry::DiagnosticsData populated structure
     */
    Telemetry::DiagnosticsData collect(
        uint32_t pulseCount,
        float distanceRawCm,
        float tdsVoltageMv,
        float turbidityVoltageMv,
        bool hasRssi = false,
        int16_t rssiDbm = 0,
        bool hasDistance = true
    );

private:
    bool _initialized;
};
