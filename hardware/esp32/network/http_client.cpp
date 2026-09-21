#include "http_client.h"
#include <WiFiClientSecure.h>

TelemetryHttpClient::TelemetryHttpClient(
    const char* backendUrl,
    const char* sensorKey,
    uint32_t timeoutMs
) : _backendUrl(backendUrl),
    _sensorKey(sensorKey),
    _timeoutMs(timeoutMs) {}

void TelemetryHttpClient::begin() {
    // No persistent connection setup required for HTTPClient
}

HttpResponse TelemetryHttpClient::postTelemetry(const String& jsonPayload) {
    HttpResponse result;
    result.success = false;
    result.httpCode = 0;
    result.responseBody = "";
    result.errorMessage = "";

    if (_backendUrl == nullptr || strlen(_backendUrl) == 0) {
        result.errorMessage = "Backend URL unconfigured";
        return result;
    }

    bool isHttps = (strncmp(_backendUrl, "https://", 8) == 0);
    HTTPClient http;
    http.setTimeout(_timeoutMs);

    bool initOk = false;
    WiFiClient plainClient;
    WiFiClientSecure secureClient;

    if (isHttps) {
#ifdef ROOT_CA_CERTIFICATE
        secureClient.setCACert(ROOT_CA_CERTIFICATE);
        initOk = http.begin(secureClient, _backendUrl);
#else
        // Insecure TLS bypass is strictly prohibited by architectural policy.
        result.errorMessage = "HTTPS requested but ROOT_CA_CERTIFICATE unconfigured; setInsecure bypass prohibited";
        return result;
#endif
    } else {
        initOk = http.begin(plainClient, _backendUrl);
    }

    if (!initOk) {
        result.errorMessage = "Failed to initialize HTTP client for URL";
        return result;
    }

    http.addHeader("Content-Type", "application/json");
    if (_sensorKey != nullptr && strlen(_sensorKey) > 0) {
        http.addHeader("X-Sensor-Key", _sensorKey);
    }

    int httpResponseCode = http.POST(jsonPayload);
    result.httpCode = httpResponseCode;

    if (httpResponseCode > 0) {
        result.responseBody = http.getString();
        if (httpResponseCode >= 200 && httpResponseCode < 300) {
            result.success = true;
        } else {
            result.errorMessage = "Server returned non-2xx status";
        }
    } else {
        result.errorMessage = http.errorToString(httpResponseCode);
    }

    http.end();
    return result;
}

const char* TelemetryHttpClient::getEndpointUrl() const {
    return _backendUrl;
}
