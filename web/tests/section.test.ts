// P2-A vertical section helpers
import assert from "node:assert/strict";
import { lineParam, depthEdges, depthScale } from "../src/studio/section";
// dateline: 179 → -179 is unwrapped to 181 so the server samples the short way
assert.equal(lineParam([[179, 10], [-179, 11]]), "179.0000,10.0000;181.0000,11.0000");
assert.equal(lineParam([[120, 20], [125.5, 21.25]]), "120.0000,20.0000;125.5000,21.2500");
// cells: surface to half-way between levels; last cell extends by half the last spacing
assert.deepEqual(depthEdges([0.5, 10, 50]), [0, 5.25, 30, 70]);
assert.deepEqual(depthEdges([-0.5, -10]), [0, 5.25, 14.75]);   // positive-up depths
const lin = depthScale(100, false), lg = depthScale(1000, true);
assert.equal(lin(0), 0); assert.equal(lin(50), 0.5); assert.equal(lin(200), 1);
assert.ok(lg(10) > 0.3 && lg(10) < 0.4 && lg(1000) === 1);   // log10(11)/log10(1001) ≈ 0.347
console.log("section: ok");
