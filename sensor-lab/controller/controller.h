// controller.h — the list of controls on the gamepad, and the two functions that send them.
//
// How the sketch uses it:
//   1. make an empty pad:           ControllerState pad;         (everything released)
//   2. fill in what you want:       pad.button[BTN_A] = true;
//                                   pad.rt = 0.6;
//   3. send it to the computer:     outputSend(pad);
//
// The sketch only says WHAT is pressed. controller.cpp is the only place that
// knows HOW it goes out over USB.
#pragma once            // read this file only once per compile
#include <Arduino.h>

// Button names (Xbox style). The number is the position in pad.button[].
// They are sent as USB buttons 1..10 in this same order.
enum Button {
  BTN_A = 0,   // 0
  BTN_B,       // 1
  BTN_X,       // 2
  BTN_Y,       // 3
  BTN_LB,      // 4  left bumper
  BTN_RB,      // 5  right bumper
  BTN_BACK,    // 6
  BTN_START,   // 7
  BTN_LS,      // 8  left stick click
  BTN_RS,      // 9  right stick click
  BTN_COUNT    // 10 = how many buttons there are (not a button itself)
};

const int HAT_CENTER = -1;   // D-pad released

// One snapshot of the whole controller.
// A new ControllerState starts with everything released.
struct ControllerState {
  float lx = 0, ly = 0;  // left stick, -1..1    (lx: -1 = left, 1 = right.  ly: -1 = up, 1 = down)
  float rx = 0, ry = 0;  // right stick, -1..1
  float lt = 0, rt = 0;  // triggers, 0..1       (0 = released, 1 = fully pressed)
  bool button[BTN_COUNT] = {};  // one true/false per button. true = pressed. all start as false.
  int hat = HAT_CENTER;  // D-pad: -1 = released, else 0..315 in 45 degree steps (0 = up, 90 = right)
};

void outputBegin();                     // call once, in setup()
void outputSend(ControllerState pad);   // call every time the pad should be sent to the computer
