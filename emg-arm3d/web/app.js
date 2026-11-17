/* MyoArm3D frontend: 3D arm + clickable DB3 electrode spots + my own capture
 * pins + hand-rolled charts. Data comes from the FastAPI server (../server/):
 *   DB3 public data  -> 3D view (gestures, channels, envelopes, trials)
 *   my sensor        -> bench mode records a capture tagged with gesture + pin
 *   both             -> compare card: my trials over the DB3 reps (capture.js)
 * three.js is vendored (./vendor/VENDOR.md); no other JS dependencies. */
import * as THREE from './vendor/three-0.187.0/three.module.js';
import { GLTFLoader } from "./vendor/three-0.187.0/GLTFLoader.js";
import { nearestChannel, placementText, envLane, floorOf, markTimes, compareSeries } from "./capture.js";

const $ = (id) => document.getElementById(id);
const statusEl = $("status");
const deg = THREE.MathUtils.degToRad;

const DATASET = new URLSearchParams(location.search).get("d"); // ?d=S1_E2 (else server default)
async function api(p) {
  const q = DATASET ? (p.includes("?") ? "&" : "?") + "d=" + encodeURIComponent(DATASET) : "";
  const r = await fetch("/api" + p + q);
  if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
  return r.json();
}

// ---------------------------------------------------------------- state ----
const state = {
  markers: null,               // markers.json (channels + muscle map)
  session: null,               // /api/gestures payload
  envs: new Map(),             // ch -> {values, rate}
  envRef: new Map(),           // ch -> 98th percentile (glow normalization)
  bands: [],                   // gesture bands for the session chart
  sel: { ch: 9, gesture: 6, rep: 1 },
  seg: null,                   // last loaded segment payload
  play: null,                  // {a, b, t, seg} while playing
  glow: new Float64Array(13),  // 0..1 per channel (index 1..12)
  caps: [],                    // my captures (meta only) from /api/captures
  cap: null,                   // the selected capture, samples included
  pin: null,                   // where MY sensor sits right now: {az, y}
  placing: false,              // next click on the arm sets state.pin
  cmpMode: "floor",            // compare scaling: "floor" | "peak" (capture.js)
};

// --------------------------------------------------------------- charts ----
const C = {
  dim: "#7b8496", grid: "#2e3440", cur: "#88c0d0",
  band1: "rgba(134,153,200,0.07)", band2: "rgba(134,153,200,0.14)",
};

function fitCanvas(cv) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth || 1, h = cv.clientHeight || 1;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return [ctx, w, h];
}

/* chart(cv, {x0,x1, series:[{ys, dx+x0 | xs, color, lw}], bands, vlines, cursor, fmtY})
 * a series is evenly spaced (x0 + i*dx) unless it brings its own xs[] */
function chart(cv, opt) {
  const [ctx, W, H] = fitCanvas(cv);
  ctx.clearRect(0, 0, W, H);
  const PL = 34, PR = 6, PT = 4, PB = 12;
  const iw = W - PL - PR, ih = H - PT - PB;
  const x0 = opt.x0 ?? 0, x1 = opt.x1 ?? 1;
  let lo = Infinity, hi = -Infinity;
  for (const s of opt.series)
    for (const y of s.ys) {
      if (!isFinite(y)) continue;
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
  if (!isFinite(lo)) { lo = 0; hi = 1; }
  if (hi === lo) hi = lo + 1;
  if (opt.yMin != null || opt.yMax != null) { // explicit scale (cross-card compare)
    if (opt.yMin != null) lo = opt.yMin;
    if (opt.yMax != null) hi = Math.max(opt.yMax, lo + 1e-6);
  } else {
    const padY = (hi - lo) * 0.08;
    hi += padY;
    lo = Math.min(lo - padY, lo < 0 ? lo - padY : 0);
  }
  const X = (x) => PL + ((x - x0) / (x1 - x0)) * iw;
  const Y = (y) => PT + ih - ((y - lo) / (hi - lo)) * ih;

  ctx.font = "9px ui-monospace, monospace";
  ctx.lineWidth = 1;
  for (let g = 0; g <= 2; g++) {
    const v = lo + ((hi - lo) * g) / 2, y = Math.round(Y(v)) + 0.5;
    ctx.strokeStyle = C.grid;
    ctx.beginPath(); ctx.moveTo(PL, y); ctx.lineTo(W - PR, y); ctx.stroke();
    ctx.fillStyle = C.dim; ctx.textAlign = "right";
    ctx.fillText(opt.fmtY ? opt.fmtY(v) : v.toFixed(1), PL - 4, y + 3);
  }
  ctx.fillStyle = C.dim; ctx.textAlign = "center";
  for (let g = 0; g <= 4; g++) {
    const v = x0 + ((x1 - x0) * g) / 4;
    ctx.fillText(v.toFixed(v >= 100 ? 0 : 1), X(v), H - 2);
  }

  ctx.save(); // clip plot area so zoomed/panned series don't spill over labels
  ctx.beginPath(); ctx.rect(PL, PT, iw, ih); ctx.clip();
  (opt.bands || []).forEach((b, i) => {
    ctx.fillStyle = i % 2 ? C.band2 : C.band1;
    ctx.fillRect(X(b.a), PT, Math.max(X(b.b) - X(b.a), 1), ih);
  });

  for (const s of opt.series) {
    if (!s.ys.length) continue;
    ctx.strokeStyle = s.color || "#9aa";
    ctx.lineWidth = s.lw || 1;
    ctx.beginPath();
    for (let i = 0; i < s.ys.length; i++) {
      const px = X(s.xs ? s.xs[i] : (s.x0 ?? 0) + i * s.dx), py = Y(s.ys[i]);
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.stroke();
  }

  for (const v of opt.vlines || []) {
    ctx.strokeStyle = v.color || "#606a80";
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(X(v.x), PT); ctx.lineTo(X(v.x), PT + ih); ctx.stroke();
    ctx.setLineDash([]);
  }
  if (opt.cursor != null && opt.cursor >= x0 && opt.cursor <= x1) {
    ctx.strokeStyle = C.cur; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(X(opt.cursor), PT); ctx.lineTo(X(opt.cursor), PT + ih); ctx.stroke();
  }
  ctx.restore();
}

// ------------------------------------------------------- gesture poses -----
// stylized only: curl 0..1 per finger [thumb, index, middle, ring, little],
// spread -1..1, opp = thumb opposition, wrist/spin in degrees.
const REST = { curl: [0.06, 0.06, 0.06, 0.06, 0.06], spread: 0.15, opp: 0, wristX: 0, wristZ: 0, spin: 0 };
const POSES = {
  1: { curl: [0, 1, 1, 1, 1] },
  2: { curl: [1, 0, 0, 1, 1] },
  3: { curl: [0, 0, 0, 1, 1] },
  4: { curl: [0, 0, 0, 0, 0], opp: 1 },
  5: { curl: [0, 0, 0, 0, 0], spread: 1 },
  6: { curl: [1, 1, 1, 1, 1] },
  7: { curl: [0.8, 0, 1, 1, 1] },
  8: { curl: [0, 0, 0, 0, 0], spread: -0.9 },
  9: { spin: 60 }, 10: { spin: -60 }, 11: { spin: 60 }, 12: { spin: -60 },
  13: { wristX: -35 }, 14: { wristX: 35 },
  15: { wristZ: -20 }, 16: { wristZ: 20 },
  17: { curl: [1, 1, 1, 1, 1], wristX: 30 },
};
const copyPose = (p) => ({ ...p, curl: p.curl.slice() });
function poseFor(id) {
  const p = POSES[id] || {};
  return {
    curl: p.curl ?? REST.curl.slice(), spread: p.spread ?? REST.spread,
    opp: p.opp ?? REST.opp, wristX: p.wristX ?? 0, wristZ: p.wristZ ?? 0,
    spin: p.spin ?? 0,
  };
}
function poseLerp(cur, tgt, k) {
  for (const f of ["spread", "opp", "wristX", "wristZ", "spin"]) cur[f] += (tgt[f] - cur[f]) * k;
  for (let i = 0; i < 5; i++) cur.curl[i] += (tgt.curl[i] - cur.curl[i]) * k;
}

// ------------------------------------------------------------ 3D scene -----
const canvas = $("arm-canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio || 1);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 30);
const camS = { theta: 0.72, phi: 1.18, r: 2.3, tx: 0, ty: 0.5, tz: 0 };
{ // debug camera: ?cam=r,theta,phi,ty (handy for screenshots/aligning)
  const cp = new URLSearchParams(location.search).get("cam");
  if (cp) {
    const [r, th, ph, ty2] = cp.split(",").map(Number);
    if ([r, th, ph, ty2].every((v) => isFinite(v)))
      Object.assign(camS, { r, theta: th, phi: ph, ty: ty2 });
  }
}

scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2433, 1.15));
const dir = new THREE.DirectionalLight(0xffffff, 1.7);
dir.position.set(1.4, 2.2, 1.6);
scene.add(dir);

// normalized arm profile [y, radius] (units: forearm lengths)
const PROFILE = [
  [-0.40, 0.001], [-0.39, 0.128], [-0.20, 0.160], [0, 0.148],
  [0.25, 0.125], [0.50, 0.103], [0.75, 0.083], [1.00, 0.062], [1.03, 0.001],
];
function radiusAt(y) {
  if (y <= PROFILE[0][0] || y >= PROFILE.at(-1)[0]) return 0.001;
  for (let i = 1; i < PROFILE.length; i++)
    if (y <= PROFILE[i][0]) {
      const [y0, r0] = PROFILE[i - 1], [y1, r1] = PROFILE[i];
      const t = (y - y0) / (y1 - y0);
      return r0 + (r1 - r0) * t;
    }
  return 0.001;
}
function lathe(ya, yb) {
  const pts = [];
  const n = 24;
  const capA = radiusAt(ya) < 0.01, capB = radiusAt(yb) < 0.01;
  if (!capA) pts.push(new THREE.Vector2(0.001, ya - 0.01));
  for (let i = 0; i <= n; i++) {
    const y = ya + ((yb - ya) * i) / n;
    pts.push(new THREE.Vector2(Math.max(radiusAt(y), 0.001), y));
  }
  if (!capB) pts.push(new THREE.Vector2(0.001, yb + 0.01));
  return new THREE.LatheGeometry(pts, 48);
}

const skin = new THREE.MeshStandardMaterial({
  color: 0x93a7c4, transparent: true, opacity: 0.30,
  roughness: 0.85, depthWrite: false, side: THREE.DoubleSide,
});
const skinSolid = new THREE.MeshStandardMaterial({
  color: 0x9fb2cd, roughness: 0.75,
});

const groupUpper = new THREE.Group();   // upper arm + biceps/triceps (no spin)
const groupFore = new THREE.Group();    // forearm + FDS/EDS + hand (spins)
scene.add(groupUpper, groupFore);

const latheUpper = new THREE.Mesh(lathe(-0.40, 0.05), skin);
const latheFore = new THREE.Mesh(lathe(0.0, 1.03), skin);
groupUpper.add(latheUpper);
groupFore.add(latheFore);

function capsuleMesh(c, color) {
  const a = new THREE.Vector3(...c.from), b = new THREE.Vector3(...c.to);
  const len = b.distanceTo(a);
  const geo = new THREE.CapsuleGeometry(c.r, Math.max(len - 2 * c.r, 0.001), 6, 16);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.10, depthWrite: false })
  );
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()
  );
  return mesh;
}

