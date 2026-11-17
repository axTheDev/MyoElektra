/* node web/capture.test.mjs - checks the pure compare helpers in capture.js */
import assert from "node:assert/strict";
import { nearestChannel, envLane, floorOf, markTimes, capTrials, compareSeries } from "./capture.js";

const channels = [
  { ch: 1, label: "ring 1", pos: { az: 0, y: 0.05 } },
  { ch: 8, label: "ring 8", pos: { az: 315, y: 0.05 } },
  { ch: 9, label: "FDS", pos: { az: 270, y: 0.27 } },
  { ch: 10, label: "EDS", pos: { az: 90, y: 0.26 } },
];
assert.equal(nearestChannel(channels, { az: 268, y: 0.3 }).ch, 9);
assert.equal(nearestChannel(channels, { az: 350, y: 0.05 }).ch, 1); // wraps across 360

// 10 Hz capture: floor 100, two hills peaking 450 at rows 20 and 60
const env = Array.from({ length: 80 }, (_, i) => (Math.abs(i - 20) < 3 || Math.abs(i - 60) < 3 ? 450 : 100));
const cap = {
  lanes: ["env"], rate: 10, values: [env],
  meta: { marks: [{ t_s: 9, row: 15, label: "trial" }, { t_s: 5.5, row: 55, label: "trial" }], fw: { floor: 100 } },
};
assert.equal(envLane(cap), 0);
assert.deepEqual(floorOf(cap), { value: 100 });
assert.deepEqual(markTimes(cap), [1.5, 5.5]); // row wins over t_s
const tr = capTrials(cap);
assert.equal(tr.length, 2);
assert.deepEqual([tr[0].i0, tr[0].i1], [10, 55]); // 0.5 s pre -> next mark

const db = { series: [{ ys: [1, 20, 1], dx: 0.05, x0: -0.3 }], x1: 3, pre: 0.3 };
const c = compareSeries(cap, db, "floor");
assert.equal(c.mode, "floor");
assert.equal(c.series.length, 3);
assert.equal(Math.max(...c.series[1].ys), 4.5); // 450 / floor 100
assert.equal(c.series[1].x0, -0.5); // onset-aligned: mark sits at x = 0
assert.equal(db.series[0].ys[1], 20); // input not mutated

const p = compareSeries(cap, db, "peak");
assert.equal(Math.max(...p.series[0].ys), 100);
assert.equal(Math.max(...p.series[2].ys), 100);

// no floor anywhere -> falls back to peak; floor lane beats meta
const bare = { lanes: ["env"], rate: 10, values: [env], meta: {} };
assert.equal(compareSeries(bare, null, "floor").mode, "peak");
assert.equal(capTrials(bare).length, 1); // unmarked = one whole-capture trial
const laned = { lanes: ["env", "floor", "flex"], rate: 10, values: [env, env.map(() => 50), env.map(() => 0)], meta: { floor: 999 } };
assert.deepEqual(floorOf(laned), { lane: 1 });
assert.equal(Math.max(...compareSeries(laned, null, "floor").series[0].ys), 9);

console.log("capture.js: all checks passed");
