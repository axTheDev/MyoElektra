// sensor_read — SEN0240 live bring-up sketch
//
// What it does, in order:
//   1. read the sensor 1000 times a second               (raw, 0-4095 counts)
//   2. every 100 readings: p2p = highest - lowest        (the "env" graph)
//   3. work out the resting level of p2p                 (the "floor" graph)
//   4. decide flex or no flex                            (the "flex" graph)
//   5. print one line:  env,floor,flex\n                 (10 lines a second)
//
// At startup: keep the arm relaxed for 2 seconds. The first 20 windows are
// used to measure the resting level. Until that is done the floor prints as 0.
//
// Build (from the repo root; find the port with: arduino-cli board list):
//   arduino-cli compile --upload -p <port> --fqbn teensy:avr:teensy41 sensor-lab/sketch/sensor_read

#include <Arduino.h>

const int SENSOR_PIN = A9; // data pin is at pin 23 or A9

int lo = 4095, hi = 0, n = 0; // min max counter

elapsedMicros since_last_sample; // timer

void setup() {
  Serial.begin(115200);   // nominal only; Teensy CDC throughput is much higher
  analogReadResolution(12);   // readings go from 0 to 4095

  // startup line. It starts with "#" so the app treats it as a comment, not as data.
  Serial.printf("# sensor_read started. first reading: %d\n", analogRead(SENSOR_PIN));
}

// ── stage chain (each fn = one PIPELINE.md row) ─────────────────
//  loop → raw ──► window() ──p2p──► floor_update() ──floor──► flex_decide() ──► emit()

int window(int raw) {           // the min/max (p2p) window. was called better() before.
  // min/max/n bookkeeping stays here
  // returns: 0 until the 100th sample, then the p2p value (one call = one answer)
  lo = min(lo, raw);
  hi = max(hi, raw);
  if (++n == 100) {
      int p2p = hi - lo;
      lo = 4095; hi = 0; n = 0;
      return p2p;
  } else {
      return 0;
  }
}

int floor_update(int p2p) {     // calibration + drift live together (they're the same job:
  // calib[20] collection → median once;
  // then the gated /64 EMA forever
  // returns: current floor


    static int calib[20];
    static int counter = 0;
    // static = the value is remembered between calls (without it, it would be 0 again every call).
    // float  = it can hold 184.7, so the small /64 steps below are not rounded away.
    // the name is rest_floor, not floor, because floor() is already a math function.
    static float rest_floor = 0; // 0 means: not calibrated yet

    if (counter < 20){
        calib[counter++] = p2p;
        if ( counter == 20){
// sort
            for (int i = 1; i < 20; i++) {
                int current = calib[i];      // hold the item being inserted
                int j = i;
                while (j >= 1 && calib[j - 1] > current) {
                    calib[j] = calib[j - 1]; // shift bigger left-neighbor one slot right
                    j--;
                }
                calib[j] = current;          // drop it into the hole where walking stopped
            }
            rest_floor = calib[10]; // get midle value
            if (rest_floor < 50) rest_floor = 50;
            if (rest_floor > 3000) rest_floor = 3000;
            Serial.printf("# floor=%d\n", (int)rest_floor);
        }
        return (int)rest_floor;   // still 0 for the first 19 windows
    }
    if (p2p < 2 * rest_floor){
        rest_floor += (p2p - rest_floor) / 64.0;   // += : move 1/64 of the way toward p2p
    }
    return (int)rest_floor;
}




bool flex_decide(int p2p, int rest_floor) {
  // hysteresis 2.5×/1.5× + 3-window confirm (its own little state)
  // returns: flex true/false
  if (p2p > 2.5 * rest_floor && rest_floor != 0){
      return true;
  } else {
      return false;
  }
}

void emit(int p2p, int rest_floor, bool flex) {
  // the ONLY place serial printing of data happens
  // one line per window:  env,floor,flex     example: 412,185,0
  Serial.printf("%d,%d,%d\n", p2p, rest_floor, flex);
}

void loop() {                   // the tick; knows nothing about signal processing
  if (since_last_sample >= 1000) {          // 1000 microseconds passed = time for one reading (1 kHz)
    since_last_sample -= 1000;
    int raw = analogRead(SENSOR_PIN);
    int p2p = window(raw);
    if (p2p > 0) {                          // window completed — a real 100 ms moment
      int fl = floor_update(p2p);
      bool fx = flex_decide(p2p, fl);
      emit(p2p, fl, fx);
    }
  }
}