// markers (clickable spheres + number label), muscle capsules inside the arm
const markerMeshes = [];
const markerByCh = new Map();
const capsuleByCh = new Map();
const capsuleDefs = new Map();   // ch -> raw capsule {from,to,r} for curve refit

/* (azimuth deg, height) -> point just outside the procedural lathe arm */
function latheSpot(az, y) {
  const a = deg(az), r = radiusAt(y) + 0.013;
  return new THREE.Vector3(r * Math.cos(a), y, -r * Math.sin(a));
}
const markerPos = (m) => latheSpot(m.pos.az, m.pos.y);
function labelSprite(txt) {
  const cv = document.createElement("canvas");
  cv.width = 96; cv.height = 48;
  const c = cv.getContext("2d");
  c.font = "34px ui-monospace, monospace";
  c.fillStyle = "#c8d3e8";
  c.textAlign = "center"; c.textBaseline = "middle";
  c.fillText(txt, 48, 26);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false,
  }));
  sp.scale.set(0.062, 0.031, 1);
  sp.position.set(0, 0.035, 0);
  return sp;
}

function buildMarkers() {
  for (const m of state.markers.channels) {
    const mus = m.muscle ? state.markers.muscles[m.muscle] : null;
    const color = mus ? mus.color : "#c8d3e8";
    const glowColor = mus ? mus.color : "#ffd166";
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.016, 20, 16),
      new THREE.MeshStandardMaterial({
        color, emissive: glowColor, emissiveIntensity: 0.12, roughness: 0.4,
      })
    );
    mesh.position.copy(markerPos(m));
    mesh.userData = { ch: m.ch };
    mesh.add(labelSprite(String(m.ch)));
    (m.ch >= 11 ? groupUpper : groupFore).add(mesh);
    markerMeshes.push(mesh);
    markerByCh.set(m.ch, mesh);
  }
  // muscle capsules: named channels' muscles
  const chMuscle = Object.fromEntries(
    state.markers.channels.filter((c) => c.muscle).map((c) => [c.muscle, c.ch])
  );
  for (const [mus, def] of Object.entries(state.markers.muscles)) {
    const mesh = capsuleMesh(def.capsule, def.color);
    const isUpper = mus === "BIC" || mus === "TRI";
    (isUpper ? groupUpper : groupFore).add(mesh);
    capsuleByCh.set(chMuscle[mus], mesh);
    capsuleDefs.set(chMuscle[mus], def.capsule);
  }
}

// hand: palm + 4 fingers + thumb, all hinged groups, child of the forearm
const handPivot = new THREE.Group();
handPivot.position.set(0, 1.0, 0);
groupFore.add(handPivot);
handPivot.add(new THREE.Mesh(new THREE.BoxGeometry(0.165, 0.17, 0.062), skinSolid)
  .translateY(0.075));

const fingers = [];
let thumb;
{
  const FING = [
    { x: 0.052, l1: 0.055, l2: 0.045, sp: 1 },    // index
    { x: 0.017, l1: 0.062, l2: 0.050, sp: 0.35 }, // middle
    { x: -0.018, l1: 0.058, l2: 0.047, sp: -0.35 },
    { x: -0.053, l1: 0.045, l2: 0.036, sp: -1 },
  ];
  const seg = (r, l) => new THREE.Mesh(new THREE.CapsuleGeometry(r, l, 4, 10), skinSolid);
  for (const f of FING) {
    const root = new THREE.Group();
    root.position.set(f.x, 0.155, 0);
    const s1 = seg(0.012, f.l1); s1.position.y = f.l1 / 2; root.add(s1);
    const pip = new THREE.Group(); pip.position.y = f.l1; root.add(pip);
    const s2 = seg(0.010, f.l2); s2.position.y = f.l2 / 2; pip.add(s2);
    handPivot.add(root);
    fingers.push({ root, pip, sp: f.sp });
  }
  // thumb: base yaw = opposition, pip = curl
  const base = new THREE.Group();
  base.position.set(0.068, 0.03, -0.01);
  base.rotation.z = -0.85;
  const t1 = seg(0.013, 0.048); t1.position.y = 0.024; base.add(t1);
  const tpip = new THREE.Group(); tpip.position.y = 0.048; base.add(tpip);
  const t2 = seg(0.011, 0.034); t2.position.y = 0.017; tpip.add(t2);
  handPivot.add(base);
  thumb = { base, tpip };
}

function applyPose(p) {
  for (let i = 0; i < 4; i++) {
    const f = fingers[i], c = p.curl[i + 1];
    f.root.rotation.x = -c * 1.15;
    f.root.rotation.z = -f.sp * (0.05 + p.spread * 0.24);
    f.pip.rotation.x = -c * 0.95;
  }
  thumb.base.rotation.y = p.opp * 1.05;
  thumb.tpip.rotation.x = -p.curl[0] * 0.85;
  handPivot.rotation.x = deg(p.wristX);
  handPivot.rotation.z = deg(p.wristZ);
  groupFore.rotation.y = deg(p.spin);
}

let poseCur = copyPose(REST);
let poseTarget = copyPose(REST);

// ------------------------------------------- anatomical mesh (models/, /api/model3d) ---
const modelGroup = new THREE.Group();
groupFore.add(modelGroup);          // spins with the forearm like real skin
let cfgModel = { enabled: false };
let modelRaw = null;                // { geo, mat, fit:{s,cx,cy,cz,midY} }
let modelParts = null;              // { back, front, collider }

function modelMatrix() {
  const r = cfgModel.rig;
  const c = new THREE.Vector3(0, modelRaw.fit.midY, 0);    // rotation pivot
  const sa = new THREE.Vector3(0, cfgModel.pivotY ?? 0, 0); // scale anchor (the elbow)
  const q = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(deg(r.rx), deg(r.ry), deg(r.rz), "XYZ")
  );
  const s = r.extraScale;
  const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
  return T(r.tx, r.ty, r.tz)
    .multiply(T(c.x, c.y, c.z))
    .multiply(new THREE.Matrix4().makeRotationFromQuaternion(q))
    .multiply(T(-c.x, -c.y, -c.z))
    .multiply(T(sa.x, sa.y, sa.z))
    .multiply(new THREE.Matrix4().makeScale(s, s * (cfgModel.stretchY ?? 1), s))
    .multiply(T(-sa.x, -sa.y, -sa.z));
}

/* hard clip: drop triangles with ANY vertex outside [clipBelowY, yCut] - hides
 * the model's static hand so the procedural posing hand shows through
 * (all-vertex rule: a centroid rule leaves long straddling triangles that
 * stick out of the cut plane as spikes) */
function clipAboveY(geo, yCut) {
  if (!geo.index) return;
  const pos = geo.attributes.position;
  const idx = geo.index.array;
  const keep = [];
  const yLo = cfgModel.clipBelowY ?? -Infinity;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    const ya = pos.getY(a), yb = pos.getY(b), yc = pos.getY(c);
    const lo = Math.min(ya, yb, yc), hi = Math.max(ya, yb, yc);
    if (hi <= yCut && lo >= yLo) keep.push(a, b, c);
  }
  geo.setIndex(keep);
}

/* the anatomical arm is naturally curved: from the transformed mesh, derive
 * the cross-section centroid per Y band (smoothed) -> local axis drift
 * curveAt(y) so marker rays and the hand follow the bend, not the Y axis */
let modelCurve = null;

