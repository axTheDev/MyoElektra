/* capture.js - pure helpers for "my capture vs DB3" (no DOM, no three.js, so
 * `node web/capture.test.mjs` can exercise them).
 *
 * A capture (GET /api/captures/<id>) is {meta, lanes, rate, values[lane][i]}.
 * Nothing here filters or detects anything - the firmware already produced the
 * envelope. The only arithmetic is display scaling so two different sensors
 * can share one Y axis:
 *   "floor"  value / rest floor   (needs a floor: a `floor` lane, or meta.floor,
 *                                  or a "# floor=N" line the firmware printed)
 *   "peak"   value / own maximum  (always possible: compares SHAPE, not size)
 */

const ARM_R = 0.12; // rough forearm radius in forearm lengths: turns azimuth into arc length

/* DB3 electrode closest to a placement {az, y} (az wraps at 360) */
export function nearestChannel(channels, p) {
  let best = null, bd = Infinity;
  for (const c of channels) {
    let da = Math.abs(c.pos.az - p.az) % 360;
    if (da > 180) da = 360 - da;
    const arc = (da * Math.PI / 180) * ARM_R, dy = c.pos.y - p.y;
    const d = Math.hypot(arc, dy);
    if (d < bd) { bd = d; best = c; }
  }
  return best && { ch: best.ch, label: best.label, dist: bd };
}

export function placementText(p, channels) {
  if (!p) return "no placement";
  const n = channels ? nearestChannel(channels, p) : null;
  return `az ${Math.round(p.az)}° · y ${(+p.y).toFixed(2)}` + (n ? ` · ≈ ch${n.ch} ${n.label}` : "");
}

/* which lane is the envelope: the one called "env", else the first */
export function envLane(cap) {
  const i = cap.lanes.indexOf("env");
  return i >= 0 ? i : 0;
}

/* rest floor of a capture: {lane: idx} | {value: n} | null */
export function floorOf(cap) {
  const i = cap.lanes.indexOf("floor");
  if (i >= 0 && i !== envLane(cap)) return { lane: i };
  const m = cap.meta || {};
  const v = m.floor ?? (m.fw || {}).floor;
  return v > 0 ? { value: +v } : null;
}

/* mark times in seconds from the first sample (row index is exact, t_s the fallback) */
export function markTimes(cap) {
  return ((cap.meta || {}).marks || [])
    .map((m) => (m.row != null ? m.row / cap.rate : m.t_s))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
}

/* split the envelope lane into trials at the marks: each trial runs from
 * `pre` s before its mark to the next mark (capped at maxLen s). No marks ->
 * the whole capture is one trial starting at x = 0. */
export function capTrials(cap, pre = 0.5, maxLen = 8) {
  const n = (cap.values[envLane(cap)] || []).length, rate = cap.rate;
  if (!n) return [];
  const marks = markTimes(cap);
  if (!marks.length) return [{ label: "all", t: 0, i0: 0, i1: n - 1 }];
  const out = [];
  marks.forEach((t, j) => {
    const end = Math.min(n / rate, marks[j + 1] ?? Infinity, t + maxLen);
    const i0 = Math.max(0, Math.round((t - pre) * rate));
    const i1 = Math.min(n - 1, Math.round(end * rate));
    if (i1 > i0) out.push({ label: `t${j + 1}`, t, i0, i1 });
  });
  return out;
}

const MINE = ["#ff7ab6", "#ffb86c", "#f1fa8c", "#ff5555", "#bd93f9", "#50fa7b"];
const DB3_COL = "rgba(136,192,208,0.5)";
const median = (a) => (a.length ? a.slice().sort((x, y) => x - y)[a.length >> 1] : 0);

/* Overlay my trials on the DB3 reps of the same gesture, both onset-aligned.
 * db = repSeries() from app.js ({series:[{ys (× floor), dx, x0}], x1, pre}) or null.
 * -> {series, x0, x1, mode (the one actually used), unit, note} for chart(). */
export function compareSeries(cap, db, mode = "floor") {
  const k = envLane(cap), ys = cap.values[k] || [];
  const fl = floorOf(cap);
  if (mode === "floor" && !fl) mode = "peak";
  const trials = capTrials(cap);

  const mine = trials.map((tr, j) => {
    const out = new Array(tr.i1 - tr.i0 + 1);
    for (let i = tr.i0; i <= tr.i1; i++) {
      const f = mode !== "floor" ? 1 : fl.lane != null ? cap.values[fl.lane][i] : fl.value;
      out[i - tr.i0] = ys[i] / Math.max(f, 1e-9);
    }
    return { ys: out, dx: 1 / cap.rate, x0: tr.i0 / cap.rate - tr.t, color: MINE[j % MINE.length], lw: 1.8 };
  });
  const theirs = (db ? db.series : []).map((s) => ({ ys: s.ys.slice(), dx: s.dx, x0: s.x0, color: DB3_COL, lw: 1 }));

  const peaks = (list) => list.map((s) => s.ys.reduce((a, v) => (v > a ? v : a), 0));
  let pm = peaks(mine), pd = peaks(theirs);
  if (mode === "peak") { // each SENSOR scaled by its own biggest trial -> 100
    for (const [list, pk] of [[mine, pm], [theirs, pd]]) {
      const top = Math.max(...pk, 1e-9);
      for (const s of list) s.ys = s.ys.map((v) => (v / top) * 100);
    }
    pm = peaks(mine); pd = peaks(theirs);
  }

  const ends = [...mine, ...theirs].map((s) => s.x0 + (s.ys.length - 1) * s.dx);
  const starts = [...mine, ...theirs].map((s) => s.x0);
  const unit = mode === "floor" ? "× floor" : "% of own peak";
  const f = (v) => (mode === "floor" ? v.toFixed(1) + "×" : v.toFixed(0) + "%");
  const bits = [];
  if (pm.length) bits.push(`mine: ${pm.length} trial${pm.length > 1 ? "s" : ""}, median peak ${f(median(pm))}`);
  else bits.push("mine: no samples");
  if (pd.length) bits.push(`DB3: ${pd.length} reps, median peak ${f(median(pd))}`);
  else bits.push("DB3: no reps of this gesture in this dataset");
  return {
    series: [...theirs, ...mine], // mine drawn last = on top
    x0: starts.length ? Math.min(...starts, 0) : 0,
    x1: ends.length ? Math.max(...ends, 1) : 1,
    mode, unit, note: bits.join(" · "),
  };
}
