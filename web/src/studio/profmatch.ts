// Model–Argo vertical profile matching.
//   space : model column at the profile position (bilinear in the horizontal; nearest valid corner near land — /point)
//   time  : nearest model frame within ±maxDt (no time interpolation of 3-D fields)
//   depth : observed pressure → depth (UNESCO 1983, server side), then linear interpolation between the two
//           bracketing *valid* model levels; never extrapolated below the deepest valid level, and above the
//           shallowest level only within `surfaceTol` metres (constant value, i.e. a mixed surface layer)
//   QC    : observed levels flagged bad / missing are excluded; *_ADJUSTED preferred when it has data for the profile
// Inputs are injected so the logic is testable without a server.
export type ObsLevel = { z: number; v: number | null; qc: string };
export type ObsProfile = { platform: string; key: string; cycle: string | null; time: string; lon: number; lat: number; levels: ObsLevel[]; variable: string };
export type ModelColumn = { z: number[]; v: (number | null)[]; time: string | null; method?: string; gridLon?: number; gridLat?: number } | null;
export type Pair = { platform: string; key: string; z: number; obs: number; model: number; dtH: number; dzNear: number; lon: number; lat: number; time: string };
export type BinStats = { z0: number; z1: number; n: number; bias: number; rmse: number; mae: number; r: number; obsMean: number; modelMean: number };
export type ProfileSummary = { platform: string; key: string; cycle: string | null; time: string; modelTime: string | null; lon: number; lat: number; dtH: number | null; n: number; bias: number; rmse: number; reason: string | null };
export type ProfileMatch = { pairs: Pair[]; profiles: ProfileSummary[]; bins: BinStats[]; stats: Stats; unmatched: Record<string, number>; variable: string; unit: string; label: string; modelLabel: string; maxDtH: number; notes: string[] };
export type Stats = { n: number; bias: number; mae: number; rmse: number; r: number; slope: number; intercept: number; std_diff: number; obs_mean: number; model_mean: number };

export const DEPTH_BINS: [number, number][] = [[0, 10], [10, 50], [50, 100], [100, 200], [200, 500], [500, 1000], [1000, 1500], [1500, 2000]];

/** Model value at depth z from a column; returns [value, distance to nearest used level] or null with a reason. */
export function interpColumn(zs: number[], vs: (number | null)[], z: number, surfaceTol = 5): { v: number; dz: number } | { reason: "below_model" | "above_model" | "model_gap" } {
  const ok: [number, number][] = []; for (let i = 0; i < zs.length; i++) { const v = vs[i]; if (v != null && Number.isFinite(v) && Number.isFinite(zs[i])) ok.push([zs[i], v]); }
  if (!ok.length) return { reason: "model_gap" };
  ok.sort((a, b) => a[0] - b[0]);
  if (z < ok[0][0]) return z >= ok[0][0] - surfaceTol ? { v: ok[0][1], dz: ok[0][0] - z } : { reason: "above_model" };
  if (z > ok[ok.length - 1][0]) return { reason: "below_model" };
  let k = 0; while (k < ok.length - 2 && ok[k + 1][0] < z) k++;
  const [z0, v0] = ok[k], [z1, v1] = ok[Math.min(k + 1, ok.length - 1)];
  if (z1 === z0) return { v: v0, dz: Math.abs(z - z0) };
  const t = (z - z0) / (z1 - z0); return { v: v0 + (v1 - v0) * t, dz: Math.min(Math.abs(z - z0), Math.abs(z1 - z)) };
}

export function stats(o: number[], m: number[]): Stats {
  const n = o.length; if (!n) return { n: 0, bias: NaN, mae: NaN, rmse: NaN, r: NaN, slope: NaN, intercept: NaN, std_diff: NaN, obs_mean: NaN, model_mean: NaN };
  let so = 0, sm = 0, sd = 0, sad = 0, sdd = 0; for (let i = 0; i < n; i++) { const d = m[i] - o[i]; so += o[i]; sm += m[i]; sd += d; sad += Math.abs(d); sdd += d * d; }
  const mo = so / n, mm = sm / n; let soo = 0, smm = 0, som = 0; for (let i = 0; i < n; i++) { const a = o[i] - mo, b = m[i] - mm; soo += a * a; smm += b * b; som += a * b; }
  const bias = sd / n, slope = soo > 0 ? som / soo : NaN;
  return { n, bias, mae: sad / n, rmse: Math.sqrt(sdd / n), r: soo > 0 && smm > 0 ? som / Math.sqrt(soo * smm) : NaN, slope, intercept: mm - slope * mo, std_diff: Math.sqrt(Math.max(0, sdd / n - bias * bias)), obs_mean: mo, model_mean: mm };
}

