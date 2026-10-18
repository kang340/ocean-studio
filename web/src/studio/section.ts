// Vertical section helpers (pure; tested in node). The server samples real model levels along the line
// (/api/viz/datasets/{id}/section); here: query string, depth-cell edges and the depth axis mapping.
import { api } from "../api";

export type SectionVar = { name: string; units: string; kind: string; label: string; depth: number[]; depth_units: string; positive: string; time: string | null;
  values: (number | null)[][]; cline: { per_point: ({ depth: number; gradient: number } | null)[]; median_depth: number | null; method: string } };
export type SectionResult = { lon: number[]; lat: number[]; distance_km: number[]; variables: SectionVar[]; outside: number };

/** 'lon,lat;lon,lat' with longitudes unwrapped along the line (a line drawn across the dateline stays short). */
export function lineParam(pts: [number, number][]) {
  const out: [number, number][] = [];
  for (const [x, y] of pts) { let lon = x; if (out.length) { const p = out[out.length - 1][0]; lon += Math.round((p - lon) / 360) * 360; } out.push([lon, y]); }
  return out.map(([x, y]) => `${x.toFixed(4)},${y.toFixed(4)}`).join(";");
}
export const sectionQuery = (id: string, vars: string[], pts: [number, number][], time?: string | null, n = 200) => {
  const p = new URLSearchParams({ vars: vars.join(","), line: lineParam(pts), n: String(n) }); if (time) p.set("time", time);
  return api(`/viz/datasets/${encodeURIComponent(id)}/section?${p}`) as Promise<SectionResult>;
};

/** Top / bottom of each level's cell: half-way to the neighbours, the first cell starts at the surface (0). */
export function depthEdges(z: number[]) {
  const a = z.map(Math.abs), e: number[] = [0];
  for (let i = 0; i < a.length - 1; i++) e.push((a[i] + a[i + 1]) / 2);
  e.push(a.length > 1 ? a[a.length - 1] + (a[a.length - 1] - a[a.length - 2]) / 2 : a[0] * 2 || 1);
  return e;
}
/** Depth → 0..1 down the plot; log axis uses log10(1 + z) so the surface layer stays visible. */
export function depthScale(maxZ: number, log: boolean) {
  const f = (z: number) => (log ? Math.log10(1 + z) : z), top = f(0), bot = f(maxZ) || 1;
  return (z: number) => (f(Math.min(Math.max(z, 0), maxZ)) - top) / (bot - top);
}
