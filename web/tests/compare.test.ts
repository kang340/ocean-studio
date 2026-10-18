// Run: node scripts/run-ts-tests.mjs  (bundles with esbuild, plain node assert — no test framework dependency)
import assert from "node:assert/strict";
import { resample, diffStats, common, type Grid } from "../src/studio/compare";
import { ELEMENTS, sourcesFor, pickFile, compareBlockers, scalarFor } from "../src/studio/elements";

const axis = (a: number, b: number, d: number) => { const o: number[] = []; for (let v = a; v <= b + 1e-9; v += d) o.push(+v.toFixed(6)); return o; };
const grid = (lon: number[], lat: number[], global = false): Grid => ({ nx: lon.length, ny: lat.length, lon, lat, dx: lon[1] - lon[0], dy: lat[1] - lat[0], global });
const fill = (g: Grid, f: (x: number, y: number) => number) => { const a = new Float32Array(g.nx * g.ny); for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) a[j * g.nx + i] = f(g.lon[i], g.lat[j]); return a; };

// 1. a linear field is reproduced exactly by bilinear resampling (fine 0.25° → coarse 1°)
{ const fine = grid(axis(120, 150, 0.25), axis(15, 42, 0.25)), coarse = grid(axis(120, 150, 1), axis(15, 42, 1));
  const lin = (x: number, y: number) => 2 * x - 3 * y + 7, r = resample(fine, fill(fine, lin), coarse), ref = fill(coarse, lin);
  for (let i = 0; i < r.length; i++) assert.ok(Math.abs(r[i] - ref[i]) < 1e-3, `linear at ${i}`); }
// 2. strict: a missing neighbour (land) gives NaN, never a value
{ const g = grid(axis(0, 4, 1), axis(0, 4, 1)), v = fill(g, () => 1); v[2 * 5 + 2] = NaN;
  const d = grid([1.5, 3.5], [1.5, 3.5]), r = resample(g, v, d); assert.ok(Number.isNaN(r[0])); assert.equal(r[3], 1); }
// 3. 0–360 source onto −180–180 target, across the dateline for a global grid
{ const src = grid(axis(0, 359, 1), axis(-10, 10, 1), true), dst = grid([-179.5, -0.5, 179.5, 359.5 - 360], [0]);
  const r = resample(src, fill(src, x => x), dst); assert.equal(r[0], 180.5); assert.equal(r[2], 179.5);
  // −0.5° lies between column 359 (value 359) and column 0 (value 0): the global wrap blends both halves
  assert.ok(Math.abs(r[1] - 179.5) < 1e-4 && Math.abs(r[3] - 179.5) < 1e-4, "wrap: " + r[1]);
  const regional = resample({ ...src, global: false }, fill(src, x => x), dst); assert.ok(Number.isNaN(regional[1]), "no wrap for regional grids"); }
// 4. statistics: B = A − 0.5 everywhere → bias 0.5, RMSE 0.5, MAE 0.5, r = 1
{ const g = grid(axis(0, 10, 1), axis(-60, 60, 10)), a = fill(g, (x, y) => x + y / 10), b = a.map(v => v - 0.5) as Float32Array;
  const s = diffStats(g, a, b)!; assert.ok(Math.abs(s.bias - 0.5) < 1e-5 && Math.abs(s.rmse - 0.5) < 1e-5 && Math.abs(s.mae - 0.5) < 1e-5 && Math.abs(s.r - 1) < 1e-6, JSON.stringify(s)); }
// 5. common(): coarser grid is the target and D = A − B
{ const fa: any = { ...grid(axis(0, 10, 1), axis(0, 10, 1)), bounds: [0, 0, 10, 10] }, fb: any = { ...grid(axis(0, 10, 0.5), axis(0, 10, 0.5)), bounds: [0, 0, 10, 10] };
  const c = common(fa, fill(fa, x => x), fb, fill(fb, x => x - 1)); assert.equal(c.target, "A"); assert.equal(c.D.length, 121); assert.ok(c.D.every(d => Math.abs(d - 1) < 1e-5)); }
// 6. element → sources: grouping by provider, wind needs a u/v pair, nearest-in-time file
{ const mk = (id: string, provider: string, vars: [string, string][], t: string, vectors: any[] = []): any => ({ id, provider, provider_label: provider, kind: "grid", renderable: true, completed: 1, dataset: id,
    summary: { grid: { bounds: [-180, -80, 180, 80], nx: 1440, ny: 641, dx: 0.25, dy: 0.25, global: true }, times: [t, t], steps: 1, depth_levels: 0, variables: vars.map(([name, kind]) => ({ name, kind, units: "", mapable: true })), vectors } });
  const wind = ELEMENTS.find(e => e.id === "wind")!, ds = [mk("g1", "gfs", [["u10", "wind_u"], ["v10", "wind_v"]], "2026-10-10T00:00:00Z", [{ id: "wind:u10:v10", kind: "wind", u: "u10", v: "v10" }]),
    mk("g2", "gfs", [["u10", "wind_u"], ["v10", "wind_v"]], "2026-10-15T00:00:00Z", [{ id: "wind:u10:v10", kind: "wind", u: "u10", v: "v10" }]), mk("e1", "era5", [["u10", "wind_u"]], "2026-09-08T00:00:00Z")];
  const s = sourcesFor(wind, ds); assert.deepEqual(s.map(x => x.provider), ["gfs"], "u-only ERA5 file is not a wind source");
  assert.equal(pickFile(s[0], Date.parse("2026-10-10T03:00:00Z")).ds.id, "g1"); assert.equal(pickFile(s[0], Date.parse("2026-10-14T00:00:00Z")).ds.id, "g2");
  assert.equal(scalarFor(wind, ds[0].summary.variables, ds[0].summary.vectors), "speed:u10:v10"); }
