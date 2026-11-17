"""captures.py - the capture store: my own sensor recordings on disk.

One capture = one stream of integer lines the firmware printed, plus a
meta.json saying WHERE on the arm the sensor sat (placement), WHICH gesture
was performed (a DB3 stimulus id, so it lines up with the public data) and
where the trials start (marks). That tagging is what lets the frontend put a
capture on the 3D arm and overlay it on the matching DB3 channel + gesture.

Two on-disk shapes, both under ../sensor-lab/captures/:
  <id>/recorded.csv + <id>/meta.json   recorded by bench mode (live.py)
  <id>.csv (+ <id>.csv.meta.json)      older hand-made flat captures; the
                                       sidecar only appears once you tag one

House law (../sensor-lab/README.md): the firmware computes, this file only
splits integers and reads/writes metadata. No signal math here.

Firmware can describe its own stream with comment lines (see parse_comment):
  # lanes: env,floor,flex      names for the comma-separated fields
  # floor=185                  any key=number pairs -> meta["fw"]
"""

import json
import os
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent.parent
CAPTURES = ROOT.parent / "sensor-lab" / "captures"  # user-approved capture home

DEFAULT_RATE = 10  # Hz - sensor-lab P2P envelope windows, when nothing says otherwise

# field-count -> lane names, used only when the stream carries no "# lanes:" line
LANE_NAMES = {
    1: ["env"],
    3: ["env", "floor", "flex"],
    4: ["raw", "corr", "env", "flex"],
}

ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")
_LANES_RE = re.compile(r"lanes\s*[:=]\s*(.+)$", re.I)
_KV_RE = re.compile(r"([A-Za-z_]\w*)\s*=\s*(-?\d+(?:\.\d+)?)")


def lane_names(width: int) -> list[str]:
    return LANE_NAMES.get(width, [f"f{i + 1}" for i in range(width)])


def parse_line(line: str):
    """-> list[int] | None (skip: blank/comment) | False (malformed)."""
    line = line.strip()
    if not line or line.startswith("#"):
        return None
    parts = line.replace(";", ",").split(",")
    try:
        return [int(float(p)) for p in parts]
    except ValueError:
        return False


def parse_comment(line: str) -> dict:
    """'# lanes: a,b' -> {"lanes": [...]};  '# floor=185' -> {"kv": {...}};  else {}."""
    s = line.strip()
    if not s.startswith("#"):
        return {}
    body = s.lstrip("#").strip()
    m = _LANES_RE.match(body)
    if m:
        names = [re.sub(r"[^A-Za-z0-9_]", "", p)[:16] for p in m[1].split(",")]
        names = [n for n in names if n]
        return {"lanes": names} if names else {}
    kv = {k: float(v) for k, v in _KV_RE.findall(body)}
    return {"kv": kv} if kv else {}


# ---- reading ---------------------------------------------------------------
def resolve(cid: str) -> tuple[Path, Path]:
    """capture id -> (csv path, meta path); 404 when it isn't a capture."""
    if not ID_RE.match(cid):
        raise HTTPException(404, f"bad capture id {cid!r}")
    d = CAPTURES / cid
    if d.is_dir() and (d / "recorded.csv").is_file():
        return d / "recorded.csv", d / "meta.json"
    if cid.endswith(".csv") and d.is_file():
        return d, CAPTURES / f"{cid}.meta.json"
    raise HTTPException(404, f"no capture {cid!r} in {CAPTURES}")


_CSV_CACHE: dict = {}  # path -> (mtime_ns, size, parsed)


def read_csv(f: Path) -> dict:
    """Parse one capture file -> rows (list[list[int]]), bad count, header lanes, fw."""
    st = f.stat()
    hit = _CSV_CACHE.get(f)
    if hit and hit[0] == st.st_mtime_ns and hit[1] == st.st_size:
        return hit[2]
    rows, bad, lanes, fw = [], 0, None, {}
    for line in f.read_text(errors="replace").splitlines():
        v = parse_line(line)
        if v is None:
            c = parse_comment(line)
            lanes = c.get("lanes", lanes)
            fw.update(c.get("kv", {}))
        elif v is False or (rows and len(v) != len(rows[0])):
            bad += 1  # malformed, or a torn line with the wrong field count
        else:
            rows.append(v)
    width = len(rows[0]) if rows else 0
    if not lanes or len(lanes) != width:
        lanes = lane_names(width)
    out = {"rows": rows, "bad": bad, "lanes": lanes, "fw": fw}
    _CSV_CACHE[f] = (st.st_mtime_ns, st.st_size, out)
    return out


