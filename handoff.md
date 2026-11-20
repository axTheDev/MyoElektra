# MyoElektra — handoff

Written 2026-11-17, at the end of the session that built the capture/compare loop in the 3D
app and pushed the code to GitHub. This file is meant to let a fresh session (or you, in a
month) pick up without the chat history.

Paths are relative to the project root (the folder holding `MyoElektra/`, `sensor-lab/`,
`emg-arm3d/`).

> **Moved 2026-11-17, after this was written.** The project root is now
> `~/Documents/Obsidian Vault/Projects/MyoElektra/code` (was `~/Documents/Capstone/code`). The
> folder was moved, not cloned, so everything in §2 came along and the layout is unchanged.
> Both venvs were recreated with the same package versions. The memory notes in §3 were copied
> to the new path; only points 3 and 4 there are not saved yet. The path contains a space:
> quote it. The vault's project note is `Projects/MyoElektra.md`.

---

## 1. Where we are, in one paragraph

The project is an EMG game controller: a SEN0240 muscle sensor read by a Teensy 4.1 that shows
up as a USB gamepad. The gamepad half works but is driven by **fake** EMG. The real sensor has
been read on the bench (envelope only), and its sketch is **mid-refactor and does not compile**.
The 3D arm app (`emg-arm3d`) was rebuilt this session into a full loop — browse NinaPro DB3,
record my own sensor tagged with placement and gesture, see it on the arm, overlay it on the
matching DB3 channel — but it has **never been opened in a real browser or used with the real
sensor**. All code is on GitHub as of commit `410622c`.

**The single most important remaining thing:** the real sensor has never driven the controller.

---

## 2. Read this before migrating the folder

Things that do **not** travel with a `git clone` (they are ignored, so copy the folder itself
or move them by hand):

| Item | Why it matters |
| --- | --- |
| `sensor-lab/captures/*.csv` (2 files) | the only real sensor data so far; ignored by `sensor-lab/.gitignore` |
| `Nina Dataset/` (242 MB) and `s1_0.zip` (241 MB) | the app cannot start without the `.mat` files; re-downloadable from ninapro.hevs.ch |
| `tools/tag_exercise1.m`, `raw_exercise1.m`, `inspect_nina.m`, `tools/nina_inspect/` | MATLAB reference the app's numbers were matched against; still cited in app comments |
| `emg-pipeline/` | notebook with 3 unfinished exercise cells (rectify, moving average, hysteresis) |
| `opencode.json` | local tool config |
| `emg-arm3d/.venv/`, `emg-pipeline/.venv/` | recreate rather than move (see §12) |
| `handoff.md` (this file) | untracked — not committed, the repo is public and nobody asked for it to go up |

The app depends on the **folder layout**, not on absolute paths:

- dataset must be at `<root>/Nina Dataset/s1_0/DB3_s1/S1_E{1,2,3}_A1.mat` (one level above `emg-arm3d/`)
- captures are read from and written to `<root>/sensor-lab/captures/`

Also lost in the migration:

- **Claude's saved memory** for this project (it is keyed on the old folder path). The two
  notes are reproduced in §3 so a new session can re-save them.
- **The session scratchpad** (already empty): the pre-change copy of `web/app.js` and the
  captures backup are gone. The oldest version of the app in git is already the rebuilt one.

---

## 3. How the owner wants to work (was in memory — re-save it)

1. **The owner writes the firmware themselves.** Stated 2026-11-09 during SEN0240 bring-up; it
   is a learning goal of the capstone. For `sensor-lab` sketches and `MyoElektra/` firmware:
   explain what to build, in what order, with starting values and how to check it — do not
   hand over finished sketches unless asked. Short diagnostic snippets are fine when
   debugging. Doc updates they ask for are fine to do directly.
2. **Signal processing lives on the Teensy.** No signal math in Python. The house rule in
   `sensor-lab/README.md`: "the firmware is the pipeline, Python is a dumb window."
3. **The 3D app is the owner's personal tool**, and that part they are happy to delegate:
   "the whole point of this app is to act as a tool to help me with my project" — load the
   public dataset and see its graphs, record my own sensor and see it in the app, compare my
   sensor with the public data at the same placement and gesture.