// 7. comparison guards
assert.equal(compareBlockers({ unitA: "°C", unitB: "°C", dtH: 0, maxDtH: 3, depthA: 0.5, depthB: 0.49, overlap: true }).length, 0);
assert.equal(compareBlockers({ unitA: "°C", unitB: "°C", dtH: 12, maxDtH: 3, depthA: null, depthB: null, overlap: true }).length, 1);
assert.equal(compareBlockers({ unitA: "°C", unitB: "°C", dtH: 0, maxDtH: 3, depthA: 0.5, depthB: null, overlap: false }).length, 2);
console.log("compare/elements: 7 groups passed");

// audit #10: speed specs only claim m/s when the data are in m/s
import { specFor, isMps } from "../src/viz/palettes";
{ assert.equal(specFor("current_speed", "m s-1").unit, "m/s"); assert.equal(specFor("wind_speed", "m s**-1").range?.[1], 25);
  const odd = specFor("current_speed", "cm/s"); assert.equal(odd.unit, "cm/s"); assert.equal(odd.range, undefined);  // server converts known units; a leftover cm/s is not relabelled
  assert.equal(specFor("current_u", "furlong/fortnight").unit, "furlong/fortnight"); assert.ok(isMps("M S-1") && isMps("") && !isMps("kn")); }

// P1 swipe: contour lines are split exactly at the swipe meridian, across world copies
import { clipLinesLon } from "../src/studio/compare";
{ const fc: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [
    { type: "Feature", properties: { level: 1 }, geometry: { type: "LineString", coordinates: [[100, 0], [120, 10], [140, 0]] } },
    { type: "Feature", properties: { level: 2 }, geometry: { type: "LineString", coordinates: [[150, 0], [160, 5]] } }] };
  const L = clipLinesLon(fc, 130, "left", 120), R = clipLinesLon(fc, 130, "right", 120);
  assert.equal(L.features.length, 1); assert.deepEqual((L.features[0].geometry as any).coordinates, [[100, 0], [120, 10], [130, 5]]);
  assert.equal(R.features.length, 2); assert.deepEqual((R.features[0].geometry as any).coordinates, [[130, 5], [140, 0]]);
  assert.equal(L.features[0].properties!.level, 1);
  // a line that leaves and re-enters becomes a MultiLineString
  const zig = clipLinesLon({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[0, 0], [20, 0], [0, 1]] } }] }, 10, "left", 0);
  assert.equal(zig.features[0].geometry.type, "MultiLineString");
  // data at 0–360 viewed around −170° (dateline): unwrapped next to the view centre
  const dl = clipLinesLon({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[170, 0], [190, 0]] } }] }, -175, "left", -175);
  assert.deepEqual((dl.features[0].geometry as any).coordinates, [[-190, 0], [-175, 0]]); }

// audit #9: the classic view only animates across files of one product grid (bounds, not just shape)
import { framesFor, sameGrid } from "../src/viz/model";
{ const grid = (w: number) => ({ bounds: [w, 9.5, w + 10, 19.5] as [number, number, number, number], nx: 10, ny: 10, dx: 1, dy: 1, global: false });
  assert.ok(sameGrid(grid(119.5), grid(119.7)) && !sameGrid(grid(119.5), grid(-0.5)));
  const ds = (id: string, t: string, w: number, fh = 0): any => ({ id, provider: "gfs", dataset: t, kind: "grid", renderable: true, completed: 1, request: { options: { forecast_hour: fh } },
    summary: { grid: grid(w), times: [t, t], steps: 1, depth_levels: 0, variables: [{ name: "u10", kind: "wind_u", units: "m/s", label: "", mapable: true }], vectors: [] } });
  const a = ds("a", "2031-01-01T00:00:00Z", 119.5), b = ds("b", "2031-01-01T06:00:00Z", 119.5), c = ds("c", "2031-01-01T12:00:00Z", -0.5), d = ds("d", "2031-01-01T12:00:00Z", 119.5, 6);
  const desc: any = { grid: grid(119.5), times: { t0: [a.summary.times[0]] }, depths: {}, variables: [], vectors: [] };
  const opt: any = { vars: ["u10"], axis: { time_axis: "t0" } };
  assert.deepEqual(framesFor(a, desc, opt, [a, b, c, d]).map(f => f.datasetId), ["a", "b"]); }

// P1-A: providers listed with their real task state (local first, then tasked providers, then download hints)
import { providerRows, STATE_LABEL } from "../src/studio/elements";
{ const el = ELEMENTS.find(e => e.id === "sea_temperature")!;
  const rows = providerRows(el, [{ provider: "copernicus" } as any], [{ provider: "copernicus", state: "ready" }, { provider: "hycom", state: "timeout" }, { provider: "custom", state: "error" }]);
  assert.deepEqual(rows, [{ provider: "hycom", state: "timeout" }, { provider: "custom", state: "error" }, { provider: "era5", state: null }]);
  assert.deepEqual(providerRows(el, [], null).map(r => r.provider), ["hycom", "copernicus", "era5"]);  // endpoint unavailable → hints only
  assert.equal(STATE_LABEL.timeout[1], "bad"); assert.equal(STATE_LABEL.downloading[0], "下载中"); }
