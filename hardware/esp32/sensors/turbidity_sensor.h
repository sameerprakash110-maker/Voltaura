#pragma once

#include <Arduino.h>

/**
 * ============================================================================
 * TurbiditySensor Interface (Analog Optical Turbidity Sensor)
 * ============================================================================
 * 
 * Hardware abstraction for analog optical turbidity sensor (e.g. TS-300B / DFRobot SEN0189 style).
 * Measures phototransistor analog output voltage through ESP32 ADC1 (GPIO 35 / ADC1_CH7).
 * 
 * Electrical & Architectural Safety:
 *   - Pin: GPIO 35 (ADC1 input-only pin; ADC2 cannot be used with Wi-Fi).
 *   - Safe ADC Voltage Range: 0.0V to 3.3V (ADC_11db attenuation).
 *   - WARNING: Optical turbidity modules can output 4.2V - 4.5V in clean water!
 *     A hardware resistive voltage divider or onboard potentiometer scaling to <= 3.0V
 *     is REQUIRED to avoid overvolting GPIO 35.
 *   - Voltage Divider Ratio: Configurable multiplier (V_sensor / V_pin).
 * 
 * Directionality & Physical Optics:
 *   - Clean Water: IR light passes through unhindered -> High phototransistor current -> High voltage.
 *   - Turbid Water: Suspended particles scatter IR light -> Low phototransistor current -> Low voltage.
 *   - Clear Baseline: Voltage in clean potable tap water (~0.0 NTU).
 *   - Calibration Slope: Configurable NTU per volt drop from clear baseline.
 *   - Note: The value is an ESTIMATE and requires physical calibration with Formazin turbidity standards.
 * 
 * Telemetry Contract Alignment (docs/TELEMETRY_CONTRACT.md):
 *   - turbidity_ntu: Float [0.0 - 3000.0] NTU or null if disconnected / saturated / invalid.
 *   - Never reports 0.0 NTU for an electrical fault condition.
 *   - Error codes: TURBIDITY_ADC_INVALID, TURBIDITY_VOLTAGE_OUT_OF_RANGE, TURBIDITY_CALCULATION_INVALID.
 *   - Diagnostics: Exposes estimated ADC-pin voltage (millivolts) to diagnostics.turbidity_voltage_mv
 *     (based on the nominal 3300mV Vref assumption, unless calibrated against actual ESP32).
 * ============================================================================
 */

class TurbiditySensor {
public:
    /**
     * @param adcPin ADC1 GPIO (PROVISIONAL: GPIO 35 / ADC1_CH7)
     * @param vrefMv ESP32 ADC reference full-scale voltage in millivolts (nominal: 3300.0 mV)
     * @param clearVoltageMv Expected sensor output voltage in 0.0 NTU clean water (default: 3000.0 mV)
     * @param voltageDividerRatio Hardware divider ratio V_sensor / V_pin (default: 1.0)
     * @param calibrationSlope Linear conversion factor: NTU per volt drop from clear baseline (default: 400.0)
     * @param sampleCount Number of ADC readings averaged per measurement (default: 10)
     * @param minVoltageMv Minimum valid ADC pin millivolts before flagging disconnected probe (default: 50.0 mV)
     * @param maxVoltageMv Maximum valid ADC pin millivolts before flagging saturation/overvoltage (default: 3250.0 mV)
     * @param maxNtu Physical ceiling for valid turbidity reading per contract (default: 3000.0 NTU)
     */
    TurbiditySensor(
        uint8_t adcPin,
        float vrefMv = 3300.0f,
        float clearVoltageMv = 3000.0f,
        float voltageDividerRatio = 1.0f,
        float calibrationSlope = 400.0f,
        uint8_t sampleCount = 10,
        float minVoltageMv = 50.0f,
        float maxVoltageMv = 3250.0f,
        float maxNtu = 3000.0f
    );

    /**
     * Initializes GPIO pin mode and ADC attenuation.
     */
    void begin();

    /**
     * Samples the phototransistor voltage, applies multisampling noise reduction,
     * validates electrical bounds, and calculates estimated turbidity in NTU.
     * 
     * @param outTurbidityNtu Output: Turbidity in NTU [0.0 - 3000.0] (valid only if function returns true)
     * @param outPinVoltageMv Output: Estimated ADC-pin voltage in millivolts (nominal Vref assumption)
     * @param outErrorCode Output: Populated with error code if read fails
     * @return true if valid reading obtained; false on optical/electrical fault
     */
    bool read(float &outTurbidityNtu, float &outPinVoltageMv, String &outErrorCode);

    /**
     * Isolated conversion function: converts sensor voltage (millivolts) to estimated NTU.
     * Isolated for auditability and calibration curve adjustment without altering driver plumbing.
     */
    static float voltageToNtu(
        float sensorVoltageMv,
        float clearVoltageMv,
        float calibrationSlope,
        float maxNtu,
        String &outErrorCode
    );

    bool isConnected() const;
    uint8_t getPin() const;
    float getClearVoltageMv() const;
    void setClearVoltageMv(float clearMv);
    float getVoltageDividerRatio() const;
    void setVoltageDividerRatio(float ratio);
    float getCalibrationSlope() const;
    void setCalibrationSlope(float slope);

private:
    uint8_t _adcPin;
    float _vrefMv;
    float _clearVoltageMv;
    float _voltageDividerRatio;
    float _calibrationSlope;
    uint8_t _sampleCount;
    float _minVoltageMv;
    float _maxVoltageMv;
    float _maxNtu;
    bool _initialized;
};
