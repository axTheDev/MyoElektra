#include "controller.h"

#if !defined(JOYSTICK_INTERFACE)
#error "USB type must include Joystick: build with --fqbn teensy:avr:teensy41:usb=serialhid"
#endif

// Teensy joystick axes are 0..1023 with 512 = center.
static int stickAxis(float v) { return (int)(512 + constrain(v, -1.0f, 1.0f) * 511); }
static int triggerAxis(float v) { return (int)(constrain(v, 0.0f, 1.0f) * 1023); }

void outputBegin() {
  Joystick.useManualSend(true);  // set every field, then send one report
}

void outputSend(const ControllerState& s) {
  Joystick.X(stickAxis(s.lx));
  Joystick.Y(stickAxis(s.ly));
  // The descriptor declares "Slider" twice and Linux only exposes the first, so
  // only 5 of the 6 axes are visible there. Triggers go on Z/Rz (same as Linux's
  // xpad driver); right stick Y is the one that's lost on Linux.
  Joystick.Z(triggerAxis(s.lt));
  Joystick.Zrotate(triggerAxis(s.rt));
  Joystick.sliderLeft(stickAxis(s.rx));
  Joystick.sliderRight(stickAxis(s.ry));
  for (int b = 0; b < BTN_COUNT; b++) {
    Joystick.button(b + 1, s.get((Button)b));
  }
  Joystick.hat(s.hat);
  Joystick.send_now();
}
