// Visualisation API client: binary field slices with an LRU cache and in-flight de-duplication.
import { api } from "../api";

export type VarStats = { min: number | null; max: number | null; mean: number | null; p02: number | null; p98: number | null; valid: number };
export type FieldHeader = {
  variables: { name: string; units: string; kind: string; label: string; stats: VarStats }[];
  nx: number; ny: number; lon: number[]; lat: number[]; bounds: [number, number, number, number];
  dx: number; dy: number; factor: number; source_shape: [number, number]; global: boolean;
  time: string | null; time_index: number | null; depth: number | null; depth_index: number | null;
};
export type Field = FieldHeader & { arrays: Float32Array[]; key: string; bytes: number };

export type VizVariable = {
  name: string; label: string; units: string; kind: string; standard_name: string; canonical: string | null;
  /** set by the server for velocities: original unit when converted to m/s, or kept when unrecognised */
  source_units?: string | null; scale?: number; units_known?: boolean;
  dims: string[]; shape: number[]; mapable: boolean; reason: string | null;
  time_axis: string | null; depth_axis: string | null;
};
export type VizVector = { id: string; kind: string; label: string; u?: string; v?: string; direction?: string; magnitude?: string | null; convention?: string; units: string };
export type Describe = {
  grid: { bounds: [number, number, number, number]; nx: number; ny: number; dx: number; dy: number; global: boolean } | null;
  variables: VizVariable[]; vectors: VizVector[];
  times: Record<string, string[]>; depths: Record<string, { values: number[]; units: string; positive: string }>;
  dimensions: Record<string, number>; attrs: Record<string, string>;
};
export type VizDataset = {
  id: string; title?: string | null; provider: string; provider_label: string; dataset: string; format: string; path: string; bytes: number; completed: number;
  kind: "grid" | "observations" | "imagery" | "table"; renderable: boolean; reason: string | null; file_format?: string;
  request: { region?: { west: number; east: number; south: number; north: number } | null; time_start?: string | null; time_end?: string | null; depth_min?: number | null; depth_max?: number | null; variables?: string[]; options?: any };
  summary?: { grid: Describe["grid"]; times: string[]; steps: number; depth_levels: number; variables: { name: string; kind: string; units: string; label: string; mapable: boolean }[]; vectors: VizVector[] };
  describe?: Describe;
  observations?: { records: number; stations: number; variable: string; variables: string[]; times: string[]; bounds: number[] | null; vertical?: string | null; capped: boolean };
};

const cache = new Map<string, Field>(); let cacheBytes = 0; const MAX_BYTES = 220 * 1024 * 1024;
const inflight = new Map<string, Promise<Field>>();

export type FieldQuery = { id: string; vars: string[]; time?: string | null; depth?: number | null; bbox?: [number, number, number, number] | null; maxCells?: number };
export function fieldKey(q: FieldQuery) {
  return [q.id, q.vars.join(","), q.time ?? "", q.depth ?? "", q.bbox ? q.bbox.map(v => v.toFixed(2)).join(",") : "", q.maxCells ?? ""].join("|");
}

export function peekField(q: FieldQuery) { return cache.get(fieldKey(q)) || null; }

export async function loadField(q: FieldQuery, signal?: AbortSignal): Promise<Field> {
  const key = fieldKey(q), hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
  const pending = inflight.get(key); if (pending) return pending;
  const params = new URLSearchParams({ vars: q.vars.join(",") });
  if (q.time) params.set("time", q.time);
  if (q.depth != null) params.set("depth", String(q.depth));
  if (q.bbox) params.set("bbox", q.bbox.map(v => v.toFixed(3)).join(","));
  if (q.maxCells) params.set("max_cells", String(Math.round(q.maxCells)));
  const job = (async () => {
    const res = await fetch(`/api/viz/datasets/${encodeURIComponent(q.id)}/field?${params}`, { signal });
    if (!res.ok) { let msg = `读取失败 (${res.status})`; try { msg = (await res.json()).detail || msg } catch { } throw new Error(msg); }
    const buf = await res.arrayBuffer(), n = new DataView(buf).getUint32(0, true);
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, n))) as FieldHeader;
    const cells = header.nx * header.ny, arrays: Float32Array[] = [];
    for (let k = 0; k < header.variables.length; k++) arrays.push(new Float32Array(buf, 4 + n + k * cells * 4, cells));
    const f: Field = { ...header, arrays, key, bytes: buf.byteLength };
    cache.set(key, f); cacheBytes += f.bytes;
    for (const [k, v] of cache) { if (cacheBytes <= MAX_BYTES || cache.size <= 2) break; cache.delete(k); cacheBytes -= v.bytes; }
    return f;
  })();
  inflight.set(key, job);
  try { return await job; } finally { inflight.delete(key); }
}

