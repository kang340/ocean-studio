import { t as i18nText } from "../i18n";
// Pure helpers that turn a dataset description into selectable layers and timeline frames.
import type { Describe, VizDataset, VizVariable, VizVector } from "./data";
import { specFor, type Spec } from "./palettes";

export type ScalarOpt = { id: string; label: string; short: string; vars: string[]; kind: string; units: string; axis: VizVariable; spec: Spec; derived: boolean };
export type Frame = { datasetId: string; time: string | null };

const SPEED_KIND: Record<string, string> = { wind: "wind_speed", current: "current_speed", ice_drift: "ice_speed", stress: "stress_speed" };

export function scalarOptions(d: Describe): ScalarOpt[] {
  const out: ScalarOpt[] = [];
  for (const vec of d.vectors) if (vec.u && vec.v) {
    const u = d.variables.find(v => v.name === vec.u)!, kind = SPEED_KIND[vec.kind] || "speed", spec = specFor(kind, u.units);
    out.push({ id: `speed:${vec.u}:${vec.v}`, label: spec.label || i18nText("{0}速度", vec.label), short: `|${vec.u}, ${vec.v}|`, vars: [vec.u, vec.v], kind, units: u.units, axis: u, spec: { ...spec, unit: spec.unit || u.units }, derived: true });
  }
  for (const v of d.variables) if (v.mapable) {
    const spec = specFor(v.kind, v.units);
    out.push({ id: v.name, label: spec.label || v.label, short: v.name, vars: [v.name], kind: v.kind, units: v.units, axis: v, spec, derived: false });
  }
  return out;
}

const PREFERRED = ["wind_speed", "current_speed", "wave_height", "sea_temperature", "air_temperature", "ssh", "pressure", "salinity", "precipitation"];
export function defaultScalar(opts: ScalarOpt[]) {
  for (const k of PREFERRED) { const o = opts.find(o => o.kind === k); if (o) return o.id; }
  return opts[0]?.id ?? null;
}

export const vectorVars = (v: VizVector) => (v.u && v.v ? [v.u, v.v] : [v.direction!, ...(v.magnitude ? [v.magnitude] : [])]);
export const flowKind = (v: VizVector) => (v.kind === "wave" ? "wave" : v.kind);

export function timesFor(d: Describe, v: VizVariable | undefined) { return (v?.time_axis && d.times[v.time_axis]) || []; }
export function depthsFor(d: Describe, v: VizVariable | undefined) { return (v?.depth_axis && d.depths[v.depth_axis]) || null; }

/** One product grid: same shape, spacing, global flag and bounds within half a cell (mirrors core.gridview.same_grid). */
export function sameGrid(a: Describe["grid"] | null | undefined, b: Describe["grid"] | null | undefined) {
  if (!a || !b || a.nx !== b.nx || a.ny !== b.ny || Math.abs(a.dx - b.dx) > 1e-6 || Math.abs((a.dy || 0) - (b.dy || 0)) > 1e-6 || !!a.global !== !!b.global) return false;
  const tol = Math.max(Math.abs(a.dx), Math.abs(a.dy || a.dx)) / 2 + 1e-9;
  return a.bounds.every((x, i) => Math.abs(x - b.bounds[i]) <= tol);
}
const fhOf = (d: VizDataset) => { const v = d.request?.options?.forecast_hour; return typeof v === "number" ? v : null; };

/** Frames along the file's own time axis, or — for single-step files — across sibling downloads of the same product grid. */
export function framesFor(primary: VizDataset, d: Describe, opt: ScalarOpt | undefined, all: VizDataset[]): Frame[] {
  const own = timesFor(d, opt?.axis);
  if (own.length > 1 || !opt) return own.length ? own.map(t => ({ datasetId: primary.id, time: t })) : [{ datasetId: primary.id, time: null }];
  const g = d.grid, byTime = new Map<string, VizDataset>();
  for (const s of all) {
    const sum = s.summary;
    if (s.kind !== "grid" || !s.renderable || !sum || s.provider !== primary.provider || sum.steps > 1 || !sum.times.length) continue;
    if (!sameGrid(sum.grid, g) || sum.depth_levels !== primary.summary?.depth_levels) continue; // equal shape elsewhere is another region
    if (fhOf(s) !== fhOf(primary)) continue; // forecast lead times are not one time series (same rule as /api/studio frames)
    if (!opt.vars.every(n => sum.variables.some(v => v.name === n && v.mapable))) continue;
    const t = sum.times[0], prev = byTime.get(t);
    if (!prev || s.id === primary.id || (prev.id !== primary.id && s.completed > prev.completed)) byTime.set(t, s);
  }
  const sorted = [...byTime.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([t, s]) => ({ datasetId: s.id, time: t }));
  // Only a contiguous run around the primary file forms a series (gaps over 48 h are separate forecasts, not an animation).
  const at = sorted.findIndex(f => f.datasetId === primary.id); if (at < 0) return [{ datasetId: primary.id, time: own[0] ?? null }];
  const gap = (a: Frame, b: Frame) => Math.abs(+new Date(b.time!) - +new Date(a.time!)) > 48 * 3600e3;
  let lo = at, hi = at; while (lo > 0 && !gap(sorted[lo - 1], sorted[lo])) lo--; while (hi < sorted.length - 1 && !gap(sorted[hi], sorted[hi + 1])) hi++;
  return sorted.slice(lo, hi + 1);
}

export function datasetTitle(d: VizDataset) {
  const name = d.dataset || d.path?.split(/[\\/]/).pop() || d.id.slice(0, 8);
  return name.length > 46 ? "…" + name.slice(-45) : name;
}

export function fmtTime(iso: string | null | undefined, withYear = true) {
  if (!iso) return "—";
  const d = new Date(iso); if (isNaN(+d)) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${withYear ? d.getUTCFullYear() + "-" : ""}${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

export function regionText(r?: { west: number; east: number; south: number; north: number } | null) {
  if (!r) return i18nText("全球");
  const lon = (v: number) => `${Math.abs(v).toFixed(2)}°${v < 0 ? "W" : "E"}`, lat = (v: number) => `${Math.abs(v).toFixed(2)}°${v < 0 ? "S" : "N"}`;
  return `${lon(r.west)} – ${lon(r.east)}，${lat(r.south)} – ${lat(r.north)}`;
}

/** Link back to the downloader's discovery page with the context pre-filled. */
