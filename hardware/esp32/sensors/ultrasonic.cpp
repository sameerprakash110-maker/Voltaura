#include "ultrasonic.h"
#include <math.h>

/**
 * ============================================================================
 * UltrasonicSensor Implementation (HC-SR04)
 * ============================================================================
 * 
 * Hardware driver implementing trigger pulse sequence, echo duration timing,
 * median noise filtering, physical validation, and tank depth / level conversion.
 * ============================================================================
 */

UltrasonicSensor::UltrasonicSensor(
    uint8_t trigPin,
    uint8_t echoPin,
    float tankRefHeightCm,
    float deadbandCm,
    float minDistanceCm,
    float maxDistanceCm,
    uint8_t sampleCount,
    unsigned long timeoutUs,
    unsigned long sampleIntervalMs
) : _trigPin(trigPin),
    _echoPin(echoPin),
    _tankRefHeightCm(tankRefHeightCm),
    _deadbandCm(deadbandCm),
    _minDistanceCm(minDistanceCm),
    _maxDistanceCm(maxDistanceCm),
    _sampleCount(sampleCount),
    _timeoutUs(timeoutUs),
    _sampleIntervalMs(sampleIntervalMs),
    _initialized(false) {}

void UltrasonicSensor::begin() {
    pinMode(_trigPin, OUTPUT);
    pinMode(_echoPin, INPUT);
    digitalWrite(_trigPin, LOW);
    _initialized = true;
}

float UltrasonicSensor::pingSingle(String &outPingError) {
    if (!_initialized) {
        outPingError = "ULTRASONIC_NOT_INITIALIZED";
        return -1.0f;
    }

    // 1. Ensure clean LOW state before trigger
    digitalWrite(_trigPin, LOW);
    delayMicroseconds(4);

    // 2. Transmit 10 microsecond HIGH trigger pulse
    digitalWrite(_trigPin, HIGH);
    delayMicroseconds(10);
    digitalWrite(_trigPin, LOW);

    // 3. Measure duration of incoming HIGH echo pulse on level-shifted Echo pin
    // pulseIn returns duration in microseconds, or 0 if timeout expired.
    unsigned long durationUs = pulseIn(_echoPin, HIGH, _timeoutUs);

    // 4. Validate pulse duration
    if (durationUs == 0) {
        outPingError = "ULTRASONIC_ECHO_TIMEOUT";
        return -1.0f;
    }

    // 5. Convert pulse duration to distance in centimeters.
    // Physics relationship: distance = (duration * speed_of_sound) / 2
    // Practical approximation around room temperature (~20 C):
    //   Speed of sound in dry air ≈ 343 m/s = 0.0343 cm/us
    //   1 / (0.0343 / 2) ≈ 58.3 us/cm -> practical standard approximation: 58.0 us/cm
    // Note: Assumes ambient room temperature; not laboratory-grade calibration.
    float distanceCm = static_cast<float>(durationUs) / 58.0f;

    // 6. Validate physical operating bounds
    if (isnan(distanceCm) || isinf(distanceCm)) {
        outPingError = "ULTRASONIC_INVALID_CALCULATION";
        return -1.0f;
    }

    if (distanceCm < _minDistanceCm) {
        // Transducer blind zone / acoustic ring violation (< 2.0 cm)
        outPingError = "ULTRASONIC_DEADBAND_VIOLATION";
        return -1.0f;
    }

    if (distanceCm > _maxDistanceCm) {
        // Echo returned beyond reliable physical range of HC-SR04 (> 400.0 cm)
        outPingError = "ULTRASONIC_OUT_OF_RANGE";
        return -1.0f;
    }

    outPingError = "";
    return distanceCm;
}

bool UltrasonicSensor::read(float &outLevelPct, float &outLevelCm, float &outRawDistanceCm, String &outErrorCode) {
    if (!_initialized) {
        outErrorCode = "ULTRASONIC_NOT_INITIALIZED";
        outLevelPct = 0.0f;
        outLevelCm = 0.0f;
        outRawDistanceCm = 0.0f;
        return false;
    }

    // Multi-sample collection for median noise filtering
    // Limits temporary buffer to fixed stack memory (no dynamic heap allocation)
    constexpr uint8_t MAX_SAMPLES = 16;
    uint8_t targetSamples = (_sampleCount > MAX_SAMPLES) ? MAX_SAMPLES : _sampleCount;
    if (targetSamples < 1) targetSamples = 1;

    float validSamples[MAX_SAMPLES];
    uint8_t validCount = 0;
    String lastPingError = "";

    for (uint8_t i = 0; i < targetSamples; i++) {
        // Insert short delay between successive pings to let acoustic reflections dissipate
        if (i > 0 && _sampleIntervalMs > 0) {
            delay(_sampleIntervalMs);
        }

        String pingError = "";
        float dist = pingSingle(pingError);

        if (dist >= 0.0f) {
            validSamples[validCount++] = dist;
        } else {
            lastPingError = pingError;
        }
    }

    // Reject reading if no valid pings were captured
    if (validCount == 0) {
        outErrorCode = (lastPingError.length() > 0) ? lastPingError : "ULTRASONIC_MEASUREMENT_FAILED";
        outLevelPct = 0.0f;
        outLevelCm = 0.0f;
        outRawDistanceCm = 0.0f;
        return false;
    }

    // Median filter: Sort valid samples ascending using simple insertion sort
    for (uint8_t i = 1; i < validCount; i++) {
        float key = validSamples[i];
        int j = i - 1;
        while (j >= 0 && validSamples[j] > key) {
            validSamples[j + 1] = validSamples[j];
            j--;
        }
        validSamples[j + 1] = key;
    }

    // Extract median sample
    float medianDistanceCm = validSamples[validCount / 2];
    outRawDistanceCm = medianDistanceCm;

    // Convert measured distance to liquid height:
    //   water_height_cm = tank_reference_height_cm - measured_distance_cm
    float waterHeightCm = _tankRefHeightCm - medianDistanceCm;

    // Calibration boundary handling:
    // 1. If water is physically below configured zero (empty tank or sensor offset error),
    //    clamp water height to 0.0 cm.
    if (waterHeightCm < 0.0f) {
        waterHeightCm = 0.0f;
    }

    // 2. Usable tank height excludes the top sensor mounting deadband zone
    float usableHeightCm = _tankRefHeightCm - _deadbandCm;
    if (usableHeightCm <= 0.0f) {
        usableHeightCm = _tankRefHeightCm;
    }

    // 3. If water level reaches into top deadband, clamp water height to usable maximum
    if (waterHeightCm > usableHeightCm) {
        waterHeightCm = usableHeightCm;
    }

    // Calculate percentage:
    //   water_level_pct = (water_height_cm / usable_height_cm) * 100.0
    float levelPct = 0.0f;
    if (usableHeightCm > 0.0f) {
        levelPct = (waterHeightCm / usableHeightCm) * 100.0f;
    }

    // Strictly clamp calculated percentage to [0.0% - 100.0%] per contract rules
    if (levelPct < 0.0f) levelPct = 0.0f;
    if (levelPct > 100.0f) levelPct = 100.0f;

    outLevelCm = waterHeightCm;
    outLevelPct = levelPct;
    outErrorCode = "";
    return true;
}

bool UltrasonicSensor::isConnected() const {
    return _initialized;
}
