import { t as i18nText } from "../i18n";
// Element-first browsing: physical elements → data sources (providers) → the local file nearest in time.
// Everything here is derived from the downloaded catalogue (/api/viz/datasets); nothing is invented.
// Adding a provider = adding its id to `providers` of the elements it can serve (download hint only);
// what is actually shown always comes from the variable kinds that gridview detected in local files.
import type { VizDataset } from "../viz/data";

export type ElementId = "sea_temperature" | "salinity" | "current" | "waves" | "wind" | "pressure" | "precipitation" | "sea_ice" | "ssh" | "air_temperature";
export type ElementDef = {
  id: ElementId; label: string; short: string; ocean: boolean;
  /** variable kinds that carry this element (first = preferred colour field) */
  kinds: string[];
  /** for vector elements the vector kind (u/v pair) used for particles and |speed| */
  vector?: "wind" | "current";
  /** public sources the downloader can fetch for this element (for "暂无本地数据" + download links) */
  providers: string[];
};

export const ELEMENTS: ElementDef[] = [
  { id: "sea_temperature", label: i18nText("海温"), short: "SST", ocean: true, kinds: ["sea_temperature"], providers: ["hycom", "copernicus", "era5"] },
  { id: "salinity", label: i18nText("盐度"), short: "SAL", ocean: true, kinds: ["salinity"], providers: ["hycom", "copernicus"] },
  { id: "current", label: i18nText("海流"), short: "CUR", ocean: true, kinds: ["current_speed"], vector: "current", providers: ["hycom", "copernicus"] },
  { id: "waves", label: i18nText("海浪"), short: "WAV", ocean: true, kinds: ["wave_height", "wave_period"], providers: ["wavewatch", "copernicus", "era5"] },
  { id: "wind", label: i18nText("风场"), short: "WND", ocean: false, kinds: ["wind_speed"], vector: "wind", providers: ["gfs", "era5"] },
  { id: "pressure", label: i18nText("气压"), short: "MSL", ocean: false, kinds: ["pressure"], providers: ["gfs", "era5"] },
  { id: "air_temperature", label: i18nText("气温"), short: "T2M", ocean: false, kinds: ["air_temperature"], providers: ["gfs", "era5"] },
  { id: "precipitation", label: i18nText("降水"), short: "PCP", ocean: false, kinds: ["precipitation"], providers: ["gfs", "era5"] },
  { id: "sea_ice", label: i18nText("海冰"), short: "ICE", ocean: true, kinds: ["sea_ice"], providers: ["copernicus", "era5"] },
  { id: "ssh", label: i18nText("海面高度"), short: "SSH", ocean: true, kinds: ["ssh"], providers: ["hycom", "copernicus"] },
];
export const elementById = (id: string | null | undefined) => ELEMENTS.find(e => e.id === id) || null;

export const PROVIDER_LABEL: Record<string, string> = { hycom: "HYCOM", copernicus: "CMEMS", gfs: "GFS", era5: "ERA5", wavewatch: "WAVEWATCH III" };
/** Official public access pages of each provider (where users can obtain more files for the catalogue). */
export const PROVIDER_URL: Record<string, string> = { hycom: "https://www.hycom.org/dataserver", copernicus: "https://data.marine.copernicus.eu/products",
  gfs: "https://nomads.ncep.noaa.gov/", era5: "https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels", wavewatch: "https://polar.ncep.noaa.gov/waves/" };

type SumVar = { name: string; kind: string; units: string; mapable: boolean };
const VEC_KIND: Record<string, string> = { wind: "wind", current: "current" };

/** Does this dataset carry the element? Returns the scalar id (as built by viz/model.scalarOptions) to colour with, or null. */
export function scalarFor(el: ElementDef, vars: SumVar[], vectors: { id: string; kind: string; u?: string; v?: string }[]): string | null {
  if (el.vector) {
    const vec = vectors.find(v => v.kind === VEC_KIND[el.vector!] && v.u && v.v);
    if (vec) return `speed:${vec.u}:${vec.v}`;
  }
  for (const k of el.kinds) { const v = vars.find(x => x.kind === k && x.mapable); if (v) return v.name; }
  return null;
}
/** u/v vector for particles (wind, current). Waves use the separate direction-based wave particle layer. */
export const vectorFor = (el: ElementDef, vectors: { id: string; kind: string; u?: string; direction?: string }[]) =>
  el.vector ? vectors.find(v => v.kind === VEC_KIND[el.vector!] && v.u)?.id ?? null : null;