export const listDatasets = () => api("/viz/datasets") as Promise<VizDataset[]>;
export const getDataset = (id: string) => api(`/viz/datasets/${encodeURIComponent(id)}`) as Promise<VizDataset>;
export function pointQuery(id: string, lon: number, lat: number, o: { time?: string | null; depth?: number | null; series?: boolean; profile?: boolean; vars?: string[] }) {
  const p = new URLSearchParams({ lon: lon.toFixed(4), lat: lat.toFixed(4) });
  if (o.time) p.set("time", o.time); if (o.depth != null) p.set("depth", String(o.depth));
  if (o.series) p.set("series", "true"); if (o.profile) p.set("profile", "true"); if (o.vars?.length) p.set("vars", o.vars.join(","));
  return api(`/viz/datasets/${encodeURIComponent(id)}/point?${p}`);
}
export function regionQuery(id: string, vars: string[], bbox: number[], o: { time?: string | null; depth?: number | null; series?: boolean }) {
  const p = new URLSearchParams({ vars: vars.join(","), bbox: bbox.map(v => v.toFixed(3)).join(",") });
  if (o.time) p.set("time", o.time); if (o.depth != null) p.set("depth", String(o.depth)); if (o.series) p.set("series", "true");
  return api(`/viz/datasets/${encodeURIComponent(id)}/region?${p}`);
}
export const observationQuery = (id: string, variable?: string) => api(`/viz/datasets/${encodeURIComponent(id)}/observations${variable ? "?variable=" + encodeURIComponent(variable) : ""}`);

/** Bilinear sample of array k at lon/lat; NaN outside or where any neighbour is missing falls back to nearest valid. */
export function sampler(f: Field) {
  const { lon, lat, nx, ny } = f, x0 = lon[0], y0 = lat[0];
  const regular = nx > 1 && Math.abs((lon[nx - 1] - x0) / (nx - 1) - f.dx) < f.dx * 0.02;
  const fx = (x: number) => {
    let L = x; const span = lon[nx - 1] - x0;
    if (L < x0 - f.dx / 2) L += 360 * Math.ceil((x0 - f.dx / 2 - L) / 360);
    if (L > lon[nx - 1] + f.dx / 2) L -= 360 * Math.ceil((L - lon[nx - 1] - f.dx / 2) / 360);
    if (L < x0 - f.dx / 2 || L > x0 + span + f.dx / 2) return -1;
    if (regular) return Math.max(0, Math.min(nx - 1, (L - x0) / f.dx));
    let lo = 0, hi = nx - 1; if (L <= lon[0]) return 0; if (L >= lon[hi]) return hi;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (lon[m] <= L) lo = m; else hi = m; }
    return lo + (L - lon[lo]) / (lon[hi] - lon[lo]);
  };
  const fy = (y: number) => {
    if (y < lat[0] - f.dy / 2 || y > lat[ny - 1] + f.dy / 2) return -1;
    let lo = 0, hi = ny - 1; if (y <= lat[0]) return 0; if (y >= lat[hi]) return hi;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (lat[m] <= y) lo = m; else hi = m; }
    return lo + (y - lat[lo]) / (lat[hi] - lat[lo]);
  };
  return { fx, fy, at(k: number, gx: number, gy: number) {
    if (gx < 0 || gy < 0) return NaN;
    const a = f.arrays[k], i = Math.min(nx - 2, Math.floor(gx)), j = Math.min(ny - 2, Math.floor(gy));
    if (nx < 2 || ny < 2) return a[0];
    const tx = gx - i, ty = gy - j, r = j * nx;
    const v00 = a[r + i], v10 = a[r + i + 1], v01 = a[r + nx + i], v11 = a[r + nx + i + 1];
    if (v00 === v00 && v10 === v10 && v01 === v01 && v11 === v11)
      return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
    const near = a[(ty < .5 ? r : r + nx) + (tx < .5 ? i : i + 1)];
    return near;
  } };
}
