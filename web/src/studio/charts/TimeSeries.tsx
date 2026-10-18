// Time-series chart on uPlot (MIT, github.com/leeoniya/uPlot): drag to zoom, double-click to reset,
// hover read-out, per-point QC marks, gaps kept as gaps, PNG/CSV export, statistics for the visible range.
import { useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { Download, ImageDown, RotateCcw } from "lucide-react";
import { useChartTheme, fmtN, download, downloadText } from "./theme";

export type TsSeries = { label: string; unit: string; t: number[]; v: (number | null)[]; qc?: string[]; color?: string; dash?: boolean; axis?: 0 | 1; points?: boolean };
type Props = { series: TsSeries[]; height?: number; marker?: number | null; title?: string; decimals?: number; exportName?: string; onPick?: (t: number) => void };

export function TimeSeries({ series, height = 210, marker = null, title, decimals = 2, exportName = "timeseries", onPick }: Props) {
  const el = useRef<HTMLDivElement>(null), plot = useRef<uPlot | null>(null), th = useChartTheme();
  const [range, setRange] = useState<[number, number] | null>(null), [width, setWidth] = useState(320);
  const markerRef = useRef(marker); markerRef.current = marker;
  // Align all series on the union of their timestamps (seconds); missing → null so lines break at gaps.
  const data = useMemo(() => {
    const ts = Array.from(new Set(series.flatMap(s => s.t))).sort((a, b) => a - b), pos = new Map(ts.map((t, i) => [t, i]));
    const cols = series.map(s => { const c: (number | null)[] = new Array(ts.length).fill(null); s.t.forEach((t, i) => { c[pos.get(t)!] = s.v[i] ?? null; }); return c; });
    const qcs = series.map(s => { const c: (string | null)[] = new Array(ts.length).fill(null); if (s.qc) s.t.forEach((t, i) => { c[pos.get(t)!] = s.qc![i]; }); return c; });
    return { ts: ts.map(t => t / 1000), cols, qcs };
  }, [series]);
  useEffect(() => { if (!el.current) return; const ro = new ResizeObserver(e => setWidth(Math.max(200, e[0].contentRect.width))); ro.observe(el.current); return () => ro.disconnect(); }, []);
  useEffect(() => {
    if (!el.current || !data.ts.length) return;
    const units = Array.from(new Set(series.map(s => s.unit)));
    const qcPlugin: uPlot.Plugin = { hooks: { draw: [(u: uPlot) => {
      const ctx = u.ctx; ctx.save();
      data.qcs.forEach((col, si) => { const sc = series[si].axis === 1 ? "y2" : "y";
        col.forEach((q, i) => { const v = data.cols[si][i]; if (v == null || !q || (q !== "suspect" && q !== "bad")) return;
          const x = u.valToPos(data.ts[i], "x", true), y = u.valToPos(v, sc, true), r = 3.5 * devicePixelRatio;
          ctx.strokeStyle = q === "bad" ? th.bad : th.warn; ctx.lineWidth = 1.6 * devicePixelRatio; ctx.beginPath();
          if (q === "bad") { ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); } else ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.stroke(); }); });
      const m = markerRef.current; if (m != null) { const x = u.valToPos(m / 1000, "x", true); ctx.strokeStyle = th.warn; ctx.setLineDash([4, 3]); ctx.lineWidth = devicePixelRatio; ctx.beginPath(); ctx.moveTo(x, u.bbox.top); ctx.lineTo(x, u.bbox.top + u.bbox.height); ctx.stroke(); }
      ctx.restore(); }], setScale: [(u: uPlot, k: string) => { if (k === "x") setRange([u.scales.x.min! * 1000, u.scales.x.max! * 1000]); }] } };
    const axis = (scale: string, side: 1 | 3, unit: string): uPlot.Axis => ({ scale, side, stroke: th.muted, grid: { stroke: th.grid, width: 1 }, ticks: { stroke: th.grid, width: 1 }, font: "10.5px system-ui", size: 46, label: unit, labelFont: "10.5px system-ui", labelSize: 14, values: (_u, v) => v.map(x => fmtN(x, decimals > 2 ? 2 : decimals)) });
    const opts: uPlot.Options = {
      width, height, padding: [8, 8, 0, 0], legend: { show: false }, cursor: { drag: { x: true, y: false, setScale: true }, points: { size: 6 } },
      scales: { x: { time: true }, y: { auto: true }, y2: { auto: true } },
      axes: [{ stroke: th.muted, grid: { stroke: th.grid, width: 1 }, ticks: { stroke: th.grid, width: 1 }, font: "10.5px system-ui", size: 34,
        values: [[3600 * 24 * 365, "{YYYY}", null, null, null, null, null, null, 1], [3600 * 24 * 28, "{MM}月", "\n{YYYY}", null, null, null, null, null, 1], [3600 * 24, "{MM}-{DD}", "\n{YYYY}", null, null, null, null, null, 1], [3600, "{HH}:00", "\n{MM}-{DD}", null, "\n{MM}-{DD}", null, null, null, 1], [60, "{HH}:{mm}", "\n{MM}-{DD}", null, "\n{MM}-{DD}", null, null, null, 1]] as any },
        axis("y", 3, units[0] || ""), ...(units.length > 1 && series.some(s => s.axis === 1) ? [axis("y2", 1, units[1])] : [])],
      series: [{}, ...series.map((s, i) => ({ label: s.label, scale: s.axis === 1 ? "y2" : "y", stroke: s.color || th.series[i % th.series.length], width: 1.6, dash: s.dash ? [5, 4] : undefined,
        spanGaps: false, points: { show: s.points ?? data.ts.length <= 80, size: 4, fill: s.color || th.series[i % th.series.length] },
        value: (_u: uPlot, v: number | null) => (v == null ? "—" : fmtN(v, decimals) + " " + s.unit) }))],
      plugins: [qcPlugin], tzDate: ts => uPlot.tzDate(new Date(ts * 1e3), "Etc/UTC"),
    };
    plot.current?.destroy();
    plot.current = new uPlot(opts, [data.ts, ...data.cols] as any, el.current);
    const over = plot.current.over;
    const click = () => { const i = plot.current?.cursor.idx; if (i != null && onPick) onPick(data.ts[i] * 1000); };
    const dbl = () => { plot.current?.setScale("x", { min: data.ts[0], max: data.ts[data.ts.length - 1] }); setRange(null); };
    over.addEventListener("click", click); over.addEventListener("dblclick", dbl);
    return () => { over.removeEventListener("click", click); over.removeEventListener("dblclick", dbl); plot.current?.destroy(); plot.current = null; };
  }, [data, width, height, th, decimals]);
  useEffect(() => { plot.current?.redraw(false, false); }, [marker]);
  // statistics over the visible range, valid (non-bad, non-missing) values only
  const stats = useMemo(() => series.map((s, si) => {
    const vs: number[] = [];
    data.ts.forEach((t, i) => { const v = data.cols[si][i], q = data.qcs[si][i]; if (v == null || q === "bad" || q === "missing") return; if (range && (t * 1000 < range[0] || t * 1000 > range[1])) return; vs.push(v); });
    if (!vs.length) return { label: s.label, unit: s.unit, n: 0 };
    const mean = vs.reduce((a, b) => a + b, 0) / vs.length; return { label: s.label, unit: s.unit, n: vs.length, mean, min: Math.min(...vs), max: Math.max(...vs), std: Math.sqrt(vs.reduce((a, b) => a + (b - mean) ** 2, 0) / vs.length) };
  }), [series, data, range]);
  const csv = () => downloadText(["time_utc," + series.map(s => `${s.label} (${s.unit})${s.qc ? `,${s.label}_qc` : ""}`).join(","), ...data.ts.map((t, i) => [new Date(t * 1000).toISOString(), ...series.flatMap((s, si) => [data.cols[si][i] ?? "", ...(s.qc ? [data.qcs[si][i] ?? ""] : [])])].join(","))].join("\n"), exportName + ".csv");
  if (!data.ts.length) return <div className="os-chart-empty">没有可绘制的时间序列</div>;
  return <div className="os-chart">
    <div className="os-chart-head">{title && <strong>{title}</strong>}<div className="os-legend-row">{series.map((s, i) => <span key={i}><i style={{ background: s.color || th.series[i % th.series.length] }} className={s.dash ? "dash" : ""} />{s.label}</span>)}</div>
      <div className="os-chart-tools"><button title="复位缩放（双击图表）" onClick={() => { plot.current?.setScale("x", { min: data.ts[0], max: data.ts[data.ts.length - 1] }); setRange(null); }}><RotateCcw size={13} /></button>
        <button title="导出 PNG" onClick={() => plot.current && download((plot.current as any).ctx.canvas.toDataURL("image/png"), exportName + ".png")}><ImageDown size={13} /></button>
        <button title="导出 CSV" onClick={csv}><Download size={13} /></button></div></div>
    <div ref={el} className="os-uplot" />
    <div className="os-chart-stats">{stats.map((s: any, i) => <span key={i}><b>{s.label}</b>{s.n ? <>均值 {fmtN(s.mean, decimals)} · 最小 {fmtN(s.min, decimals)} · 最大 {fmtN(s.max, decimals)} · σ {fmtN(s.std, decimals)} {s.unit} · n={s.n}</> : "无有效值"}</span>)}
      <small>拖拽框选放大，双击复位；统计排除 QC 为“错误 / 缺测”的记录{range ? "，仅限当前可见时段" : ""}</small></div>
  </div>;
}
