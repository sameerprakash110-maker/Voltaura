# ESP32 Water Node Wiring & Electrical Specification

> **Status:** `NOT PHYSICALLY VERIFIED — PENDING PHYSICAL ON-SITE HARDWARE RIG DEPLOYMENT`  
> **Target Board:** Generic ESP32 Dev Module (ESP32-WROOM-32 / 30-pin or 38-pin DevKitC)  
> **Reference Contract:** [`docs/TELEMETRY_CONTRACT.md`](file:///C:/Voltaura/docs/TELEMETRY_CONTRACT.md)  
> **Firmware Implementation:** Complete (Steps 1–10)

---

## 1. Master Wiring Table

> [!CAUTION]
> **5V Logic Warning:** The ESP32 is a strictly **3.3V logic device**. Connecting a 5V signal directly to an ESP32 GPIO will permanently damage the microcontroller. Pay careful attention to the level-shifting instructions below for the HC-SR04 Echo line and 5V-powered sensors.

| Component / Function | ESP32 Pin | Power Rail | Sensor Signal Type | Direction | Hardware Notes & Constraints | Physical Verification Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **HC-SR04 Trigger** | **GPIO 5** | 5V (VIN / External) | Digital Logic (TTL) | Output from ESP32 | ESP32 3.3V HIGH pulse ($\ge 2.0\text{V}$) satisfies HC-SR04 trigger threshold. | `NOT PHYSICALLY VERIFIED` |
| **HC-SR04 Echo** | **GPIO 18** | 5V (VIN / External) | 5V Digital Pulse | Input to ESP32 | **CRITICAL: MUST LEVEL-SHIFT TO 3.3V!** Direct 5V connection damages pin. | `NOT PHYSICALLY VERIFIED` |
| **YF-S201 Flow Pulse**| **GPIO 19** | 5V (Datasheet 4.5–18V) | Digital Pulse Train | Input to ESP32 | Requires hardware interrupt. Verify if module pull-up pulls to 5V or 3.3V. | `NOT PHYSICALLY VERIFIED` |
| **TDS Analog Probe** | **GPIO 34 (ADC1_CH6)** | 3.3V or 5V (Module dependent)| Analog (0–2.3V typ.)| Input to ESP32 | **Must be ADC1** (ADC2 cannot be read when Wi-Fi is active). Input-only pin. | `NOT PHYSICALLY VERIFIED` |
| **Turbidity Probe** | **GPIO 35 (ADC1_CH7)** | 5V (Module dependent) | Analog (0–4.5V typ.)| Input to ESP32 | **Must be ADC1**. Voltage divider required if output exceeds 3.3V. | `NOT PHYSICALLY VERIFIED` |
| **Common Ground** | **GND** | - | 0V Reference | Power | All sensor grounds **MUST** be tied to common ESP32 ground. | `NOT PHYSICALLY VERIFIED` |

---

## 2. ESP32 Pin Selection Rules & Constraints

The provisional GPIO assignments were selected by evaluating ESP32 architectural restrictions:

1. **Wi-Fi / ADC Conflict (ADC1 vs ADC2):**
   - The ESP32 has two ADC units: `ADC1` (GPIO 32, 33, 34, 35, 36, 39) and `ADC2` (GPIO 0, 2, 4, 12, 13, 14, 15, 25, 26, 27).
   - **`ADC2` is shared with the Wi-Fi driver.** Whenever the Wi-Fi subsystem is initialized or transmitting, analog reads on `ADC2` fail or return invalid data.
   - *Design Decision:* Both the TDS probe and Turbidity sensor are assigned strictly to **ADC1** pins (`GPIO 34` and `GPIO 35`), ensuring continuous measurement during active networking.
2. **Input-Only Pins (GPI):**
   - `GPIO 34`, `GPIO 35`, `GPIO 36` (VP), and `GPIO 39` (VN) do not possess internal pull-up/pull-down resistors or output driver transistors.
   - They cannot be used for `TRIG` (which requires output), but are optimal for high-impedance analog inputs.
3. **Bootstrapping Pins (Avoided):**
   - `GPIO 0`: Boot mode select (must float or pull HIGH to boot into firmware).
   - `GPIO 2`: Bootstrapping / strapping pin (must be LOW on boot).
   - `GPIO 12`: Flash voltage selector (if pulled HIGH during boot, can cause 1.8V flash brownout).
   - `GPIO 15`: JTAG strapping pin.
   - *Design Decision:* All strapping pins have been intentionally avoided for sensor I/O.
4. **Internal SPI Flash Pins (Strictly Prohibited):**
   - `GPIO 6` through `GPIO 11` are internally wired to the SPI flash IC. Never connect external hardware to these pins.

---

## 3. Critical Electrical & Level-Shifting Details

### 3.1 HC-SR04 Ultrasonic Sensor (Echo Level Shifting)
- **Power:** The HC-SR04 transmitter requires $5\text{V } V_{cc}$ to emit adequate 40kHz acoustic power.
- **Trigger:** When the ESP32 drives `GPIO 5` HIGH ($3.3\text{V}$), the HC-SR04 reliably accepts this because the TTL HIGH threshold is $\ge 2.0\text{V}$.
- **Echo Signal:** The Echo pin responds with a pulse width proportional to distance at a full **$5.0\text{V}$ logic level**.
- **Protection Circuit:** You **must** install a resistive voltage divider between the HC-SR04 Echo pin and ESP32 `GPIO 18`:

```text
HC-SR04 Echo (5V) ─────── [ 1.0 kΩ ] ──────┬──────► ESP32 GPIO 18 (3.3V)
                                           │
                                       [ 2.0 kΩ ]
                                           │
                                          GND
```

$$V_{\text{out}} = 5.0\text{V} \times \left(\frac{2.0\text{ k}\Omega}{1.0\text{ k}\Omega + 2.0\text{ k}\Omega}\right) \approx 3.33\text{V}$$

*(Alternatively, use $2.2\text{ k}\Omega$ and $3.3\text{ k}\Omega$ to yield $\sim 3.0\text{V}$, or a dedicated TXS0108E / BSS138 bidirectional level-shifter).*

---

### 3.2 YF-S201 Flow Sensor (Power & Pull-up)
- **Datasheet Operating Voltage:** $4.5\text{V} - 18\text{V}$ (Nominal $5\text{V}$).
- **Output:** Hall-effect open-collector or active push-pull frequency pulse train.
- **Concern to Verify:**
  - If the flow sensor module includes an internal pull-up resistor tied to its $5\text{V}$ power rail, its pulse output will swing to $5\text{V}$.
  - If verified to swing to $5\text{V}$, pass the signal through a $1\text{k}\Omega / 2\text{k}\Omega$ voltage divider before connecting to `GPIO 19`.
  - If the module has an open-collector output without a 5V pull-up, enable the ESP32 internal pull-up (`pinMode(19, INPUT_PULLUP)`).

---

### 3.3 Analog TDS Sensor
- **Operating Voltage:** Most commercial hobbyist TDS modules (e.g. Gravity / Keyestudio) accept $3.3\text{V}$ to $5.5\text{V}$.
- **Signal Range:** Typically outputs an analog voltage from $0\text{V}$ to $2.3\text{V}$ (well within the ESP32 $0 - 3.3\text{V}$ ADC input range).
- **ADC Configuration:** Configured in firmware with `ADC_11db` attenuation on `GPIO 34`.
- **Note:** Keep the probe separated from AC electrical noise (e.g. submersible pump power lines) to prevent ADC reading jitter.

---

### 3.4 Analog Turbidity Sensor
- **Operating Voltage:** Standard optical turbidity modules require $5\text{V}$ supply for their optical IR transmitter.
- **Output Range:** In clean water, optical transmission is high and output voltage can reach $4.2\text{V} - 4.5\text{V}$.
- **Protection Requirement:** If the module's amplifier board outputs $> 3.3\text{V}$, a resistive voltage divider or potentiometer scaling is required to avoid clipping or overvolting `GPIO 35`.
- **Alternative:** Some modules feature an onboard potentiometer to calibrate the clear-water output voltage down to $3.0\text{V}$. This must be calibrated prior to deployment.

---

## 4. Tank Geometry & Calibration Reference

| Calibration Parameter | Nominal Configuration Value | Physical Units | Calibration Verification Status |
| :--- | :--- | :--- | :--- |
| `TANK_REFERENCE_HEIGHT_CM` | `200.0` | cm | `NOT PHYSICALLY VERIFIED` (Must be calibrated on physical tank) |
| `TANK_DEADBAND_CM` | `10.0` | cm | `NOT PHYSICALLY VERIFIED` (Transducer ringing offset) |
| `YF_S201_PULSES_PER_LITER` | `450.0` | pulses/L | `NOT PHYSICALLY VERIFIED` (Requires bucket/cylinder test) |
| `TDS_CALIBRATION_FACTOR` | `1.0` | ratio | `NOT PHYSICALLY VERIFIED` (Requires standard buffer calibration) |
| `TURBIDITY_CLEAR_VOLTAGE_MV`| `3000.0` | mV | `NOT PHYSICALLY VERIFIED` (Requires clean tap water reference) |
| `TURBIDITY_CALIBRATION_SLOPE`| `400.0` | NTU/V | `NOT PHYSICALLY VERIFIED` (Requires turbidity reference solution) |

---

## 5. Hardware Verification Checklist Before Power-On

- [ ] `NOT PHYSICALLY VERIFIED`: Measure $5\text{V}$ rail with multimeter (verify it is within $4.75\text{V} - 5.25\text{V}$).
- [ ] `NOT PHYSICALLY VERIFIED`: Verify common ground exists between the ESP32 GND and external power supply GND.
- [ ] `NOT PHYSICALLY VERIFIED`: Measure the HC-SR04 Echo signal with an oscilloscope or multimeter on a level-shifted divider to ensure voltage does not exceed $3.3\text{V}$.
- [ ] `NOT PHYSICALLY VERIFIED`: Check if the Turbidity module output voltage exceeds $3.3\text{V}$ in ambient clean water.
- [ ] `NOT PHYSICALLY VERIFIED`: Confirm no sensor is connected to strapping pins (`GPIO 0`, `GPIO 2`, `GPIO 12`).

