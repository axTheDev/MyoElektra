# MyoElektra

Capstone project: a muscle (EMG) sensor read by a Teensy 4.1 that shows up as a USB gamepad.

| Folder | What it is |
| --- | --- |
| `MyoElektra/` | gamepad firmware; currently driven by fake EMG until the real chain is promoted |
| `sensor-lab/` | SEN0240 bench bring-up: the real-sensor sketch, pipeline map and bench notes |
| `emg-arm3d/` | MyoArm3D: local 3D tool to browse NinaPro DB3, record the sensor and compare the two |
| `tools/` | `key_emg.py` and `demo.fish`, helpers for the gamepad firmware |

Each folder has its own README. The rest of this page is about the gamepad firmware.

## Build & flash

```
arduino-cli compile --upload -p usb5/5-1 --fqbn teensy:avr:teensy41:usb=serialhid MyoElektra
```

Run it from `~/Documents/Capstone/code`. `usb=serialhid` ("Serial + Keyboard + Mouse +
Joystick") is required, otherwise `Joystick` doesn't exist and the build fails. If the
port changes after a replug, check `arduino-cli board list` and swap in the new name.

For Zed, put the same command in `.zed/tasks.json`:

```json
{ "label": "Teensy: upload", "command": "arduino-cli compile --upload -p usb5/5-1 --fqbn teensy:avr:teensy41:usb=serialhid MyoElektra" }
```

## As a game controller

The Teensy shows up as a generic USB gamepad ("Teensyduino Serial/Keyboard/Mouse/Joystick").
A flex presses **A** (HID button 1) and drives the **right trigger**.

Axes: left stick = X/Y, LT = Z, RT = Rz, right stick = the two sliders. Linux only
exposes the first slider, so right stick Y is missing there (XInput would fix this).
Steam's guessed layout for this generic pad is wrong; the correct SDL mapping is:

```
03000b85c01600008704000011010000,Serial/Keyboard/Mouse/Joystick,a:b0,b:b1,x:b2,y:b3,leftshoulder:b4,rightshoulder:b5,back:b6,start:b7,leftstick:b8,rightstick:b9,leftx:a0,lefty:a1,lefttrigger:a2,righttrigger:a3,rightx:a4,dpup:h0.1,dpright:h0.2,dpdown:h0.4,dpleft:h0.8,platform:Linux,
```
Nothing else moves on its own, so it's safe to leave plugged in while playing.

Code layout: `controller.h/.cpp` holds `ControllerState` (Xbox-style names) and the HID
output; the sketch only fills in a `ControllerState`.

## In-game demo

```fish
fish tools/demo.fish        # waits 10 s, throttle 3 s, steer left 0.5 s, brake 1 s
```

Start it, switch to the game, watch. Pass a different delay as the first argument.

## Keyboard-driven fake EMG

No probe yet? Press a key and the sketch's fake EMG flexes: RMS envelope up ->
right trigger + A.

```bash
python3 tools/key_emg.py
```

Then, in that terminal: `1` = flex 80, `2` = flex 40 (small), `0` = relax, `q` = quit.
Pass a port explicitly if you have more than one: `python3 tools/key_emg.py /dev/ttyACM0`.

### Serial protocol

One command per line on USB serial (115200), read without blocking the 1 kHz sampler:

| Command | Meaning |
| --- | --- |
| `f<0-100>` | flex amplitude (switches the AUTO demo off) |
| `t<0-500>` | tone in Hz mixed into the signal, `t0` = broadband noise |
| `a<0\|1>` | turn the built-in AUTO demo (1 s flex every 3 s) off/on |
| `x<-100..100>` / `y<-100..100>` | left stick X / Y (right / down = +), independent of the EMG |
| `l<0-100>` / `r<0-100>` | left trigger (brake) / right trigger (throttle); RT is also driven by the EMG |
| `?` | print current state |

So `echo f80 > /dev/ttyACM0` works too, if you'd rather skip the Python.

## Timeline

<img width="1570" height="963" alt="image" src="https://github.com/user-attachments/assets/ff85d4a8-676a-4dcb-bc6c-203e8c8f0c7d" />