function buildCurve(geo) {
  const pos = geo.attributes.position;
  const B = 0.1, lo = -0.75, hi = 0.7, n = Math.ceil((hi - lo) / B);
  const sx = new Float64Array(n), sz = new Float64Array(n), cnt = new Float64Array(n);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const k = Math.floor((y - lo) / B);
    if (k < 0 || k >= n) continue;
    sx[k] += pos.getX(i); sz[k] += pos.getZ(i); cnt[k]++;
  }
  const ys = [], xs = [], zs = [];
  for (let k = 0; k < n; k++) {
    if (cnt[k] < 3) continue;
    let ax = sx[k], az = sz[k], c = cnt[k];       // avg with neighbour bins
    for (let j = k - 1; j <= k + 1; j += 2)
      if (j >= 0 && j < n && cnt[j] >= 3) { ax += sx[j]; az += sz[j]; c += cnt[j]; }
    ys.push(lo + B * (k + 0.5)); xs.push(ax / c); zs.push(az / c);
  }
  return ys.length >= 2 ? { ys, xs, zs } : null;
}

function curveAt(y) {
  if (!modelCurve) return { x: 0, z: 0 };
  const { ys, xs, zs } = modelCurve;
  if (y <= ys[0]) return { x: xs[0], z: zs[0] };
  if (y >= ys[ys.length - 1]) return { x: xs[xs.length - 1], z: zs[zs.length - 1] };
  let i = 0;
  while (ys[i + 1] < y) i++;
  const t = (y - ys[i]) / (ys[i + 1] - ys[i]);
  return { x: xs[i] + (xs[i + 1] - xs[i]) * t, z: zs[i] + (zs[i + 1] - zs[i]) * t };
}

/* where an (azimuth, height) spot sits on the visible arm, in `parent` local
 * coords: ray from the arm's curved local axis outward along the azimuth onto
 * the anatomical mesh; the lathe spot when there is no mesh or the ray misses */
function spotOnArm(parent, az, y) {
  const p = latheSpot(az, y);
  const col = modelParts && modelParts.collider;
  if (!col) return p;
  const a = deg(az), d = curveAt(y);
  const o = parent.localToWorld(new THREE.Vector3(d.x, y, d.z));
  const p1 = parent.localToWorld(new THREE.Vector3(d.x + Math.cos(a), y, d.z - Math.sin(a)));
  raycaster.set(o, p1.sub(o).normalize());
  const hit = raycaster.intersectObject(col, false)[0];
  if (hit) p.copy(parent.worldToLocal(hit.point.clone()));
  p.x += cfgModel.senX || 0;
  p.y += cfgModel.senY || 0;
  p.z += cfgModel.senZ || 0;
  return p;
}

/* re-seat every DB3 marker and every pin (always from az/y, never stacking offsets) */
function reprojectMarkers() {
  for (const m of state.markers.channels) {
    const mesh = markerByCh.get(m.ch);
    mesh.position.copy(spotOnArm(mesh.parent, m.pos.az, m.pos.y));
  }
  for (const mesh of pinMeshes)
    mesh.position.copy(spotOnArm(mesh.parent, mesh.userData.az, mesh.userData.y));
}

// ------------------------------------------ pins: my sensor + my captures ---
/* same {az, y} coordinates as markers.json, so a pin and a DB3 electrode are
 * directly comparable. white = where my sensor sits now, pink = a capture. */
const pinMeshes = [];
const PIN_GEO = new THREE.OctahedronGeometry(0.019);
const pinParent = (y) => (y < 0 ? groupUpper : groupFore);
const validSpot = (p) => p && Number.isFinite(p.az) && Number.isFinite(p.y);

function syncPins() {
  for (const m of pinMeshes) { m.parent.remove(m); m.material.dispose(); }
  pinMeshes.length = 0;
  const add = (p, color, userData) => {
    const mesh = new THREE.Mesh(PIN_GEO, new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 0.4, roughness: 0.3,
    }));
    mesh.userData = { ...userData, az: p.az, y: p.y };
    const parent = pinParent(p.y);
    parent.add(mesh);
    mesh.position.copy(spotOnArm(parent, p.az, p.y));
    pinMeshes.push(mesh);
  };
  for (const c of state.caps) if (validSpot(c.placement)) add(c.placement, "#ff7ab6", { capId: c.id });
  if (validSpot(state.pin)) add(state.pin, "#ffffff", { myPin: true });
}

/* muscle capsules ride the bend too: shift each from→to endpoint by the
 * drift at its own height, so biceps/triceps stay inside the curved arm */
function refitCapsules() {
  for (const [ch, mesh] of capsuleByCh) {
    const c = capsuleDefs.get(ch);
    if (!c) continue;
    const da = curveAt(c.from[1]), db = curveAt(c.to[1]);
    const a = new THREE.Vector3(c.from[0] + da.x, c.from[1], c.from[2] + da.z);
    const b = new THREE.Vector3(c.to[0] + db.x, c.to[1], c.to[2] + db.z);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()
    );
  }
}

/* seat the procedural hand on whatever the config currently says (live-editable
 * via ?rig=1); called from loadModel3d and every rebuildModel */
function syncHand() {
  const c = cfgModel;
  handPivot.position.set(c.handX ?? 0, c.handY ?? 1.0, c.handZ ?? 0);
  handPivot.rotation.y = deg(c.handRotY ?? 0);
  handPivot.scale.setScalar(c.handScale ?? 1);
}

function rebuildModel() {
  if (!modelRaw || !modelParts) return;
  const f = modelRaw.fit;
  const geo = modelRaw.geo.clone();
  geo.translate(f.cx, f.cy, f.cz);
  geo.scale(f.s, f.s, f.s);
  geo.translate(0, f.midY, 0);
  geo.applyMatrix4(modelMatrix());
  modelCurve = buildCurve(geo);        // curved-axis map for marker rays
  clipAboveY(geo, cfgModel.clipAboveY);
  const old = modelParts.back.geometry;
  modelParts.back.geometry = geo;
  modelParts.front.geometry = geo;
  modelParts.collider.geometry = geo;
  old.dispose();
  modelParts.front.material.opacity = cfgModel.frontOpacity;
  reprojectMarkers();
  refitCapsules();
  syncHand();
}

async function loadModel3d() {
  let cfg;
  try { cfg = await api("/model3d"); } catch { cfg = { enabled: false }; }
  try { Object.assign(cfg, JSON.parse(localStorage.getItem("model3dRig") || "{}")); } catch { /* fresh */ }
  if (!cfg.enabled || !cfg.url) return;
  let gltf;
  try {
    gltf = await new Promise((res, rej) => new GLTFLoader().load(cfg.url, res, undefined, rej));
  } catch {
    statusEl.textContent = "model3d failed to load — staying procedural";
    return;
  }
  gltf.scene.updateMatrixWorld(true);
  let geo = null, mat = null;
  gltf.scene.traverse((o) => {
    if (o.isMesh && !geo) {
      geo = o.geometry.clone();
      geo.applyMatrix4(o.matrixWorld);   // bake node scale/offset (Sketchfab habit)
      mat = o.material;
    }
  });
  if (!geo) return;
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const [y0, y1] = cfg.fit.spanY;
  cfgModel = cfg;
  syncHand();
  modelRaw = {
    geo, mat,
    fit: {
      s: (y1 - y0) / Math.max(bb.max.y - bb.min.y, 1e-6),
      cx: -(bb.min.x + bb.max.x) / 2, cz: -(bb.min.z + bb.max.z) / 2,
      cy: -(bb.min.y + bb.max.y) / 2, midY: (y0 + y1) / 2,
    },
  };
  const backMat = mat.clone();
  backMat.side = THREE.BackSide; backMat.transparent = false; backMat.opacity = 1;
  const frontMat = mat.clone();
  frontMat.side = THREE.FrontSide; frontMat.transparent = true;
  frontMat.opacity = cfg.frontOpacity; frontMat.depthWrite = false;
  const back = new THREE.Mesh(new THREE.BufferGeometry(), backMat);
  const front = new THREE.Mesh(new THREE.BufferGeometry(), frontMat);
  front.renderOrder = 2;
  const collider = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })
  );
  collider.renderOrder = -1;
  modelGroup.add(back, front, collider);
  modelParts = { back, front, collider };
  if (!cfg.showProceduralArm) { latheUpper.visible = false; latheFore.visible = false; }
  rebuildModel();
}

/* ?rig=1 -> alignment sliders; live edits persist to localStorage, the
 * "copy config json" button gives the numbers to paste into config/model3d.json */
