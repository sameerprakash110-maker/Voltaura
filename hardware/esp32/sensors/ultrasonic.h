#pragma once

#include <Arduino.h>

/**
 * ============================================================================
 * UltrasonicSensor Interface (HC-SR04)
 * ============================================================================
 * 
 * Hardware driver for HC-SR04 ultrasonic water level measurement.
 * 
 * Measurement Principles:
 *   1. Transmits a 10 microsecond trigger pulse.
 *   2. Measures the echo high pulse duration with a non-blocking timeout.
 *   3. Computes distance via speed of sound: distance_cm = duration_us / 58.0.
 *   4. Performs multi-sample pinging and extracts the median to filter acoustic noise.
 *   5. Converts distance to water height:
 *        water_height_cm = tank_reference_height_cm - measured_distance_cm
 *   6. Calculates level percentage:
 *        water_level_pct = (water_height_cm / usable_height_cm) * 100.0
 *      and clamps legitimate values strictly to [0.0% - 100.0%].
 * 
 * Electrical Safety:
 *   - HC-SR04 Echo line operates at 5.0V.
 *   - MUST be level-shifted to 3.3V (e.g. 1k / 2k resistor divider) before ESP32 GPIO.
 * ============================================================================
 */

class UltrasonicSensor {
public:
    /**
     * @param trigPin GPIO connected to HC-SR04 Trigger (3.3V Output)
     * @param echoPin GPIO connected to HC-SR04 Echo via Level Shifter (3.3V Input)
     * @param tankRefHeightCm Tank reference height from sensor face to bottom (cm)
     * @param deadbandCm Transducer blind zone offset (sensor face to max fill line, cm)
     * @param minDistanceCm Physical minimum distance limit for HC-SR04 (default 2.0 cm)
     * @param maxDistanceCm Physical maximum reliable distance limit (default 400.0 cm)
     * @param sampleCount Number of pings for median noise filter (default 5)
     * @param timeoutUs Echo pulseIn timeout in microseconds (default 25000 us)
     * @param sampleIntervalMs Delay between successive pings for acoustic ring-down (default 30 ms)
     */
    UltrasonicSensor(
        uint8_t trigPin,
        uint8_t echoPin,
        float tankRefHeightCm,
        float deadbandCm = 10.0f,
        float minDistanceCm = 2.0f,
        float maxDistanceCm = 400.0f,
        uint8_t sampleCount = 5,
        unsigned long timeoutUs = 25000,
        unsigned long sampleIntervalMs = 30
    );

    /**
     * Configures GPIO pin modes (TRIG output, ECHO input).
     */
    void begin();

    /**
     * Performs a filtered measurement cycle using median filtering across multiple pings.
     * 
     * @param outLevelPct Output: Water depth as percentage [0.0 - 100.0%]
     * @param outLevelCm Output: Current liquid depth in centimeters
     * @param outRawDistanceCm Output: Median distance from sensor face to water surface
     * @param outErrorCode Output: Populated with error code if read fails
     * @return true if valid reading obtained; false on timeout or deadband violation
     */
    bool read(float &outLevelPct, float &outLevelCm, float &outRawDistanceCm, String &outErrorCode);

    /**
     * Executes a single trigger and echo ping measurement.
     * 
     * @param outPingError Output: Error string if single ping fails
     * @return Measured distance in cm, or -1.0f on error/timeout
     */
    float pingSingle(String &outPingError);

    /**
     * Returns true if the sensor GPIO pins have been initialized.
     */
    bool isConnected() const;

private:
    uint8_t _trigPin;
    uint8_t _echoPin;
    float _tankRefHeightCm;
    float _deadbandCm;
    float _minDistanceCm;
    float _maxDistanceCm;
    uint8_t _sampleCount;
    unsigned long _timeoutUs;
    unsigned long _sampleIntervalMs;
    bool _initialized;
};
