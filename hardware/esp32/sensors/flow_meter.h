#pragma once

#include <Arduino.h>

/**
 * ============================================================================
 * FlowMeter Interface (YF-S201 Hall-Effect Turbine)
 * ============================================================================
 * 
 * Hardware abstraction for YF-S201 Hall-effect water flow sensor.
 * Uses an ESP32 GPIO hardware interrupt with FreeRTOS SMP critical-section
 * protection to safely count turbine pulses across reporting intervals.
 * 
 * Electrical & Physical Specifications:
 *   - Operating voltage: 4.5V - 18V (nominal 5V VCC).
 *   - Output signal: Frequency pulse train from internal Hall-effect switch.
 *   - Pin Mode: INPUT_PULLUP (or external pull-up).
 *   - Interrupt Edge: FALLING (open-collector active-low pull-down has faster
 *     slew rate and sharper transition to GND than passive pull-up release).
 *   - Nominal Calibration: ~450 pulses/Liter (Datasheet: f = 7.5 * Q).
 *   - Operational Range: 1.0 to 30.0 L/min.
 * 
 * Telemetry Contract Alignment (docs/TELEMETRY_CONTRACT.md):
 *   - flow_rate_lpm: Average flow rate over actual elapsed interval (L/min).
 *   - volume_liters: Water volume strictly during current interval (Liters).
 *   - diagnostics.pulse_count: Exact integer pulses in current interval.
 *   - Zero Flow: Valid reading (0.0 L/min, 0.000 L), NOT a sensor error.
 *   - Anomaly: Rates > 60.0 L/min flag FLOW_SENSOR_PULSE_ERROR.
 * ============================================================================
 */

class FlowMeter {
public:
    /**
     * @param pulsePin GPIO supporting hardware interrupt (Provisional: GPIO 19)
     * @param pulsesPerLiter Calibration factor K (nominal datasheet: 450.0 pulses/L)
     * @param maxRatedFlowLpm Maximum rated flow rate before out-of-spec warning (default: 30.0 L/min)
     * @param anomalyFlowLpm Physical ceiling before flagging FLOW_SENSOR_PULSE_ERROR (default: 60.0 L/min)
     */
    FlowMeter(
        uint8_t pulsePin,
        float pulsesPerLiter = 450.0f,
        float maxRatedFlowLpm = 30.0f,
        float anomalyFlowLpm = 60.0f
    );

    /**
     * Configures GPIO pin mode (INPUT_PULLUP) and attaches the hardware interrupt on FALLING edge.
     */
    void begin();

    /**
     * Interrupt service routine callback (called on pulse falling edge).
     * Minimal implementation: increments volatile pulse counters inside critical section.
     */
    void IRAM_ATTR onPulse();

    /**
     * Reads current interval flow, snapshots and resets the interval accumulator atomically.
     * 
     * @param elapsedSeconds Actual wall-clock seconds elapsed between telemetry reports
     * @param outFlowRateLpm Output: Average flow rate in L/min
     * @param outVolumeLiters Output: Volume in Liters strictly during this interval
     * @param outPulseDelta Output: Integer pulses counted in this interval (for diagnostics)
     * @param outErrorCode Output: Empty string if normal, or error code on failure/anomaly
     * @return true if valid reading obtained (including 0.0 for zero flow); false on severe anomaly/uninitialized
     */
    bool readInterval(
        float elapsedSeconds,
        float &outFlowRateLpm,
        float &outVolumeLiters,
        uint32_t &outPulseDelta,
        String &outErrorCode
    );

    /**
     * Get total cumulative pulses since boot (for node diagnostics).
     */
    uint32_t getLifetimePulses() const;

    /**
     * Get total cumulative water volume in Liters since boot.
     */
    float getLifetimeVolumeLiters() const;

    /**
     * Reset cumulative lifetime pulse counter.
     */
    void resetLifetime();

    /**
     * Check if the flow meter has been initialized and interrupt attached.
     */
    bool isConnected() const;

    /**
     * Get configured GPIO pin.
     */
    uint8_t getPin() const;

    /**
     * Get current calibration factor (pulses per liter).
     */
    float getPulsesPerLiter() const;

    /**
     * Update calibration factor (e.g. following on-site bucket calibration).
     */
    void setPulsesPerLiter(float k);

private:
    uint8_t _pulsePin;
    float _pulsesPerLiter;
    float _maxRatedFlowLpm;
    float _anomalyFlowLpm;
    volatile uint32_t _intervalPulses;
    volatile uint32_t _lifetimePulses;
    portMUX_TYPE _mux;
    bool _initialized;
};