4. Commit and push only when asked. The repo is public.

Timeline (from the Gantt image at the bottom of the root README; made around the midterm, so
confirm before relying on a date):

- Fall final presentation: **Fri 2026-12-11**; deck and demo prep Dec 7–10.
- Fall phases still open: Phase 4 processing & mapping pipeline (Nov 9 – Dec 4), Phase 5
  validate the controls (Nov 30 – Dec 9).
- Spring (marked TBD): Phase 6 real EMG signals (Jan 11 – Feb 12 2027), Phase 7 map to real
  devices, Phase 8 testing with users, Phase 9 wrap-up to Apr 30 2027.

---

## 4. Project map

| Folder | What it is | State |
| --- | --- | --- |
| `MyoElektra/` | Teensy 4.1 USB gamepad firmware (`MyoElektra.ino`, `controller.h/.cpp`). Fake EMG → RMS envelope → A button + right trigger. Serial commands `f t a x y l r ?` (see root README) | works, last edited Oct 26 |
| `sensor-lab/` | SEN0240 bench bring-up: `sketch/sensor_read/sensor_read.ino`, `PIPELINE.md` (signal-chain map + measured numbers), `notes.md` (bench notebook), `captures/` | sketch mid-refactor, does not compile |
| `emg-arm3d/` | MyoArm3D: FastAPI + vendored three.js tool | rebuilt this session, untested in a browser |
| `tools/` | `key_emg.py`, `demo.fish` (gamepad helpers, in git) + MATLAB scripts (local only) | — |
| `emg-pipeline/` | NinaPro notebook exercises (local only) | 3 TODO cells |
| root | midterm report (`main.tex`, PDF, figures, `IEEEtran.cls`), `README.md` | — |

Machine facts: Linux (Nobara/Fedora), fish shell, `arduino-cli`, `node` v24, `ruff` and `gh`
installed; `gh` is logged in over HTTPS as of 2026-11-17. No browser was available to Claude,
and no Teensy was plugged in during the session.

---

## 5. Git and GitHub

- Remote: `origin` → `https://github.com/axTheDev/MyoElektra.git` (**public**). The account
  was renamed; the old `alexs-2020/MyoElektra` URL redirects there.
- Branch `main`, in sync with the remote at `410622c`. Working tree clean apart from this file.
- History: 24 older commits holding the midterm report (uploaded through the web UI), then
  - `8e497dd` Add MyoArm3D app and sensor-lab bench sketch
  - `410622c` Add gamepad firmware, helper scripts and repo overview
- The root README is now: folder overview table → gamepad build/usage docs → the timeline
  image under "Timeline".
- `.gitignore` (root) keeps out: venvs, caches, `MyoElektra/build/`, the dataset,
  `emg-pipeline/`, `opencode.json`, and everything in `tools/` except `key_emg.py` and
  `demo.fish`.
- `sensor-lab/.gitignore` keeps out `captures/*.csv`. Note the asymmetry: captures **recorded
  by the app** are folders (`captures/<id>/recorded.csv`), which that pattern does not match,
  so they *would* be committed. Decide which you want before the first real recording.

---

## 6. Bench facts (measured, from `sensor-lab/PIPELINE.md` and `notes.md`)

- Wiring: SEN0240 VCC → 3V3, GND → GND, AOUT → Teensy **pin 23 / A9**. Output is 0–3.0 V
  centred on 1.5 V.
- ADC: 12-bit at 1 kHz, verified 3004 lines / 3 s. Resting raw baseline ≈ **1855 counts**.
- Envelope in use: **peak-to-peak (max − min) over a 100 ms window, emitted at 10 Hz**.
- Rest floor is session-dependent: **≈480** (session 1) vs **≈185** (session 2, better
  contact). Stable ±2 % within a session. So absolute thresholds are dead; everything must be
  relative to a floor calibrated at startup (median of 1–2 s is enough).
- Hard clench ≈ **830–860** (~4.5× floor), clean hills, no clipping. Mild clench: not measured.
- Planned detection: ON at 2.5× floor, OFF at 1.5× floor, 3-window debounce.
- Open questions: the "3708 pinned" reading from session 1 (suspected squeeze artefact /
  saturation); why the floor differed 2.6× between sessions (contact? mains hum?).
