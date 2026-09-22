#include "flow_meter.h"

// Pointer to instance for global ISR callback
static FlowMeter* g_flowInstance = nullptr;

/**
 * Global ISR trampoline function called on GPIO interrupt edge.
 * Placed in IRAM for deterministic execution timing without flash cache miss latency.
 */
static void IRAM_ATTR globalFlowISR() {
    if (g_flowInstance != nullptr) {
        g_flowInstance->onPulse();
    }
}

FlowMeter::FlowMeter(
    uint8_t pulsePin,
    float pulsesPerLiter,
    float maxRatedFlowLpm,
    float anomalyFlowLpm
) : _pulsePin(pulsePin),
    _pulsesPerLiter(pulsesPerLiter),
    _maxRatedFlowLpm(maxRatedFlowLpm),
    _anomalyFlowLpm(anomalyFlowLpm),
    _intervalPulses(0),
    _lifetimePulses(0),
    _mux(portMUX_INITIALIZER_UNLOCKED),
    _initialized(false) {}

void FlowMeter::begin() {
    // Enable internal pull-up resistor to maintain stable HIGH when Hall switch is open.
    // NOTE: If using an external 5V pull-up with a level shifter, pin mode remains INPUT or INPUT_PULLUP.
    pinMode(_pulsePin, INPUT_PULLUP);
    g_flowInstance = this;

    // Attach interrupt on FALLING edge:
    // Open-collector NPN transistor in the Hall sensor pulls the Yellow line to GND when triggered.
    // The active pull-down creates a sharp falling edge with high slew rate and noise immunity.
    attachInterrupt(digitalPinToInterrupt(_pulsePin), globalFlowISR, FALLING);
    _initialized = true;
}

void IRAM_ATTR FlowMeter::onPulse() {
    // Minimal, ultra-fast ISR: increment volatile 32-bit counters under spinlock
    portENTER_CRITICAL_ISR(&_mux);
    _intervalPulses++;
    _lifetimePulses++;
    portEXIT_CRITICAL_ISR(&_mux);
}

bool FlowMeter::readInterval(
    float elapsedSeconds,
    float &outFlowRateLpm,
    float &outVolumeLiters,
    uint32_t &outPulseDelta,
    String &outErrorCode
) {
    outErrorCode = "";

    if (!_initialized) {
        outFlowRateLpm = 0.0f;
        outVolumeLiters = 0.0f;
        outPulseDelta = 0;
        outErrorCode = "FLOW_NOT_INITIALIZED";
        return false;
    }

    if (elapsedSeconds <= 0.0f) {
        outFlowRateLpm = 0.0f;
        outVolumeLiters = 0.0f;
        outPulseDelta = 0;
        outErrorCode = "FLOW_INVALID_INTERVAL";
        return false;
    }

    // Atomically capture and reset the interval pulse counter
    uint32_t pulses = 0;
    portENTER_CRITICAL(&_mux);
    pulses = _intervalPulses;
    _intervalPulses = 0; // Reset interval accumulator for next window
    portEXIT_CRITICAL(&_mux);

    outPulseDelta = pulses;

    // Handle normal zero-flow condition (closed valve / standing water)
    // Zero flow is a legitimate operating state, NOT a sensor failure.
    if (pulses == 0) {
        outFlowRateLpm = 0.0f;
        outVolumeLiters = 0.0f;
        return true;
    }

    // Calibration factor guard
    if (_pulsesPerLiter <= 0.0f) {
        outFlowRateLpm = 0.0f;
        outVolumeLiters = 0.0f;
        outErrorCode = "FLOW_CALIBRATION_INVALID";
        return false;
    }

    // Calculate interval volume in Liters strictly during this reporting interval:
    // volume_liters = pulse_delta / pulses_per_liter
    outVolumeLiters = static_cast<float>(pulses) / _pulsesPerLiter;

    // Calculate average flow rate in Liters per minute:
    // flow_rate_lpm = (pulse_delta / elapsed_seconds) * (60.0 / pulses_per_liter)
    // Or equivalently: outVolumeLiters / (elapsedSeconds / 60.0f)
    float elapsedMinutes = elapsedSeconds / 60.0f;
    outFlowRateLpm = outVolumeLiters / elapsedMinutes;

    // Sanity and Physical Bounds Check:
    // 1. Check for severe anomaly / electrical EMI noise / floating input (> 60.0 L/min)
    // Per docs/TELEMETRY_CONTRACT.md Section 6, readings > 60.0 L/min indicate electrical noise and violate physical limits.
    if (_anomalyFlowLpm > 0.0f && outFlowRateLpm > _anomalyFlowLpm) {
        outErrorCode = "FLOW_SENSOR_PULSE_ERROR";
        return false; // Hardware fault condition -> payload emits null and records error
    }

    // 2. Check for rated operating range ceiling (> 30.0 L/min)
    // Flow rates between 30.0 and 60.0 L/min exceed rated sensor linearity but represent valid physical data.
    if (_maxRatedFlowLpm > 0.0f && outFlowRateLpm > _maxRatedFlowLpm) {
        outErrorCode = "FLOW_RATE_EXCEEDS_SPEC";
    }

    return true;
}

uint32_t FlowMeter::getLifetimePulses() const {
    uint32_t count = 0;
    portENTER_CRITICAL((portMUX_TYPE*)&_mux);
    count = _lifetimePulses;
    portEXIT_CRITICAL((portMUX_TYPE*)&_mux);
    return count;
}

float FlowMeter::getLifetimeVolumeLiters() const {
    if (_pulsesPerLiter <= 0.0f) {
        return 0.0f;
    }
    return static_cast<float>(getLifetimePulses()) / _pulsesPerLiter;
}

void FlowMeter::resetLifetime() {
    portENTER_CRITICAL(&_mux);
    _lifetimePulses = 0;
    portEXIT_CRITICAL(&_mux);
}

bool FlowMeter::isConnected() const {
    return _initialized;
}

uint8_t FlowMeter::getPin() const {
    return _pulsePin;
}

float FlowMeter::getPulsesPerLiter() const {
    return _pulsesPerLiter;
}

void FlowMeter::setPulsesPerLiter(float k) {
    if (k > 0.0f) {
        _pulsesPerLiter = k;
    }
}
