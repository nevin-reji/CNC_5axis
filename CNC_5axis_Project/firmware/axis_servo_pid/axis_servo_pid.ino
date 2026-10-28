// One closed-loop servo axis for the 5-axis CNC (build five of these).
// Arduino Uno + DC gear motor with quadrature encoder + H-bridge (BTS7960 or L298N).
//
// The CNC controller (LinuxCNC or grblHAL) sends STEP/DIR pulses, exactly as it
// would to a stepper driver. This board counts them as the target position,
// reads the motor encoder as the actual position, and runs the same
// PID + feedforward law as axis_control.py at 1 kHz.
//
// Wiring
//   Encoder A -> D2 (INT0), Encoder B -> D3 (INT1), encoder 5V/GND
//   STEP in   -> D8 (pin-change interrupt), DIR in -> D4, controller GND -> GND
//   H-bridge: PWM -> D9, DIR -> D7, ENABLE -> D6
//   Fault LED -> D13 (on if the following error grows too large)

const byte ENC_A = 2, ENC_B = 3, STEP_IN = 8, DIR_IN = 4;
const byte PWM_OUT = 9, DIR_OUT = 7, EN_OUT = 6, FAULT_LED = 13;

// Gains in PWM per encoder count. Start values for a small 12 V gear motor;
// tune with the 's' step test on the Serial Monitor (see docs/HARDWARE.md).
const float KP = 4.0;            // proportional
const float KI = 40.0;           // integral (per second)
const float KD = 0.05;           // derivative (seconds)
const float KV = 0.0;            // velocity feedforward: PWM per (count/s), set after a speed test
const float D_ALPHA = 0.3;       // low-pass on the derivative
const float I_LIMIT = 200;       // anti-windup clamp on KI * integral (PWM)
const long  MAX_FOLLOW = 2000;   // following-error limit (counts) -> fault, motor off
const unsigned long PERIOD_US = 1000;   // 1 kHz servo loop

volatile long encCount = 0;      // actual position (counts)
volatile long target = 0;        // commanded position (step pulses)
float integ = 0, dFilt = 0;
long prevErr = 0, prevTarget = 0;
bool fault = false;
unsigned long nextTick;

// Quadrature decoding: on every edge of A or B, compare the two channels
void encA() { encCount += (digitalRead(ENC_A) == digitalRead(ENC_B)) ? 1 : -1; }
void encB() { encCount += (digitalRead(ENC_A) != digitalRead(ENC_B)) ? 1 : -1; }

// STEP input on D8 = PCINT0: count one step on each rising edge, direction from DIR
ISR(PCINT0_vect) {
  if (PINB & _BV(PB0)) target += (PIND & _BV(PD4)) ? 1 : -1;
}

void motor(float u) {
  int pwm = constrain((int)fabs(u), 0, 255);
  digitalWrite(DIR_OUT, u >= 0);
  analogWrite(PWM_OUT, pwm);
}

void setup() {
  pinMode(ENC_A, INPUT_PULLUP); pinMode(ENC_B, INPUT_PULLUP);
  pinMode(STEP_IN, INPUT); pinMode(DIR_IN, INPUT);
  pinMode(PWM_OUT, OUTPUT); pinMode(DIR_OUT, OUTPUT); pinMode(EN_OUT, OUTPUT); pinMode(FAULT_LED, OUTPUT);
  attachInterrupt(digitalPinToInterrupt(ENC_A), encA, CHANGE);
  attachInterrupt(digitalPinToInterrupt(ENC_B), encB, CHANGE);
  PCICR |= _BV(PCIE0); PCMSK0 |= _BV(PCINT0);      // enable pin-change interrupt on D8
  digitalWrite(EN_OUT, HIGH);
  Serial.begin(115200);
  nextTick = micros();
}

void loop() {
  if ((long)(micros() - nextTick) < 0) return;      // wait for the next 1 ms tick
  nextTick += PERIOD_US;
  const float dt = PERIOD_US * 1e-6;

  noInterrupts(); long pos = encCount, tgt = target; interrupts();
  long err = tgt - pos;

  if (labs(err) > MAX_FOLLOW) fault = true;         // lost position: stop for safety
  if (fault) { motor(0); digitalWrite(EN_OUT, LOW); digitalWrite(FAULT_LED, HIGH); return; }

  dFilt += D_ALPHA * ((err - prevErr) / dt - dFilt);  // filtered derivative of the error
  prevErr = err;
  float vRef = (tgt - prevTarget) / dt;               // commanded speed (counts/s)
  prevTarget = tgt;

  float u = KP * err + KI * integ + KD * dFilt + KV * vRef;
  if (fabs(u) < 255) {                                 // anti-windup: integrate only when not saturated
    integ += err * dt;
    integ = constrain(integ, -I_LIMIT / KI, I_LIMIT / KI);
  }
  motor(u);

  // Serial: 's' = 1000-count step test, 'z' = zero position, otherwise print every 50 ms
  if (Serial.available()) {
    char c = Serial.read();
    if (c == 's') { noInterrupts(); target += 1000; interrupts(); }
    if (c == 'z') { noInterrupts(); target = encCount = 0; interrupts(); integ = 0; }
  }
  static byte n = 0;
  if (++n >= 50) { n = 0; Serial.print(tgt); Serial.print(','); Serial.print(pos); Serial.print(','); Serial.println(u, 1); }
}
