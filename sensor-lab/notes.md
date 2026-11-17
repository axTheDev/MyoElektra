# Bench notebook — sensor-lab

One dated entry per session: gain setting, electrode positions (which muscle,
left/right, spot label), what the lanes looked like, numbers that belong in
PIPELINE.md "Rules", surprises. Paste plot screenshots into `captures/` if
worth keeping.

## 2026-11-09 — skeleton day

- SEN0240 delivered. Skeleton M0 created (README, PIPELINE, stub sketch).
- Sketch stub compiles; no firmware logic written yet (M1 is next, by hand).
- Python env not created yet — commands in README.

## 2026-11-09 — first light on the SEN0240 (session 1+2)

- M1 written by hand: 1 kHz sampler on A9 (physical pin 23), verified 3004 lines/3 s.
- Bugs met and learned: paste-into-buffer mishap; function-local state resets per call
  (`static`/globals — rite-of-passage); `==` counter skip; compile ≠ upload ≠ firmware.
- Dry electrodes (3 metal pads on the board, no gel): contact pressure is everything.
- Replaced raw print with P2P (min–max over 100 ms) envelope @10 Hz — visible at a glance.
  S2 baseline handling absorbed by the short window (drift-immune).
- Measured: raw baseline ~1855; rest floor session-dependent 480 → 185; hard clench
  hills ~830–860 (~4.5× floor), clean rise/fall, no clipping; floor stable ±2%/17 s.
- 3708-pinned "clench" from session 1 = suspected squeeze artifact (open issue).
- Split-stream gotcha: two readers halve any capture (`fuser /dev/ttyACM0` first).
- Key decisions banked in PIPELINE.md: calibration = 1–2 s median of envelope;
  absolute thresholds dead → floor-relative with hysteresis + debounce next.
- Captures archived in captures/ with story in captures/README.md.
