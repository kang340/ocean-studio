// CPU rasteriser for scalar fields onto Web-Mercator rows, plus marching-squares isolines.
import type { Field } from "./data";

export const MERC_LAT = 85.0511;
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (Math.max(-MERC_LAT, Math.min(MERC_LAT, lat)) * Math.PI) / 360));
const invMerc = (y: number) => (Math.atan(Math.sinh(y)) * 180) / Math.PI;

/** Values of array k (or the |u,v| magnitude) converted to display units; cached on the field object. */
export function displayArray(f: Field, k: number | [number, number], convert?: (v: number) => number, unit = ""): Float32Array {
  const cacheKey = `__disp_${Array.isArray(k) ? k.join("_") : k}_${convert ? unit : "raw"}`;
  const anyF = f as any; if (anyF[cacheKey]) return anyF[cacheKey];
  let out: Float32Array;
  if (Array.isArray(k)) {
    const a = f.arrays[k[0]], b = f.arrays[k[1]]; out = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) out[i] = Math.hypot(a[i], b[i]);
  } else if (convert) { const a = f.arrays[k]; out = new Float32Array(a.length); for (let i = 0; i < a.length; i++) out[i] = convert(a[i]); }
  else out = f.arrays[k];
  anyF[cacheKey] = out; return out;
}

/** 2nd–98th percentile; with `view` = {field, bbox} only cells inside the lon/lat box are used. */
export function robustRange(a: Float32Array, symmetric = false, view?: { f: Field; bbox: [number, number, number, number] }): [number, number] {
  const s: number[] = [];
  if (view) {
    const { f, bbox: [w, so, e, n] } = view, wrap = (x: number) => ((x - w) % 360 + 360) % 360, span = e - w >= 360 ? 360 : wrap(e);
    const step = Math.max(1, Math.round(Math.sqrt(f.nx * f.ny / 60000)));
    for (let j = 0; j < f.ny; j += step) { if (f.lat[j] < so || f.lat[j] > n) continue; for (let i = 0; i < f.nx; i += step) if (wrap(f.lon[i]) <= span) { const v = a[j * f.nx + i]; if (v === v) s.push(v); } }
  }
  if (!s.length) { const step = Math.max(1, Math.floor(a.length / 40000)); for (let i = 0; i < a.length; i += step) { const v = a[i]; if (v === v) s.push(v); } }
  if (!s.length) return [0, 1];
  s.sort((x, y) => x - y);
  let lo = s[Math.floor(s.length * 0.02)], hi = s[Math.min(s.length - 1, Math.floor(s.length * 0.98))];
  if (symmetric) { const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1; lo = -m; hi = m; }
  if (hi <= lo) hi = lo + (Math.abs(lo) || 1) * 0.01;
  return [lo, hi];
}

export type Raster = { canvas: HTMLCanvasElement; coordinates: [[number, number], [number, number], [number, number], [number, number]] };

/** Draws `values` (ny×nx, south→north) with bilinear interpolation and anti-aliased missing-data edges. */
export function rasterise(canvas: HTMLCanvasElement, f: Field, values: Float32Array, range: [number, number], table: Uint8ClampedArray, opacity = 1): Raster {
  const [w0, s0, e0, n0] = f.bounds, south = Math.max(-MERC_LAT, s0), north = Math.min(MERC_LAT, n0);
  const yS = mercY(south), yN = mercY(north), spanX = (e0 - w0) * Math.PI / 180;
  const W = Math.round(Math.max(256, Math.min(2304, f.nx * 2))), H = Math.round(Math.max(128, Math.min(2304, W * (yN - yS) / spanX)));
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const ctx = canvas.getContext("2d", { willReadFrequently: false })!;
  const img = ctx.createImageData(W, H), px = img.data, { nx, ny, lon, lat } = f;
  // Per-column / per-row fractional grid indices (lon/lat axes may be slightly irregular).
  const gx = new Float32Array(W), gy = new Float32Array(H);
  const locate = (axis: number[], n: number, v: number) => {
    if (v <= axis[0]) return 0; if (v >= axis[n - 1]) return n - 1;
    let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (axis[m] <= v) lo = m; else hi = m; }
    return lo + (v - axis[lo]) / (axis[hi] - axis[lo]);
  };
  for (let i = 0; i < W; i++) gx[i] = locate(lon, nx, w0 + ((i + 0.5) / W) * (e0 - w0));
  for (let j = 0; j < H; j++) gy[j] = locate(lat, ny, invMerc(yN - ((j + 0.5) / H) * (yN - yS)));
  const lo = range[0], scale = 255 / (range[1] - range[0] || 1), alpha = Math.round(255 * opacity);
  for (let j = 0; j < H; j++) {
    const y = gy[j], j0 = Math.min(ny - 2, Math.max(0, Math.floor(y))), ty = ny > 1 ? y - j0 : 0, r0 = j0 * nx, r1 = ny > 1 ? r0 + nx : r0;
    let o = j * W * 4;
    for (let i = 0; i < W; i++, o += 4) {
      const x = gx[i], i0 = Math.min(nx - 2, Math.max(0, Math.floor(x))), tx = nx > 1 ? x - i0 : 0, i1 = nx > 1 ? i0 + 1 : i0;
      const a = values[r0 + i0], b = values[r0 + i1], c = values[r1 + i0], d = values[r1 + i1];
      const wa = (1 - tx) * (1 - ty), wb = tx * (1 - ty), wc = (1 - tx) * ty, wd = tx * ty;
      let v: number, cover = 1;
      if (a === a && b === b && c === c && d === d) v = a * wa + b * wb + c * wc + d * wd;
      else {
        let sum = 0; cover = 0;
        if (a === a) { sum += a * wa; cover += wa } if (b === b) { sum += b * wb; cover += wb }
        if (c === c) { sum += c * wc; cover += wc } if (d === d) { sum += d * wd; cover += wd }
        if (cover < 0.35) { px[o + 3] = 0; continue; }
        v = sum / cover;
      }
      let t = (v - lo) * scale; t = t < 0 ? 0 : t > 255 ? 255 : t; const q = (t | 0) * 4;
      const edge = cover >= 0.65 ? 1 : (cover - 0.35) / 0.3; // smooth coastline instead of a pixel staircase
      px[o] = table[q]; px[o + 1] = table[q + 1]; px[o + 2] = table[q + 2]; px[o + 3] = (table[q + 3] * alpha * edge) / 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, coordinates: [[w0, north], [e0, north], [e0, south], [w0, south]] };
}