- Gotcha: two programs reading the port halve the stream. Check `fuser /dev/ttyACM0` first.
  The app reports who holds the port when it cannot open it.

Existing captures (flat files, one integer per line, untagged):

- `2026-11-09_rest_floor480_17s.csv` — 171 windows, fully relaxed, median ≈ 479.
- `2026-11-09_clenches_floor185_halfstream.csv` — 64 windows, half-streamed (every other
  window lost), floor ≈ 185, two clench hills peaking 826 / 860.

---

## 7. Firmware state — `sensor-lab/sketch/sensor_read/sensor_read.ino`

The owner's file; **not to be rewritten for them**. The design in it is good:
`loop → window() → floor_update() → flex_decide() → emit()`, one function per pipeline stage.
`window()` is complete. Things a reviewer would point out, as of today (line numbers approximate):

- Two `loop()` definitions (around lines 101 and 151). The old one at the bottom, plus
  `better()`, `remove_dc()`, `initial_calibrate()`, `correct_drift()`, are leftovers from before
  the refactor and are themselves incomplete.
- `setup()`: `const rest = calibrate` is not a statement.
- `floor_update()`:
  - `int float floor = 0` — pick one type; and it needs to be `static`, otherwise the floor
    resets to 0 on every call (the same lesson as the first bench session).
  - missing semicolons after `floor = calib[10]` and `return floor`.
  - `floor =+ (...)` assigns instead of accumulating; meant `+=`.
  - while calibrating it returns 0, so the caller needs to know "not calibrated yet" (0 works
    as that signal if `flex_decide` treats it so).
  - `floor` shadows the C math function of the same name — legal, but a rename avoids confusion.
- `flex_decide()` and `emit()` are empty; `flex_decide` has no `return`.
- New `loop()` uses `tick`, which does not exist yet (the 1 kHz `elapsedMicros` check from the
  old loop is what belongs there).
- Header comment is stale (still says 4 fields at 1 kHz and pin A0).

**Design risk worth deciding before writing `flex_decide`:** a 10 Hz envelope with a 3-window
debounce means roughly 0.3–0.4 s between flexing and the button press. That will feel laggy in
a game. Updating the window more often (a sliding window, e.g. 100 ms wide every 10–20 ms)
keeps the same debounce count at a fraction of the delay.

What the app wants from the sketch is in §9.

---

## 8. The 3D app — `emg-arm3d/`

Run: `./run.sh`, then open `http://127.0.0.1:8890`. First start takes ~12 s (loading the
`.mat`). Bound to 127.0.0.1 only; no CDN; deps pinned; JS vendored.

### Files

```
config/markers.json    12 DB3 electrode spots {az, y} + muscle capsules (single source of truth)
config/gestures.json   49 gestures: stimulus id -> name (E1 verified; E2/E3 NOT verified)
config/model3d.json    anatomical mesh alignment (tune in the browser with ?rig=1)
models/                arm GLB (CC-BY 4.0, attribution in NOTICE.md)
server/app.py          DB3 endpoints
server/nina.py         .mat loader           server/signals.py   rectify -> 50 ms mean -> / rest floor
server/captures.py     capture store + API   (new this session)
server/live.py         bench stream: serial/replay hub, recording, WebSocket (rewritten this session)
web/app.js             3D scene, charts, bench scope, capture UI (~1725 lines)
web/capture.js         pure compare helpers  (new)      web/capture.test.mjs   its test
web/index.html, style.css
web/vendor/            three.js 0.187.0, hash-checked (VENDOR.md)
```

### API

```
GET   /api/datasets                         GET  /api/gestures?d=S1_E2
GET   /api/channels                         GET  /api/envelopes              (all 12 in one request)
GET   /api/channels/{ch}/envelope           GET  /api/channels/{ch}/segment/{gesture}/{rep}
GET   /api/model3d
GET   /api/captures                         list with tags, no samples
GET   /api/captures/{id}                    meta + values[lane][i] + lanes + rate + bad
PATCH /api/captures/{id}                    note / gesture / placement / floor (null clears)
GET   /api/live/sources     GET /api/live/status
POST  /api/live/start {source, loop}        source = "serial" or "replay:<capture id>"
POST  /api/live/stop
POST  /api/live/record {action: start|stop, name, note, gesture, placement}
POST  /api/live/mark {label}                WS /ws/live
```

