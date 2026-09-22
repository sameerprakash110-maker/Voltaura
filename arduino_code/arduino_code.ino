#include <WiFi.h>
#include <HTTPClient.h>

// =====================================================
//                    VOLTORA
//          Smart Water Management System
// =====================================================


// =====================================================
//                    SENSOR PINS
// =====================================================

#define TRIG 27
#define ECHO 14

// IMPORTANT:
// GPIO 34 is ADC1 and works with Wi-Fi
#define TURBIDITY_PIN 34

// TDS sensor analog output
#define TDS_PIN 35


// =====================================================
//                    TANK SETTINGS
// =====================================================

// Distance from ultrasonic sensor to bottom
// when the tank is empty.
const float TANK_HEIGHT = 22.0;


// =====================================================
//                    WIFI SETTINGS
// =====================================================

const char* ssid = "DivamA35";
const char* password = "password";


// =====================================================
//                    SERVER SETTINGS
// =====================================================

// Your laptop IPv4 address on the ESP32's Wi-Fi network:
// 10.196.23.106
//
// FastAPI backend:
// Port = 8000
//
// POST endpoint:
// /sensor


const char* serverName = "http://10.196.23.106:8000/api/telemetry/water";


// =====================================================
//                    ULTRASONIC
// =====================================================

float getDistance() {

  digitalWrite(TRIG, LOW);
  delayMicroseconds(2);

  digitalWrite(TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG, LOW);

  long duration = pulseIn(ECHO, HIGH, 30000);

  // No echo received
  if (duration == 0) {
    return -1;
  }

  float distance = duration * 0.0343 / 2.0;

  return distance;
}


// =====================================================
//                    WIFI CONNECTION
// =====================================================

void connectWiFi() {

  Serial.println();
  Serial.println("Connecting to Wi-Fi...");

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  int attempts = 0;

  while (WiFi.status() != WL_CONNECTED && attempts < 30) {

    delay(500);
    Serial.print(".");
    attempts++;
  }

  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {

    Serial.println("================================");
    Serial.println("Wi-Fi Connected!");
    Serial.println("================================");

    Serial.print("Wi-Fi Name: ");
    Serial.println(WiFi.SSID());

    Serial.print("ESP32 IP Address: ");
    Serial.println(WiFi.localIP());

    Serial.print("Signal Strength: ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");

    Serial.println();

  } else {

    Serial.println("Wi-Fi connection failed!");
    Serial.println("Check Wi-Fi name and password.");
  }
}


// =====================================================
//                    SEND DATA
// =====================================================

void sendData(
  float distance,
  float waterLevel,
  float waterPercentage,
  int turbidityRaw,
  int tdsRaw
) {

  // Check Wi-Fi
  if (WiFi.status() != WL_CONNECTED) {

    Serial.println("Wi-Fi disconnected!");
    Serial.println("Trying to reconnect...");

    connectWiFi();

    if (WiFi.status() != WL_CONNECTED) {
      return;
    }
  }


  HTTPClient http;

  Serial.println();
  Serial.println("Connecting to Voltora backend...");

  Serial.print("Server: ");
  Serial.println(serverName);


  // Start HTTP connection
  http.begin(serverName);

  // Timeout
  http.setTimeout(5000);

  // JSON content type
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Sensor-Key", "dev-secret-key-lib-01");


  // ===================================================
  //                 CREATE JSON
  // ===================================================
String jsonData = "{";

jsonData += "\"schema_version\":\"1.0\",";
jsonData += "\"device_id\":\"LIB-RISER-01\",";
jsonData += "\"building_id\":4,";
jsonData += "\"source\":\"esp32\",";
jsonData += "\"interval_seconds\":5,";

jsonData += "\"water_level_pct\":";
jsonData += String(waterPercentage, 2);
jsonData += ",";

jsonData += "\"water_level_cm\":";
jsonData += String(waterLevel, 2);
jsonData += ",";

jsonData += "\"flow_rate_lpm\":0,";

jsonData += "\"volume_liters\":0,";

jsonData += "\"tds_ppm\":";
jsonData += String(tdsRaw);
jsonData += ",";

jsonData += "\"turbidity_ntu\":";
jsonData += String(turbidityRaw);
jsonData += ",";

jsonData += "\"sensor_errors\":[]";

jsonData += "}";

  Serial.println("Data being sent:");
  Serial.println(jsonData);


  // ===================================================
  //                 SEND POST REQUEST
  // ===================================================

  int httpResponseCode = http.POST(jsonData);


  // ===================================================
  //                 SERVER RESPONSE
  // ===================================================

  if (httpResponseCode > 0) {

    Serial.print("HTTP Response Code: ");
    Serial.println(httpResponseCode);

    String response = http.getString();

    Serial.print("Server Response: ");
    Serial.println(response);

  } else {

    Serial.print("HTTP Request Failed. Error Code: ");
    Serial.println(httpResponseCode);

    Serial.println("Possible causes:");
    Serial.println("1. Backend is not running");
    Serial.println("2. Wrong laptop IP");
    Serial.println("3. Wrong backend port");
    Serial.println("4. Wrong API endpoint");
    Serial.println("5. Windows Firewall blocking port 8000");
    Serial.println("6. ESP32 and laptop are on different networks");
  }


  http.end();
}