/** Isolines as GeoJSON LineStrings (segments joined into polylines). */
export function isolines(f: Field, values: Float32Array, levels: number[], maxCols = 480) {
  const step = Math.max(1, Math.ceil(f.nx / maxCols)), nx = Math.ceil(f.nx / step), ny = Math.ceil(f.ny / step);
  const g = new Float32Array(nx * ny), X = new Float64Array(nx), Y = new Float64Array(ny);
  for (let j = 0; j < ny; j++) { Y[j] = f.lat[Math.min(f.ny - 1, j * step)]; for (let i = 0; i < nx; i++) g[j * nx + i] = values[Math.min(f.ny - 1, j * step) * f.nx + Math.min(f.nx - 1, i * step)]; }
  for (let i = 0; i < nx; i++) X[i] = f.lon[Math.min(f.nx - 1, i * step)];
  const features: any[] = [];
  for (const level of levels) {
    // Edge ids: horizontal edge (i,j)-(i+1,j) = 2*(j*nx+i); vertical edge (i,j)-(i,j+1) = 2*(j*nx+i)+1
    const point = (e: number): [number, number] => {
      const base = e >> 1, i = base % nx, j = (base / nx) | 0, horizontal = (e & 1) === 0;
      const va = g[j * nx + i], vb = horizontal ? g[j * nx + i + 1] : g[(j + 1) * nx + i], t = (level - va) / (vb - va || 1e-12);
      return horizontal ? [X[i] + (X[i + 1] - X[i]) * t, Y[j]] : [X[i], Y[j] + (Y[j + 1] - Y[j]) * t];
    };
    const next = new Map<number, number[]>(); const segs: [number, number][] = [];
    const add = (a: number, b: number) => { segs.push([a, b]); const k = segs.length - 1; (next.get(a) || next.set(a, []).get(a)!).push(k); (next.get(b) || next.set(b, []).get(b)!).push(k); };
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = g[j * nx + i], b = g[j * nx + i + 1], c = g[(j + 1) * nx + i + 1], d = g[(j + 1) * nx + i];
      if (!(a === a && b === b && c === c && d === d)) continue;
      const code = (a >= level ? 1 : 0) | (b >= level ? 2 : 0) | (c >= level ? 4 : 0) | (d >= level ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const S = 2 * (j * nx + i), E = 2 * (j * nx + i + 1) + 1, N = 2 * ((j + 1) * nx + i), Wd = 2 * (j * nx + i) + 1;
      switch (code) {
        case 1: case 14: add(Wd, S); break; case 2: case 13: add(S, E); break; case 3: case 12: add(Wd, E); break;
        case 4: case 11: add(E, N); break; case 6: case 9: add(S, N); break; case 7: case 8: add(Wd, N); break;
        case 5: case 10: { const center = (a + b + c + d) / 4 >= level; if ((code === 5) === center) { add(Wd, N); add(S, E); } else { add(Wd, S); add(E, N); } break; }
      }
    }
    const used = new Uint8Array(segs.length);
    for (let s = 0; s < segs.length; s++) {
      if (used[s]) continue; used[s] = 1;
      const line = [segs[s][0], segs[s][1]];
      for (const forward of [true, false]) {
        for (; ;) {
          const end = forward ? line[line.length - 1] : line[0], cand = (next.get(end) || []).find(k => !used[k]);
          if (cand === undefined) break; used[cand] = 1;
          const other = segs[cand][0] === end ? segs[cand][1] : segs[cand][0];
          forward ? line.push(other) : line.unshift(other);
        }
      }
      if (line.length >= 3) features.push({ type: "Feature", properties: { level }, geometry: { type: "LineString", coordinates: line.map(point) } });
    }
  }
  return { type: "FeatureCollection", features } as GeoJSON.FeatureCollection;
}
