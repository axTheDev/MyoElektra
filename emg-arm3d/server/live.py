"""live.py - bench stream hub: Teensy serial or a capture replay, pushed to the
browser over a WebSocket, and recorded into the capture store (captures.py).

House law inherited from ../sensor-lab/README.md: the firmware computes, this
hub ferries, the browser draws. Lines here are only parsed to split integer
fields - no signal math ever happens in this file.

Sources are one-at-a-time:
  replay:<capture id>   stream a stored capture at its recorded rate (loop optional)
  serial                the Teensy on /dev/ttyACM* (override: MYOARM_PORT=/dev/...)

Firmware -> hub conventions (all optional, see captures.parse_comment):
  # lanes: env,floor,flex   names the fields; without it lanes are guessed by count
  # floor=185               key=number pairs land in status["fw"] and in meta.json
  The hub sends "?\\n" once when it opens the port, so a sketch that answers
  `?` with those comment lines gets named lanes even when it booted long ago.

The hub thread appends (seq, wall-clock t, [ints]) rows to a ring buffer; each
WebSocket client polls that buffer incrementally every 50 ms, so slow clients
just get a bigger next chunk instead of backpressure on the source.
"""

import asyncio
import os
import re
import threading
import time
from collections import deque
from pathlib import Path

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

import captures
from captures import CAPTURES, Placement, lane_names, parse_comment, parse_line

try:
    import serial  # pyserial==3.5 (same pin as ../sensor-lab)
except ImportError:
    serial = None


def find_port() -> Path:
    """MYOARM_PORT if set, else the first /dev/ttyACM* (the Teensy re-enumerates
    as ACM1 after some replugs), else the usual name so messages stay readable."""
    env = os.environ.get("MYOARM_PORT")
    if env:
        return Path(env)
    ports = sorted(Path("/dev").glob("ttyACM*"))
    return ports[0] if ports else Path("/dev/ttyACM0")


def port_holders(port: Path):
    """PIDs:comm of OTHER processes holding the serial device open.

    POSIX lets two readers share a tty (they silently split the stream -
    the "halfstream" casualty in sensor-lab/captures). ttyACM has no
    mandatory lock, so we check /proc/*/fd before taking it.
    """
    targets = {str(port)}
    try:
        targets.add(str(port.resolve()))
    except OSError:
        pass
    out = []
    me = os.getpid()
    for p in Path("/proc").iterdir():
        if not p.name.isdigit() or int(p.name) == me:
            continue
        try:
            for fd in (p / "fd").iterdir():
                try:
                    tgt = os.readlink(fd)
                except OSError:
                    continue
                if tgt in targets:
                    try:
                        comm = (p / "comm").read_text().strip()
                    except OSError:
                        comm = "?"
                    out.append(f"pid {p.name} ({comm})")
                    break
        except OSError:  # process vanished / no permission
            continue
    return out


