# sensor-lab

Bench sandbox for the **SEN0240 EMG sensor** bring-up. Nothing here imports from
`../MyoElektra` or `../emg-arm3d` — proven pieces get promoted out of here later,
never the other way around.

Design rule: **the firmware is the pipeline, Python is a dumb window.** Every
processing stage (baseline, envelope, threshold) lives in the sketch and is
emitted as a test point each sample. The Python viewer is only allowed to
split strings and plot — never to compute signal content. That forces all the
real learning into C++, which is the language the shipped product runs on.

See `PIPELINE.md` for the living signal-chain map (what lives where, what's
built yet). `notes.md` is the bench notebook.

## Wiring

| SEN0240 pin | Wire | Teensy 4.1 | notes |
| --- | --- | --- | --- |
| VCC | red | 3V3 | board accepts 3.3–5.5 V; 3V3 keeps one rail |
| GND | black | GND | |
| AOUT | blue | **pin 23 / A9** | analog out, 0–3.0 V centered on 1.5 V (reads ~1857 counts) |

Electrodes: the SEN0240 uses one patch of three dry metal plates, no gel. Strap
it snugly on a large area of bare skin over the muscle, aligned with the muscle
direction (per the DFRobot wiki). Clean the skin first; a slightly damp wipe can
lower contact resistance.

Mains hum: a large, regular swing at rest (~600 counts peak-to-peak, nearly all
60/120/180 Hz) means the signal is mostly hum, usually from poor electrode
contact. Fix the contact, run the laptop on battery with the charger unplugged,
and keep the cable away from power bricks. The mean does not change with a
flex: EMG is AC around 1.5 V, so a flex shows up as a bigger swing.

Safety: this is an educational dev rig, not a medical device. Stop if anything
stings or irritates the skin.

## Serial protocol (sketch ⇄ host)

One line per 1 kHz sample, four integer test points, comma separated, `\n`
terminated:

```
raw,corr,env,flex
1863,-47,31,0
```

| field | meaning | range |
| --- | --- | --- |
| `raw` | ADC counts at A9 (12-bit, 0–3.3 V) | 0–4095 |
| `corr` | raw − moving baseline (counts) | ±4095 |
| `env` | RMS envelope of `corr`, 100 ms window, scaled ×1000 | 0–1000 |
| `flex` | 1 when `env` above threshold, else 0 | 0/1 |

Each field is the output of exactly one firmware stage — see `PIPELINE.md`.
USB-serial CDC on the Teensy ignores baud for actual throughput; ~18 kB/s of
ASCII is easy. Commands host→sketch (when implemented): `?` = print state
line, matching the `MyoElektra` convention.

## Build & flash (firmware)

From `~/Documents/Capstone/code`:

```fish
arduino-cli compile --upload -p usb7/7-1 --fqbn teensy:avr:teensy41 sensor-lab/sketch/sensor_read
```

No Joystick HID in this sketch yet, so plain `usb=serial` (the default fqbn) is
enough — unlike `../MyoElektra` which needs `usb=serialhid`. Port changes on
replug: `arduino-cli board list`.

## Python viewer setup

One-time, from this folder:

```fish
python3 -m venv .venv
.venv/bin/pip install -r tools/requirements.txt
.venv/bin/python tools/view_live.py            # reads /dev/ttyACM0
.venv/bin/python tools/view_live.py /dev/ttyACM1   # explicit port
```

## Milestones

- [x] **M0** skeleton: this README, PIPELINE.md, stub sketch (compiles), pins pinned
- [ ] **M1** `raw` at 1 kHz → viewer lane 1. First look at your arm + any 60 Hz hum
- [ ] **M2** moving baseline + `corr` → lane 2 centered at rest
- [ ] **M3** rectify + RMS → `env` lane 3 swells on clench (port from MyoElektra.ino)
- [ ] **M4** `flex` threshold lane; eyeball latency; `?` command
- [ ] **M5** tune on real muscle; write numbers into PIPELINE.md "rules"; promote to MyoElektra