URL flags: `?d=S1_E2` picks the dataset, `?rig=1` shows mesh-alignment sliders, `?cam=` sets
the camera. Browser storage: `myPin` (my sensor's placement), `model3dRig`.

### Captures on disk

Two shapes, both under `sensor-lab/captures/`:

- **Recorded by the app:** `<date>_<name>_<dur>s/recorded.csv` + `meta.json`.
- **Old flat files:** `<id>.csv`; a sidecar `<id>.csv.meta.json` appears only once tagged.

`meta.json` fields: `note`, `gesture` (DB3 stimulus id), `placement` `{az, y, label}`, `floor`,
`fw` (key=number pairs the firmware printed), `rate` (measured from first/last row times),
`marks` `[{t_s, row, label}]`, `recorded_at`, `source`. `recorded.csv` starts with the
`# lanes:` / `# key=value` header the firmware gave. Each finished recording also appends a
stub entry to `sensor-lab/captures/README.md` for the story to be written by hand.

### Coordinates

Pins and DB3 markers share one system: `az` in degrees around the forearm, `y` from 0 (elbow
joint line) to 1 (wrist). "Nearest DB3 electrode" is arc-length distance in that space
(`web/capture.js`, forearm radius taken as 0.12 forearm lengths).

### The loop in the UI

1. **Place the sensor:** 3D view → "place on arm" → click. White pin; shows the nearest DB3
   electrode. Persists in the browser.
2. **Record:** bench mode → start serial (or a replay) → choose the gesture → record → Space
   at each trial onset → stop.
3. **See it:** the capture appears under "my captures" and as a pink pin. Clicking it jumps
   to its gesture and its nearest DB3 electrode.
4. **Compare:** the compare card overlays my trials (warm colours) on the DB3 reps (blue),
   onset-aligned. "big view" opens a zoomable version. Old captures can be tagged afterwards
   with "gesture ← selected", "pin ← my sensor" and the floor box.

### What the comparison means

- **× floor:** each signal as multiples of its own rest floor. My capture's floor comes from,
  in order: a `floor` lane, the number typed in the floor box, a `# floor=N` line from the
  sketch. With none of those it falls back to % peak.
- **% peak:** each sensor scaled to its own biggest trial — shape and timing only.
- Trials: from 0.5 s before each mark to the next mark, capped at 8 s. No marks → the whole
  capture is one trial.
- Honest limits: DB3 is mean-|x| over 50 ms from a Delsys electrode, mine is P2P over 100 ms;
  x = 0 is DB3's relabelled trial start but my Space press. Shapes and ratios compare,
  absolute values do not.

---

## 9. The contract between the sketch and the app

One line per sample or window, comma-separated integers. Optional comment lines describe the
stream:

```
# lanes: env,floor,flex
# floor=185
412,185,1
```

- The app sends `?` once when it opens the port (115200 nominal). Printing the two comment
  lines in response to `?` is the reliable way to get them through, since boot-time prints
  are usually gone before the port opens.
- Without `# lanes:` the lanes are guessed from the field count: 1 → `env`; 3 →
  `env,floor,flex`; 4 → `raw,corr,env,flex`; anything else → `f1..fn`.
- The comparison uses the lane called `env` (else the first one).
- Port: first `/dev/ttyACM*`; override with `MYOARM_PORT=/dev/ttyACM1 ./run.sh`.
- Lines with the wrong field count are counted as bad and skipped, not fatal.

---

## 10. What was tested, and what was not

Tested during the session:

- Server, end to end against a replay: start → record with gesture and placement → two marks
  → stop → capture saved with correct `meta.json` → PATCH floor → replay the new capture →
  WebSocket rows arrive. Bad capture id → 404. Serial start with no Teensy → clear error.
- `node web/capture.test.mjs` passes; `node --check web/app.js` passes (re-run 2026-11-17).
- The frontend ran headless in Node with a stub DOM: init, capture list, pin placement and
  persistence, compare card, peak mode, big view, retagging, bench mode switch — no errors.

**Not tested:**

- Anything in a real browser. Layout, CSS and the 3D picking have never been seen.
- Pin placement on the **anatomical mesh** (the headless run only exercised the simple
  fallback arm).
- The live serial path with a real Teensy, and therefore `# lanes:` / `?` handling on real
  hardware.

Expect a round of small fixes after the first real run.

---

## 11. Open items

App:

1. First real-browser run and first real-sensor recording; fix what breaks.
2. **Gesture names for E2 and E3 are unverified.** E2 (ids 18–40, C1–C23) were written from
   memory of the NinaPro paper; E3 (ids 41–49) are generic "D1–D9 force pattern". Check
   against the DB2/DB3 paper before quoting any. No hand poses exist for ids ≥ 18.
3. **Possible volar/dorsal label mix-up in `config/markers.json`.** Its note says az 90 =
   volar, 270 = dorsal, yet FDS (a flexor) is at az 270 and EDS (an extensor) at az 90.
   Noticed while writing this file; **not investigated**. Pins and markers share the same
   coordinates so nearest-electrode matching is self-consistent either way, but any text that
   says "volar"/"dorsal" (the note, a comment in `server/captures.py`, the app README) may be
   the wrong way round.
4. Comments in `server/app.py`, `server/signals.py` and the app README cite
   `tools/tag_exercise1.m`, which is not in the repo.
5. `ruff check emg-arm3d/server` reports 13 style findings (import order, a `re.I` alias,
   broad `except`); none fixed, none functional.
6. Milestone M5 (later, only if the report needs it): per-placement results (SNR, detection
   accuracy) drawn on the arm.
7. The two legacy captures are untagged.

Docs that are now stale: `sensor-lab/README.md` still describes the 4-field 1 kHz protocol
and milestones M1–M5 as unchecked, while `PIPELINE.md` and `notes.md` are current.

---

## 12. What is left this semester (my view, in priority order)

Critical path — firmware, the owner's:

1. Get `sensor_read.ino` compiling again (§7).
2. Floor calibration at startup (median of ~2 s of envelope).
3. Flex detection: floor-relative hysteresis + debounce — after deciding the latency question.
4. Promote that chain into `MyoElektra/` so a real flex presses A and drives the trigger.
5. Play a game with it.

Evidence for the report — the owner, using the app:

- Same gesture at two or three tagged placements, compared against DB3, to justify where the
  sensor goes.
- Numbers: clench-to-floor ratio; hits / misses / false triggers over a set of trials; latency.
- Close the bench questions in §6.

Probably not this semester: multi-gesture classification. One single-channel sensor gives one
on/off plus a proportional signal. The owner's own timeline puts "real EMG signals" in spring,
so a real sensor driving the pad by Dec 11 would already be ahead of plan.

---

## 13. Commands

```fish
# app
cd emg-arm3d
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # once per machine/folder
./run.sh                                                             # http://127.0.0.1:8890
node web/capture.test.mjs                                            # compare-helper test

# firmware (from the project root; check the port with: arduino-cli board list)
arduino-cli compile --upload -p <port> --fqbn teensy:avr:teensy41 sensor-lab/sketch/sensor_read
arduino-cli compile --upload -p <port> --fqbn teensy:avr:teensy41:usb=serialhid MyoElektra

# gamepad helpers
python3 tools/key_emg.py          # 1 = flex 80, 2 = flex 40, 0 = relax, q = quit
fish tools/demo.fish              # scripted throttle / steer / brake

# who is holding the serial port
fuser /dev/ttyACM0
```

After moving the folder, recreate `emg-arm3d/.venv` if `./run.sh` fails — virtual
environments do not always survive a move.

---

## 14. What happened in the session, briefly

1. Explored the whole project for context.
2. Rebuilt the app around the owner's stated goal: capture store and API, bench recording
   with gesture/placement/marks, pins on the arm, mine-vs-DB3 compare card and big view,
   one-request envelope loading, real timestamps in the bench scope, E2/E3 gesture entries,
   README rewrite. Firmware was not touched.
3. Listed what is left for the semester (§12).
4. Put the code on GitHub: two commits on top of the existing report history in the public
   `MyoElektra` repo, after re-authenticating with `gh auth login`.
5. Wrote this file.
