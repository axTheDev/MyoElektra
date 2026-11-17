# captures/ — kept experiments, one line per P2P envelope window (10 Hz unless noted)

## 2026-11-09_rest_floor480_17s.csv
Session 1, dry pads, inner forearm. 171 windows (~17 s at 10 Hz), fully relaxed.
Median floor ≈ 479 counts (IQR 469–489). Basis for "1–2 s calibration suffices".

## 2026-11-09_clenches_floor185_halfstream.csv
Session 2 (better contact). 64 windows (~6.4 s of coverage) — HALF-STREAMED: a second
`cat` was reading the port concurrently, so every other window survives. Each line is
still a complete 100 ms window. Rest floor ≈ 185, two clean clench hills peaking 826/860
(~4.5× floor, no clipping). Basis for "absolute thresholds dead" + first real clench number.

## Not kept but recorded in PIPELINE.md rules
- raw 1 kHz capture (~10.6k lines): baseline raw ≈ 1855 counts, rest sd ~280–330.
- session-1 "clench = 3708 pinned": suspected mechanical squeeze artifact, open issue.

Rule of the folder: name files `date_what_sensorstate_duration.csv`, write the story
HERE, not only in the filename. Check `fuser /dev/ttyACM0` before capturing.
