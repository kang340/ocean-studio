// Vertical section panel: distance × depth on the file's real levels (cells, no smoothing between levels).
import { useEffect, useMemo, useRef, useState } from "react";
import { Panel, Loading, Alert } from "./Inspectors";
import { fmtN } from "../charts/theme";
import { lut, specFor, gradientCss } from "../../viz/palettes";
import { robustRange } from "../../viz/render";
import { depthEdges, depthScale, type SectionResult } from "../section";

export function SectionInspector({ data, onClose }: { data: { loading?: boolean; error?: string; r?: SectionResult; source?: string; daily?: boolean; points: [number, number][] }; onClose: () => void }) {
  const v = data.r?.variables[0], [log, setLog] = useState(false), cv = useRef<HTMLCanvasElement>(null), [hover, setHover] = useState<string>("");
  const spec = v ? specFor(v.kind, v.units) : null, conv = spec?.convert || ((x: number) => x), unit = spec?.unit || v?.units || "";
  const vals = useMemo(() => (v ? v.values.map(row => row.map(x => (x == null ? NaN : conv(x)))) : []), [v]);
  const range = useMemo(() => (vals.length ? robustRange(Float32Array.from(vals.flat())) : [0, 1]), [vals]);
  const W = 340, H = 230, L = 40, B = 22, T = 6, R = 6, pw = W - L - R, ph = H - T - B;
  const edges = v ? depthEdges(v.depth) : [0, 1], maxZ = edges[edges.length - 1], ys = depthScale(maxZ, log), dist = data.r?.distance_km || [], D = dist[dist.length - 1] || 1;
  useEffect(() => {
    const c = cv.current; if (!c || !v) return; const g = c.getContext("2d")!, dpr = window.devicePixelRatio || 1;
    c.width = W * dpr; c.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const pal = lut(spec?.palette || "viridis"), [lo, hi] = range, n = dist.length;
    for (let k = 0; k < v.depth.length; k++) {
      const y0 = T + ys(edges[k]) * ph, y1 = T + ys(edges[k + 1]) * ph;
      for (let i = 0; i < n; i++) {
        const x = vals[k][i]; if (!Number.isFinite(x)) continue;
        const xa = L + ((i ? (dist[i - 1] + dist[i]) / 2 : 0) / D) * pw, xb = L + ((i < n - 1 ? (dist[i] + dist[i + 1]) / 2 : D) / D) * pw;
        const q = Math.round(Math.min(1, Math.max(0, (x - lo) / ((hi - lo) || 1))) * 255) * 4; g.fillStyle = `rgb(${pal[q]},${pal[q + 1]},${pal[q + 2]})`;
        g.fillRect(xa, y0, Math.max(1, xb - xa + 0.5), Math.max(1, y1 - y0 + 0.5));
      }
    }
    // strongest-gradient depth (thermocline / halocline proxy)
    g.strokeStyle = "rgba(255,255,255,.9)"; g.setLineDash([3, 3]); g.beginPath(); let pen = false;
    v.cline.per_point.forEach((p, i) => { if (!p) { pen = false; return; } const x = L + dist[i] / D * pw, y = T + ys(p.depth) * ph; pen ? g.lineTo(x, y) : g.moveTo(x, y); pen = true; });
    g.stroke(); g.setLineDash([]);
    g.fillStyle = "#8aa0b4"; g.font = "10px sans-serif"; g.textAlign = "right";
    const ticks = log ? [0, 10, 50, 100, 200, 500, 1000, 2000, 5000].filter(z => z <= maxZ) : Array.from({ length: 6 }, (_, i) => Math.round(maxZ * i / 5));
    for (const z of ticks) { const y = T + ys(z) * ph; g.fillText(String(z), L - 4, y + 3); g.fillRect(L - 2, y, 2, 1); }
    g.textAlign = "center"; for (let i = 0; i <= 4; i++) g.fillText(`${Math.round(D * i / 4)}`, L + pw * i / 4, H - 6);
  }, [v, vals, range, log]);
  const move = (e: React.MouseEvent) => {
    if (!v) return; const r = (e.target as HTMLCanvasElement).getBoundingClientRect(), x = e.clientX - r.left - L, y = e.clientY - r.top - T;
    if (x < 0 || x > pw || y < 0 || y > ph) { setHover(""); return; }
    const d = x / pw * D, i = dist.reduce((b, t, k) => (Math.abs(t - d) < Math.abs(dist[b] - d) ? k : b), 0), fy = y / ph;
    const k = edges.findIndex((_, j) => j < edges.length - 1 && ys(edges[j]) <= fy && fy < ys(edges[j + 1])); if (k < 0) return;
    const val = vals[k]?.[i]; setHover(`${fmtN(dist[i], 0)} km · ${fmtN(v.depth[k], v.depth[k] < 10 ? 1 : 0)} m · ${Number.isFinite(val) ? fmtN(val, spec?.decimals ?? 2) + " " + unit : "无数据（陆地 / 海底 / 网格外）"}`);
  };
  return <Panel title="垂向断面" sub={v ? `${v.label || v.name} · ${data.points.length} 个折点 · 全长 ${fmtN(D, 0)} km` : "沿折线采样真实模式层"} onClose={onClose}>
    <div className="os-stack">{data.loading && <Loading text="沿断面读取各层…" />}{data.error && <Alert>{data.error}</Alert>}
      {v && <>
        <div className="os-seg"><button className={!log ? "on" : ""} onClick={() => setLog(false)}>线性深度</button><button className={log ? "on" : ""} onClick={() => setLog(true)}>对数深度</button></div>
        <canvas ref={cv} style={{ width: W, height: H }} onMouseMove={move} onMouseLeave={() => setHover("")} aria-label="垂向断面图（横轴距离 km，纵轴深度 m 向下）" />
        <small className="os-note">{hover || "横轴：沿线距离（km）；纵轴：深度（m，向下）。色块 = 文件真实层（层厚取相邻层中点），空白为陆地 / 海底以下 / 网格外。"}</small>
        <div className="lg-bar" style={{ background: gradientCss(spec?.palette || "viridis"), height: 8, borderRadius: 4 }} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}><span>{fmtN(range[0], 2)}</span><span>{unit}</span><span>{fmtN(range[1], 2)}</span></div>
        <dl className="os-kv compact">
          <div><dt>{v.kind === "salinity" ? "盐跃层（中位）" : "温跃层（中位）"}</dt><dd>{v.cline.median_depth != null ? `${fmtN(v.cline.median_depth, 0)} m（虚线）` : "层数不足，未识别"}</dd></div>
          <div><dt>模式层</dt><dd>{v.depth.length} 层 · {fmtN(Math.abs(v.depth[0]), 1)}–{fmtN(Math.abs(v.depth[v.depth.length - 1]), 0)} {v.depth_units}</dd></div>
          <div><dt>时间</dt><dd>{v.time || "—"}{data.daily ? "（日均产品：代表当日平均）" : ""}</dd></div>
          <div><dt>数据</dt><dd>{data.source || ""}</dd></div>
        </dl>
        <small className="os-note">跃层：{v.cline.method}。插值：每层双线性，邻点缺测时取最近有效格点；层间不插值、不外推。{data.r!.outside ? ` ${data.r!.outside} 个采样点在网格外。` : ""}</small>
      </>}
    </div></Panel>;
}
