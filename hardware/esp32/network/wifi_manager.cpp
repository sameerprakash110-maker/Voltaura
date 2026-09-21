#include "wifi_manager.h"

WiFiManager::WiFiManager(
    const char* ssid,
    const char* password,
    uint32_t connectTimeoutMs,
    uint32_t reconnectIntervalMs
) : _ssid(ssid),
    _password(password),
    _connectTimeoutMs(connectTimeoutMs),
    _reconnectIntervalMs(reconnectIntervalMs),
    _lastReconnectAttemptMillis(0),
    _wasConnected(false),
    _credentialsValid(false) {
    if (_ssid != nullptr && strlen(_ssid) > 0 && strcmp(_ssid, "YOUR_WIFI_SSID") != 0) {
        _credentialsValid = true;
    }
}

void WiFiManager::begin() {
    if (!_credentialsValid) {
        Serial.println("[WiFi] No valid credentials configured in secrets.h.");
        Serial.println("[WiFi] Operating in OFFLINE mode (sensors running normally).");
        WiFi.mode(WIFI_OFF);
        return;
    }

    Serial.println("[WiFi] Initializing Station mode...");
    Serial.printf("[WiFi] Connecting to SSID: %s (Bounded timeout: %u ms)...\n", _ssid, _connectTimeoutMs);

    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.begin(_ssid, _password);

    // Bounded startup connection wait
    unsigned long startMillis = millis();
    while (WiFi.status() != WL_CONNECTED && (millis() - startMillis < _connectTimeoutMs)) {
        delay(250);
        Serial.print(".");
    }
    Serial.println();

    if (WiFi.status() == WL_CONNECTED) {
        _wasConnected = true;
        Serial.println("[WiFi] Connected!");
        Serial.printf("[WiFi] IP: %s\n", WiFi.localIP().toString().c_str());
        Serial.printf("[WiFi] RSSI: %d dBm\n", WiFi.RSSI());
    } else {
        _wasConnected = false;
        Serial.println("[WiFi] Connection timeout.");
        Serial.println("[WiFi] Continuing in OFFLINE mode (sensors running normally).");
        _lastReconnectAttemptMillis = millis();
    }
}

void WiFiManager::update() {
    if (!_credentialsValid) {
        return;
    }

    bool currentlyConnected = (WiFi.status() == WL_CONNECTED);

    if (currentlyConnected) {
        if (!_wasConnected) {
            _wasConnected = true;
            Serial.println("[WiFi] Connection restored!");
            Serial.printf("[WiFi] IP: %s\n", WiFi.localIP().toString().c_str());
            Serial.printf("[WiFi] RSSI: %d dBm\n", WiFi.RSSI());
        }
        return;
    }

    // State transition from connected -> disconnected
    if (_wasConnected) {
        _wasConnected = false;
        Serial.println("[WiFi] Connection lost.");
        Serial.println("[WiFi] Continuing in OFFLINE mode.");
        _lastReconnectAttemptMillis = millis();
    }

    // Non-blocking periodic reconnect attempt using millis()
    unsigned long currentMillis = millis();
    if (currentMillis - _lastReconnectAttemptMillis >= _reconnectIntervalMs) {
        _lastReconnectAttemptMillis = currentMillis;
        Serial.println("[WiFi] Attempting non-blocking reconnect...");
        WiFi.disconnect();
        WiFi.begin(_ssid, _password);
    }
}

bool WiFiManager::isConnected() const {
    return (WiFi.status() == WL_CONNECTED);
}

bool WiFiManager::hasRssi() const {
    return isConnected();
}

int16_t WiFiManager::getRssi() const {
    if (isConnected()) {
        return static_cast<int16_t>(WiFi.RSSI());
    }
    return 0;
}

bool WiFiManager::getRssi(int16_t& rssiOut) const {
    if (isConnected()) {
        rssiOut = static_cast<int16_t>(WiFi.RSSI());
        return true;
    }
    rssiOut = 0;
    return false;
}

String WiFiManager::getLocalIp() const {
    if (isConnected()) {
        return WiFi.localIP().toString();
    }
    return "0.0.0.0";
}

const char* WiFiManager::getSsid() const {
    return _ssid;
}