function rigUI() {
  if (!modelRaw || !location.search.includes("rig=1")) return;
  const c = cfgModel;
  const box = document.createElement("div");
  box.style.cssText = "position:absolute;right:10px;top:10px;width:252px;max-height:94vh;" +
    "overflow-y:auto;padding:10px;background:rgba(18,20,26,.93);border:1px solid #2e3440;" +
    "border-radius:8px;font-size:11px;z-index:5;color:#d8dee9";
  const title = document.createElement("div");
  title.textContent = "align — sliders live & auto-saved; copy json when done";
  title.style.cssText = "color:#88c0d0;margin-bottom:6px";
  box.appendChild(title);
  const exportCfg = () => JSON.stringify({
    rig: c.rig, handRotY: c.handRotY,
    handX: c.handX, handY: c.handY, handZ: c.handZ, handScale: c.handScale,
    senX: c.senX, senY: c.senY, senZ: c.senZ,
    clipAboveY: c.clipAboveY, clipBelowY: c.clipBelowY, frontOpacity: c.frontOpacity,
  }, null, 1);
  const persist = () => localStorage.setItem("model3dRig", exportCfg());
  let pending = false;
  const apply = () => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; rebuildModel(); }); };
  const section = (t) => {
    const h = document.createElement("div");
    h.textContent = t;
    h.style.cssText = "color:#ebcb8b;margin:8px 0 2px;text-transform:uppercase;letter-spacing:.08em";
    box.appendChild(h);
  };
  function addRow(label, min, max, step, val, set) {
    const row = document.createElement("label");
    row.style.cssText = "display:block;margin:2px 0";
    const sp = document.createElement("span");
    sp.textContent = label;
    sp.style.cssText = "display:inline-block;width:74px;color:#7b8496";
    const inp = document.createElement("input");
    inp.type = "range"; inp.min = min; inp.max = max; inp.step = step; inp.value = val;
    inp.style.width = "148px";
    inp.addEventListener("input", () => { set(+inp.value); apply(); });
    inp.addEventListener("change", persist);
    row.append(sp, inp);
    box.appendChild(row);
  }
  const specs = {
    rx: [-180, 180, 1], ry: [-180, 180, 1], rz: [-180, 180, 1],
    tx: [-0.4, 0.4, 0.002], ty: [-0.4, 0.4, 0.002], tz: [-0.4, 0.4, 0.002],
    extraScale: [0.2, 2.6, 0.005],
  };
  section("arm mesh");
  for (const [k, [mn, mx, st]] of Object.entries(specs))
    addRow(k, mn, mx, st, c.rig[k], (v) => { c.rig[k] = v; });
  section("procedural hand");
  addRow("handX", -0.3, 0.3, 0.002, c.handX ?? 0, (v) => { c.handX = v; });
  addRow("handY", -0.2, 1.6, 0.002, c.handY ?? 1.0, (v) => { c.handY = v; });
  addRow("handZ", -0.3, 0.3, 0.002, c.handZ ?? 0, (v) => { c.handZ = v; });
  addRow("handScale", 0.4, 3, 0.01, c.handScale ?? 1, (v) => { c.handScale = v; });
  section("sensors (all rings)");
  addRow("senX", -0.3, 0.3, 0.001, c.senX ?? 0, (v) => { c.senX = v; });
  addRow("senY", -0.5, 0.5, 0.001, c.senY ?? 0, (v) => { c.senY = v; });
  addRow("senZ", -0.3, 0.3, 0.001, c.senZ ?? 0, (v) => { c.senZ = v; });
  section("view");
  addRow("clipAboveY", -0.5, 1.6, 0.005, c.clipAboveY, (v) => { c.clipAboveY = v; });
  addRow("clipBelowY", -0.8, 0.4, 0.005, c.clipBelowY ?? -0.8, (v) => { c.clipBelowY = v; });
  addRow("frontOpacity", 0, 1, 0.01, c.frontOpacity, (v) => { c.frontOpacity = v; });
  const btn = document.createElement("button");
  btn.textContent = "copy config json";
  btn.style.cssText = "margin-top:8px;font:inherit;padding:3px 8px;cursor:pointer;width:100%";
  btn.onclick = () => {
    navigator.clipboard?.writeText(exportCfg());
    persist();
    btn.textContent = "copied ✓ — paste into config/model3d.json";
  };
  box.appendChild(btn);
  $("view3d").appendChild(box);
}

// --------------------------------------------- camera + picking controls ---
function updateCamera() {
  const { r, theta, phi, tx, ty, tz } = camS;
  camera.position.set(
    tx + r * Math.sin(phi) * Math.sin(theta),
    ty + r * Math.cos(phi),
    tz + r * Math.sin(phi) * Math.cos(theta)
  );
  camera.lookAt(tx, ty, tz);
}
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let drag = null, moved = 0;
canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  drag = [e.clientX, e.clientY];
  moved = 0;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const dx = e.clientX - drag[0], dy = e.clientY - drag[1];
  drag = [e.clientX, e.clientY];
  moved += Math.abs(dx) + Math.abs(dy);
  camS.theta -= dx * 0.008;
  camS.phi = THREE.MathUtils.clamp(camS.phi - dy * 0.008, 0.2, 2.94);
});
canvas.addEventListener("pointerup", (e) => {
  if (drag && moved < 4) pick(e);
  drag = null;
});
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  camS.r = THREE.MathUtils.clamp(camS.r * Math.exp(e.deltaY * 0.001), 0.6, 4.5);
}, { passive: false });

function pick(e) {
  const rect = canvas.getBoundingClientRect();
  ndc.set(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  );
  raycaster.setFromCamera(ndc, camera);
  if (state.placing) { placePin(); return; }
  const hit = raycaster.intersectObjects([...pinMeshes, ...markerMeshes], false)[0];
  if (!hit) return;
  const u = hit.object.userData;
  if (u.capId != null) selectCapture(u.capId);
  else if (u.ch != null) selectChannel(u.ch);
}

/* place-mode click: arm surface point -> {az, y} (the inverse of spotOnArm) */
function placePin() {
  scene.updateMatrixWorld(true);
  const targets = modelParts ? [modelParts.collider] : [latheUpper, latheFore];
  const hit = raycaster.intersectObjects(targets, false)[0];
  if (!hit) { statusEl.textContent = "that click missed the arm — try again"; return; }
  const y = groupFore.worldToLocal(hit.point.clone()).y;
  const l = pinParent(y).worldToLocal(hit.point.clone());
  const d = curveAt(l.y);
  const az = (Math.atan2(-(l.z - d.z), l.x - d.x) * 180 / Math.PI + 360) % 360;
  setPlacing(false);
  setPin({ az: Math.round(az * 10) / 10, y: Math.round(l.y * 1000) / 1000 });
}
function setPlacing(on) {
  state.placing = on;
  $("pin-place").classList.toggle("sel", on);
  $("pin-place").textContent = on ? "now click the arm…" : "📍 place on arm";
  canvas.style.cursor = on ? "crosshair" : "";
}
function setPin(p) {
  state.pin = p;
  try {
    if (p) localStorage.setItem("myPin", JSON.stringify(p));
    else localStorage.removeItem("myPin");
  } catch { /* private mode: pin just won't survive a reload */ }
  syncPins();
  updatePinInfo();
}
function updatePinInfo() {
  const t = validSpot(state.pin)
    ? placementText(state.pin, state.markers.channels)
    : "no pin yet — place it in the 3D view";
  $("pin-info").textContent = t;
  $("rec-pin").textContent = "📍 " + t;
}

// ------------------------------------------------------------ API views ----
function gestureById(id) {
  return state.session.gestures.find((g) => g.id === id);
}
function segmentFor(g, r) {
  return state.session.segments.find((s) => s.gesture === g && s.rep === r);
}
function envAt(ch, t) {
  const e = state.envs.get(ch);
  if (!e) return 0;
  const i = Math.min(Math.max(Math.round(t * e.rate), 0), e.values.length - 1);
  return e.values[i];
}

function chartEnv() {
  const e = state.envs.get(state.sel.ch);
  if (!e) return;
  $("env-title").textContent = `env: ch${e.ch} ${e.label}  (× rest floor)`;
  chart($("env-chart"), {
    x0: 0, x1: state.session.duration,
    series: [{ ys: e.values, dx: 1 / e.rate, color: "#a3be8c" }],
    bands: state.bands,
    cursor: state.play ? state.play.t : null,
    fmtY: (v) => v.toFixed(0),
  });
}

/* all reps of a gesture as onset-aligned envelope series (shared: panel + inspect) */
function repSeries(ch, gesture) {
  const e = state.envs.get(ch);
  const segs = state.session.segments.filter((s) => s.gesture === gesture);
  if (!e || !segs.length) return null;
  const pre = 0.3, post = 0.4;
  const cols = ["#88c0d0","#a3be8c","#ebcb8b","#b48ead","#8fbcbb","#d08770","#bf616a","#5e81ac"];
  const series = [];
  const notes = [];
  let x1 = pre + 1;
  for (const [i, s] of segs.entries()) {
    const t0 = Math.max(0, s.start - pre), t1 = s.end + post;
    const i0 = Math.round(t0 * e.rate), i1 = Math.min(e.values.length - 1, Math.round(t1 * e.rate));
    if (i1 <= i0) continue;
    const ys = e.values.slice(i0, i1 + 1);
    let pk = 0, at = 0;
    ys.forEach((v, k) => { if (v > pk) { pk = v; at = k / e.rate; } });
    series.push({ ys, dx: 1 / e.rate, x0: -(s.start - t0), color: cols[i % cols.length], lw: 1.2 });
    notes.push(`r${s.rep} ${pk.toFixed(0)}×@${at.toFixed(1)}s`);
    x1 = Math.max(x1, t1 - s.start);
  }
  return series.length ? { series, notes, x1, pre } : null;
}

function chartReps() {
  const g = gestureById(state.sel.gesture);
  $("reps-title").textContent =
    `reps: ch${state.sel.ch} · ${g.name.trim()} aligned to onset (x=0)`;
  const r = repSeries(state.sel.ch, state.sel.gesture);
  if (!r) { $("reps-note").textContent = ""; return; }
  chart($("reps-chart"), {
    x0: -r.pre, x1: r.x1, series: r.series,
    vlines: [{ x: 0, color: "#606a80" }],
    fmtY: (v) => v.toFixed(0),
  });
  $("reps-note").textContent = `peak ×floor @peak: ${r.notes.join(" · ")}`;
}

