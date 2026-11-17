// sensor_read — SEN0240 live bring-up sketch (sensor-lab M0 skeleton)
//
// Contract with the host (see ../../README.md and ../../PIPELINE.md):
//   one line per 1 kHz sample:  raw,corr,env,flex\n
//   raw  = ADC counts 0-4095 (12-bit, 0-3.3 V)          [stage S1]
//   corr = raw - moving baseline (counts)               [stage S2]
//   env  = 100 ms RMS of rectified corr, scaled x1000   [stage S3]
//   flex = env above threshold                          [stage S4]
//
// Build (from ~/Documents/Capstone/code):
//   arduino-cli compile --upload -p usb5/5-1 --fqbn teensy:avr:teensy41 sensor-lab/sketch/sensor_read
//
// M1: fill in S1 — analogReadResolution(12), read A0 on a 1 kHz elapsedMicros
//     tick, print "raw,0,0,0" for now. Everything else is M2+.

#include <Arduino.h>

const int SENSOR_PIN = A9; // data pin is at pin 23 or A9

int lo = 4095, hi = 0, n = 0; // min max counter

elapsedMicros since_last_sample; // timer

void setup() {
  Serial.begin(115200);   // nominal only; Teensy CDC throughput is much higher
  // TODO(M1): analogReadResolution(12); pin config if any; a startup banner
  //           line (e.g. "# sensor_read M1") so the viewer can skip junk.
  analogReadResolution(12);

  Serial.printf( " Reading pin data: %d", analogRead(SENSOR_PIN));
  const rest = calibrate
}

// ── stage chain (each fn = one PIPELINE.md row) ─────────────────
//  loop → raw ──► window() ──p2p──► floor_update() ──floor──► flex_decide() ──► emit()

int window(int raw) {           // was better(): pure window mechanic.
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
    int float floor = 0 // not calibrated yet

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
            floor = calib[10] // get midle value
            if (floor < 50) floor = 50;
            if (floor > 3000) floor = 3000;
            Serial.printf("# floor=%d\n", (int)floor);
        }
        return floor
    }
    if (p2p < 2 * floor){
        floor =+ (p2p - floor) / 64.0;
    }
    return floor;
}






bool flex_decide(int p2p, int floor) {
  // hysteresis 2.5×/1.5× + 3-window confirm (its own little state)
  // returns: flex true/false
}

void emit(int p2p, int floor, bool flex) {
  // the ONLY place serial printing of data happens
}

void loop() {                   // the tick; knows nothing about signal processing
  if (tick) {
    int raw = analogRead(SENSOR_PIN);
    int p2p = window(raw);
    if (p2p > 0) {                          // window completed — a real 100 ms moment
      int fl = floor_update(p2p);
      bool fx = flex_decide(p2p, fl);
      emit(p2p, fl, fx);
    }
  }
}






void better(int value){
    lo = min(lo, value);
    hi = max(hi, value);
    if (++n == 100) {
      Serial.printf("%d\n", hi - lo);
      lo = 4095; hi = 0; n = 0;
    }
}


void remove_dc(int rest){
    corr = raw - rest
    Serial.printf("%d\n", corr);
}

int initial_calibrate(){
    // measure resting value over 60 seconds
    // set value globally
    for ()

    Serial.printf("%d is the resting value\n", rest);
    return rest
}

int correct_drift(){
// baseline value drifts with skin stuff
// correct the drift with time-domain splitting
//

}



void loop() {
  if (since_last_sample >= 1000) {
    since_last_sample -= 1000;
    int value = analogRead(SENSOR_PIN);
    // better(value);
    Serial.print("%d", value);
  }
}
