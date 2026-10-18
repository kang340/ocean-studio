import assert from "node:assert/strict";
import { interpColumn, matchProfiles, binStats, stats, type ObsProfile } from "../src/studio/profmatch";

// linear interpolation between valid levels; skips a missing level; no extrapolation at depth
const z = [0.5, 10, 50, 100, 500], v = [25, 24, null, 20, 10];
const r = interpColumn(z, v, 30) as any; assert.ok(Math.abs(r.v - (24 + (20 - 24) * (20 / 90))) < 1e-9, "interpolates 10→100 across the missing 50 m level");
assert.deepEqual(interpColumn(z, v, 600), { reason: "below_model" });
assert.equal((interpColumn(z, v, 0.1) as any).v, 25, "within surface tolerance → shallowest value");
assert.deepEqual(interpColumn([20, 30], [1, 2], 2), { reason: "above_model" });
assert.deepEqual(interpColumn(z, [null, null, null, null, null], 5), { reason: "model_gap" });

// statistics with a known answer: model = obs + 0.3
const s = stats([1, 2, 3, 4], [1.3, 2.3, 3.3, 4.3]); assert.ok(Math.abs(s.bias - 0.3) < 1e-12 && Math.abs(s.rmse - 0.3) < 1e-12 && Math.abs(s.r - 1) < 1e-12 && Math.abs(s.slope - 1) < 1e-12);

// end-to-end with a synthetic model column T(z) = 20 − 0.01 z, observations offset by −0.5 (model warm bias 0.5)
const prof = (id: string, time: string, levels: [number, number | null, string][]): ObsProfile => ({ platform: id, key: id + time, cycle: "1", time, lon: 140, lat: 30, variable: "temp", levels: levels.map(([z, v, qc]) => ({ z, v, qc })) });
const col = { z: [0.5, 50, 100, 200, 500, 1000], v: [20 - 0.005, 19.5, 19, 18, 15, 10], time: "2026-10-13T00:00:00Z" };
const P = [prof("A", "2026-10-13T02:00:00Z", [[5, 20 - 0.05 - 0.5, "good"], [150, 18.5 - 0.5, "good"], [300, null, "good"], [400, 16 - 0.5, "bad"], [1200, 8, "good"]]),
  prof("B", "2026-10-15T12:00:00Z", [[5, 19, "good"]])];
const m = await matchProfiles({ profiles: P, frames: [{ time: "2026-10-13T00:00:00Z", task: "x" }, { time: "2026-10-14T00:00:00Z", task: "y" }], maxDtH: 12, maxDepth: 2000, column: async () => col, unit: "°C", label: "T", modelLabel: "M" });
assert.equal(m.stats.n, 2); assert.ok(Math.abs(m.stats.bias - 0.5) < 1e-9, "bias " + m.stats.bias);
assert.equal(m.unmatched.qc_excluded, 1); assert.equal(m.unmatched.obs_missing, 1); assert.equal(m.unmatched.below_model, 1); assert.equal(m.unmatched.outside_time, 1);
assert.equal(m.profiles.find(p => p.platform === "B")!.reason!.startsWith("超出时间容差"), true);
assert.deepEqual(binStats(m.pairs).map(b => [b.z0, b.n]), [[0, 1], [100, 1]]);
console.log("profmatch: passed");
