#include "turbidity_sensor.h"

TurbiditySensor::TurbiditySensor(
    uint8_t adcPin,
    float vrefMv,
    float clearVoltageMv,
    float voltageDividerRatio,
    float calibrationSlope,
    uint8_t sampleCount,
    float minVoltageMv,
    float maxVoltageMv,
    float maxNtu
) : _adcPin(adcPin),
    _vrefMv(vrefMv),
    _clearVoltageMv(clearVoltageMv),
    _voltageDividerRatio(voltageDividerRatio),
    _calibrationSlope(calibrationSlope),
    _sampleCount(sampleCount > 0 ? sampleCount : 10),
    _minVoltageMv(minVoltageMv),
    _maxVoltageMv(maxVoltageMv),
    _maxNtu(maxNtu),
    _initialized(false) {}

void TurbiditySensor::begin() {
    pinMode(_adcPin, INPUT);
    // Explicit 12-bit ADC resolution (0 - 4095 range)
    analogReadResolution(12);
    // Set 11dB attenuation to allow full-scale reading up to ~3.1V - 3.3V
    analogSetPinAttenuation(_adcPin, ADC_11db);
    _initialized = true;
}

float TurbiditySensor::voltageToNtu(
    float sensorVoltageMv,
    float clearVoltageMv,
    float calibrationSlope,
    float maxNtu,
    String &outErrorCode
) {
    outErrorCode = "";

    // Directionality & Optical Physics:
    // Optical transmission is inversely related to turbidity:
    // - Clean Water (~0.0 NTU): Maximum IR light reaches the phototransistor -> Maximum voltage (~clearVoltageMv).
    // - Highly Turbid Water: Suspended particles scatter light away -> Phototransistor voltage drops.
    //
    // Note: The resulting NTU is an ESTIMATE and requires physical calibration with Formazin standards.

    // If measured voltage is at or above the clear-water baseline (within 2% margin), turbidity is effectively 0.0 NTU.
    if (sensorVoltageMv >= clearVoltageMv * 0.98f) {
        return 0.0f;
    }

    // Linearized drop from clear water baseline:
    // deltaVolts = (clearVoltageMv - sensorVoltageMv) / 1000.0
    // NTU = deltaVolts * calibrationSlope
    float deltaVolts = (clearVoltageMv - sensorVoltageMv) / 1000.0f;
    float ntu = deltaVolts * calibrationSlope;

    if (ntu < 0.0f) {
        outErrorCode = "TURBIDITY_CALCULATION_INVALID";
        return -1.0f;
    }

    if (ntu > maxNtu) {
        outErrorCode = "TURBIDITY_CALCULATION_INVALID";
        return -1.0f;
    }

    return ntu;
}

bool TurbiditySensor::read(float &outTurbidityNtu, float &outPinVoltageMv, String &outErrorCode) {
    outErrorCode = "";
    outTurbidityNtu = 0.0f;
    outPinVoltageMv = 0.0f;

    if (!_initialized) {
        outErrorCode = "TURBIDITY_NOT_INITIALIZED";
        return false;
    }

    // Multisampling: take _sampleCount readings with short delay to suppress electrical noise
    uint32_t rawSum = 0;
    for (uint8_t i = 0; i < _sampleCount; i++) {
        rawSum += analogRead(_adcPin);
        delay(2);
    }
    float rawAvg = static_cast<float>(rawSum) / static_cast<float>(_sampleCount);

    // Convert raw ADC (12-bit: 0 - 4095) to ADC pin millivolts using nominal Vref calibration assumption
    float pinVoltageMv = (rawAvg * _vrefMv) / 4095.0f;
    // Diagnostic semantic: estimated voltage seen by the ESP32 ADC pin under nominal Vref assumption
    outPinVoltageMv = pinVoltageMv;

    // Check for open circuit / probe disconnected / unpowered IR LED (< minVoltageMv)
    if (pinVoltageMv < _minVoltageMv) {
        outErrorCode = "TURBIDITY_ADC_INVALID";
        return false; // Unavailable/null in telemetry
    }

    // Check for saturation / over-voltage / missing voltage divider (> maxVoltageMv)
    if (pinVoltageMv > _maxVoltageMv) {
        outErrorCode = "TURBIDITY_VOLTAGE_OUT_OF_RANGE";
        return false; // Unavailable/null in telemetry
    }

    // Reconstruct sensor output voltage before any hardware voltage divider
    float sensorVoltageMv = pinVoltageMv * _voltageDividerRatio;

    // Convert voltage to estimated NTU
    String convError = "";
    float ntuEstimated = voltageToNtu(sensorVoltageMv, _clearVoltageMv, _calibrationSlope, _maxNtu, convError);

    if (convError.length() > 0 || ntuEstimated < 0.0f) {
        outErrorCode = convError.length() > 0 ? convError : "TURBIDITY_CALCULATION_INVALID";
        return false;
    }

    outTurbidityNtu = ntuEstimated;
    return true;
}

bool TurbiditySensor::isConnected() const {
    return _initialized;
}

uint8_t TurbiditySensor::getPin() const {
    return _adcPin;
}

float TurbiditySensor::getClearVoltageMv() const {
    return _clearVoltageMv;
}

void TurbiditySensor::setClearVoltageMv(float clearMv) {
    if (clearMv > 0.0f) {
        _clearVoltageMv = clearMv;
    }
}

float TurbiditySensor::getVoltageDividerRatio() const {
    return _voltageDividerRatio;
}

void TurbiditySensor::setVoltageDividerRatio(float ratio) {
    if (ratio > 0.0f) {
        _voltageDividerRatio = ratio;
    }
}

float TurbiditySensor::getCalibrationSlope() const {
    return _calibrationSlope;
}

void TurbiditySensor::setCalibrationSlope(float slope) {
    if (slope > 0.0f) {
        _calibrationSlope = slope;
    }
}
