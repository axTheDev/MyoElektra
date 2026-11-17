# MyoArm3D — interactive 3D EMG placement & channel explorer

A personal dev tool: a 3D forearm with the NinaPro DB3 electrode positions rendered on it.
Click an electrode to see that channel's signals and graphs, watch muscles light up in sync
with the data, record where *my* physical sensor was placed and what it measured, and overlay
the two — a spatial lab notebook for the MyoElektra capstone.

```
┌─────────────────┬──────────────────┐
│                 │  ch9 FDS         │
│    3D arm       │  ~~~▁▂▅▇▅▂___    │
│  (FDS glowing)  │  B6 fist, 5 s    │
│  ● ● markers    ├──────────────────┤
│  ◆ my captures  │  mine vs DB3     │
│  (click→graph)  │  ~~▂▅▇▅▂ overlay │
└─────────────────┴──────────────────┘
```

## Why

- Reading 12 stacked envelopes (what `tools/tag_exercise1.m` gives) is fine for structure but
  spatially blind: understanding *which spot hears which gesture* is the core question of a
  1–2-channel device. A clickable 3D arm makes that intuition direct.
- The bench-testing notebook use case: "sensor here, over muscle X, produced THIS graph" is
  much stronger as a placed pin than as a line of text in a table.

## The loop this tool exists for

1. **Public data** — pick a NinaPro DB3 session, gesture and electrode on the 3D arm; see
   raw / rectified / envelope per trial, all reps overlaid, all 12 sensors side by side.
2. **My measurement** — in the 3D view press *place on arm* and click where my sensor sits
   (white pin). In **bench** mode start the Teensy (or a replay), choose the gesture I'm about
   to do, hit record, tap Space at each trial onset, stop. The capture is saved to
   `../sensor-lab/captures/<date>_<name>_<dur>s/` with placement + gesture + marks in `meta.json`.
3. **See it** — every capture shows up in *my captures* and as a pink pin on the arm.
   Clicking one jumps to its gesture and to the DB3 electrode nearest its pin.
4. **Compare** — the compare card overlays my trials (warm) on the DB3 reps (blue) for the
   same gesture, onset-aligned. Pick another channel or gesture to compare against that instead.
   Old captures can be tagged afterwards (*gesture ← selected*, *pin ← my sensor*, floor box).

Comparison scales (button on the compare card):
- **× floor** — each signal as multiples of its own rest floor. Needs a floor for my capture:
  a `floor` lane, a `# floor=N` line from the firmware, or the number typed into the floor box.
- **% peak** — each sensor scaled to its own biggest trial: shape and timing only. Used
  automatically when a capture has no floor.

Read it honestly: DB3 is mean-|x| over 50 ms from a Delsys electrode, mine is whatever
envelope the sketch prints (P2P over 100 ms today), and x = 0 is the relabelled trial start
for DB3 but my Space press for me. Shapes and ratios compare; absolute values don't.

## What the firmware has to send (and nothing more)

One line per sample/window, comma-separated integers. Optional self-description, as comment
lines the hub understands (it sends `?` when it opens the port, so answering `?` with them
is the reliable way to get them through):

```
# lanes: env,floor,flex     names for the fields, in order
# floor=185                 any key=number pairs; kept in meta.json under "fw"
412,185,1
```

Without `# lanes:` the lanes are guessed from the field count (1 = `env`, 3 = `env,floor,flex`,
4 = `raw,corr,env,flex`, otherwise `f1..fn`). The compare view uses the lane called `env`
(else the first one). The port is the first `/dev/ttyACM*`; override with `MYOARM_PORT=...`.
The house rule stands: the sketch computes, the server ferries, the browser draws.

## Non-goals / anti-goals

- Not a medical anatomy viewer: muscle geometry is *indicative*, not clinically exact
  (the DB3 ring electrode numbering isn't anatomically documented anyway — see
  `tools/tag_exercise1.m` comments).
