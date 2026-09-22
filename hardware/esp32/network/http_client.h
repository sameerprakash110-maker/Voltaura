#pragma once

#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFiClient.h>

/**
 * ============================================================================
 * TelemetryHttpClient Interface
 * ============================================================================
 * 
 * Transmits serialized canonical JSON telemetry packets to the backend
 * via HTTP POST with X-Sensor-Key device authentication.
 * 
 * Architectural Guarantees:
 *   - Bounded HTTP timeout (default 3000ms; never hangs sensor acquisition).
 *   - Offline-safe: Caller only invokes when Wi-Fi is connected.
 *   - Graceful failure handling: Connection errors or HTTP 4xx/5xx codes
 *     are logged to Serial without halting or restarting the node.
 *   - Zero credential exposure: Never prints sensor secrets to Serial.
 *   - Clearly distinguishes local packet generation from backend acceptance.
 * ============================================================================
 */

struct HttpResponse {
    bool success;
    int httpCode;
    String responseBody;
    String errorMessage;
};

class TelemetryHttpClient {
public:
    /**
     * @param backendUrl Full HTTP POST URL (e.g. "http://192.168.1.100:8000/api/telemetry")
     * @param sensorKey Device API secret passed via X-Sensor-Key header
     * @param timeoutMs Maximum socket timeout in milliseconds (default: 3000ms)
     */
    TelemetryHttpClient(
        const char* backendUrl,
        const char* sensorKey,
        uint32_t timeoutMs = 3000
    );

    void begin();

    /**
     * Posts a JSON telemetry payload to the configured endpoint.
     * 
     * @param jsonPayload Serialized JSON string matching docs/TELEMETRY_CONTRACT.md
     * @return HttpResponse containing status code, success flag, and diagnostics
     */
    HttpResponse postTelemetry(const String& jsonPayload);

    const char* getEndpointUrl() const;

private:
    const char* _backendUrl;
    const char* _sensorKey;
    uint32_t _timeoutMs;
};