class Hub:
    def __init__(self):
        self.lock = threading.Lock()
        self.stop_evt = threading.Event()
        self.thread = None
        self.seq = 0
        self.rows = deque(maxlen=240_000)
        self.status = {
            "state": "idle",
            "source": None,
            "rate": 0,
            "lanes": [],
            "lines": 0,
            "bad": 0,
            "started": 0.0,
            "error": None,
            "fw": {},
            "recording": False,
            "rec_name": None,
            "rec_lines": 0,
        }
        self.rec = None  # active recording (see start_rec), guarded by self.lock

    def snapshot(self) -> dict:
        with self.lock:
            return {**self.status, "fw": dict(self.status["fw"])}

    # -- control ---------------------------------------------------------------
    def _begin(self, source, rate, lanes, bad, fw):
        self.rows.clear()
        self.seq = 0
        self.stop_evt.clear()
        with self.lock:
            self.status.update(
                state="running",
                source=source,
                rate=rate,
                lanes=lanes,
                lines=0,
                bad=bad,
                started=time.time(),
                error=None,
                fw=dict(fw),
            )

    def start(self, source: str, loop: bool):
        with self.lock:
            if self.status["state"] == "running":
                raise HTTPException(409, "a source is already running - stop it first")
        if source == "serial":
            self._start_serial()
            return
        if not source.startswith("replay:"):
            raise HTTPException(400, "source must be replay:<capture id> or serial")
        cap = captures.load(source.split(":", 1)[1])
        if not cap["rows"]:
            raise HTTPException(422, f"{source}: no integer data lines found")
        meta = cap["meta"]
        self._begin(source, meta["rate"], meta["lanes"], cap["bad"], meta["fw"])
        self.thread = threading.Thread(
            target=self._run_replay, args=(cap["rows"], meta["rate"], loop), daemon=True
        )
        self.thread.start()

    def _start_serial(self):
        port = find_port()
        if serial is None:
            raise HTTPException(501, "pyserial is not installed in this venv")
        if not port.exists():
            raise HTTPException(404, f"nothing on {port}")
        holders = port_holders(port)
        if holders:
            raise HTTPException(
                503,
                f"{port} already opened by {', '.join(holders)} — "
                f"two readers split the stream; stop that one first",
            )
        try:  # CDC-ACM: baud is nominal; failure here usually means a second reader
            ser = serial.Serial(str(port), baudrate=115200, timeout=1)
        except serial.SerialException as exc:
            raise HTTPException(
                503, f"cannot open {port}: {exc} — another reader? (fuser {port})"
            )
        self._begin("serial", 0, [], 0, {})
        self.thread = threading.Thread(
            target=self._run_serial, args=(ser,), daemon=True
        )
        self.thread.start()

    def _run_serial(self, ser):
        stamps = deque(maxlen=150)  # recent arrival times -> measured line rate
        n = 0
        try:
            try:
                ser.write(b"?\n")  # ask the sketch to (re)describe itself
            except Exception:
                pass
            while not self.stop_evt.is_set():
                line = ser.readline()
                if not line:
                    continue  # 1 s timeout tick
                text = line.decode(errors="replace").strip()
                v = parse_line(text)
                if v is None:
                    self._comment(text)
                    continue
                if v is False:
                    with self.lock:
                        self.status["bad"] += 1
                    continue
                self._emit(v, text)
                n += 1
                stamps.append(time.monotonic())
                if len(stamps) == 12 or (n % 100 == 0 and len(stamps) > 2):
                    self._set(
                        rate=max(1, round((len(stamps) - 1) / (stamps[-1] - stamps[0])))
                    )
        except Exception as exc:  # USB unplug lands here
            self._set(state="error", error=f"serial: {exc}")
        finally:
            try:
                ser.close()
            except Exception:
                pass
            if self.snapshot()["state"] == "running":
                self._set(state="stopped")

    def _comment(self, text: str):
        """Firmware self-description: lane names and key=number facts."""
        c = parse_comment(text)
        if not c:
            return
        with self.lock:
            if "lanes" in c:
                self.status["lanes"] = c["lanes"]
            if "kv" in c:
                self.status["fw"].update(c["kv"])
            if self.rec is not None:  # keep the recording self-describing
                self.rec["fh"].write(text + "\n")

    def stop(self):
        self.stop_evt.set()

    def _set(self, **kw):
        with self.lock:
            self.status.update(kw)
            if self.rec is not None and self.status["state"] != "running":
                # source ended (done/stopped/error): save what we have rather than lose it
                try:
                    self._finalize_rec(self.rec["note"] + " (auto: source ended)")
                except Exception as exc:
                    self.status["error"] = f"record save failed: {exc}"

    # -- recording ---------------------------------------------------------------
    def start_rec(self, name: str, note: str, gesture=None, placement=None):
        with self.lock:
            if self.status["state"] != "running":
                raise HTTPException(409, "start a source before recording")
            if self.rec is not None:
                raise HTTPException(409, "already recording")
            slug = re.sub(r"[^A-Za-z0-9_-]+", "_", name)[:40].strip("_") or "capture"
            stage = CAPTURES / f".rec_{slug}"
            stage.mkdir(parents=True, exist_ok=True)
            fh = open(stage / "recorded.csv", "w", encoding="utf-8")
            if self.status["lanes"]:
                fh.write("# lanes: " + ",".join(self.status["lanes"]) + "\n")
            for k, v in self.status["fw"].items():
                fh.write(f"# {k}={v:g}\n")
            self.rec = {
                "slug": slug,
                "note": note,
                "gesture": gesture,
                "placement": placement,
                "t0": time.time(),
                "t_first": None,  # wall-clock of the first / last recorded row
                "t_last": None,
                "fh": fh,
                "marks": [],  # (wall-clock, row index, label)
                "stage": stage,
            }
            self.status.update(recording=True, rec_name=slug, rec_lines=0)

    def mark(self, label: str):
        with self.lock:
            if self.rec is None:
                raise HTTPException(409, "not recording")
            self.rec["marks"].append((time.time(), self.status["rec_lines"], label))

    def stop_rec(self, note: str):
        with self.lock:
            if self.rec is None:
                raise HTTPException(409, "not recording")
            return self._finalize_rec(note or self.rec["note"])

    def _finalize_rec(self, note=""):
        """Close the staging file, name the capture folder, write meta + README
        stub. Caller must hold self.lock (see sensor-lab/captures/README.md for
        the naming convention this follows)."""
        rec, self.rec = self.rec, None
        if rec is None:
            return None
        try:
            rec["fh"].close()
        except OSError:
            pass
        lines = self.status["rec_lines"]
        dur = max(1, round(time.time() - rec["t0"]))
        # the rate the rows really arrived at (serial status rate is a rounded estimate)
        rate = self.status["rate"] or None
        if lines > 2 and rec["t_last"] > rec["t_first"]:
            rate = round((lines - 1) / (rec["t_last"] - rec["t_first"]), 3)
        base = rec["t_first"] or rec["t0"]
        date = time.strftime("%Y-%m-%d")
        final = CAPTURES / f"{date}_{rec['slug']}_{dur}s"
        i = 2
        while final.exists():
            final = CAPTURES / f"{date}_{rec['slug']}_{dur}s_{i}"
            i += 1
        rec["stage"].rename(final)
        meta = {
            "id": final.name,
            "recorded_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "source": self.status["source"],
            "rate": rate,
            "lanes": self.status["lanes"],
            "lines": lines,
            "duration_s": dur,
            "note": note,
            "gesture": rec["gesture"],  # DB3 stimulus id this capture performs
            "placement": rec["placement"],  # {az, y, label} on the 3D arm
            "floor": None,  # manual rest floor, if the stream carries none
            "fw": dict(self.status["fw"]),
            # trial onsets: row = index into recorded.csv data lines (exact),
            # t_s = seconds after the first recorded row (for humans)
            "marks": [
                {"t_s": round(max(0.0, t - base), 3), "row": row, "label": lab}
                for t, row, lab in rec["marks"]
            ],
            "recorded_by": "emg-arm3d bench mode",
            "format": "one comma-separated integer line per sample, verbatim stream",
        }
        captures.write_meta(final / "meta.json", meta)
        with open(CAPTURES / "README.md", "a", encoding="utf-8") as rf:
            rf.write(
                f"\n## {final.name}\n\nBench record: {meta['source']}, "
                f"{meta['rate'] or '?'} Hz, lanes {meta['lanes']}, {meta['lines']} lines, "
                f"{dur} s. Note: {note or '(none)'}. Marks: {len(meta['marks'])}.\n"
                "TODO: replace this stub with the real story (skin prep, posture, oddities).\n"
            )
        self.status.update(recording=False, rec_lines=0)
        return meta

    # -- the pump ----------------------------------------------------------------
    def _emit(self, vals: list[int], text=None):
        t = time.time()
        with self.lock:
            if len(vals) != len(self.status["lanes"]):  # first row, or format change
                self.status["lanes"] = lane_names(len(vals))
            self.seq += 1
            self.rows.append((self.seq, t, vals))
            self.status["lines"] += 1
            rec = self.rec
            if rec is not None:
                rec["fh"].write((text or ",".join(map(str, vals))) + "\n")
                self.status["rec_lines"] += 1
                if rec["t_first"] is None:
                    rec["t_first"] = t
                rec["t_last"] = t

    def _run_replay(self, rows, rate, loop):
        dt = 1.0 / rate
        i = 0
        t0 = time.monotonic()
        try:
            while not self.stop_evt.is_set():
                if i >= len(rows):
                    if not loop:
                        self._set(state="done")
                        return
                    i, t0 = 0, time.monotonic()
                self._emit(rows[i])
                i += 1
                left = t0 + i * dt - time.monotonic()
                if left > 0:
                    self.stop_evt.wait(left)
            self._set(state="stopped")
        except Exception as exc:  # never leave the UI stuck on "running"
            self._set(state="error", error=str(exc))

    # -- feed --------------------------------------------------------------------
    def new_rows(self, after: int):
        """(gap, [(seq, t, *vals), ...], status-copy) for rows with seq > after."""
        with self.lock:
            st = {**self.status, "fw": dict(self.status["fw"])}
            if not self.rows:
                return 0, [], st
            gap = max(0, self.rows[0][0] - after - 1) if after >= 0 else 0
            out = [(s, t, *v) for (s, t, v) in self.rows if s > after]
            return gap, out, st


