"""MyoArm3D backend - serves DB3 sessions, my own captures and the static frontend.

  DB3 (public data)   /api/datasets /api/gestures /api/envelopes /api/channels/...
  my captures         /api/captures...            (captures.py)
  live bench stream   /api/live/... + /ws/live    (live.py)

Local dev tool: binds 127.0.0.1 only (see ../run.sh). Session data is loaded
once at startup; the numbers here must match ../tools/tag_exercise1.m exactly
(same .mat, same restimulus edges, same 50 ms mean-|x| envelope, same rest
noise-floor normalization).
"""

import json
import re
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

import captures
import live
import nina
from signals import ENV_HZ, envelope, rest_floor

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
CONFIG = ROOT / "config"
MODELS = ROOT / "models"

MARKERS_PATH = CONFIG / "markers.json"  # re-read per request so edits show on reload


def markers_cfg():
    return json.loads(MARKERS_PATH.read_text())


GESTURES = json.loads((CONFIG / "gestures.json").read_text())


# ---- sessions: lazy registry, one .mat per dataset id (S1_E1, S1_E2, ...) --
def load_bundle(subject: int, exercise: int) -> dict:
    """Everything computed for one DB3 session (the heavy, once-per-file part)."""
    sess = nina.load_session(subject, exercise)
    emg, lab, fs = sess["emg"], sess["restimulus"], sess["fs"]
    i0, e0 = nina.trial_edges(lab)  # per-sample trial edges from the answer key
    val = lab[i0]  # which gesture (1..17) each trial is

    # repetition number inside a run of same-gesture trials (as tag_exercise1.m)
    block = np.cumsum(np.concatenate(([True], np.diff(val) != 0)))
    rep = np.empty(len(val), dtype=int)
    for b in np.unique(block):
        idx = np.flatnonzero(block == b)
        rep[idx] = np.arange(1, len(idx) + 1)

    win = round(fs / ENV_HZ)  # 100 samples = 50 ms at 2 kHz
    env = envelope(emg, fs)  # (nblocks, 12)
    envn = env / np.maximum(rest_floor(emg, lab), 1e-12)  # 1 = rest noise floor

    # per-trial summary: median normalized envelope -> level + loudest channel
    # (this is what ../tools/nina_inspect/S1_E1_trials.txt reports)
    lvl = np.zeros(len(i0))
    trch = np.zeros(len(i0), dtype=int)
    for k in range(len(i0)):
        a = i0[k] // win
        b2 = min(e0[k] // win, env.shape[0] - 1)
        med = np.median(envn[a : b2 + 1], axis=0)
        trch[k] = int(np.argmax(med))
        lvl[k] = float(med[trch[k]])

    return {
        "emg": emg,
        "fs": fs,
        "i0": i0,
        "e0": e0,
        "val": val,
        "rep": rep,
        "win": win,
        "envn": envn,
        "lvl": lvl,
        "trch": trch,
    }


DATASET_RE = re.compile(r"^S(\d+)_E(\d+)$")
DEFAULT_DATASET = "S1_E1"  # subject/exercise the arm alignment + markers were tuned for


def dataset_ids() -> list[dict]:
    """Every DB3 session .mat actually present on disk."""
    out = []
    for f in sorted(nina.DATA_ROOT.glob("s*_0/DB3_s*/S*_E?_A1.mat")):
        m = DATASET_RE.match(f.name.removesuffix(".mat").removesuffix("_A1"))
        if m:
            out.append({"id": m.group(0), "subject": int(m[1]), "exercise": int(m[2])})
    return out


_BUNDLES = {DEFAULT_DATASET: load_bundle(1, 1)}  # warm the default at startup


def bundle(d: str) -> dict:
    """Cached session bundle; other datasets load (and stay cached) on first use."""
    if d not in _BUNDLES:
        m = DATASET_RE.match(d)
        if not m or not nina.mat_path(int(m[1]), int(m[2])).exists():
            raise HTTPException(404, f"unknown dataset {d!r}")
        _BUNDLES[d] = load_bundle(int(m[1]), int(m[2]))
    return _BUNDLES[d]


app = FastAPI(title="MyoArm3D", docs_url=None, redoc_url=None)


@app.middleware("http")
async def no_cache(request, call_next):
    """Local dev tool: force browser revalidation so a plain reload gets fresh
    files (hard-reload keybinds are eaten by the niri/DMS compositor)."""
    resp = await call_next(request)
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.get("/api/channels")
def get_channels():
    """markers.json verbatim: spots, labels, muscle map (single source of truth)."""
    return markers_cfg()


@app.get("/api/datasets")
def get_datasets():
    """DB3 session files found on disk + the default one the frontend opens."""
    return {"default": DEFAULT_DATASET, "datasets": dataset_ids()}


@app.get("/api/gestures")
def get_gestures(d: str = DEFAULT_DATASET):
    """Gesture table + every trial's segment (from restimulus)."""
    b = bundle(d)
    segs = [
        {
            "gesture": int(b["val"][k]),
            "rep": int(b["rep"][k]),
            "start": round(b["i0"][k] / b["fs"], 3),
            "end": round((b["e0"][k] + 1) / b["fs"], 3),
            "level": round(b["lvl"][k], 2),
            "loudest": int(b["trch"][k] + 1),
        }
        for k in range(len(b["i0"]))
    ]
    # gesture table for THIS dataset's stimulus ids (E1 = 1-17, E2 = 18-40,
    # E3 = 41-49); ids missing from gestures.json get a fallback name
    names = {g["id"]: g for g in GESTURES["gestures"]}
    gest_table = [
        names.get(g, {"id": g, "name": f"G{g}", "desc": "unlabelled stimulus id"})
        for g in sorted(set(int(v) for v in b["val"]))
    ]
    return {
        "session": d,
        "fs": b["fs"],
        "duration": round(b["emg"].shape[0] / b["fs"], 3),
        "gestures": gest_table,
        "segments": segs,
    }


@app.get("/api/envelopes")
def get_envelopes(d: str = DEFAULT_DATASET):
    """Whole-session normalized 20 Hz envelope of every channel, one request."""
    b = bundle(d)
    envn = np.round(b["envn"], 4)
    return {
        "rate": ENV_HZ,
        "channels": [
            {"ch": k + 1, "label": nina.CH_LABELS[k], "values": envn[:, k].tolist()}
            for k in range(envn.shape[1])
        ],
    }


@app.get("/api/channels/{ch}/envelope")
def get_envelope(ch: int, d: str = DEFAULT_DATASET):
    """Whole-session normalized 20 Hz envelope for one channel."""
    b = bundle(d)
    nch = b["emg"].shape[1]
    if not 1 <= ch <= nch:
        raise HTTPException(404, f"channel must be 1..{nch}")
    return {
        "ch": ch,
        "label": nina.CH_LABELS[ch - 1],
        "rate": ENV_HZ,
        "values": np.round(b["envn"][:, ch - 1], 4).tolist(),
    }


@app.get("/api/channels/{ch}/segment/{gesture}/{rep}")
def get_segment(ch: int, gesture: int, rep: int, d: str = DEFAULT_DATASET):
    """One trial window (1 s pre-context, 0.5 s tail): raw / rectified / envelope."""
    b = bundle(d)
    emg, fs, win = b["emg"], b["fs"], b["win"]
    nch = emg.shape[1]
    if not 1 <= ch <= nch:
        raise HTTPException(404, f"channel must be 1..{nch}")
    hits = np.flatnonzero((b["val"] == gesture) & (b["rep"] == rep))
    if hits.size == 0:
        raise HTTPException(404, f"no trial with gesture={gesture} rep={rep}")
    k = int(hits[0])
    i0, e0 = b["i0"][k], b["e0"][k]
    ws = max(i0 - fs, 0)  # 1 s of rest before the labelled start
    we = min(e0 + fs // 2, emg.shape[0])  # short tail for release
    raw = emg[ws:we, ch - 1]
    rect = np.abs(raw)
    nb = len(rect) // win
    envw = rect[: nb * win].reshape(nb, win).mean(axis=1)
    return {
        "ch": ch,
        "label": nina.CH_LABELS[ch - 1],
        "gesture": gesture,
        "rep": rep,
        "fs": fs,
        "t0": round(ws / fs, 3),
        "trialStart": int(i0 - ws),  # sample offsets of the labelled trial
        "trialEnd": int(e0 - ws),  # inside the returned arrays
        "raw": np.round(raw, 6).tolist(),
        "rect": np.round(rect, 6).tolist(),
        "env": np.round(envw, 6).tolist(),
    }


@app.get("/api/model3d")
def get_model3d():
    """Optional anatomical-mesh config; {"enabled": false} when absent."""
    f = CONFIG / "model3d.json"
    if not f.exists():
        return {"enabled": False}
    return json.loads(f.read_text())


# my own recordings (captures.py) + bench-mode live stream (live.py)
app.include_router(captures.router)
app.include_router(live.router)
app.include_router(live.ws_router)


# static frontend (mounted last so /api/* wins)
app.mount("/models", StaticFiles(directory=MODELS), name="models")
app.mount("/", StaticFiles(directory=WEB, html=True), name="web")
