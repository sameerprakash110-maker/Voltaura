#pragma once

/**
 * ============================================================================
 * EcoTwin ESP32 Water Node - Wi-Fi Credentials Template
 * ============================================================================
 * 
 * INSTRUCTIONS:
 * 1. Copy this file and rename it to 'secrets.h' in the same directory:
 *      cp hardware/esp32/secrets.example.h hardware/esp32/secrets.h
 * 2. Replace the placeholder values below with your actual local Wi-Fi SSID
 *    and WPA2 password.
 * 3. Never commit 'secrets.h' to source control. ('secrets.h' is gitignored).
 * ============================================================================
 */

// Replace with your local Wi-Fi network credentials
#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// Backend HTTP ingestion endpoint and device authentication secret
#define BACKEND_HTTP_URL "http://192.168.1.100:8000/api/telemetry"
#define SENSOR_API_KEY "dev-secret-key-lib-01"