function drawSegCharts() {
  const d = state.seg;
  if (!d) return;
  const w = d.raw.length / d.fs;
  const vl = [
    { x: d.trialStart / d.fs, color: "#7fa3c0" },
    { x: d.trialEnd / d.fs, color: "#7fa3c0" },
  ];
  const tRel = state.play ? state.play.t - d.t0 : null;
  const cur = tRel != null && tRel >= 0 && tRel <= w ? tRel : null;
  chart($("raw-chart"), {
    x0: 0, x1: w, vlines: vl, cursor: cur,
    series: [{ ys: d.rawMv, dx: 1 / d.fs, color: "#88c0d0" }],
  });
  chart($("rect-chart"), {
    x0: 0, x1: w, vlines: vl, cursor: cur,
    series: [{ ys: d.rectMv, dx: 1 / d.fs, color: "#ebcb8b" }],
  });
  chart($("senv-chart"), {
    x0: 0, x1: w, vlines: vl, cursor: cur,
    series: [{ ys: d.envMv, dx: 0.05, color: "#a3be8c" }],
  });
}

function updateInfo() {
  const m = state.markers.channels.find((c) => c.ch === state.sel.ch);
  const mus = m.muscle ? state.markers.muscles[m.muscle] : null;
  const g = gestureById(state.sel.gesture);
  $("chaninfo").innerHTML =
    `<b>ch${m.ch} · ${m.label}</b><br>` +
    (mus ? `muscle: ${mus.full}<br>` : `ring position — DB3 assigns no muscle<br>`) +
    `gesture <b>${g.name}</b> rep ${state.sel.rep} — ${g.desc}`;
  $("gdesc").innerHTML = `<b>${g.name.trim()}</b><br>${g.desc || ""}`;
}

// ------------------------------------------------------------- UI wiring ---
function buildChips() {
  const box = $("chips");
  box.innerHTML = "";
  for (const m of state.markers.channels) {
    const mus = m.muscle ? state.markers.muscles[m.muscle] : null;
    const b = document.createElement("button");
    b.innerHTML =
      `<span class="dot" style="background:${mus ? mus.color : "#4c5566"}"></span>` +
      `<b>${m.ch}</b><span>${m.muscle || "ring"}</span>`;
    b.dataset.ch = m.ch;
    b.title = m.label;
    b.onclick = () => selectChannel(m.ch);
    box.appendChild(b);
  }
}
function updateChips() {
  for (const b of $("chips").children)
    b.classList.toggle("sel", +b.dataset.ch === state.sel.ch);
}

function buildGestureList() {
  const box = $("glist");
  box.innerHTML = "";
  for (const g of state.session.gestures) {
    const b = document.createElement("button");
    b.textContent = g.name.trim();
    b.dataset.g = g.id;
    b.title = g.desc || "";
    b.onclick = () => {
      state.sel.gesture = g.id;
      state.sel.rep = 1;
      updateGlistSel();
      syncRepSelect();
      loadSegment();
    };
    box.appendChild(b);
  }
  $("rep").onchange = () => {
    state.sel.rep = +$("rep").value;
    loadSegment();
  };
  $("play").onclick = () => (state.play ? stopPlay(false) : startPlay());
}
function updateGlistSel() {
  for (const b of $("glist").children)
    b.classList.toggle("sel", +b.dataset.g === state.sel.gesture);
}
function syncRepSelect() {
  const rs = $("rep");
  rs.innerHTML = "";
  state.session.segments
    .filter((s) => s.gesture === state.sel.gesture)
    .forEach((s) => {
      const o = document.createElement("option");
      o.value = s.rep;
      o.textContent = `rep ${s.rep}`;
      rs.appendChild(o);
    });
  rs.value = Math.min(state.sel.rep, rs.options.length);
  state.sel.rep = +rs.value;
}

function bestSegmentFor(ch) {
  const segs = state.session.segments;
  const own = segs.filter((s) => s.loudest === ch);
  const pool = own.length ? own : segs;
  return pool.reduce((a, b) => (b.level > a.level ? b : a));
}

function selectChannel(ch, keepGesture) {
  stopPlay(false);
  state.sel.ch = ch;
  updateChips();
  chartEnv();
  if (keepGesture) {
    // inspect grid: browse sensors within the gesture you're looking at
    if (!state.session.segments.some((s) => s.gesture === state.sel.gesture && s.rep === state.sel.rep))
      state.sel.rep = 1;
    syncRepSelect();
  } else {
    const best = bestSegmentFor(ch);
    state.sel.gesture = best.gesture;
    state.sel.rep = best.rep;
    updateGlistSel();
    syncRepSelect();
  }
  loadSegment();
  updateInfo();
}

async function loadSegment() {
  stopPlay(false);
  const { ch, gesture, rep } = state.sel;
  const d = await api(`/channels/${ch}/segment/${gesture}/${rep}`);
  d.rawMv = d.raw.map((v) => v * 1e3);
  d.rectMv = d.rect.map((v) => v * 1e3);
  d.envMv = d.env.map((v) => v * 1e3);
  state.seg = d;
  const g = gestureById(gesture);
  $("seg-title").textContent =
    `segment: ch${ch} ${d.label} · ${g.name.trim()} rep ${rep} · ${d.t0.toFixed(1)}–${(d.t0 + d.raw.length / d.fs).toFixed(1)} s`;
  drawSegCharts();
  chartReps();
  drawCap(); // the compare card follows the selected channel + gesture
  poseTarget = poseFor(gesture); // static preview of the gesture
  updateInfo();
  if (!$("inspect").hidden) { if (insp.mode === "seg") inspReset(); inspRender(); }
}

// ----------------------------------------------------------- my captures ---
const capId = () => (state.cap ? state.cap.meta.id : null);
function gName(id) {
  if (id == null) return "untagged";
  const g = state.session.gestures.find((x) => x.id === id);
  return g ? g.name.trim().replace(/\s+/g, " ") : `G${id}`;
}

async function loadCaptures() {
  state.caps = (await api("/captures")).captures;
  buildCapList();
  syncPins();
}

function buildCapList() {
  const box = $("caplist");
  box.innerHTML = "";
  if (!state.caps.length) {
    box.innerHTML = `<span class="dim small">none yet — record one in bench mode</span>`;
    return;
  }
  for (const c of state.caps) {
    const b = document.createElement("button");
    b.classList.toggle("sel", c.id === capId());
    const t = document.createElement("b");
    t.textContent = c.id.replace(/\.csv$/, "");
    const sub = document.createElement("span");
    const where = validSpot(c.placement)
      ? "📍 " + placementText(c.placement, state.markers.channels).split(" · ").pop()
      : "no pin";
    sub.textContent = `${gName(c.gesture)} · ${where} · ${c.duration_s}s`;
    b.append(t, sub);
    b.title = c.note || "";
    b.onclick = () => selectCapture(c.id === capId() ? null : c.id);
    box.appendChild(b);
  }
}

/* open one of my captures: jump to ITS gesture and the DB3 electrode nearest
 * its pin, so the compare card shows like against like straight away */
async function selectCapture(id) {
  if (id == null) { state.cap = null; buildCapList(); drawCap(); return; }
  try {
    state.cap = await api(`/captures/${encodeURIComponent(id)}`);
  } catch (err) {
    statusEl.textContent = `capture: ${err.message}`;
    return;
  }
  const m = state.cap.meta;
  if (m.gesture != null && gestureById(m.gesture)) {
    state.sel.gesture = m.gesture;
    state.sel.rep = 1;
    updateGlistSel();
  }
  buildCapList();
  if (validSpot(m.placement)) {
    selectChannel(nearestChannel(state.markers.channels, m.placement).ch, true);
  } else {
    syncRepSelect();
    loadSegment();
  }
}

const cmpData = () =>
  compareSeries(state.cap, repSeries(state.sel.ch, state.sel.gesture), state.cmpMode);
const cmpTitle = () =>
  `mine [${gName(state.cap.meta.gesture)}] vs DB3 ch${state.sel.ch} · ${gName(state.sel.gesture)}`;
const cmpFmt = (r) => (v) => v.toFixed(r.mode === "floor" ? 1 : 0);

function drawCap() {
  const c = state.cap;
  $("cap-card").hidden = $("cmp-card").hidden = !c;
  if (!c) return;
  const m = c.meta, k = envLane(c), ys = c.values[k] || [];
  const marks = markTimes(c), fl = floorOf(c);
  $("cap-title").textContent =
    `${m.id} · lane "${c.lanes[k] ?? "?"}" · ${c.rate} Hz · ${m.duration_s} s`;
  chart($("cap-chart"), {
    x0: 0, x1: Math.max(ys.length / c.rate, 1),
    series: [{ ys, dx: 1 / c.rate, color: "#ff7ab6" }],
    vlines: marks.map((x) => ({ x, color: "#ffb86c" })),
    fmtY: (v) => v.toFixed(0),
  });
  $("cap-note").textContent = [
    `gesture: ${gName(m.gesture)}`,
    validSpot(m.placement) ? placementText(m.placement, state.markers.channels) : "no placement",
    `${marks.length} trial mark${marks.length === 1 ? "" : "s"}`,
    fl ? (fl.lane != null ? "floor: from lane" : `floor: ${fl.value}`) : "no floor",
    m.note,
  ].filter(Boolean).join(" · ");
  if (document.activeElement !== $("cap-floor")) $("cap-floor").value = m.floor ?? "";

  const r = cmpData();
  $("cmp-title").textContent = cmpTitle();
  $("cmp-mode").textContent = r.mode === "floor" ? "scale: × floor" : "scale: % peak";
  chart($("cmp-chart"), {
    x0: r.x0, x1: r.x1, series: r.series,
    vlines: [{ x: 0, color: "#606a80" }], fmtY: cmpFmt(r),
  });
  $("cmp-note").textContent = r.note +
    (state.cmpMode === "floor" && r.mode === "peak" ? " · this capture has no floor → shape only" : "");
  if (inspIsOpen() && insp.mode === "cmp") inspRender();
}

