"""Data access for NinaPro DB3 - the only part I wrote for you, so you don't
re-pay the quirks tuition. NO signal processing lives in here on purpose:
load raw arrays + build the "answer key" from restimulus. Your rectify /
envelope / detector code goes in nina_cells.py.

DB3 facts (paper: https://www.nature.com/articles/sdata201453):
  emg        12 channels, 2 kHz, volts, zero-mean RAW waveform (not rectified)
             cols 0-7  = ring electrodes, equally spaced around the forearm
                         at elbow height (positions, NOT named muscles)
             col 8     = FDS (flexor digitorum superficialis)
             col 9     = EDS (extensor digitorum superficialis)
             col 10    = biceps brachii
             col 11    = triceps brachii
  stimulus     label the experiment software showed (perfect clockwork)
  restimulus   same labels re-fitted to where the activity actually was
                -> this is the answer key; 0 = rest

NOTE python indices are 0-based: emg[:, 8] is FDS (channel 9 in MATLAB).

Copy of ../emg-pipeline/nina.py (verified 2026-11-03) kept self-contained
here so this app stands alone; only the DATA_ROOT path is adapted.
"""

from pathlib import Path

import numpy as np
from scipy.io import loadmat

FS = 2000  # EMG sampling rate, Hz (DB3 spec)

# the .mat files live two levels up, next to the MATLAB tools
# (this file sits in emg-arm3d/server/)
DATA_ROOT = Path(__file__).resolve().parent.parent.parent / "Nina Dataset"

# exercise B gesture names (E1), index+1 = stimulus ID
GESTURES_E1 = [
    "B1  thumb up",
    "B2  idx+mid ext",
    "B3  ring+lit flex",
    "B4  thumb-oppose",
    "B5  finger spread",
    "B6  fist",
    "B7  point index",
    "B8  finger adduct",
    "B9  supinate mid",
    "B10 pronate mid",
    "B11 supinate lit",
    "B12 pronate lit",
    "B13 wrist flex",
    "B14 wrist ext",
    "B15 radial dev",
    "B16 ulnar dev",
    "B17 fist + wrist ext",
]

CH_LABELS = [
    "ring 1",
    "ring 2",
    "ring 3",
    "ring 4",
    "ring 5",
    "ring 6",
    "ring 7",
    "ring 8",
    "FDS flexor dig",
    "EDS ext dig",
    "biceps",
    "triceps",
]

# --- SEN0240 (DFRobot/OYMotion) front-end emulation parameters -----------
# sensor: gain ~1000 (input +/-1.5 mV -> output 0-3.0 V), 1.5 V reference,
# effective band 20-500 Hz (already covered: Delsys bandpassed at source).
# The datasheet recommends sampling at >= 1 kHz with >= 8-bit ADC.
SENSOR_GAIN = 1000.0
SENSOR_VREF = 1.5  # volts at the A-pin when there is no muscle signal
SENSOR_FS = 1000  # our emulated ADC rate


def mat_path(subject: int = 1, exercise: int = 1) -> Path:
    return (
        DATA_ROOT
        / f"s{subject}_0"
        / f"DB3_s{subject}"
        / f"S{subject}_E{exercise}_A1.mat"
    )


def load_session(subject: int = 1, exercise: int = 1) -> dict:
    """Load one DB3 exercise file. Returns dict with:
    emg  (samples x 12 float, volts, RAW), restimulus, stimulus, fs
    """
    s = loadmat(mat_path(subject, exercise))
    return {
        "emg": np.asarray(s["emg"], dtype=float),
        "restimulus": np.asarray(s["restimulus"]).ravel().astype(int),
        "stimulus": np.asarray(s["stimulus"]).ravel().astype(int),
        "fs": FS,
    }


def trial_edges(lab: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Answer key from a per-sample label array (0 = rest).
    Returns (i0, e0): 0-based, INCLUSIVE sample index of every trial's first
    and last labelled sample. The relabeller guarantees strict alternation
    rest/movement/rest, so every 0->x transition is exactly one trial start.
    Same logic as tag_exercise1.m (diff of the padded nonzero mask).
    """
    nz = lab != 0
    padded = np.concatenate(([False], nz, [False]))
    tr = np.diff(padded.astype(int))
    i0 = np.flatnonzero(tr == 1)  # first labelled sample
    e0 = np.flatnonzero(tr == -1) - 1  # last labelled sample
    return i0, e0


def to_sensor(emg_ch: np.ndarray) -> np.ndarray:
    """Map one raw DB3 channel (volts) to what the SEN0240 A-pin would
    output: raw * SENSOR_GAIN + SENSOR_VREF. This is the scale/offset
    assumption to re-measure on the real board - nothing else depends on it.
    """
    return emg_ch * SENSOR_GAIN + SENSOR_VREF


def at_sensor_rate(x: np.ndarray, fs: int = FS) -> np.ndarray:
    """Downsample a signal to SENSOR_FS by taking every n-th sample -
    what your analogRead loop will literally collect (no filtering)."""
    step = fs // SENSOR_FS
    return x[::step]
