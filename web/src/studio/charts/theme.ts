// Chart colours resolved from the active CSS theme (literal values so exported PNGs keep them).
import { useEffect, useState } from "react";
export type ChartTheme = { fg: string; muted: string; grid: string; axis: string; bg: string; accent: string; warn: string; bad: string; good: string; series: string[] };
const read = (): ChartTheme => {
  const s = getComputedStyle(document.documentElement), v = (n: string, d: string) => s.getPropertyValue(n).trim() || d;
  const dark = document.documentElement.dataset.theme === "dark";
  return { fg: v("--text", "#e3edf6"), muted: v("--text-3", "#8399ad"), grid: dark ? "rgba(160,190,215,0.12)" : "rgba(20,50,80,0.10)", axis: v("--text-4", "#5a6f83"),
    bg: v("--surface", "#0d1a28"), accent: v("--accent", "#38b6e6"), warn: "#ffb020", bad: "#ff4d4f", good: v("--success", "#3ccf95"),
    series: dark ? ["#4cc3ef", "#f5b942", "#7ee0a8", "#e78ac3", "#9b8cf0", "#ff8f6b", "#a3d977", "#6aa9ff"] : ["#0b78b3", "#c47f00", "#178a55", "#b0457f", "#5d4bc4", "#c4532d", "#5e8f22", "#2f63c4"] };
};
export function useChartTheme() {
  const [t, set] = useState(read);
  useEffect(() => { const f = () => setTimeout(() => set(read()), 30); window.addEventListener("ocean-studio-theme", f); return () => window.removeEventListener("ocean-studio-theme", f); }, []);
  return t;
}
export const niceTicks = (lo: number, hi: number, n = 5) => {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag, step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
  const out: number[] = []; for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(+v.toPrecision(12)); return out;
};
export const fmtN = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? "—" : Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(2) : v.toFixed(d));
export function svgToPng(svg: SVGSVGElement, name: string, scale = 2) {
  const xml = new XMLSerializer().serializeToString(svg), img = new Image(), r = svg.getBoundingClientRect();
  img.onload = () => { const c = document.createElement("canvas"); c.width = r.width * scale; c.height = r.height * scale; const g = c.getContext("2d")!; g.fillStyle = getComputedStyle(svg).backgroundColor || read().bg; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height); download(c.toDataURL("image/png"), name + ".png"); };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml.includes("xmlns=") ? xml : xml.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"'));
}
export function download(href: string, name: string) { const a = document.createElement("a"); a.href = href; a.download = name; a.click(); }
export function downloadText(text: string, name: string, type = "text/csv") { const u = URL.createObjectURL(new Blob(["﻿" + text], { type })); download(u, name); setTimeout(() => URL.revokeObjectURL(u), 2000); }
/** UNESCO 1981 one-atmosphere equation of state → σ (kg m⁻³ − 1000). In-situ T gives σt. */
export function sigma0(S: number, T: number) {
  const rw = 999.842594 + 6.793952e-2 * T - 9.09529e-3 * T * T + 1.001685e-4 * T ** 3 - 1.120083e-6 * T ** 4 + 6.536332e-9 * T ** 5;
  const A = 8.24493e-1 - 4.0899e-3 * T + 7.6438e-5 * T * T - 8.2467e-7 * T ** 3 + 5.3875e-9 * T ** 4, B = -5.72466e-3 + 1.0227e-4 * T - 1.6546e-6 * T * T, C = 4.8314e-4;
  return rw + A * S + B * S ** 1.5 + C * S * S - 1000;
}
