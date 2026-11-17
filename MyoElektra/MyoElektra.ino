// MyoElektra - Teensy 4.1 EMG -> game controller (fake EMG until the sensor arrives)
//
// REQUIRED: USB type must include Joystick:
//   arduino-cli: --fqbn teensy:avr:teensy41:usb=serialhid
//   Arduino IDE: Tools > USB Type > "Serial + Keyboard + Mouse + Joystick"
//
// What it does:
//   - A fake EMG signal drives an RMS envelope.
//   - Flex (RMS above threshold) presses A; the envelope also drives the right
//     trigger (RT) as an analog value. Nothing else moves, so it's safe in-game.
//   - Serial prints the RMS so you can see the "muscle" signal.
//
// The fake EMG has two drive modes:
//   AUTO  demo pattern: flexes for 1 s every 3 s (off at power-up).
//   KEY   driven from the host keyboard via tools/key_emg.py (hold a key = flex).
//
// Line protocol on USB serial (one command per line, '\n' or '\r' terminated):
//   f<0-100>   flex level (amplitude). f0 = relax. Switches AUTO off.
//   t<hz>      tone added to the signal, 0-500 Hz. t0 = broadband noise.
//   a<0|1>     AUTO demo on/off.
//   x<-100..100>  left stick X (right = +). Independent of the EMG.
//   y<-100..100>  left stick Y (down = +). Independent of the EMG.
//   l<0-100>   left trigger (brake). Independent of the EMG.
//   r<0-100>   right trigger (throttle); the EMG envelope also drives it.
//   ?          print current state.

#include <Arduino.h>
#include "controller.h"

// ---- Fake EMG + RMS envelope ----
const uint32_t SAMPLE_US = 1000;   // 1 kHz sample rate
const int RMS_WIN = 100;           // 100 ms window
const float FLEX_THRESHOLD = 0.2f; // RMS above this = "flex"

float sqBuf[RMS_WIN] = {0};
int sqIdx = 0;
float sqSum = 0.0f;

elapsedMicros sampleTimer;
elapsedMillis reportTimer;
uint32_t reportCount = 0;

// ---- Drive mode (set by the host over serial) ----
int flexLevel = 0;      // 0..100 amplitude requested by the keyboard
int toneHz = 0;        // 0 = broadband noise, otherwise a tone is added
bool autoDemo = false;  // a1 turns the demo pattern on
int stickX = 0;        // left stick, -100..100, set over serial for testing
int stickY = 0;
int ltLevel = 0;       // triggers, 0..100, set over serial for testing
int rtLevel = 0;
float tonePhase = 0.0f;
char cmdBuf[32];
int cmdLen = 0;

// Resting = small noise, flexing = large amplitude (roughly what raw sEMG looks like)
float emgAmplitude() {
  const float rest = 0.05f;
  if (autoDemo) return ((millis() % 3000) < 1000) ? 1.0f : rest;
  return rest + (flexLevel / 100.0f) * (1.0f - rest);
}

// One fake EMG sample: broadband noise, or a tone at toneHz plus a little noise.
float emgSample(uint32_t dt_us) {
  float amp = emgAmplitude();
  float noise = random(-1000, 1001) / 1000.0f;  // uniform in [-1, 1]
  if (toneHz <= 0) return amp * noise;
  tonePhase += TWO_PI * toneHz * (dt_us / 1.0e6f);
  tonePhase -= floorf(tonePhase / TWO_PI) * TWO_PI;
  return amp * (0.85f * sinf(tonePhase) + 0.15f * noise);
}

void printState() {
  Serial.printf("state: source=%s flex=%d tone=%d stick=%d,%d lt=%d rt=%d\n",
               autoDemo ? "AUTO" : "KEY", flexLevel, toneHz, stickX, stickY, ltLevel, rtLevel);
}

void runCommand(const char* s) {
  long v = atol(s + 1);
  switch (s[0]) {
    case 'f': case 'F':
      flexLevel = constrain((int)v, 0, 100);
      autoDemo = false;
      break;
    case 't': case 'T':
      toneHz = constrain((int)v, 0, 500);
      autoDemo = false;
      break;
    case 'x': case 'X':
      stickX = constrain((int)v, -100, 100);
      break;
    case 'y': case 'Y':
      stickY = constrain((int)v, -100, 100);
      break;
    case 'l': case 'L':
      ltLevel = constrain((int)v, 0, 100);
      break;
    case 'r': case 'R':
      rtLevel = constrain((int)v, 0, 100);
      break;
    case 'a': case 'A':
      autoDemo = (v != 0);
      break;
    case '?':
      printState();
      break;
    default:
      Serial.printf("unknown command: %s\n", s);
      break;
  }
}

// Non-blocking line reader so serial input never stalls the 1 kHz sampler.
void pollSerial() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (cmdLen > 0) {
        cmdBuf[cmdLen] = '\0';
        runCommand(cmdBuf);
        cmdLen = 0;
      }
    } else if (cmdLen < (int)sizeof(cmdBuf) - 1) {
      cmdBuf[cmdLen++] = c;
    }
  }
}

void setup() {
  Serial.begin(115200);
  outputBegin();
}

void loop() {
  pollSerial();

  // 1) Sample the fake EMG at 1 kHz and keep a running RMS
  if (sampleTimer >= SAMPLE_US) {
    sampleTimer -= SAMPLE_US;
    float x = emgSample(SAMPLE_US);
    float sq = x * x;
    sqSum += sq - sqBuf[sqIdx];
    if (sqSum < 0) sqSum = 0;  // guard against float drift
    sqBuf[sqIdx] = sq;
    sqIdx = (sqIdx + 1) % RMS_WIN;
  }

  // 2) Send a HID report at 100 Hz
  if (reportTimer >= 10) {
    reportTimer = 0;
    float rms = sqrtf(sqSum / RMS_WIN);
    bool flex = rms > FLEX_THRESHOLD;

    // "EMG" -> right trigger (analog) and A (flex-to-press)
    ControllerState pad;
    // Envelope -> trigger. Subtract the resting level so the trigger reads 0 when
    // relaxed (placeholder until the calibration stage exists).
    const float REST_RMS = 0.05f, MAX_RMS = 0.6f;
    float emgTrigger = (rms - REST_RMS) / (MAX_RMS - REST_RMS);
    pad.rt = max(emgTrigger, rtLevel / 100.0f);
    pad.lt = ltLevel / 100.0f;
    pad.set(BTN_A, flex);
    pad.lx = stickX / 100.0f;
    pad.ly = stickY / 100.0f;
    outputSend(pad);

    if (++reportCount % 10 == 0) {  // print at 10 Hz
      Serial.printf("rms=%.3f  rt=%.2f  A=%d  [%s flex=%d tone=%d]\n",
                   rms, constrain(pad.rt, 0.0f, 1.0f), flex,
                   autoDemo ? "AUTO" : "KEY", flexLevel, toneHz);
    }
  }
}
