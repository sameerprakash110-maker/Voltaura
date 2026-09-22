#define TRIG 27
#define ECHO 14

#define TURBIDITY_PIN 12
#define TDS_PIN 35


void setup() {

  Serial.begin(115200);

  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);

  pinMode(TURBIDITY_PIN, INPUT);
  pinMode(TDS_PIN, INPUT);

  Serial.println("Water Quality Sensor Test");
}


float getDistance() {

  digitalWrite(TRIG, LOW);
  delayMicroseconds(2);

  digitalWrite(TRIG, HIGH);
  delayMicroseconds(10);

  digitalWrite(TRIG, LOW);

  long duration = pulseIn(ECHO, HIGH, 30000);

  if (duration == 0) {
    return 999;
  }

  return duration * 0.0343 / 2;
}


void loop() {

  // Read ultrasonic sensor
  float distance = getDistance();

  // Read turbidity sensor
  int turbidityValue = analogRead(TURBIDITY_PIN);

  // Read TDS sensor
  int tdsValue = analogRead(TDS_PIN);


  // Display ultrasonic value
  Serial.print("Distance: ");
  Serial.print(distance);
  Serial.println(" cm");


  // Display turbidity value
  Serial.print("Turbidity Raw: ");
  Serial.println(turbidityValue);


  // Display TDS value
  Serial.print("TDS Raw: ");
  Serial.println(tdsValue);


  Serial.println("-----------------------------");

  delay(1000);
}