async function patchCap(body) {
  if (!state.cap) return;
  const r = await fetch(`/api/captures/${encodeURIComponent(capId())}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    statusEl.textContent = `tag failed: ${typeof j.detail === "string" ? j.detail : "HTTP " + r.status}`;
    return;
  }
  state.cap.meta = j.meta;
  await loadCaptures();
  drawCap();
}

// ------------------------------------------------------- inspect overlay ---
/* full-screen interactive charts: big trial (raw/|x|/env share one time
 * window), big all-reps, and a grid of every sensor for the chosen gesture */
const insp = { mode: "seg", a: 0, b: 1, ra: -0.3, rb: 3, allMode: "block",
               focus: null, fa: 0, fb: 1, fKey: "", fBounds: [0, 1] };
const inspIsOpen = () => !$("inspect").hidden;
function inspOpen(mode) {
  insp.mode = mode;
  $("inspect").hidden = false;
  for (const b of $("inspect-bar").querySelectorAll("button[data-m]"))
    b.classList.toggle("sel", b.dataset.m === mode);
  $("im-toggle").hidden = mode !== "all";
  $("im-toggle").textContent = insp.allMode === "block" ? "reps overlaid" : "whole block";
  insp.focus = null;
  inspReset();
  inspRender();
}
function inspFocus(ch) { insp.focus = ch; insp.fKey = ""; inspRender(); }
function inspUnfocus() { insp.focus = null; inspRender(); }

function inspReset() {
  if (state.seg) { insp.a = 0; insp.b = state.seg.raw.length / state.seg.fs; }
  const r = repSeries(state.sel.ch, state.sel.gesture);
  insp.ra = -0.3; insp.rb = r ? r.x1 : 3;
  if (insp.mode === "cmp" && state.cap) { const c = cmpData(); insp.ra = c.x0; insp.rb = c.x1; }
}
function inspRender() {
  const mode = insp.mode;
  const focusOn = mode === "all" && insp.focus != null;
  $("inspect-trial").hidden = mode !== "seg";
  $("inspect-reps").hidden = mode !== "reps";
  $("inspect-cmp").hidden = mode !== "cmp";
  $("inspect-grid").hidden = mode !== "all" || focusOn;
  $("inspect-focus").hidden = !focusOn;
  $("focus-chips").hidden = !focusOn;
  if (mode === "seg") {
    const d = state.seg;
    if (!d) return;
    const w = d.raw.length / d.fs;
    $("inspect-title").textContent =
      `ch${d.ch} ${d.label} · trial ${insp.a.toFixed(2)}–${insp.b.toFixed(2)} s of ${w.toFixed(1)}`;
    const o = {
      x0: insp.a, x1: insp.b,
      vlines: [{ x: d.trialStart / d.fs }, { x: d.trialEnd / d.fs }],
    };
    chart($("i-raw"), { ...o, series: [{ ys: d.rawMv, dx: 1 / d.fs, color: "#88c0d0" }] });
    chart($("i-rect"), { ...o, series: [{ ys: d.rectMv, dx: 1 / d.fs, color: "#ebcb8b" }] });
    chart($("i-env"), { ...o, series: [{ ys: d.envMv, dx: 0.05, color: "#a3be8c" }] });
  } else if (mode === "reps") {
    const g = gestureById(state.sel.gesture);
    $("inspect-title").textContent =
      `ch${state.sel.ch} · ${g.name.trim()} · all reps, onset = x 0`;
    const r = repSeries(state.sel.ch, state.sel.gesture);
    if (r) chart($("i-reps"), {
      x0: insp.ra, x1: insp.rb, series: r.series,
      vlines: [{ x: 0, color: "#606a80" }], fmtY: (v) => v.toFixed(0),
    });
  } else if (mode === "cmp") {
    const r = state.cap ? cmpData() : null;
    $("inspect-title").textContent = r
      ? `${cmpTitle()} · ${r.unit} · x 0 = trial onset (my mark / DB3 label) — DB3 blue, mine warm`
      : "compare — pick one of my captures first (left column)";
    if (r) chart($("i-cmp"), {
      x0: insp.ra, x1: insp.rb, series: r.series,
      vlines: [{ x: 0, color: "#606a80" }], fmtY: cmpFmt(r),
    });
  } else if (focusOn) {
    // one sensor blown up from the stack: same time window as the grid rows,
    // but zoom/pannable; ch chips in the bar hop between sensors without leaving
    const ch = insp.focus;
    const m = state.markers.channels.find((x) => x.ch === ch);
    if (!m) { insp.focus = null; inspRender(); return; }
    const mus = m.muscle ? state.markers.muscles[m.muscle] : null;
    const g = gestureById(state.sel.gesture);
    const repsMode = insp.allMode === "reps";
    let bmin, bmax, series, vlines = [];
    if (repsMode) {
      const r = repSeries(ch, state.sel.gesture);
      if (!r) return;
      bmin = -0.3; bmax = r.x1; series = r.series; vlines = [{ x: 0, color: "#606a80" }];
    } else {
      const e = state.envs.get(ch);
      if (!e) return;
      const segs = state.session.segments.filter((s) => s.gesture === state.sel.gesture);
      bmin = segs.length ? segs[0].start - 0.5 : 0;
      bmax = segs.length ? segs.at(-1).end + 1 : 6;
      const i0 = Math.max(0, Math.round(bmin * e.rate));
      const i1 = Math.min(e.values.length - 1, Math.round(bmax * e.rate));
      series = [{ ys: e.values.slice(i0, i1 + 1), dx: 1 / e.rate, x0: i0 / e.rate,
                  color: mus ? mus.color : "#a3be8c" }];
    }
    const key = `${ch}:${insp.allMode}:${state.sel.gesture}`;
    if (insp.fKey !== key) { insp.fKey = key; insp.fa = bmin; insp.fb = bmax; } // stale window (gesture/mode/sensor changed) → refit
    insp.fBounds = [bmin, bmax];
    $("inspect-title").textContent =
      `${m.label} · ${g.name.trim()} · focus — ${repsMode ? "reps overlaid" : "whole block"} · ` +
      "wheel zoom · drag pan · dblclick or Esc back to all sensors";
    chart($("i-focus"), { x0: insp.fa, x1: insp.fb, series, vlines, fmtY: (v) => v.toFixed(0) });
    for (const b of $("focus-chips").children) b.classList.toggle("sel", +b.dataset.ch === ch);
  } else {
    const g = gestureById(state.sel.gesture);
    const repsMode = insp.allMode === "reps";
    $("inspect-title").textContent = `${g.name.trim()} · every sensor — ${
      repsMode ? "all reps overlaid per sensor (onset = x 0, shared Y scale)"
               : "whole gesture block, envelope × floor (shared Y scale) — click a card to select"}`;
    const segs = state.session.segments.filter((s) => s.gesture === state.sel.gesture);
    const bt0 = segs.length ? segs[0].start - 0.5 : 0;
    const bt1 = segs.length ? segs.at(-1).end + 1 : 6;
    const per = [];
    let gmax = 0, rmaxX = 1.2;
    for (const m of state.markers.channels) {
      if (repsMode) {
        const r = repSeries(m.ch, state.sel.gesture);
        if (r) {
          for (const s of r.series) for (const v of s.ys) if (v > gmax) gmax = v;
          rmaxX = Math.max(rmaxX, r.x1);
        }
        per.push(r);
      } else {
        const e = state.envs.get(m.ch);
        if (!e) { per.push(null); continue; }
        const i0 = Math.max(0, Math.round(bt0 * e.rate));
        const i1 = Math.min(e.values.length - 1, Math.round(bt1 * e.rate));
        const ys = e.values.slice(i0, i1 + 1);
        for (const v of ys) if (v > gmax) gmax = v;
        per.push({ e, i0, ys });
      }
    }
    const yFix = gmax > 0 ? { yMin: 0, yMax: gmax * 1.06 } : {};
    const grid = $("inspect-grid");
    grid.innerHTML = "";
    for (let k = 0; k < state.markers.channels.length; k++) {
      const m = state.markers.channels[k];
      const d = per[k];
      if (!d) continue;
      const mus = m.muscle ? state.markers.muscles[m.muscle] : null;
      const cell = document.createElement("div");
      cell.className = "mini" + (m.ch === state.sel.ch ? " sel" : "");
      cell.innerHTML =
        `<div class="minit"><span class="dot" style="display:inline-block;width:8px;height:8px;` +
        `border-radius:50%;background:${mus ? mus.color : "#4c5566"}"></span> ch${m.ch} — ${m.label}</div>`;
      const cv = document.createElement("canvas");
      cell.appendChild(cv);
      cell.onclick = () => selectChannel(m.ch, true);
      cell.ondblclick = () => inspFocus(m.ch);
      grid.appendChild(cell);
      if (repsMode) {
        chart(cv, { x0: -0.3, x1: rmaxX, series: d.series, vlines: [{ x: 0, color: "#606a80" }], fmtY: (v) => v.toFixed(0), ...yFix });
      } else {
        chart(cv, {
          x0: bt0, x1: bt1, fmtY: (v) => v.toFixed(0), ...yFix,
          series: [{ ys: d.ys, dx: 1 / d.e.rate, x0: d.i0 / d.e.rate, color: mus ? mus.color : "#a3be8c" }],
        });
      }
    }
  }
}
{
  const body = $("inspect-body");
  body.addEventListener("wheel", (e) => {
    if (!inspIsOpen() || (insp.mode === "all" && insp.focus == null)) return;
    e.preventDefault();
    const f = Math.exp(e.deltaY * 0.0015);
    const frac = Math.min(Math.max((e.offsetX - 34) / Math.max(body.clientWidth - 40, 1), 0), 1);
    if (insp.mode === "seg" && state.seg) {
      const w = state.seg.raw.length / state.seg.fs;
      const c = insp.a + (insp.b - insp.a) * frac;
      const a = Math.max(0, c - (c - insp.a) * f), b = Math.min(w, c + (insp.b - c) * f);
      if (b - a > 0.02) { insp.a = a; insp.b = b; inspRender(); }
    } else if (insp.mode === "reps" || insp.mode === "cmp") {
      const c = insp.ra + (insp.rb - insp.ra) * frac;
      const a = c - (c - insp.ra) * f, b = c + (insp.rb - c) * f;
      if (b - a > 0.05) { insp.ra = a; insp.rb = b; inspRender(); }
    } else if (insp.mode === "all" && insp.focus != null) {
      const [mn, mx] = insp.fBounds;
      const c = insp.fa + (insp.fb - insp.fa) * frac;
      const a = Math.max(mn, c - (c - insp.fa) * f), b = Math.min(mx, c + (insp.fb - c) * f);
      if (b - a > 0.05) { insp.fa = a; insp.fb = b; inspRender(); }
    }
  }, { passive: false });
  let dragX = null, win0 = null;
  body.addEventListener("pointerdown", (e) => {
    dragX = e.clientX;
    win0 = insp.mode === "seg" ? [insp.a, insp.b]
           : insp.mode === "reps" || insp.mode === "cmp" ? [insp.ra, insp.rb]
           : insp.focus != null ? [insp.fa, insp.fb] : null;
    body.style.cursor = "grabbing";
  });
  body.addEventListener("pointermove", (e) => {
    if (dragX == null || !win0) return;
    const span = win0[1] - win0[0];
    const dt = -((e.clientX - dragX) / Math.max(body.clientWidth, 1)) * span;
    if (insp.mode === "seg" && state.seg) {
      const w = state.seg.raw.length / state.seg.fs;
      insp.a = Math.min(Math.max(0, win0[0] + dt), w - span);
      insp.b = insp.a + span;
    } else if (insp.mode === "reps" || insp.mode === "cmp") {
      insp.ra = win0[0] + dt; insp.rb = win0[1] + dt;
    } else if (insp.mode === "all" && insp.focus != null) {
      const [mn, mx] = insp.fBounds;
      const a = Math.min(Math.max(mn, win0[0] + dt), mx - span);
      insp.fa = a; insp.fb = a + span;
    }
    inspRender();
  });
  const up = () => { dragX = null; win0 = null; body.style.cursor = "grab"; };
  window.addEventListener("pointerup", up);
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !inspIsOpen()) return;
    if (insp.focus != null) inspUnfocus();
    else $("inspect").hidden = true;
  });
  $("inspect-focus").addEventListener("dblclick", inspUnfocus);
}

