#include "tds_sensor.h"

TDSSensor::TDSSensor(
    uint8_t adcPin,
    float vrefMv,
    float calibrationFactor,
    float voltageDividerRatio,
    float referenceTempC,
    uint8_t sampleCount,
    float minVoltageMv,
    float maxVoltageMv,
    int maxPpm
) : _adcPin(adcPin),
    _vrefMv(vrefMv),
    _calibrationFactor(calibrationFactor),
    _voltageDividerRatio(voltageDividerRatio),
    _referenceTempC(referenceTempC),
    _sampleCount(sampleCount > 0 ? sampleCount : 10),
    _minVoltageMv(minVoltageMv),
    _maxVoltageMv(maxVoltageMv),
    _maxPpm(maxPpm),
    _initialized(false) {}

void TDSSensor::begin() {
    pinMode(_adcPin, INPUT);
    // Explicit 12-bit ADC resolution (0 - 4095 range)
    analogReadResolution(12);
    // Set 11dB attenuation to allow full-scale reading up to ~3.1V - 3.3V
    analogSetPinAttenuation(_adcPin, ADC_11db);
    _initialized = true;
}

float TDSSensor::voltageToPpm(
    float sensorVolts,
    float calibrationFactor,
    float referenceTempC,
    int maxPpm,
    String &outErrorCode
) {
    outErrorCode = "";

    // Temperature Compensation:
    // Standard formula: V_comp = V / (1.0 + 0.02 * (T - 25.0))
    // Uses the configured reference temperature (e.g. 25.0 C).
    // Note: The physical hardware does NOT include a live temperature probe.
    float tempCoefficient = 1.0f + 0.02f * (referenceTempC - 25.0f);
    if (tempCoefficient <= 0.0f) {
        tempCoefficient = 1.0f;
    }
    float vComp = sensorVolts / tempCoefficient;

    // Cubic polynomial conversion curve (standard DFRobot / Gravity analog TDS curve):
    // TDS_raw = (133.42 * vComp^3 - 255.86 * vComp^2 + 857.39 * vComp) * 0.5
    // Note: The result is an ESTIMATE and requires physical calibration with a known standard solution.
    float tdsValue = (133.42f * vComp * vComp * vComp - 255.86f * vComp * vComp + 857.39f * vComp) * 0.5f * calibrationFactor;

    if (tdsValue < 0.0f) {
        outErrorCode = "TDS_CALCULATION_INVALID";
        return -1.0f;
    }

    if (tdsValue > static_cast<float>(maxPpm)) {
        outErrorCode = "TDS_VOLTAGE_OUT_OF_RANGE";
        return -1.0f;
    }

    return tdsValue;
}

bool TDSSensor::read(int &outTdsPpm, float &outPinVoltageMv, String &outErrorCode) {
    outErrorCode = "";
    outTdsPpm = 0;
    outPinVoltageMv = 0.0f;

    if (!_initialized) {
        outErrorCode = "TDS_NOT_INITIALIZED";
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

    // Check for open circuit / probe dry / disconnected (< minVoltageMv)
    if (pinVoltageMv < _minVoltageMv) {
        outErrorCode = "TDS_PROBE_DRY";
        return false; // Unavailable/null in telemetry
    }

    // Check for short circuit / saturated voltage (> maxVoltageMv)
    if (pinVoltageMv > _maxVoltageMv) {
        outErrorCode = "TDS_VOLTAGE_OUT_OF_RANGE";
        return false; // Unavailable/null in telemetry
    }

    // Reconstruct sensor output voltage before any hardware voltage divider
    float sensorVoltageMv = pinVoltageMv * _voltageDividerRatio;
    float sensorVolts = sensorVoltageMv / 1000.0f;

    // Convert voltage to estimated TDS ppm
    String convError = "";
    float tdsEstimated = voltageToPpm(sensorVolts, _calibrationFactor, _referenceTempC, _maxPpm, convError);

    if (convError.length() > 0 || tdsEstimated < 0.0f) {
        outErrorCode = convError.length() > 0 ? convError : "TDS_CALCULATION_INVALID";
        return false;
    }

    outTdsPpm = static_cast<int>(round(tdsEstimated));
    if (outTdsPpm < 0) outTdsPpm = 0;
    if (outTdsPpm > _maxPpm) outTdsPpm = _maxPpm;

    return true;
}

bool TDSSensor::isConnected() const {
    return _initialized;
}

uint8_t TDSSensor::getPin() const {
    return _adcPin;
}

float TDSSensor::getCalibrationFactor() const {
    return _calibrationFactor;
}

void TDSSensor::setCalibrationFactor(float factor) {
    if (factor > 0.0f) {
        _calibrationFactor = factor;
    }
}

float TDSSensor::getVoltageDividerRatio() const {
    return _voltageDividerRatio;
}

void TDSSensor::setVoltageDividerRatio(float ratio) {
    if (ratio > 0.0f) {
        _voltageDividerRatio = ratio;
    }
}

float TDSSensor::getReferenceTempC() const {
    return _referenceTempC;
}

void TDSSensor::setReferenceTempC(float tempC) {
    _referenceTempC = tempC;
}
