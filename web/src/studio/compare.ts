// Source-vs-source comparison on a common grid. The target grid is the coarser of the two
// (interpolating a coarse field onto a fine grid would invent detail). Values are strict
// bilinear: a target cell is used only when all four source neighbours are valid, so coastlines
// and missing data never leak into the difference.
import type { Field } from "../viz/data";

export type Grid = { nx: number; ny: number; lon: number[]; lat: number[]; dx: number; dy: number; global: boolean };

function locate(axis: number[], v: number): number {
  const n = axis.length; if (n < 2) return Math.abs(v - axis[0]) < 1e-9 ? 0 : -1;
  const asc = axis[n - 1] > axis[0], lo0 = asc ? axis[0] : axis[n - 1], hi0 = asc ? axis[n - 1] : axis[0];
  if (v < lo0 - 1e-9 || v > hi0 + 1e-9) return -1;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if ((axis[m] <= v) === asc) lo = m; else hi = m; }
  const d = axis[hi] - axis[lo]; return lo + (d ? (v - axis[lo]) / d : 0);
}
/** Longitude → fractional column, honouring 0–360 vs −180–180 conventions and global wrap. Returns -1 outside. */
function locateLon(g: Grid, lon: number): number {
  const x0 = g.lon[0], last = g.lon[g.nx - 1];
  let L = lon; while (L < x0 - 1e-9) L += 360; while (L > x0 + 360 - 1e-9) L -= 360;
  if (L <= last + 1e-9) return locate(g.lon, L);
  // between last column and first+360: only defined for global grids (wraps to column 0)
  return g.global ? g.nx - 1 + (L - last) / (x0 + 360 - last) : -1;
}

/** Strict bilinear resample of `values` (on grid `src`) at the cell centres of `dst`. */
export function resample(src: Grid, values: Float32Array, dst: Grid): Float32Array {
  const out = new Float32Array(dst.nx * dst.ny).fill(NaN);
  const gx = dst.lon.map(l => locateLon(src, l)), gy = dst.lat.map(l => locate(src.lat, l));
  for (let j = 0; j < dst.ny; j++) {
    const y = gy[j]; if (y < 0) continue;
    const j0 = Math.min(src.ny - 1, Math.floor(y)), j1 = Math.min(src.ny - 1, j0 + 1), ty = y - j0;
    for (let i = 0; i < dst.nx; i++) {
      const x = gx[i]; if (x < 0) continue;
      const i0 = Math.min(src.nx - 1, Math.floor(x)); let i1 = i0 + 1; const tx = x - i0;
      if (i1 >= src.nx) i1 = src.global ? 0 : src.nx - 1;
      const a = values[j0 * src.nx + i0], b = values[j0 * src.nx + i1], c = values[j1 * src.nx + i0], d = values[j1 * src.nx + i1];
      if (a !== a || b !== b || c !== c || d !== d) continue;
      out[j * dst.nx + i] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
  }
  return out;
}

export type DiffStats = { n: number; bias: number; mae: number; rmse: number; r: number; std: number; meanA: number; meanB: number; p95: number; weighted: boolean };
/** Area-weighted (cos φ) statistics of A−B over cells valid in both, optionally inside bbox [w,s,e,n]. */
export function diffStats(g: Grid, a: Float32Array, b: Float32Array, bbox?: [number, number, number, number] | null): DiffStats | null {
  let W = 0, sa = 0, sb = 0, sd = 0, sad = 0, sdd = 0, saa = 0, sbb = 0, sab = 0, n = 0; const abs: number[] = [];
  const inLon = (l: number) => { if (!bbox) return true; const [w, , e] = bbox; if (e - w >= 360) return true; const L = ((l - w) % 360 + 360) % 360; return L <= ((e - w) % 360 + 360) % 360; };
  for (let j = 0; j < g.ny; j++) {
    const lat = g.lat[j]; if (bbox && (lat < bbox[1] || lat > bbox[3])) continue; const w = Math.cos(lat * Math.PI / 180); if (w <= 0) continue;
    for (let i = 0; i < g.nx; i++) {
      const k = j * g.nx + i, x = a[k], y = b[k]; if (x !== x || y !== y || !inLon(g.lon[i])) continue;
      const d = x - y; n++; W += w; sa += w * x; sb += w * y; sd += w * d; sad += w * Math.abs(d); sdd += w * d * d; saa += w * x * x; sbb += w * y * y; sab += w * x * y;
      if (abs.length < 200000) abs.push(Math.abs(d));
    }
  }
  if (!n || !W) return null;
  const ma = sa / W, mb = sb / W, bias = sd / W, va = saa / W - ma * ma, vb = sbb / W - mb * mb, cov = sab / W - ma * mb;
  abs.sort((p, q) => p - q);
  return { n, bias, mae: sad / W, rmse: Math.sqrt(sdd / W), r: va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : NaN, std: Math.sqrt(Math.max(0, sdd / W - bias * bias)), meanA: ma, meanB: mb, p95: abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.95))], weighted: true };
}