// --------------------------------------------------------------- playback --
async function startPlay() {
  const seg = segmentFor(state.sel.gesture, state.sel.rep);
  if (!seg) { statusEl.textContent = "no such trial"; return; }
  if (!state.seg || state.seg.gesture !== seg.gesture || state.seg.rep !== seg.rep) {
    await loadSegment();
  }
  state.play = { a: seg.start - 1, b: seg.end + 0.5, t: seg.start - 1, seg };
  $("play").textContent = "■ stop";
}
function stopPlay() {
  if (!state.play) return;
  state.play = null;
  $("play").textContent = "▶ play";
  poseTarget = copyPose(REST); // the hand relaxes on stop
  chartEnv();
  drawSegCharts();
}

function percentile(arr, q) {
  const s = Float64Array.from(arr);
  s.sort();
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] || 1;
}

let lastChart = 0;
function frame(now) {
  const dt = Math.min((now - (frame.last || now)) / 1000, 0.1);
  frame.last = now;

  if (MODE === "bench") { benchDraw(); requestAnimationFrame(frame); return; }

  if (state.play) {
    state.play.t += dt;
    const { a, b, t, seg } = state.play;
    poseTarget = t >= seg.start ? poseFor(seg.gesture) : copyPose(REST);
    for (let ch = 1; ch <= 12; ch++) {
      state.glow[ch] = Math.min(1, envAt(ch, t) / state.envRef.get(ch));
    }
    if (now - lastChart > 33) {
      lastChart = now;
      chartEnv();
      drawSegCharts();
    }
    if (state.play && t >= b) stopPlay();
  } else {
    state.glow.fill(0);
  }

  // apply glow to markers + capsules
  for (const [ch, mesh] of markerByCh) {
    const base = ch === state.sel.ch ? 0.30 + 0.12 * Math.sin(now * 0.004) : 0.10;
    mesh.material.emissiveIntensity = base + 2.4 * state.glow[ch];
  }
  for (const [ch, mesh] of capsuleByCh) {
    mesh.material.opacity = 0.08 + 0.55 * state.glow[ch];
  }

  for (const mesh of pinMeshes) { // the selected capture's pin pulses
    const u = mesh.userData, on = u.capId != null && u.capId === capId();
    mesh.material.emissiveIntensity = on ? 0.9 + 0.5 * Math.sin(now * 0.006) : u.myPin ? 0.7 : 0.3;
    mesh.scale.setScalar(on ? 1.35 : 1);
  }

  poseLerp(poseCur, poseTarget, 1 - Math.exp(-6 * dt));
  applyPose(poseCur);

  updateCamera();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------ bench mode ----
/* Live/replay scope fed by server/live.py over /ws/live. The hub stamps rows
 * with wall-clock time; we convert to seconds-since-stream-start on arrival
 * and draw only — every number in these lanes was computed in firmware. */
let MODE = "3d";
const LANE_COLS = ["#88c0d0", "#ebcb8b", "#a3be8c", "#b48ead", "#d08770", "#8fbcbb"];
const bench = {
  ws: null, buf: [], tRef: null, now: 0,
  lanes: [], laneUI: [], win: 5, frozen: false, frozenT: null, status: null,
  marks: [], // scope times of the trial marks set during this recording
};

function setMode(m) {
  if (MODE === m) return;
  MODE = m;
  $("main-3d").hidden = m !== "3d";
  $("main-bench").hidden = m !== "bench";
  $("m-3d").classList.toggle("sel", m === "3d");
  $("m-bench").classList.toggle("sel", m === "bench");
  if (m === "bench") { benchLoadSources(); benchConnect(); updatePinInfo(); }
  else {
    if (bench.ws) { bench.ws.onclose = null; bench.ws.close(); bench.ws = null; }
    resize(); // canvas was hidden (zero-size) — give the renderer its box back
  }
}

async function benchLoadSources() {
  const src = await api("/live/sources");
  const sel = $("live-src");
  sel.innerHTML = "";
  for (const r of src.replays) {
    const o = document.createElement("option");
    o.value = "replay:" + r.name;
    o.textContent = `${r.name} — ${r.seconds}s @${r.rate}Hz`;
    o.title = `replay sensor-lab capture ${r.name} (${r.lines} lines)`;
    sel.appendChild(o);
  }
  const os = document.createElement("option");
  os.value = "serial";
  os.textContent = src.serial.ready
    ? `Teensy ${src.serial.port} — live`
    : src.serial.present
      ? `Teensy ${src.serial.port} (pyserial missing)`
      : `Teensy ${src.serial.port} (not connected)`;
  os.disabled = !src.serial.ready;
  sel.appendChild(os);
}

function benchConnect() {
  if (bench.ws) return;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws/live`);
  bench.ws = ws;
  ws.onmessage = (e) => benchMsg(JSON.parse(e.data));
  ws.onclose = () => {
    bench.ws = null;
    if (MODE === "bench") { benchStatus("disconnected — retrying"); setTimeout(benchConnect, 1500); }
  };
}

function benchResetBuf() {
  bench.buf = []; bench.tRef = null; bench.now = 0; bench.frozenT = null; bench.marks = [];
}

function benchMsg(m) {
  const st = m.status;
  const lanesChanged = (st.lanes || []).join(",") !== bench.lanes.join(",");
  if (lanesChanged) { bench.lanes = (st.lanes || []).slice(); benchResetBuf(); }
  if (bench.tRef == null && m.rows.length) bench.tRef = m.rows[0][1];
  if (bench.tRef != null)
    for (const r of m.rows) bench.buf.push([r[1] - bench.tRef, r.slice(2)]);
  if (bench.buf.length) bench.now = bench.buf.at(-1)[0];
  let cut = 0; // keep at most 240 s of history
  while (cut < bench.buf.length && bench.now - bench.buf[cut][0] > 240) cut++;
  if (cut) bench.buf.splice(0, cut);
  if (JSON.stringify(st) !== JSON.stringify(bench.status)) {
    bench.status = st;
    if (lanesChanged) benchBuildLanes();
    $("rec-btn").textContent = st.recording ? `⏹ stop rec · ${st.rec_lines || 0}` : "⏺ record";
    $("rec-btn").classList.toggle("rec-on", !!st.recording);
    $("mark-btn").hidden = !st.recording;
  }
  benchStatus();
}

function benchStatus(extra) {
  const st = bench.status || {};
  const bits = [extra || st.state || "idle"];
  if (st.source) bits.push(st.source.replace(/^replay:/, ""));
  if (st.lanes && st.lanes.length) bits.push(st.lanes.length + " lanes");
  if (st.rate) bits.push(st.rate + " Hz");
  bits.push((st.lines || 0) + " lines");
  if (st.bad) bits.push(st.bad + " skipped");
  if (st.fw && st.fw.floor != null) bits.push("fw floor " + st.fw.floor);
  if (st.recording) bits.push(`● REC ${st.rec_lines || 0}`);
  if (st.error) bits.push("⚠ " + st.error);
  if (benchSaved) bits.push(benchSaved);
  $("live-status").textContent = bits.join(" · ");
}

let benchSaved = null;
function benchMark() {
  bench.marks.push(bench.now);
  return fetch("/api/live/mark", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"label":"trial"}',
  }).catch(() => {});
}

function benchBuildLanes() {
  bench.laneUI = [];
  const opts = $("lane-opts"), scope = $("scope");
  opts.innerHTML = ""; scope.innerHTML = "";
  if (!bench.lanes.length) { opts.innerHTML = `<span class="dim">start a source to detect lanes</span>`; return; }
  bench.lanes.forEach((name, i) => {
    const col = LANE_COLS[i % LANE_COLS.length];
    const row = document.createElement("div");
    row.className = "scope-row";
    row.innerHTML =
      `<div class="slabel"><b><span style="display:inline-block;width:8px;height:8px;` +
      `border-radius:50%;background:${col}"></span> ${name}</b><span class="dim" data-max></span></div>`;
    const cv = document.createElement("canvas");
    row.appendChild(cv);
    scope.appendChild(row);
    const ui = { name, cv, row, on: true, color: col };
    bench.laneUI.push(ui);

    const lab = document.createElement("label");
    lab.className = "dim";
    lab.style.cssText = "display:flex;gap:6px;align-items:center;font-size:11px";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = true;
    cb.onchange = () => { ui.on = cb.checked; row.classList.toggle("off", !cb.checked); };
    lab.appendChild(cb);
    lab.append(name);
    opts.appendChild(lab);
  });
}

