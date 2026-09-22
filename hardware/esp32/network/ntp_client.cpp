#include "ntp_client.h"

// Threshold epoch: 2023-11-14 00:00:00 UTC (1700000000UL)
// Prevents default 1970/boot epochs from being accepted as valid synchronized timestamps.
static constexpr time_t MIN_VALID_EPOCH = 1700000000UL;

NtpClient::NtpClient(const char* server1, const char* server2)
    : _server1(server1),
      _server2(server2),
      _initialized(false),
      _lastSyncState(false) {}

void NtpClient::begin() {
    if (_initialized) {
        return;
    }
    Serial.println("[NTP] Initializing SNTP client (Strict UTC)...");
    if (_server1 != nullptr && strlen(_server1) > 0) {
        Serial.printf("[NTP] Primary Server: %s\n", _server1);
    }
    if (_server2 != nullptr && strlen(_server2) > 0) {
        Serial.printf("[NTP] Backup Server:  %s\n", _server2);
    }

    // Configure SNTP with 0 GMT offset and 0 daylight offset (Strict UTC)
    configTime(0, 0, _server1, _server2);
    _initialized = true;
    Serial.println("[NTP] Background SNTP synchronization scheduled (non-blocking).");
}

void NtpClient::update() {
    if (!_initialized) {
        return;
    }
    bool syncNow = isSynchronized();
    if (syncNow && !_lastSyncState) {
        _lastSyncState = true;
        Serial.println("[NTP] Time synchronization established!");
        Serial.printf("[NTP] Current UTC Timestamp: %s\n", getIsoUtcTimestamp().c_str());
    } else if (!syncNow && _lastSyncState) {
        _lastSyncState = false;
        Serial.println("[NTP] Warning: Time synchronization lost.");
    }
}

bool NtpClient::isSynchronized() const {
    if (!_initialized) {
        return false;
    }
    time_t now = 0;
    time(&now);
    return (now >= MIN_VALID_EPOCH);
}

time_t NtpClient::getEpochTime() const {
    if (!isSynchronized()) {
        return 0;
    }
    time_t now = 0;
    time(&now);
    return now;
}

String NtpClient::getIsoUtcTimestamp() const {
    if (!isSynchronized()) {
        return "";
    }
    time_t now = 0;
    time(&now);

    struct tm timeinfo;
    if (gmtime_r(&now, &timeinfo) == nullptr) {
        return "";
    }

    char buf[32];
    // Format: YYYY-MM-DDTHH:MM:SSZ
    size_t written = strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &timeinfo);
    if (written == 0) {
        return "";
    }
    return String(buf);
}