export const gridOf = (f: Field): Grid => ({ nx: f.nx, ny: f.ny, lon: f.lon, lat: f.lat, dx: f.dx, dy: f.dy, global: f.global || f.lon[f.nx - 1] - f.lon[0] + f.dx >= 359.5 });

/** Put two displayed fields on one grid: the coarser one is the target. Returns A, B and A−B on that grid. */
export function common(fa: Field, va: Float32Array, fb: Field, vb: Float32Array) {
  const ga = gridOf(fa), gb = gridOf(fb);
  const coarseA = Math.abs(ga.dx) * Math.abs(ga.dy) >= Math.abs(gb.dx) * Math.abs(gb.dy);
  const g = coarseA ? ga : gb, field = coarseA ? fa : fb;
  const A = coarseA ? va : resample(ga, va, g), B = coarseA ? resample(gb, vb, g) : vb;
  const D = new Float32Array(A.length); for (let i = 0; i < A.length; i++) D[i] = A[i] - B[i];
  return { grid: g, field, A, B, D, target: coarseA ? "A" as const : "B" as const };
}

/** Keep the parts of line features west (side "left") or east ("right") of the meridian `cut` (Mercator swipe:
 *  a vertical screen line is a meridian, the map has no rotation). Segments are split exactly at the meridian;
 *  longitudes are unwrapped around the view centre `ref` so the result is continuous across world copies. */
export function clipLinesLon(fc: GeoJSON.FeatureCollection, cut: number, side: "left" | "right", ref: number): GeoJSON.FeatureCollection {
  const keep = (x: number) => (side === "left" ? x <= cut : x >= cut);
  const unwrap = (x: number) => x + Math.round((ref - x) / 360) * 360;
  const out: GeoJSON.Feature[] = [];
  const lines = (g: GeoJSON.Geometry): number[][][] => (g.type === "LineString" ? [g.coordinates as number[][]] : g.type === "MultiLineString" ? (g.coordinates as number[][][]) : []);
  for (const f of fc.features) {
    const parts: number[][][] = [];
    for (const line0 of lines(f.geometry)) {
      if (line0.length < 2) continue;
      const line = [[unwrap(line0[0][0]), line0[0][1]]];
      for (let i = 1; i < line0.length; i++) { let x = line0[i][0]; const px = line[i - 1][0]; x += Math.round((px - x) / 360) * 360; line.push([x, line0[i][1]]); }
      let cur: number[][] = keep(line[0][0]) ? [line[0]] : [];
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1], b = line[i], ka = keep(a[0]), kb = keep(b[0]);
        if (ka !== kb) { const t = (cut - a[0]) / (b[0] - a[0]), m = [cut, a[1] + (b[1] - a[1]) * t];
          if (ka) { cur.push(m); if (cur.length > 1) parts.push(cur); cur = []; } else cur = [m]; }
        if (kb) cur.push(b);
      }
      if (cur.length > 1) parts.push(cur);
    }
    if (parts.length) out.push({ ...f, geometry: parts.length === 1 ? { type: "LineString", coordinates: parts[0] } : { type: "MultiLineString", coordinates: parts } });
  }
  return { type: "FeatureCollection", features: out };
}
