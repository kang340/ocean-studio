// Typed client for /api/studio (plus the shared /api/viz catalogue).
import { api } from "../api";
export { listDatasets, getDataset, loadField, peekField, pointQuery, regionQuery, sampler } from "../viz/data";
export type { VizDataset, Describe, Field, VizVariable, VizVector } from "../viz/data";

export type Frame = { time: string; task: string; index: number; forecast_hour?: number };
export type FrameSet = { mode: "file" | "siblings" | "single"; frames: Frame[]; excluded: { task: string; time: string; reason: string }[]; spacing_h: { min: number; max: number; regular: boolean } | null; note: string };
export type QcClass = "good" | "probably_good" | "suspect" | "bad" | "missing" | "none";
export type ObsVar = { name: string; kind: string; label: string; unit: string; display_unit: string; qc_column: string | null; qc_scheme: string; qc_codes: Record<string, { class: QcClass; text: string }>; valid: number; min: number | null; max: number | null; qc_counts: Record<QcClass, number> };
export type ObsSummary = {
  task: string; dataset: string; family: string; structure: "profile" | "trajectory" | "timeseries" | "mixed"; platform_type: string; records: number; platform_count: number;
  types: { id: string; label: string; count: number }[]; profiles: number; time: string[]; histogram: { start: string; step_s: number; counts: number[] } | null;
  bounds: number[] | null; vertical: { name: string; unit: string; is_pressure: boolean } | null; variables: ObsVar[]; qc_classes: Record<QcClass, string>; notes: string[]; source: string;
  platforms: { id: string; type: string; lon: number; lat: number; records: number; t0: string; t1: string }[]; bytes: number; completed: number;
};
export type ObsFeatures = { points: { id: string[]; lon: number[]; lat: number[]; time: string[]; type: string[]; value: (number | null)[] | null; qc: QcClass[] | null }; tracks: { id: string; type: string; lon: number[]; lat: number[]; t: number[] }[]; variable: ObsVar | null; count: number };
export type PlatformVar = ObsVar & { raw: (number | null)[]; display_values: (number | null)[]; qc_raw: (number | null)[]; qc: QcClass[] };
export type Platform = {
  id: string; type: string; type_label: string; family: string; structure: string; records: number; source: string; notes: string[]; time: string[]; lon: number[]; lat: number[];
  variables: PlatformVar[]; qc_classes: Record<QcClass, string>;
  vertical?: { name: string; unit: string; is_pressure: boolean; values: (number | null)[]; depth_m: (number | null)[] };
  profiles?: { key: string; rows: number[]; time: string; lon: number; lat: number; cycle: string | null; levels: number }[];
  track?: { time: string[]; lon: number[]; lat: number[]; speed_ms: (number | null)[]; bearing: (number | null)[]; dt_s: number[]; dist_km: (number | null)[]; gap: boolean[]; jump: boolean[]; median_dt_s: number; speed_limit_ms: number };
};
export type Stats = { n: number; bias?: number; mae?: number; rmse?: number; r?: number; slope?: number; intercept?: number; std_diff?: number; obs_mean?: number; model_mean?: number; obs_std?: number; model_std?: number; scatter_index?: number; median_diff?: number; robust_std?: number; p95_abs?: number; outliers?: number; rmse_excl_outliers?: number };
export type MatchResult = {
  obs_variable: ObsVar; model_variables: string[]; model_mode: string; model_kind: string; unit: string; stats: Stats;
  by_time: (Stats & { time: string })[]; by_type: (Stats & { type: string; label: string })[]; by_lat: (Stats & { band: number[] })[]; diff_hist: { counts: number[]; edges: number[] } | null;
  pairs: { platform: string[]; lon: number[]; lat: number[]; time: string[]; obs: number[]; model: number[]; dt_h: number[]; dist_km: number[]; method: number[]; time_interp: number[]; dz_m: number[]; qc: QcClass[]; outlier: boolean[] };
  pairs_total: number; pairs_returned: number; candidates: number; unmatched: Record<string, number>; space_methods: Record<string, number>; time_methods: Record<string, number>;
  max_dt_h: number; time_interp: boolean; qc: string; remove_mean: boolean; max_dist_km: number | null; max_abs_dt_h: number | null; depth: { model_levels: number[] | null; max_abs_dz_m: number | null };
  frames: { time: string; task: string }[]; method: Record<string, string>; notes: string[]; outlier_rule: string; frame_mode: string; excluded_frames: FrameSet["excluded"]; coverage: { model: string[]; obs: string[] | null };
};
export type Suggestion = { obs: string; obs_dataset: string; obs_var: string; obs_label: string; valid: number; model: string; model_provider: string; model_dataset: string; model_time: string[]; obs_time: string[]; time_gap_h: number; overlap: boolean };

const q = (o: Record<string, any>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v)); return p.toString(); };
export const getFrames = (id: string, v?: string) => api(`/studio/datasets/${encodeURIComponent(id)}/frames?${q({ var: v })}`) as Promise<FrameSet>;
export const obsSummary = (id: string) => api(`/studio/obs/${encodeURIComponent(id)}/summary`) as Promise<ObsSummary>;
export const obsFeatures = (id: string, o: { var?: string | null; t0?: string | null; t1?: string | null; qc?: string; depth_max?: number | null }) => api(`/studio/obs/${encodeURIComponent(id)}/features?${q(o)}`) as Promise<ObsFeatures>;
export const obsPlatform = (id: string, pid: string) => api(`/studio/obs/${encodeURIComponent(id)}/platform/${encodeURIComponent(pid)}`) as Promise<Platform>;
export const obsNear = (id: string, o: { lon?: number; lat?: number; radius_km?: number; bbox?: string }) => api(`/studio/obs/${encodeURIComponent(id)}/near?${q(o)}`) as Promise<{ platforms: (ObsSummary["platforms"][number] & { dist_km?: number })[]; total: number }>;
export const obsExportUrl = (id: string, pid: string) => `/api/studio/obs/${encodeURIComponent(id)}/export/${encodeURIComponent(pid)}`;
export const runMatch = (o: { model: string; obs: string; obs_var: string; max_dt_h: number; time_interp: boolean; qc: string; bbox?: string | null; depth_max?: number | null; platform?: string | null; max_pairs?: number }) => api(`/studio/match?${q(o)}`) as Promise<MatchResult>;
export const suggest = () => api(`/studio/match/suggest`) as Promise<Suggestion[]>;

export const tms = (iso?: string | null) => (iso ? Date.parse(iso.endsWith("Z") || /[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z") : NaN);
export const isoOf = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/** Real per-provider status of an element (ready / downloading / failed …) from the task records. */
export type SourceState = "ready" | "downloaded_unrenderable" | "downloading" | "queued" | "retrying" | "timeout" | "validation_failed" | "error";
export type SourceStatus = { provider: string; state: SourceState; tasks: Partial<Record<SourceState, number>>; ready_files: number; products: string[];
  last_error: { state: SourceState; message: string; task: string } | null; representativeness: "instantaneous" | "daily_mean" | "monthly_mean" | null;
  meta: null | { variables: { name: string; kind: string; units: string; source_units?: string | null; mapable: boolean }[]; time_range: string[] | null; time_steps: number; time_spacing_h: number | null;
    bounds: number[] | null; resolution_deg: number[] | null; grid_type: string; depth: { levels: number; min: number; max: number; units: string; positive: string } | null } };
export const sourceStatus = (element: string) => api("/studio/sources?element=" + encodeURIComponent(element)) as Promise<{ element: string; sources: SourceStatus[] }>;
