// controller.cpp — sends a ControllerState to the computer as a USB gamepad.
//
// SKELETON: the steps are written as comments. The code under them is not written yet.
// The finished version from the old test is in MyoElektra/controller.cpp
// (it uses the old button style, s.get(...), instead of pad.button[...]).
//
// The build needs this flag. It is what makes the Teensy show up as a gamepad:
//   --fqbn teensy:avr:teensy41:usb=serialhid
#include "controller.h"

// Stop the build with a clear message when that flag is missing.
#if !defined(JOYSTICK_INTERFACE)
#error "USB type must include Joystick: build with --fqbn teensy:avr:teensy41:usb=serialhid"
#endif

// ── the two converters ──────────────────────────────────────────
// The pad holds sticks as -1..1 and triggers as 0..1.
// The Teensy wants every one of them as a whole number from 0 to 1023.

int stickAxis(float v) {
  // in:  v = stick position, -1 to 1
  // out: 0 to 1023, where 512 is the centre
  // steps:
  //   1. if v is below -1, make it -1
  //   2. if v is above 1, make it 1
  //   3. the answer is 512 + v * 511, as a whole number
  // check: -1 gives 1,   0 gives 512,   1 gives 1023

  return 512;   // NOT WRITTEN YET: always "centre"
}

int triggerAxis(float v) {
  // in:  v = how far the trigger is pressed, 0 to 1
  // out: 0 to 1023, where 0 is released
  // steps:
  //   1. if v is below 0, make it 0
  //   2. if v is above 1, make it 1
  //   3. the answer is v * 1023, as a whole number
  // check: 0 gives 0,   0.5 gives 511,   1 gives 1023

  return 0;     // NOT WRITTEN YET: always "released"
}

// ── called once, in setup() ─────────────────────────────────────

void outputBegin() {
  // one line. It tells the Teensy:
  // "do not send after every single change. I set everything first, then I send once."
  // the Teensy call for that is:   Joystick.useManualSend(true);

}

// ── called every time the pad should be sent ────────────────────

void outputSend(ControllerState pad) {
  // Set EVERY control here, also the ones the sketch never uses.
  // A control that is never set goes out as 0, and 0 means:
  // stick pushed into a corner, D-pad held up.
  //
  //   step   control        Teensy call                       value comes from
  //   1      left stick     Joystick.X(0..1023)               pad.lx  (through stickAxis)
  //                         Joystick.Y(0..1023)               pad.ly  (through stickAxis)
  //   2      triggers       Joystick.Z(0..1023)               pad.lt  (through triggerAxis)
  //                         Joystick.Zrotate(0..1023)         pad.rt  (through triggerAxis)
  //   3      right stick    Joystick.sliderLeft(0..1023)      pad.rx  (through stickAxis)
  //                         Joystick.sliderRight(0..1023)     pad.ry  (through stickAxis)
  //   4      buttons        Joystick.button(number, true/false)
  //                         the Teensy counts buttons from 1.
  //                         pad.button[] counts from 0.  so pad.button[0] is Teensy button 1.
  //                         do it for all BTN_COUNT buttons.
  //   5      D-pad          Joystick.hat(angle)               pad.hat
  //   6      send           Joystick.send_now();              (this is the moment it goes out)
  //
  // Known limit on Linux: it only shows one of the two sliders, so the
  // right stick's Y (sliderRight) is not visible there.

}
