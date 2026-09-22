#pragma once

#include <Arduino.h>
#include <time.h>

/**
 * ============================================================================
 * NtpClient Interface (Step 10)
 * ============================================================================
 * 
 * Manages ESP32 SNTP time synchronization with bounded non-blocking behavior.
 * 
 * Guarantees:
 *   - Non-blocking: never halts loop() or setup() waiting for time.
 *   - Strict UTC: synchronizes to UTC (zero GMT/daylight offset).
 *   - Explicit synchronization validation: does not consider time valid until
 *     epoch > 1700000000 (after Nov 2023).
 *   - ISO-8601 formatting: produces "YYYY-MM-DDTHH:MM:SSZ".
 *   - Safe fallback: returns empty string ("") if unconfirmed, which serializes
 *     to JSON null per docs/TELEMETRY_CONTRACT.md.
 *   - Resilient: continues background sync and recovers after Wi-Fi drops.
 * ============================================================================
 */

class NtpClient {
public:
    /**
     * @param server1 Primary NTP server hostname
     * @param server2 Secondary/backup NTP server hostname
     */
    NtpClient(
        const char* server1 = "pool.ntp.org",
        const char* server2 = "time.google.com"
    );

    /**
     * Initializes SNTP client with configured servers and 0 offset (UTC).
     * Bounded and non-blocking: schedules background synchronization.
     */
    void begin();

    /**
     * Periodic check/refresh called from loop().
     */
    void update();

    /**
     * Checks if a valid time has been acquired from NTP.
     * Evaluates whether current system epoch is >= valid threshold (1700000000UL).
     */
    bool isSynchronized() const;

    /**
     * Returns ISO-8601 UTC timestamp string (e.g. "2026-09-21T17:30:15Z").
     * Returns empty string ("") if time is not yet synchronized.
     */
    String getIsoUtcTimestamp() const;

    /**
     * Returns current raw epoch time in seconds, or 0 if not synchronized.
     */
    time_t getEpochTime() const;

private:
    const char* _server1;
    const char* _server2;
    bool _initialized;
    mutable bool _lastSyncState;
};