hub = Hub()
router = APIRouter(prefix="/api", tags=["live"])
ws_router = APIRouter()


class StartReq(BaseModel):
    source: str
    loop: bool = True


@router.get("/live/sources")
def live_sources():
    """What the bench can stream: stored captures + serial port presence."""
    port = find_port()
    return {
        "replays": [
            {
                "name": m["id"],
                "lines": m["lines"],
                "rate": m["rate"],
                "seconds": m["duration_s"],
            }
            for m in captures.list_all()
            if m["lines"]
        ],
        "serial": {
            "port": str(port),
            "present": port.exists(),
            "ready": serial is not None and port.exists(),
        },
    }


@router.post("/live/start")
def live_start(req: StartReq):
    hub.start(req.source, req.loop)
    return hub.snapshot()


@router.post("/live/stop")
def live_stop():
    hub.stop()
    return hub.snapshot()


@router.get("/live/status")
def live_status():
    return hub.snapshot()


class RecReq(BaseModel):
    action: str  # "start" | "stop"
    name: str = "capture"
    note: str = ""
    gesture: int | None = None  # DB3 stimulus id being performed
    placement: Placement | None = None  # where the sensor sits on the 3D arm


@router.post("/live/record")
def live_record(req: RecReq):
    """⏺ record the stream verbatim into sensor-lab/captures/, meta and all."""
    if req.action == "start":
        hub.start_rec(
            req.name,
            req.note,
            req.gesture,
            req.placement.model_dump() if req.placement else None,
        )
        return hub.snapshot()
    if req.action == "stop":
        meta = hub.stop_rec(req.note)
        return {"state": "recorded", "saved": meta["id"], "meta": meta}
    raise HTTPException(400, "action must be start|stop")


class MarkReq(BaseModel):
    label: str = "trial"


@router.post("/live/mark")
def live_mark(req: MarkReq):
    """Trial mark during recording (spacebar in the browser) -> meta.json."""
    hub.mark(req.label)
    return {"ok": True}


@ws_router.websocket("/ws/live")
async def ws_live(ws: WebSocket):
    await ws.accept()
    last = -1
    try:
        while True:
            gap, rows, st = await asyncio.to_thread(hub.new_rows, last)
            if rows:
                last = rows[-1][0]
            await ws.send_json({"gap": gap, "rows": rows, "status": st})
            await asyncio.sleep(0.05)
    except (WebSocketDisconnect, RuntimeError):
        pass  # RuntimeError: client vanished mid-send
