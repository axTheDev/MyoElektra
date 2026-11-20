// Controller state + HID output.
//
// The rest of the pipeline only fills in a ControllerState (Xbox-style names,
// normalized values). The output backend turns it into a USB report, so swapping
// the generic joystick for XInput later only touches controller.cpp.
#pragma once
#include <Arduino.h>

// Xbox-style button names. Values are bit positions in ControllerState::buttons
// and are sent as HID buttons 1..10 in this order, which is the layout most
// games/SDL expect from an Xbox-like DirectInput pad.
enum Button : uint8_t {
  BTN_A = 0,
  BTN_B,
  BTN_X,
  BTN_Y,
  BTN_LB,
  BTN_RB,
  BTN_BACK,
  BTN_START,
  BTN_LS,  // left stick click
  BTN_RS,  // right stick click
  BTN_COUNT
};

const int HAT_CENTER = -1;

struct ControllerState {
  float lx = 0, ly = 0;  // left stick, -1..1
  float rx = 0, ry = 0;  // right stick, -1..1
  float lt = 0, rt = 0;  // triggers, 0..1
  uint16_t buttons = 0;  // bit per Button
  int hat = HAT_CENTER;  // D-pad: -1 = released, else 0..315 in 45 degree steps

  void set(Button b, bool pressed) {
    if (pressed) buttons |= (1u << b);
    else buttons &= ~(1u << b);
  }
  bool get(Button b) const { return buttons & (1u << b); }
};

// Generic USB HID joystick (Teensy USB type "Serial + Keyboard + Mouse + Joystick").
void outputBegin();
void outputSend(const ControllerState& s);