def _file_meta(meta_path: Path) -> dict:
    try:
        m = json.loads(meta_path.read_text())
        return m if isinstance(m, dict) else {}
    except (OSError, ValueError):
        return {}


def load(cid: str) -> dict:
    """Everything about one capture: meta (defaults filled in) + parsed rows."""
    csv_path, meta_path = resolve(cid)
    data = read_csv(csv_path)
    fm = _file_meta(meta_path)
    rate = fm.get("rate") or DEFAULT_RATE
    try:
        rate = float(rate)
    except (TypeError, ValueError):
        rate = DEFAULT_RATE
    if rate <= 0:
        rate = DEFAULT_RATE
    lines = len(data["rows"])
    meta = {
        "note": "",
        "marks": [],
        "gesture": None,
        "placement": None,
        "floor": None,
        "recorded_at": None,
        "source": None,
        **fm,
        "id": cid,
        "rate": rate,
        "lanes": data["lanes"],
        "lines": lines,
        "duration_s": round(lines / rate, 2),
        "fw": {**data["fw"], **(fm.get("fw") or {})},
    }
    return {"meta": meta, "rows": data["rows"], "bad": data["bad"]}


def list_ids() -> list[str]:
    if not CAPTURES.is_dir():
        return []
    ids = []
    for p in CAPTURES.iterdir():
        if p.name.startswith("."):  # .rec_* staging dirs, .gitkeep
            continue
        if (p.is_dir() and (p / "recorded.csv").is_file()) or (
            p.is_file() and p.suffix == ".csv"
        ):
            ids.append(p.name)
    return sorted(ids, reverse=True)  # date-prefixed names -> newest first


def list_all() -> list[dict]:
    out = []
    for cid in list_ids():
        try:
            out.append(load(cid)["meta"])
        except (HTTPException, OSError):
            continue
    return out


def write_meta(meta_path: Path, meta: dict):
    tmp = meta_path.with_name(meta_path.name + ".tmp")
    tmp.write_text(json.dumps(meta, indent=2) + "\n")
    os.replace(tmp, meta_path)


# ---- API -------------------------------------------------------------------
router = APIRouter(prefix="/api", tags=["captures"])


class Placement(BaseModel):
    az: float  # azimuth deg: 0 radial, 90 volar, 180 ulnar, 270 dorsal (markers.json)
    y: float  # 0 = elbow line, 1 = wrist
    label: str = ""


class CapturePatch(BaseModel):
    """Only the fields you send are changed; send null to clear one."""

    note: str | None = None
    gesture: int | None = None
    placement: Placement | None = None
    floor: float | None = None


@router.get("/captures")
def get_captures():
    """Every capture on disk with its tags (no sample data)."""
    return {"captures": list_all()}


@router.get("/captures/{cid}")
def get_capture(cid: str):
    """One capture: meta + samples, column-major (values[lane][i])."""
    c = load(cid)
    rows = c["rows"]
    width = len(c["meta"]["lanes"])
    return {
        "meta": c["meta"],
        "lanes": c["meta"]["lanes"],
        "rate": c["meta"]["rate"],
        "bad": c["bad"],
        "values": [[r[k] for r in rows] for k in range(width)],
    }


@router.patch("/captures/{cid}")
def patch_capture(cid: str, patch: CapturePatch):
    """Tag a capture after the fact: gesture / placement / floor / note."""
    _, meta_path = resolve(cid)
    fm = _file_meta(meta_path)
    for k in patch.model_fields_set:
        v = getattr(patch, k)
        fm[k] = v.model_dump() if isinstance(v, BaseModel) else v
    if fm.get("note") is None:
        fm["note"] = ""
    fm.setdefault("id", cid)
    write_meta(meta_path, fm)
    return {"meta": load(cid)["meta"]}