// =====================================================
//                    SETUP
// =====================================================

void setup() {

  Serial.begin(115200);

  delay(1000);

  Serial.println();
  Serial.println("========================================");
  Serial.println("              VOLTORA");
  Serial.println("     Smart Water Management System");
  Serial.println("========================================");


  // ===================================================
  //                 SENSOR PINS
  // ===================================================

  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);

  pinMode(TURBIDITY_PIN, INPUT);
  pinMode(TDS_PIN, INPUT);


  // ===================================================
  //                 CONNECT WIFI
  // ===================================================

  connectWiFi();
}


// =====================================================
//                    MAIN LOOP
// =====================================================

void loop() {

  // ===================================================
  //                 READ ULTRASONIC
  // ===================================================

  float distance = getDistance();


  // ===================================================
  //                 READ TURBIDITY
  // ===================================================

  int turbidityValue =
    analogRead(TURBIDITY_PIN);


  // ===================================================
  //                 READ TDS
  // ===================================================

  int tdsValue =
    analogRead(TDS_PIN);


  // ===================================================
  //                 WATER LEVEL
  // ===================================================

  float waterLevel = 0;
  float waterPercentage = 0;


  if (distance >= 0) {

    // Water level =
    // Tank height - empty space

    waterLevel =
      TANK_HEIGHT - distance;


    // Prevent negative values

    if (waterLevel < 0) {
      waterLevel = 0;
    }


    // Prevent values above tank capacity

    if (waterLevel > TANK_HEIGHT) {
      waterLevel = TANK_HEIGHT;
    }


    // Calculate percentage

    waterPercentage =
      (waterLevel / TANK_HEIGHT) * 100.0;


    // Limit percentage

    if (waterPercentage < 0) {
      waterPercentage = 0;
    }

    if (waterPercentage > 100) {
      waterPercentage = 100;
    }

  } else {

    // No echo received

    waterLevel = 0;
    waterPercentage = 0;
  }


  // ===================================================
  //                 SERIAL MONITOR
  // ===================================================

  Serial.println();
  Serial.println("----------------------------------------");
  Serial.println("           VOLTORA SENSOR DATA");
  Serial.println("----------------------------------------");


  Serial.print("Distance: ");
  Serial.print(distance);
  Serial.println(" cm");


  Serial.print("Water Level: ");
  Serial.print(waterLevel);
  Serial.println(" cm");


  Serial.print("Water Percentage: ");
  Serial.print(waterPercentage);
  Serial.println(" %");


  Serial.print("Turbidity Raw: ");
  Serial.println(turbidityValue);


  Serial.print("TDS Raw: ");
  Serial.println(tdsValue);


  Serial.println("----------------------------------------");


  // ===================================================
  //                 SEND TO BACKEND
  // ===================================================

  sendData(
    distance,
    waterLevel,
    waterPercentage,
    turbidityValue,
    tdsValue
  );


  // Send every 5 seconds (the backend requires interval_seconds >= 5)

  delay(5000);
}