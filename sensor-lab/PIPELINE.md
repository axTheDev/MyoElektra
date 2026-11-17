# PIPELINE.md — the living signal-chain map

Updated whenever a stage gets built or a real number replaces a placeholder.
One row = one stage. `lives in` is a promise: if a stage says `python`, it is a
dev-time crutch that must migrate to firmware before it can enter `MyoElektra`.

```
muscle ──analog──► SEN0240 board ──1.5V-centered analog──► Teensy firmware ──serial──► Python viewer
                   [✓ hardware]                          [C++, the product]          [draw-only]

       stage                       lives in       status
       ─────────────────────────   ──────────     ──────
       amplify ~×1100              board          ✅ soldered (INA333 + opamp)
       bandpass ~20–450 Hz        board          ✅ soldered (does the heavy lifting)
       +1.5 V DC offset           board          ✅ soldered
       S1  ADC read @ 1 kHz       firmware       ✅ done — 3004 lines/3 s verified (2026-11-09)
       S2  baseline handling      firmware       ◐ absorbed — P2P window is drift-immune by
                                                  construction; raw EMA deferred
       S3  envelope               firmware       ✅ variant: P2P (min–max) over 100 ms
                                                  window, emitted @10 Hz (better() in sketch);
                                                  RMS variant (../MyoElektra logic) pending
       S4  threshold → flex flag  firmware       ⬜ next — hysteresis + debounce, floor-relative
       calibration rule           firmware       ⬜ next — median of ~1–2 s P2P = floor
       10 Hz parser + live plot   python         ⬜ viewer (split/plot only — no signal math)
       60 Hz hum check            firmware       🔜 maybe — rest floor ~480 is high; Goertzel
                                                  meter would convict or clear the outlet
       on-flash logging (8 MB)    firmware       🔜 later — standalone recorder, not live view
```

## Rules (real numbers discovered on the bench replace the placeholders)

| rule | value | how it was found |
| --- | --- | --- |
| resting `raw` baseline | **~1855 counts** (≈1.49 V) | 1 kHz capture, block medians, 2026-11-09 |
| rest envelope floor (P2P/100 ms) | **session-dependent: ~480 (session 1), ~185 (session 2)** | relax-capture medians, 2026-11-09 ×2 |
| floor stability within a session | **±2% over 17 s, no real drift** | per-second medians 473–490 |
| calibration window | **1–2 s median is enough** | floor variance vs window length, above |
| **absolute thresholds: DEAD** | floor varies ~2.6× across sessions | 480 vs 185, same rig, one evening apart |
| hard clench envelope | **≈830–860** (~4.5× floor), clean hills, no clipping | 2-clench capture 2026-11-09 (session 2) |
| mild clench envelope | ??? | next capture with narration 😄 |
| flex threshold (S4) | plan: **ON ≈ 2.5×floor, OFF ≈ 1.5×floor** + 3-window debounce | once floor-calibration exists |
| envelope window (S3) | **100 ms** (P2P variant) | matches MyoElecTra's RMS start value |

## Open issues

- **The 3708 mystery:** session-1 "hard clench" pinned ~3708 with near-zero variance
  (rail saturation signature); session-2 hard clenches peak ~860. Suspect mechanical
  artifact (pressing/squeezing the dry-pad board) rather than muscle. Keep an eye on
  whether extreme values recur from actual clenches; if they do, check SEN0240 gain
  options — until then assume full dynamic range goes to ~3700.
- **Protocol discipline:** captures must actually contain the relax/clench pattern
  (narrate out loud), and line counts must match timeout×10 — a mismatch means a
  second reader stole half the stream (`fuser /dev/ttyACM0` before capturing).

## What the viewer lanes should look like when working

- lane 1 `raw`: noisy trace around ~1860 (mid-scale); rest ~ flat-ish, hum comb
  possible; clench makes the noise burst.
- lane 2 `corr`: rests at 0, bursts symmetric around 0. If it drifts away from 0
  when you shift your arm → baseline filter too slow (M2 problem).
- lane 3 `env`: flat at rest, smooth swelling hills on clenches, back down
  within ~0.5 s of relaxing. No hills you can time with a stopwatch? gain too low.
- lane 4 `flex`: flips within a few tens of ms of the start of a lane-3 hill.

## Deliberately NOT here

- filtering beyond what the board does — not before lane 1 proves we need it
- anything HID (that stays in ../MyoElektra until stages are promoted)
- classification / multiple gestures — capstone meat, after M5
- CSV recording — decided only after the live view exists (one-line add to the viewer)