/** Lon/lat boxes overlap, allowing for 0–360 vs −180–180 longitude conventions. */
export function boxesOverlap(a: number[], b: number[]) {
  if (a[1] > b[3] || b[1] > a[3]) return false;
  if (a[2] - a[0] >= 359 || b[2] - b[0] >= 359) return true;
  for (const s of [-360, 0, 360]) if (a[0] + s <= b[2] && b[0] <= a[2] + s) return true;
  return false;
}

export type SourceFile = { ds: VizDataset; scalar: string; t0: number; t1: number };
export type Source = {
  provider: string; label: string; files: SourceFile[];
  /** coverage of all local files of this provider for the element */
  t0: number; t1: number; bounds: [number, number, number, number] | null; dx: number | null; depthLevels: number; steps: number; updated: number;
  /** grid differs between files (e.g. regional vs global downloads) */
  mixedGrids: boolean;
};
const tms = (s?: string | null) => (s ? Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z") : NaN);

/** All local sources for an element, grouped by provider (the "data source" users switch between). */
export function sourcesFor(el: ElementDef, datasets: VizDataset[]): Source[] {
  const by = new Map<string, SourceFile[]>();
  for (const d of datasets) {
    if (d.kind !== "grid" || !d.renderable || !d.summary) continue;
    const sc = scalarFor(el, d.summary.variables, d.summary.vectors || []); if (!sc) continue;
    const ts = d.summary.times.map(tms).filter(Number.isFinite);
    const f: SourceFile = { ds: d, scalar: sc, t0: ts.length ? Math.min(...ts) : NaN, t1: ts.length ? Math.max(...ts) : NaN };
    (by.get(d.provider) || by.set(d.provider, []).get(d.provider)!).push(f);
  }
  const out: Source[] = [];
  for (const [provider, files] of by) {
    files.sort((a, b) => (b.t1 || 0) - (a.t1 || 0) || b.ds.completed - a.ds.completed);
    const grids = files.map(f => f.ds.summary!.grid).filter(Boolean) as NonNullable<VizDataset["summary"]>["grid"][];
    let bounds: Source["bounds"] = null;
    for (const g of grids) { const b = g!.bounds; bounds = bounds ? [Math.min(bounds[0], b[0]), Math.min(bounds[1], b[1]), Math.max(bounds[2], b[2]), Math.max(bounds[3], b[3])] : [...b] as any; }
    const t0s = files.map(f => f.t0).filter(Number.isFinite), t1s = files.map(f => f.t1).filter(Number.isFinite);
    out.push({ provider, label: PROVIDER_LABEL[provider] || files[0].ds.provider_label, files,
      t0: t0s.length ? Math.min(...t0s) : NaN, t1: t1s.length ? Math.max(...t1s) : NaN, bounds,
      dx: grids.length ? Math.min(...grids.map(g => g!.dx)) : null, depthLevels: Math.max(0, ...files.map(f => f.ds.summary!.depth_levels || 0)),
      steps: files.reduce((n, f) => n + (f.ds.summary!.steps || 0), 0), updated: Math.max(...files.map(f => f.ds.completed || 0)),
      mixedGrids: new Set(grids.map(g => `${g!.nx}x${g!.ny}@${g!.dx}`)).size > 1 });
  }
  const rank = (p: string) => { const i = el.providers.indexOf(p); return i < 0 ? 99 : i; };
  return out.sort((a, b) => rank(a.provider) - rank(b.provider) || b.updated - a.updated);
}

/** The file of a source to show at time `t`: one that covers t, else the nearest in time; ties → regional finer grid, then newest. */
export function pickFile(src: Source, t: number, prefer?: [number, number, number, number] | null): SourceFile {
  // no time chosen yet → the newest file (largest end time) comes first
  const dist = (f: SourceFile) => (!Number.isFinite(t) ? (Number.isFinite(f.t1) ? -f.t1 : 0) : !Number.isFinite(f.t0) ? 0 : t < f.t0 ? f.t0 - t : t > f.t1 ? t - f.t1 : 0);
  const overlap = (f: SourceFile) => { const b = f.ds.summary?.grid?.bounds; if (!b || !prefer) return 0; const w = Math.max(0, Math.min(b[2], prefer[2]) - Math.max(b[0], prefer[0])), h = Math.max(0, Math.min(b[3], prefer[3]) - Math.max(b[1], prefer[1])); return w * h; };
  return src.files.slice().sort((a, b) => dist(a) - dist(b) || overlap(b) - overlap(a) || (a.ds.summary?.grid?.dx ?? 9) - (b.ds.summary?.grid?.dx ?? 9) || b.ds.completed - a.ds.completed)[0];
}

/** Which element does a dataset + scalar id belong to (for keeping the selector in sync with file browsing). */
export function elementOf(kind: string | undefined): ElementId | null {
  if (!kind) return null;
  for (const e of ELEMENTS) if (e.kinds.includes(kind)) return e.id;
  if (kind === "wave_direction") return "waves";
  return null;
}

/** Rules that decide whether two sources can be differenced. Returns null when comparable, else the reason (Chinese, user-facing). */
export function compareBlockers(o: { unitA: string; unitB: string; dtH: number | null; maxDtH: number; depthA: number | null; depthB: number | null; overlap: boolean }): string[] {
  const r: string[] = [];
  if (o.unitA !== o.unitB) r.push(i18nText("单位不一致（{0} / {1}），无法换算", o.unitA || i18nText("无"), o.unitB || i18nText("无")));
  if (o.dtH == null) r.push(i18nText("对比数据源没有可用时间"));
  else if (o.dtH > o.maxDtH) r.push(i18nText("两数据源最接近的时次相差 {0} h，超过 {1} h 容差", o.dtH.toFixed(o.dtH < 10 ? 1 : 0), o.maxDtH));
  if ((o.depthA == null) !== (o.depthB == null)) r.push(i18nText("一方为三维分层、另一方为单层，深度不可对应"));
  else if (o.depthA != null && o.depthB != null) { const tol = Math.max(1, 0.1 * Math.abs(o.depthA)); if (Math.abs(o.depthA - o.depthB) > tol) r.push(i18nText("最接近的深度层不同（{0} m / {1} m）", o.depthA.toFixed(1), o.depthB.toFixed(1))); }
  if (!o.overlap) r.push(i18nText("两数据源的空间范围不重叠"));
  return r;
}

/** Badge text / tone for a source state (no state = no task for this provider). */
export const STATE_LABEL: Record<string, [string, "ok" | "busy" | "bad" | "muted"]> = {
  ready: [i18nText("本地可用"), "ok"], downloading: [i18nText("下载中"), "busy"], queued: [i18nText("排队中"), "busy"], retrying: [i18nText("重试中"), "busy"], downloaded_unrenderable: [i18nText("已下载 · 不可绘制"), "bad"],
  timeout: [i18nText("下载超时"), "bad"], validation_failed: [i18nText("校验失败"), "bad"], error: [i18nText("下载失败"), "bad"],
};
export const REPR_LABEL: Record<string, string> = { instantaneous: i18nText("瞬时场"), daily_mean: i18nText("日均（P1D）"), monthly_mean: i18nText("月均") };
/** Providers to list for an element: local sources first, then every provider with a task (any state), then the download hints. */
export function providerRows(el: ElementDef, local: Source[], status: { provider: string; state: string }[] | null) {
  const seen = new Set(local.map(s => s.provider)), rows: { provider: string; state: string | null }[] = [];
  for (const s of status || []) if (!seen.has(s.provider)) { seen.add(s.provider); rows.push({ provider: s.provider, state: s.state }); }
  for (const p of el.providers) if (!seen.has(p)) { seen.add(p); rows.push({ provider: p, state: null }); }
  return rows;
}
