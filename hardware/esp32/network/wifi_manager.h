#pragma once

#include <Arduino.h>
#include <WiFi.h>

/**
 * ============================================================================
 * WiFiManager Interface
 * ============================================================================
 * 
 * Manages ESP32 Wi-Fi station mode connectivity.
 * 
 * Architectural Guarantees:
 *   - Bounded startup connection timeout (offline-first: never hangs the boot loop).
 *   - Non-blocking periodic reconnection state machine using millis() timing.
 *   - Safe credential handling (passwords are NEVER logged to Serial).
 *   - Direct RSSI signal strength extraction for telemetry diagnostics.
 *   - Modular decoupling: network state does not interfere with sensor sampling.
 * ============================================================================
 */

class WiFiManager {
public:
    /**
     * @param ssid Target Wi-Fi SSID
     * @param password Target Wi-Fi WPA2 pre-shared key
     * @param connectTimeoutMs Maximum milliseconds to wait for connection at boot (default: 10000ms)
     * @param reconnectIntervalMs Milliseconds between reconnection attempts when offline (default: 30000ms)
     */
    WiFiManager(
        const char* ssid,
        const char* password,
        uint32_t connectTimeoutMs = 10000,
        uint32_t reconnectIntervalMs = 30000
    );

    /**
     * Initializes Wi-Fi in station mode and attempts an initial bounded connection.
     * If association times out, the node continues executing in offline mode.
     */
    void begin();

    /**
     * Periodic non-blocking connection monitor. Must be invoked from loop().
     * Handles reconnection on disconnect using non-blocking millis() timing.
     */
    void update();

    /**
     * Returns true if currently associated and assigned an IP address.
     */
    bool isConnected() const;

    /**
     * Checks whether a valid RSSI reading is currently available.
     * @return true if associated and assigned an IP address.
     */
    bool hasRssi() const;

    /**
     * Returns current Received Signal Strength Indicator (RSSI) in dBm if connected,
     * or 0 if disconnected. Caller should check hasRssi() or use getRssi(int16_t&).
     */
    int16_t getRssi() const;

    /**
     * Explicit RSSI availability accessor.
     * @param rssiOut Output reference populated with signal strength in dBm if available.
     * @return true if connected and rssiOut was populated; false otherwise.
     */
    bool getRssi(int16_t& rssiOut) const;

    /**
     * Returns the assigned local IP address string (e.g. "192.168.1.50" or "0.0.0.0").
     */
    String getLocalIp() const;

    /**
     * Returns the configured target SSID.
     */
    const char* getSsid() const;

private:
    const char* _ssid;
    const char* _password;
    uint32_t _connectTimeoutMs;
    uint32_t _reconnectIntervalMs;
    unsigned long _lastReconnectAttemptMillis;
    bool _wasConnected;
    bool _credentialsValid;
};
