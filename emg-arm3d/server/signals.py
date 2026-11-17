"""Signal stages for MyoArm3D - deliberately the SAME stages as
../tools/tag_exercise1.m and the Teensy pipeline will run:
  rectify |x| -> mean over 50 ms blocks (20 Hz envelope) -> / rest noise floor.
DB3 signals arrive bandpassed 20-450 Hz zero-mean, so rectify+smooth is enough.
"""

import numpy as np

ENV_HZ = 20.0  # envelope block rate -> 50 ms blocks at 2 kHz


def envelope(raw: np.ndarray, fs: int) -> np.ndarray:
    """Mean of |raw| over non-overlapping 50 ms blocks.
    raw: (samples,) or (samples, nch) -> (nblocks,) or (nblocks, nch)."""
    win = round(fs / ENV_HZ)
    x = np.abs(raw)
    n = x.shape[0] // win
    reshaped = x[: n * win].reshape(n, win, *x.shape[1:])
    return reshaped.mean(axis=1)


def rest_floor(emg: np.ndarray, lab: np.ndarray) -> np.ndarray:
    """Per-channel RMS during rest samples (lab == 0): the '1.0' reference
    of the normalized view (value 1 = noise floor, 20 = strong contraction)."""
    return np.sqrt((emg[lab == 0] ** 2).mean(axis=0))