function benchLower(t0) { // first buffer index with t >= t0
  let lo = 0, hi = bench.buf.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; bench.buf[mid][0] < t0 ? (lo = mid + 1) : (hi = mid); }
  return lo;
}

function benchDraw() {
  if (!bench.laneUI.length || !bench.buf.length) return;
  const t1 = bench.frozen ? bench.frozenT ?? bench.now : bench.now;
  const t0 = t1 - bench.win;
  const i0 = benchLower(t0);
  const stride = Math.max(1, Math.ceil((bench.buf.length - i0) / 2400));
  const vlines = bench.marks.map((x) => ({ x, color: "#ffb86c" }));
  for (let i = 0; i < bench.laneUI.length; i++) {
    const L = bench.laneUI[i];
    if (!L.on) continue;
    const ys = [], xs = []; // real arrival times on x: gaps and jitter stay visible
    let vmax = -Infinity;
    for (let k = i0; k < bench.buf.length; k += stride) {
      const v = bench.buf[k][1][i];
      if (v == null || !isFinite(v)) continue;
      ys.push(v);
      xs.push(bench.buf[k][0]);
      if (v > vmax) vmax = v;
    }
    if (!ys.length) continue;
    chart(L.cv, {
      x0: t0, x1: t1, vlines, fmtY: (v) => Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1),
      series: [{ ys, xs, color: L.color }],
    });
    L.row.querySelector("[data-max]").textContent = `max ${vmax.toFixed(0)}`;
  }
}

// ------------------------------------------------------------------ init ---
async function init() {
  state.markers = await api("/channels");
  const dsInfo = await api("/datasets");
  const dsel = $("dataset");
  dsel.innerHTML = "";
  for (const d of dsInfo.datasets) {
    const o = document.createElement("option");
    o.value = d.id;
    o.textContent = d.id + (d.id === dsInfo.default ? " (default)" : "");
    dsel.appendChild(o);
  }
  dsel.onchange = () => {
    // full page reload with ?d= — every chart/cache starts clean on the new session
    const q = new URLSearchParams(location.search);
    q.set("d", dsel.value);
    location.search = q.toString();
  };
  state.session = await api("/gestures");
  dsel.value = state.session.session;
  $("session-tag").textContent = `· ${state.session.session}`;
  statusEl.textContent =
    `${state.session.segments.length} trials · ${Math.round(state.session.duration)} s · 12 ch @ ${state.session.session}`;

  // gesture bands (runs of the same gesture) for the session chart
  let cur = null;
  for (const s of state.session.segments) {
    if (cur && s.gesture === cur.g) { cur.mid.push(s); }
    else { cur = { g: s.gesture, first: s, mid: [s] }; state.bands.push(cur); }
  }
  state.bands.forEach((bd, i) => {
    bd.a = bd.first.start;
    bd.b = state.bands[i + 1] ? state.bands[i + 1].first.start : Math.min(bd.mid.at(-1).end + 2, state.session.duration);
  });

  buildChips();
  buildGestureList();
  buildMarkers();
  $("m-3d").onclick = () => setMode("3d");
  $("m-bench").onclick = () => setMode("bench");
  $("scope-win").onchange = () => { bench.win = +$("scope-win").value; };
  $("scope-freeze").onclick = () => {
    bench.frozen = !bench.frozen;
    bench.frozenT = bench.frozen ? bench.now : null;
    $("scope-freeze").textContent = bench.frozen ? "resume" : "freeze";
  };
  $("live-start").onclick = async () => {
    benchResetBuf();
    bench.lanes = [];
    benchBuildLanes();
    try {
      const r = await fetch("/api/live/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: $("live-src").value, loop: $("live-loop").checked }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        bench.status = { state: "error", error: e.detail || `HTTP ${r.status}` };
        benchStatus();
      }
    } catch (err) {
      bench.status = { state: "error", error: String(err) };
      benchStatus();
    }
  };
  $("live-stop").onclick = () => fetch("/api/live/stop", { method: "POST" });
  $("rec-btn").onclick = async () => {
    const st = bench.status || {};
    const body = st.recording
      ? { action: "stop", note: $("rec-note").value.trim() }
      : { action: "start", name: $("rec-name").value.trim() || "capture",
          note: $("rec-note").value.trim(),
          gesture: $("rec-gesture").value ? +$("rec-gesture").value : null,
          placement: validSpot(state.pin) ? state.pin : null };
    if (body.action === "start") bench.marks = [];
    benchSaved = null;
    const r = await fetch("/api/live/record", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) benchSaved = "⚠ " + (j.detail || "HTTP " + r.status);
    else if (body.action === "stop") {
      benchSaved = `saved ${j.saved}`;
      $("rec-name").value = "";
      $("rec-note").value = "";
      loadCaptures().catch(() => {}); // the new capture shows up in the 3D view + replay list
      benchLoadSources();
    }
    benchStatus();
  };
  $("mark-btn").onclick = benchMark;
  window.addEventListener("keydown", (e) => {
    if (MODE !== "bench" || e.code !== "Space") return;
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (!(bench.status || {}).recording) return;
    e.preventDefault();
    benchMark();
  });
  $("seg-inspect").onclick = () => inspOpen("seg");
  $("reps-inspect").onclick = () => inspOpen("reps");
  $("all-inspect").onclick = () => inspOpen("all");
  $("inspect-close").onclick = () => { $("inspect").hidden = true; };
  $("im-toggle").onclick = () => {
    insp.allMode = insp.allMode === "block" ? "reps" : "block";
    $("im-toggle").textContent = insp.allMode === "block" ? "reps overlaid" : "whole block";
    inspRender();
  };
  const fc = $("focus-chips");
  for (const m of state.markers.channels) {
    const b = document.createElement("button");
    b.textContent = m.ch;
    b.dataset.ch = m.ch;
    b.title = m.label;
    b.onclick = () => inspFocus(m.ch);
    fc.appendChild(b);
  }
  for (const b of $("inspect-bar").querySelectorAll("button[data-m]"))
    b.onclick = () => inspOpen(b.dataset.m);
  $("cmp-inspect").onclick = () => inspOpen("cmp");
  $("cmp-mode").onclick = () => {
    state.cmpMode = state.cmpMode === "floor" ? "peak" : "floor";
    drawCap();
  };
  $("pin-place").onclick = () => setPlacing(!state.placing);
  $("pin-clear").onclick = () => { setPlacing(false); setPin(null); };
  $("cap-tag-g").onclick = () => patchCap({ gesture: state.sel.gesture });
  $("cap-tag-p").onclick = () => {
    if (validSpot(state.pin)) patchCap({ placement: state.pin });
    else statusEl.textContent = "place my sensor pin on the arm first (left column)";
  };
  $("cap-floor").onchange = () => {
    const v = parseFloat($("cap-floor").value);
    patchCap({ floor: v > 0 ? v : null });
  };
  const rg = $("rec-gesture");
  rg.innerHTML = `<option value="">gesture: untagged</option>`;
  for (const g of state.session.gestures) {
    const o = document.createElement("option");
    o.value = g.id;
    o.textContent = g.name.trim();
    rg.appendChild(o);
  }
  try { state.pin = JSON.parse(localStorage.getItem("myPin") || "null"); } catch { state.pin = null; }

  await loadModel3d();
  rigUI();
  resize();
  updatePinInfo();
  await loadCaptures().catch((err) => console.warn("captures unavailable:", err));

  const envAll = await api("/envelopes");
  for (const c of envAll.channels) {
    const e = { ...c, rate: envAll.rate };
    state.envs.set(e.ch, e);
    state.envRef.set(e.ch, percentile(e.values, 0.98));
  }

  selectChannel(9); // FDS + its best gesture (a fist) as the opening demo
  requestAnimationFrame(frame);
}

init().catch((err) => {
  statusEl.textContent = `error: ${err.message}`;
  console.error(err);
});