export function binStats(pairs: Pair[], bins = DEPTH_BINS): BinStats[] {
  return bins.map(([z0, z1]) => { const p = pairs.filter(x => x.z >= z0 && x.z < z1), s = stats(p.map(x => x.obs), p.map(x => x.model));
    return { z0, z1, n: s.n, bias: s.bias, rmse: s.rmse, mae: s.mae, r: s.r, obsMean: s.obs_mean, modelMean: s.model_mean }; }).filter(b => b.n > 0);
}

const hours = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 3.6e6;

/** Match observed profiles against model columns. `column(profile, frameTime)` fetches the model column (already in display units). */
export async function matchProfiles(o: {
  profiles: ObsProfile[]; frames: { time: string; task: string }[]; maxDtH: number; maxDepth: number; column: (p: ObsProfile, frame: { time: string; task: string }) => Promise<ModelColumn>;
  unit: string; label: string; modelLabel: string; concurrency?: number; onProgress?: (done: number, total: number) => void;
}): Promise<ProfileMatch> {
  const pairs: Pair[] = [], profiles: ProfileSummary[] = [], unmatched: Record<string, number> = { outside_time: 0, outside_domain: 0, qc_excluded: 0, obs_missing: 0, below_model: 0, above_model: 0, model_gap: 0, deeper_than_limit: 0 };
  let done = 0; const queue = o.profiles.slice(), work: Promise<void>[] = [];
  const one = async (p: ObsProfile) => {
    const fr = o.frames.length ? o.frames.reduce((b, f) => (hours(f.time, p.time) < hours(b.time, p.time) ? f : b)) : null;
    const dt = fr ? hours(fr.time, p.time) : null;
    const sum: ProfileSummary = { platform: p.platform, key: p.key, cycle: p.cycle, time: p.time, modelTime: fr?.time ?? null, lon: p.lon, lat: p.lat, dtH: dt, n: 0, bias: NaN, rmse: NaN, reason: null };
    if (!fr || dt! > o.maxDtH) { unmatched.outside_time += p.levels.length; sum.reason = `超出时间容差（最近模式时次相差 ${dt == null ? "—" : dt.toFixed(1)} h）`; profiles.push(sum); return; }
    const col = await o.column(p, fr).catch(() => null);
    if (!col || !col.z.length) { unmatched.outside_domain += p.levels.length; sum.reason = "剖面位置在模式范围外或该处全为缺测（陆地）"; profiles.push(sum); return; }
    const mine: Pair[] = [];
    for (const L of p.levels) {
      if (L.qc === "bad" || L.qc === "missing") { unmatched.qc_excluded++; continue; }
      if (L.v == null || !Number.isFinite(L.v) || !Number.isFinite(L.z)) { unmatched.obs_missing++; continue; }
      if (L.z > o.maxDepth) { unmatched.deeper_than_limit++; continue; }
      const r = interpColumn(col.z, col.v, L.z);
      if ("reason" in r) { unmatched[r.reason]++; continue; }
      mine.push({ platform: p.platform, key: p.key, z: L.z, obs: L.v, model: r.v, dtH: dt!, dzNear: r.dz, lon: p.lon, lat: p.lat, time: p.time });
    }
    const s = stats(mine.map(x => x.obs), mine.map(x => x.model)); Object.assign(sum, { n: s.n, bias: s.bias, rmse: s.rmse, modelTime: col.time || fr.time });
    if (!mine.length) sum.reason = "没有可匹配的有效层"; profiles.push(sum); pairs.push(...mine);
  };
  const worker = async () => { while (queue.length) { const p = queue.shift()!; await one(p); done++; o.onProgress?.(done, o.profiles.length); } };
  for (let i = 0; i < (o.concurrency || 6); i++) work.push(worker()); await Promise.all(work);
  profiles.sort((a, b) => a.time.localeCompare(b.time));
  const st = stats(pairs.map(x => x.obs), pairs.map(x => x.model));
  return { pairs, profiles, bins: binStats(pairs), stats: st, unmatched, variable: o.profiles[0]?.variable || "", unit: o.unit, label: o.label, modelLabel: o.modelLabel, maxDtH: o.maxDtH, notes: [] };
}
