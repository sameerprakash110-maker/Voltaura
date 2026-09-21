#pragma once

#include <Arduino.h>

/**
 * ============================================================================
 * TDSSensor Interface (Analog Total Dissolved Solids)
 * ============================================================================
 * 
 * Hardware abstraction for analog TDS (Total Dissolved Solids) probe.
 * Measures analog probe voltage through ESP32 ADC1 (GPIO 34 / ADC1_CH6).
 * 
 * Electrical & Architectural Safety:
 *   - Pin: GPIO 34 (ADC1 input-only pin; ADC2 cannot be used with Wi-Fi).
 *   - Safe ADC Voltage Range: 0.0V to 3.3V (ADC_11db attenuation).
 *   - Voltage Divider Ratio: Configurable multiplier (V_sensor / V_pin).
 *   - Multisampling: Arithmetic average across N samples to suppress electrical noise.
 * 
 * Mathematical Model:
 *   - Temperature Compensation: Uses configurable reference assumption (default 25.0 C).
 *     NOTE: Hardware suite lacks a physical temperature probe; do not assume live temperature.
 *   - Cubic Polynomial: Standard DFRobot-style curve:
 *       TDS_ppm = (133.42 * V^3 - 255.86 * V^2 + 857.39 * V) * 0.5 * calibrationFactor
 *     The value is an ESTIMATE and requires physical calibration with a 1413 uS/cm standard solution.
 * 
 * Telemetry Contract Alignment (docs/TELEMETRY_CONTRACT.md):
 *   - tds_ppm: Integer [0 - 1500] or null if probe dry / disconnected / invalid.
 *   - Never reports 0 ppm for an electrical error condition.
 *   - Error codes: TDS_PROBE_DRY, TDS_VOLTAGE_OUT_OF_RANGE, TDS_CALCULATION_INVALID.
 *   - Diagnostics: Exposes estimated ADC-pin voltage (millivolts) to diagnostics.tds_voltage_mv
 *     (based on the nominal 3300mV Vref assumption, unless calibrated against actual ESP32).
 * ============================================================================
 */

class TDSSensor {
public:
    /**
     * @param adcPin ADC1 GPIO (PROVISIONAL: GPIO 34 / ADC1_CH6)
     * @param vrefMv ESP32 ADC reference full-scale voltage in millivolts (nominal: 3300.0 mV)
     * @param calibrationFactor Ratio multiplier derived from calibration solution (default: 1.0)
     * @param voltageDividerRatio Hardware divider ratio V_sensor / V_pin (default: 1.0)
     * @param referenceTempC Standard reference water temperature in degrees C (default: 25.0 C)
     * @param sampleCount Number of ADC readings averaged per measurement (default: 10)
     * @param minVoltageMv Minimum valid ADC pin millivolts before flagging dry/open probe (default: 20.0 mV)
     * @param maxVoltageMv Maximum valid ADC pin millivolts before flagging saturation (default: 3200.0 mV)
     * @param maxPpm Upper limit for valid TDS reading per contract (default: 1500 ppm)
     */
    TDSSensor(
        uint8_t adcPin,
        float vrefMv = 3300.0f,
        float calibrationFactor = 1.0f,
        float voltageDividerRatio = 1.0f,
        float referenceTempC = 25.0f,
        uint8_t sampleCount = 10,
        float minVoltageMv = 20.0f,
        float maxVoltageMv = 3200.0f,
        int maxPpm = 1500
    );

    /**
     * Initializes GPIO pin mode and ADC attenuation.
     */
    void begin();

    /**
     * Samples the probe voltage, applies multisampling noise reduction,
     * validates electrical bounds, and calculates estimated TDS ppm.
     * 
     * @param outTdsPpm Output: Total dissolved solids in ppm [0 - 1500] (valid only if function returns true)
     * @param outPinVoltageMv Output: Estimated ADC-pin voltage in millivolts (nominal Vref assumption)
     * @param outErrorCode Output: Populated with error code if read fails
     * @return true if valid reading obtained; false on electrical fault or out-of-range
     */
    bool read(int &outTdsPpm, float &outPinVoltageMv, String &outErrorCode);

    /**
     * Isolated conversion function: converts sensor voltage (Volts) to estimated TDS in ppm.
     * Isolated for auditability and recalibration without modifying driver flow.
     */
    static float voltageToPpm(
        float sensorVolts,
        float calibrationFactor,
        float referenceTempC,
        int maxPpm,
        String &outErrorCode
    );

    bool isConnected() const;
    uint8_t getPin() const;
    float getCalibrationFactor() const;
    void setCalibrationFactor(float factor);
    float getVoltageDividerRatio() const;
    void setVoltageDividerRatio(float ratio);
    float getReferenceTempC() const;
    void setReferenceTempC(float tempC);

private:
    uint8_t _adcPin;
    float _vrefMv;
    float _calibrationFactor;
    float _voltageDividerRatio;
    float _referenceTempC;
    uint8_t _sampleCount;
    float _minVoltageMv;
    float _maxVoltageMv;
    int _maxPpm;
    bool _initialized;
};
