// Regression: switching element (sea temperature → current / wind) used to rasterise the previous element's slice
// with the new selection; displayArray indexed a missing array, the effect threw and React unmounted Ocean Studio.
import assert from "node:assert/strict";
import { hasVars, scalarReady, freshFields, varIndex } from "../src/studio/fieldfresh";
import { displayArray } from "../src/viz/render";
import type { Field } from "../src/viz/data";

const field = (names: string[], fill = 1): Field => {
  const nx = 3, ny = 2;
  return { variables: names.map(name => ({ name })), arrays: names.map(() => new Float32Array(nx * ny).fill(fill)), nx, ny,
    lon: [0, 1, 2], lat: [0, 1], bounds: [0, 0, 2, 1], factor: 1, time: "2026-10-15T00:00:00Z", key: names.join(), bytes: 0 } as unknown as Field;
};
const sst = field(["thetao"]), cur = field(["water_u", "water_v"], 0.5), wind = field(["u10", "v10"], 3);

// 1. the crash itself: a sea-temperature slice read as |u,v| throws (this is what took the page down)
assert.throws(() => displayArray(field(["thetao"]), [0, 1]));

// 2. the guards
assert.equal(scalarReady(sst, ["water_u", "water_v"]), false);
assert.equal(scalarReady(cur, ["water_u", "water_v"]), true);
assert.equal(scalarReady(field(["water_v", "water_u"]), ["water_u", "water_v"]), false, "order matters for direct array indexing");
assert.equal(hasVars(field(["water_v", "water_u"]), ["water_u", "water_v"]), true, "vector lookup is by name");
assert.equal(hasVars(null, ["a"]), false); assert.equal(hasVars(sst, []), false); assert.equal(hasVars(sst, [null]), false);
assert.deepEqual(varIndex(field(["x", "v10", "u10"]), ["u10", "v10"]), [2, 1]); assert.equal(varIndex(sst, ["u10"]), null);

// 3. freshFields: stale slices of the previous element are dropped, fresh ones kept untouched
{ const stale = freshFields({ s: sst, sd: sst, v: null, wave: null }, ["water_u", "water_v"], ["water_u", "water_v"], null);
  assert.equal(stale.s, null); assert.equal(stale.sd, null); assert.equal(stale.v, null);
  const ok = freshFields({ s: cur, sd: null, v: cur, w: 0.3 }, ["water_u", "water_v"], ["water_u", "water_v"], null);
  assert.equal(ok.s, cur); assert.equal(ok.v, cur); assert.equal(ok.w, 0.3);
  assert.doesNotThrow(() => ok.s && displayArray(ok.s, [0, 1]));
  // wind selected while the current slice is still loaded
  const w = freshFields({ s: cur, v: cur }, ["u10", "v10"], ["u10", "v10"], null); assert.equal(w.s, null); assert.equal(w.v, null);
  assert.equal(freshFields({ s: wind, v: wind }, ["u10", "v10"], ["u10", "v10"], null).v, wind);
  // scalar off / vector off
  const none = freshFields({ s: sst, v: cur }, null, null, null); assert.equal(none.s, null); assert.equal(none.v, null);
  // wave direction slice is only kept while the wave layer asks for those variables
  const wave = field(["mwd", "swh"]);
  assert.equal(freshFields({ wave }, null, null, ["mwd", "swh"]).wave, wave); assert.equal(freshFields({ wave }, null, null, null).wave, null); }

// 4. 30 alternating switches with a slice that lags one step behind the selection never yield an unusable slice
{ const seq: [string[], Field][] = [[["thetao"], sst], [["water_u", "water_v"], cur], [["u10", "v10"], wind], [["swh"], field(["swh"])], [["water_u", "water_v"], cur]];
  let loaded: Field = sst;
  for (let k = 0; k < 30; k++) { const [vars, slice] = seq[k % seq.length];
    const f = freshFields({ s: loaded }, vars, null, null); if (f.s) assert.doesNotThrow(() => displayArray(f.s!, vars.length === 2 ? [0, 1] : 0));
    loaded = slice; assert.equal(freshFields({ s: loaded }, vars, null, null).s, slice); } }
console.log("fieldfresh: ok");