- Not built for demos/committee — built for my dev speed. Ugly-but-working wins.
- No user accounts, no server exposure: everything is 127.0.0.1, local only.

## Architecture (chosen)

**Python backend (FastAPI) + Three.js frontend in the browser.**

- Backend: FastAPI + uvicorn + numpy on `127.0.0.1:8890`.
  Loads DB3 `.mat` (scipy.io), precomputes per-channel envelopes + gesture segments,
  serves JSON; reads/writes my captures; ferries the serial stream.
- Frontend: a static page with **vendored, version-pinned** three.js (no CDN at runtime —
  offline-capable), a small hand-rolled canvas chart (no chart lib), and marker picking
  via raycasting.
- Serial: `pyserial` reading `/dev/ttyACM*` in a thread, pushed to the browser over a
  WebSocket; a stored capture replays through the exact same path.
- Why not pure-browser or MATLAB: pure-browser dead-ends at the serial/live step; MATLAB 3D
  picking/highlight UX is a fight and can't become the bench tool. (Both were considered.)

## Layout

```
config/markers.json    the 12 DB3 electrode spots {az, y} + muscle map (single source of truth)
config/gestures.json   stimulus id -> gesture name (E1 verified; E2/E3 names need checking)
config/model3d.json    anatomical mesh alignment (tune with ?rig=1)
server/app.py          DB3 endpoints: /api/datasets /api/gestures /api/envelopes
                       /api/channels/<ch>/segment/<gesture>/<rep>
server/captures.py     my captures: GET /api/captures, GET/PATCH /api/captures/<id>
server/live.py         bench stream: /api/live/{sources,start,stop,record,mark} + WS /ws/live
web/app.js             3D scene, charts, bench scope, capture UI
web/capture.js         pure compare helpers (test: node web/capture.test.mjs)
```

Pins use the same `{az, y}` coordinates as `markers.json` (az: 0 radial, 90 volar, 180 ulnar,
270 dorsal; y: 0 elbow line → 1 wrist), which is what makes "nearest DB3 electrode" meaningful.

## Signals shown (matching the real sensor chain, see ../tools/tag_exercise1.m notes)

- DB3 `emg` columns are raw bandpassed waveforms (20–450 Hz, zero-mean) ≈ what the SEN0240
  `A` pin outputs after ×gain +1.5 V offset. The app always shows: raw waveform, rectified
  |x|, smoothed envelope (the same stages the Teensy pipeline will run).

## Run

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # once, venv stays in this folder
./run.sh                                                             # then open http://127.0.0.1:8890
```

The NinaPro DB3 data is not in this repo (large, and re-downloadable). Get subject 1
(`s1_0.zip`) from ninapro.hevs.ch and unzip it one level above this folder, so the files sit at
`../Nina Dataset/s1_0/DB3_s1/S1_E{1,2,3}_A1.mat`.

First time the server starts it loads `S1_E1_A1.mat` (~12 s of `loadmat`) before it answers.
three.js lives vendored under `web/vendor/` (hash-checked, see `web/vendor/VENDOR.md`).
The anatomical arm mesh sits in `models/` (license in `models/NOTICE.md`); alignment
settings live in `config/model3d.json` — open the page with `?rig=1` for in-browser
alignment sliders (rotate/shift/scale/wrist-clip) with a copy-config button.

## Milestones

- **M1–M2** DB3 browser: arm, markers, click→graph, glow playback, posing hand — done 2026-11-03
- **M3** E2/E3 sessions, anatomical mesh, bench scope with replay/serial/record — done 2026-11-10
- **M4** pins + tagged captures + mine-vs-DB3 compare — done 2026-11-13 (not yet tried on the
  real sensor: only replays were available when it was built)
- **M5** (later) per-spot results (SNR / detection accuracy) rendered on the arm — the
  placement map for MyoElektra itself

## House rules

- Python deps pinned in `requirements.txt`, venv-local only; JS libs vendored with version in
  the filename. Server binds 127.0.0.1. No secrets, no CDN.
