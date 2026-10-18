// SVG / canvas science charts: vertical profiles, T–S diagram with σ isopycnals, wind / current roses,
// model–observation density scatter, histograms. Hover read-outs; PNG export.
import { useEffect, useMemo, useRef, useState } from "react";
import { ImageDown } from "lucide-react";
import { useChartTheme, niceTicks, fmtN, svgToPng, download, sigma0, type ChartTheme } from "./theme";

const Tools = ({ svg, name }: { svg: React.RefObject<SVGSVGElement | null>; name: string }) =>
  <div className="os-chart-tools"><button title="导出 PNG" onClick={() => svg.current && svgToPng(svg.current, name)}><ImageDown size={13} /></button></div>;

// ---------------------------------------------------------------- vertical profile
export type ProfileLine = { label: string; z: number[]; v: (number | null)[]; qc?: string[]; color?: string; dash?: boolean };
export function ProfileChart({ lines, unit, zLabel, title, height = 300, exportName = "profile" }: { lines: ProfileLine[]; unit: string; zLabel: string; title?: string; height?: number; exportName?: string }) {
  const th = useChartTheme(), svg = useRef<SVGSVGElement>(null), [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const W = 320, H = height, L = 46, R = 12, T = 12, B = 30;
  const pts = lines.flatMap(l => l.z.map((z, i) => [z, l.v[i]] as const)).filter(([z, v]) => v != null && Number.isFinite(v) && Number.isFinite(z)) as [number, number][];
  if (pts.length < 2) return <div className="os-chart-empty">该剖面没有足够的有效数据</div>;
  let x0 = Math.min(...pts.map(p => p[1])), x1 = Math.max(...pts.map(p => p[1])); if (x1 - x0 < 1e-9) { x0 -= 0.5; x1 += 0.5; } const xp = (x1 - x0) * 0.06; x0 -= xp; x1 += xp;
  const z0 = 0, z1 = Math.max(...pts.map(p => p[0])) * 1.03 || 1;
  const X = (v: number) => L + (v - x0) / (x1 - x0) * (W - L - R), Y = (z: number) => T + (z - z0) / (z1 - z0) * (H - T - B);
  return <div className="os-chart">
    <div className="os-chart-head">{title && <strong>{title}</strong>}<div className="os-legend-row">{lines.slice(0, 6).map((l, i) => <span key={i}><i style={{ background: l.color || th.series[i % 8] }} className={l.dash ? "dash" : ""} />{l.label}</span>)}{lines.length > 6 && <span>+{lines.length - 6}</span>}</div><Tools svg={svg} name={exportName} /></div>
    <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="os-svg" style={{ background: th.bg }} onMouseLeave={() => setHover(null)}>
      {niceTicks(z0, z1, 6).map(z => <g key={"z" + z}><line x1={L} x2={W - R} y1={Y(z)} y2={Y(z)} stroke={th.grid} /><text x={L - 5} y={Y(z) + 3} textAnchor="end" fill={th.muted} fontSize="9.5">{fmtN(z, 0)}</text></g>)}
      {niceTicks(x0, x1, 5).map(x => <g key={"x" + x}><line x1={X(x)} x2={X(x)} y1={T} y2={H - B} stroke={th.grid} /><text x={X(x)} y={H - B + 12} textAnchor="middle" fill={th.muted} fontSize="9.5">{fmtN(x, 2)}</text></g>)}
      <text x={(L + W - R) / 2} y={H - 4} textAnchor="middle" fill={th.muted} fontSize="10">{unit}</text>
      <text x={10} y={(T + H - B) / 2} textAnchor="middle" fill={th.muted} fontSize="10" transform={`rotate(-90 10 ${(T + H - B) / 2})`}>{zLabel}</text>
      {lines.map((l, li) => { const c = l.color || th.series[li % 8]; let d = ""; l.z.forEach((z, i) => { const v = l.v[i]; if (v == null || !Number.isFinite(v)) { d += " "; return; } d += (d === "" || d.endsWith(" ") ? "M" : "L") + X(v).toFixed(1) + "," + Y(z).toFixed(1); });
        return <g key={li}><path d={d.replace(/ +/g, " ").trim()} fill="none" stroke={c} strokeWidth="1.6" strokeDasharray={l.dash ? "4 3" : undefined} strokeLinejoin="round" />
          {l.z.map((z, i) => { const v = l.v[i], q = l.qc?.[i]; if (v == null || !Number.isFinite(v)) return null; const bad = q === "bad", sus = q === "suspect";
            return <circle key={i} cx={X(v)} cy={Y(z)} r={bad || sus ? 3.2 : 1.8} fill={bad ? th.bad : sus ? th.warn : c} stroke={bad || sus ? th.bg : "none"} strokeWidth="0.8"
              onMouseEnter={() => setHover({ x: X(v), y: Y(z), text: `${l.label} · ${fmtN(z, 1)} ${zLabel.split(" ")[0]} · ${fmtN(v, 3)} ${unit}${q && q !== "good" ? " · QC " + q : ""}` })} />; })}</g>; })}
      {hover && <g pointerEvents="none"><line x1={L} x2={W - R} y1={hover.y} y2={hover.y} stroke={th.muted} strokeDasharray="2 2" /><rect x={Math.min(hover.x + 6, W - 190)} y={hover.y - 20} width="184" height="16" rx="3" fill={th.bg} stroke={th.grid} /><text x={Math.min(hover.x + 10, W - 186)} y={hover.y - 9} fill={th.fg} fontSize="9.5">{hover.text}</text></g>}
    </svg></div>;
}

// ---------------------------------------------------------------- T–S diagram
export type TSPoint = { s: number; t: number; z: number; group: string; qc?: string };
export function TSDiagram({ points, title, exportName = "ts-diagram", hollow }: { points: TSPoint[]; title?: string; exportName?: string; /** groups drawn as open circles (e.g. model) */ hollow?: { group: string; label: string; solidLabel: string } }) {
  const th = useChartTheme(), svg = useRef<SVGSVGElement>(null), [hover, setHover] = useState<TSPoint | null>(null);
  const W = 320, H = 280, L = 42, R = 12, T = 12, B = 30;
  const ok = points.filter(p => Number.isFinite(p.s) && Number.isFinite(p.t));
  if (ok.length < 2) return <div className="os-chart-empty">缺少同层位的温度与盐度，无法绘制 T–S 图</div>;
  let s0 = Math.min(...ok.map(p => p.s)), s1 = Math.max(...ok.map(p => p.s)), t0 = Math.min(...ok.map(p => p.t)), t1 = Math.max(...ok.map(p => p.t));
  const ps = Math.max(0.05, (s1 - s0) * 0.08), pt = Math.max(0.2, (t1 - t0) * 0.08); s0 -= ps; s1 += ps; t0 -= pt; t1 += pt;
  const X = (s: number) => L + (s - s0) / (s1 - s0) * (W - L - R), Y = (t: number) => H - B - (t - t0) / (t1 - t0) * (H - T - B);
  const zmax = Math.max(...ok.map(p => p.z), 1), groups = Array.from(new Set(ok.map(p => p.group)));
  // isopycnals: σ(S,T)=const solved for S at each T by bisection (σ increases with S)
  const iso = (() => {
    const lo = sigma0(s0, t1), hi = sigma0(s1, t0), levels = niceTicks(lo, hi, 6), out: { v: number; d: string }[] = [];
    for (const sg of levels) { let d = ""; for (let k = 0; k <= 40; k++) { const T_ = t0 + (t1 - t0) * k / 40; let a = s0 - 5, b = s1 + 5; for (let it = 0; it < 40; it++) { const m = (a + b) / 2; if (sigma0(m, T_) < sg) a = m; else b = m; } const S_ = (a + b) / 2; if (S_ < s0 || S_ > s1) continue; d += (d ? "L" : "M") + X(S_).toFixed(1) + "," + Y(T_).toFixed(1); } if (d) out.push({ v: sg, d }); }
    return out;
  })();
  return <div className="os-chart">
    <div className="os-chart-head">{title && <strong>{title}</strong>}<div className="os-legend-row"><span>颜色＝深度（0 → {fmtN(zmax, 0)} m）</span>{hollow ? <><span><i className="dot" />{hollow.solidLabel}</span><span><i className="dot hollow" />{hollow.label}</span></> : groups.length > 1 && <span>{groups.length} 条剖面</span>}</div><Tools svg={svg} name={exportName} /></div>
    <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="os-svg" style={{ background: th.bg }} onMouseLeave={() => setHover(null)}>
      {niceTicks(t0, t1, 5).map(t => <g key={"t" + t}><line x1={L} x2={W - R} y1={Y(t)} y2={Y(t)} stroke={th.grid} /><text x={L - 5} y={Y(t) + 3} textAnchor="end" fill={th.muted} fontSize="9.5">{fmtN(t, 1)}</text></g>)}
      {niceTicks(s0, s1, 5).map(s => <g key={"s" + s}><line x1={X(s)} x2={X(s)} y1={T} y2={H - B} stroke={th.grid} /><text x={X(s)} y={H - B + 12} textAnchor="middle" fill={th.muted} fontSize="9.5">{fmtN(s, 2)}</text></g>)}
      {iso.map(i => <g key={i.v}><path d={i.d} fill="none" stroke={th.muted} strokeOpacity="0.45" strokeDasharray="3 3" /><text x={W - R - 2} y={T + 10} fill={th.muted} fontSize="8.5" textAnchor="end" opacity="0">{i.v}</text></g>)}
      {iso.map(i => { const m = /M([\d.]+),([\d.]+)/.exec(i.d); return m ? <text key={"l" + i.v} x={+m[1] + 2} y={+m[2] - 3} fill={th.muted} fontSize="8.5" opacity="0.8">σt {fmtN(i.v, 1)}</text> : null; })}
      {ok.map((p, i) => { const f = Math.min(1, p.z / zmax), c = `hsl(${200 - f * 170} 80% ${62 - f * 22}%)`, open = hollow && p.group === hollow.group;
        return <circle key={i} cx={X(p.s)} cy={Y(p.t)} r={open ? 2.8 : p.qc === "bad" || p.qc === "suspect" ? 3.2 : 2.3} fill={open ? "none" : c} stroke={open ? c : p.qc === "bad" ? th.bad : p.qc === "suspect" ? th.warn : "none"} strokeWidth={open ? 1.1 : 1.2} onMouseEnter={() => setHover(p)} />; })}
      <text x={(L + W - R) / 2} y={H - 4} textAnchor="middle" fill={th.muted} fontSize="10">实用盐度 PSU</text>
      <text x={10} y={(T + H - B) / 2} textAnchor="middle" fill={th.muted} fontSize="10" transform={`rotate(-90 10 ${(T + H - B) / 2})`}>现场温度 °C</text>
      {hover && <g pointerEvents="none"><rect x={Math.min(X(hover.s) + 6, W - 176)} y={Y(hover.t) - 20} width="170" height="16" rx="3" fill={th.bg} stroke={th.grid} /><text x={Math.min(X(hover.s) + 10, W - 172)} y={Y(hover.t) - 9} fill={th.fg} fontSize="9.5">{`${hollow ? (hover.group === hollow.group ? hollow.label : hollow.solidLabel) + " · " : ""}S ${fmtN(hover.s, 3)} · T ${fmtN(hover.t, 3)} °C · ${fmtN(hover.z, 0)} m`}</text></g>}
    </svg>
    <small className="os-chart-note">虚线为 UNESCO 1981 状态方程计算的 σt 等密度线（使用现场温度，未换算位温）。</small></div>;
}

// ---------------------------------------------------------------- rose
export function Rose({ dir, speed, unit, convention, title, exportName = "rose" }: { dir: number[]; speed: number[]; unit: string; convention: "from" | "to"; title?: string; exportName?: string }) {
  const th = useChartTheme(), svg = useRef<SVGSVGElement>(null);
  const ok = dir.map((d, i) => [d, speed[i]] as const).filter(([d, s]) => Number.isFinite(d) && Number.isFinite(s)) as [number, number][];
  if (ok.length < 3) return <div className="os-chart-empty">方向样本不足（{ok.length}），无法绘制玫瑰图</div>;
  const sectors = 16, smax = Math.max(...ok.map(o => o[1])), edges = niceTicks(0, smax, 4).filter(x => x > 0).slice(0, 4); if (!edges.length || edges[edges.length - 1] < smax) edges.push(smax);
  const counts = Array.from({ length: sectors }, () => new Array(edges.length).fill(0));
  for (const [d, s] of ok) { const k = Math.round(((d % 360) + 360) % 360 / (360 / sectors)) % sectors; const b = edges.findIndex(e => s <= e); counts[k][b < 0 ? edges.length - 1 : b]++; }
  const tot = counts.map(c => c.reduce((a, b) => a + b, 0)), maxPct = Math.max(...tot) / ok.length * 100;
  const S = 260, c = S / 2, R = c - 26, colors = ["#2f89c5", "#3fb6c9", "#7ed3a0", "#f4d35e", "#f08a4b"];
  const wedge = (k: number, r0: number, r1: number) => { const a0 = (k - 0.5) * 2 * Math.PI / sectors - Math.PI / 2 + 0.02, a1 = (k + 0.5) * 2 * Math.PI / sectors - Math.PI / 2 - 0.02;
    return `M${c + r0 * Math.cos(a0)},${c + r0 * Math.sin(a0)} L${c + r1 * Math.cos(a0)},${c + r1 * Math.sin(a0)} A${r1},${r1} 0 0 1 ${c + r1 * Math.cos(a1)},${c + r1 * Math.sin(a1)} L${c + r0 * Math.cos(a1)},${c + r0 * Math.sin(a1)} A${r0},${r0} 0 0 0 ${c + r0 * Math.cos(a0)},${c + r0 * Math.sin(a0)}Z`; };
  return <div className="os-chart">
    <div className="os-chart-head">{title && <strong>{title}</strong>}<div className="os-legend-row">{edges.map((e, i) => <span key={i}><i style={{ background: colors[i] }} />≤ {fmtN(e, 1)} {unit}</span>)}</div><Tools svg={svg} name={exportName} /></div>
    <svg ref={svg} viewBox={`0 0 ${S} ${S}`} className="os-svg rose" style={{ background: th.bg }}>
      {[0.25, 0.5, 0.75, 1].map(f => <g key={f}><circle cx={c} cy={c} r={R * f} fill="none" stroke={th.grid} /><text x={c + 3} y={c - R * f + 10} fill={th.muted} fontSize="8.5">{fmtN(maxPct * f, 0)}%</text></g>)}
      {["N", "E", "S", "W"].map((l, i) => <text key={l} x={c + (R + 13) * Math.sin(i * Math.PI / 2)} y={c - (R + 13) * Math.cos(i * Math.PI / 2) + 4} textAnchor="middle" fill={th.fg} fontSize="11" fontWeight="600">{l}</text>)}
      {counts.map((cs, k) => { let acc = 0; return cs.map((n, b) => { if (!n) return null; const r0 = acc / ok.length * 100 / maxPct * R; acc += n; const r1 = acc / ok.length * 100 / maxPct * R; return <path key={k + "-" + b} d={wedge(k, r0, r1)} fill={colors[b]} opacity="0.9"><title>{`${(k * 22.5).toFixed(1)}° · ≤${fmtN(edges[b], 1)} ${unit} · ${n} 条`}</title></path>; }); })}
    </svg>
    <small className="os-chart-note">{convention === "from" ? "风向为来向（气象惯例）" : "流向为去向（海洋惯例）"}；16 方位，半径为频率，n = {ok.length}。</small></div>;
}

// ---------------------------------------------------------------- model–observation scatter (canvas, density coloured)
export function Scatter({ obs, model, unit, stats, onPick, exportName = "scatter", outlier }: { obs: number[]; model: number[]; unit: string; stats: any; onPick?: (i: number) => void; exportName?: string; outlier?: boolean[] }) {
  const th = useChartTheme(), cv = useRef<HTMLCanvasElement>(null), [hover, setHover] = useState<string>("");
  const W = 320, H = 300, L = 44, R = 10, T = 10, B = 30;
  const lim = useMemo(() => { const all = [...obs, ...model].filter(Number.isFinite).sort((a, b) => a - b); if (!all.length) return [0, 1]; const lo = all[Math.floor(all.length * 0.002)], hi = all[Math.ceil(all.length * 0.998) - 1]; const p = (hi - lo) * 0.05 || 1; return [lo - p, hi + p]; }, [obs, model]);
  const X = (v: number) => L + (v - lim[0]) / (lim[1] - lim[0]) * (W - L - R), Y = (v: number) => H - B - (v - lim[0]) / (lim[1] - lim[0]) * (H - T - B);
  useEffect(() => {
    const c = cv.current; if (!c) return; const d = devicePixelRatio || 1; c.width = W * d; c.height = H * d; const g = c.getContext("2d")!; g.scale(d, d);
    g.fillStyle = th.bg; g.fillRect(0, 0, W, H); g.font = "9.5px system-ui"; g.fillStyle = th.muted; g.strokeStyle = th.grid;
    for (const v of niceTicks(lim[0], lim[1], 5)) { g.beginPath(); g.moveTo(X(v), T); g.lineTo(X(v), H - B); g.moveTo(L, Y(v)); g.lineTo(W - R, Y(v)); g.stroke(); g.textAlign = "center"; g.fillText(fmtN(v, 1), X(v), H - B + 12); g.textAlign = "right"; g.fillText(fmtN(v, 1), L - 4, Y(v) + 3); }
    // density by 2-D binning
    const nb = 80, bins = new Float32Array(nb * nb), bi = (v: number) => Math.max(0, Math.min(nb - 1, Math.floor((v - lim[0]) / (lim[1] - lim[0]) * nb)));
    for (let i = 0; i < obs.length; i++) if (Number.isFinite(obs[i]) && Number.isFinite(model[i])) bins[bi(model[i]) * nb + bi(obs[i])]++;
    const mx = Math.log1p(Math.max(...bins)) || 1;
    for (let i = 0; i < obs.length; i++) { const o = obs[i], m = model[i]; if (!Number.isFinite(o) || !Number.isFinite(m)) continue; const f = Math.log1p(bins[bi(m) * nb + bi(o)]) / mx;
      g.fillStyle = outlier?.[i] ? "rgba(255,77,79,0.85)" : `hsla(${205 - f * 160},85%,${48 + f * 18}%,${0.35 + f * 0.6})`; g.fillRect(X(o) - 1.1, Y(m) - 1.1, 2.2, 2.2); }
    g.strokeStyle = th.muted; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(X(lim[0]), Y(lim[0])); g.lineTo(X(lim[1]), Y(lim[1])); g.stroke(); g.setLineDash([]);
    if (stats?.slope != null) { g.strokeStyle = th.accent; g.lineWidth = 1.6; g.beginPath(); g.moveTo(X(lim[0]), Y(stats.intercept + stats.slope * lim[0])); g.lineTo(X(lim[1]), Y(stats.intercept + stats.slope * lim[1])); g.stroke(); g.lineWidth = 1; }
    g.fillStyle = th.muted; g.font = "10px system-ui"; g.textAlign = "center"; g.fillText(`观测 ${unit}`, (L + W - R) / 2, H - 4);
    g.save(); g.translate(11, (T + H - B) / 2); g.rotate(-Math.PI / 2); g.fillText(`模式 ${unit}`, 0, 0); g.restore();
  }, [obs, model, th, lim, stats, outlier]);
  const move = (e: React.MouseEvent) => {
    const r = (e.target as HTMLCanvasElement).getBoundingClientRect(), x = (e.clientX - r.left) / r.width * W, y = (e.clientY - r.top) / r.height * H;
    let best = -1, bd = 36; for (let i = 0; i < obs.length; i++) { const dx = X(obs[i]) - x, dy = Y(model[i]) - y, dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; best = i; } }
    setHover(best >= 0 ? `观测 ${fmtN(obs[best], 2)} · 模式 ${fmtN(model[best], 2)} ${unit} · 差 ${fmtN(model[best] - obs[best], 2)}` : ""); (e.target as any).dataset.pick = best;
  };
  return <div className="os-chart">
    <div className="os-chart-head"><strong>模式 vs 观测</strong><div className="os-legend-row"><span><i className="dash" style={{ background: th.muted }} />1:1</span>{stats?.slope != null && <span><i style={{ background: th.accent }} />回归 y = {fmtN(stats.slope, 3)}x {stats.intercept >= 0 ? "+" : "−"} {fmtN(Math.abs(stats.intercept), 2)}</span>}</div>
      <div className="os-chart-tools"><button title="导出 PNG" onClick={() => cv.current && download(cv.current.toDataURL("image/png"), exportName + ".png")}><ImageDown size={13} /></button></div></div>
    <canvas ref={cv} className="os-svg" style={{ width: "100%", aspectRatio: `${W}/${H}` }} onMouseMove={move} onMouseLeave={() => setHover("")} onClick={e => { const i = +(e.target as any).dataset.pick; if (i >= 0 && onPick) onPick(i); }} />
    <small className="os-chart-note">{hover || `颜色为点密度（对数），红点为 5×MAD 离群配对；n = ${obs.length.toLocaleString()}${stats?.n > obs.length ? `（显示随机子样，统计用全部 ${stats.n.toLocaleString()} 对）` : ""}`}</small></div>;
}

export function Histogram({ counts, edges, unit, title, color, exportName = "histogram" }: { counts: number[]; edges: number[]; unit: string; title?: string; color?: string; exportName?: string }) {
  const th = useChartTheme(), svg = useRef<SVGSVGElement>(null), W = 320, H = 130, L = 8, B = 22, max = Math.max(...counts, 1), bw = (W - 2 * L) / counts.length;
  const zero = edges[0] < 0 && edges[edges.length - 1] > 0 ? L + (0 - edges[0]) / (edges[edges.length - 1] - edges[0]) * (W - 2 * L) : null;
  return <div className="os-chart"><div className="os-chart-head">{title && <strong>{title}</strong>}<Tools svg={svg} name={exportName} /></div>
    <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="os-svg" style={{ background: th.bg }}>
      {counts.map((n, i) => <rect key={i} x={L + i * bw + 0.5} width={bw - 1} y={H - B - n / max * (H - B - 6)} height={n / max * (H - B - 6)} fill={color || th.accent} opacity="0.85"><title>{`${fmtN(edges[i], 2)} ~ ${fmtN(edges[i + 1], 2)} ${unit}：${n}`}</title></rect>)}
      {zero != null && <line x1={zero} x2={zero} y1={4} y2={H - B} stroke={th.fg} strokeDasharray="3 2" opacity="0.6" />}
      <text x={L} y={H - 6} fill={th.muted} fontSize="9.5">{fmtN(edges[0], 2)}</text><text x={W - L} y={H - 6} fill={th.muted} fontSize="9.5" textAnchor="end">{fmtN(edges[edges.length - 1], 2)} {unit}</text>
    </svg></div>;
}

export function Bars({ rows, label, value, unit, theme }: { rows: { name: string; v: number | null; n: number }[]; label: string; value: string; unit: string; theme?: ChartTheme }) {
  const th = useChartTheme(), t = theme || th, max = Math.max(...rows.map(r => Math.abs(r.v ?? 0)), 1e-9);
  return <div className="os-bars"><div className="os-bars-head"><span>{label}</span><span>{value}</span></div>
    {rows.map(r => <div key={r.name} className="os-bar"><span className="name" title={r.name}>{r.name}</span><span className="track"><i style={{ width: `${Math.abs(r.v ?? 0) / max * 50}%`, left: (r.v ?? 0) < 0 ? `${50 - Math.abs(r.v ?? 0) / max * 50}%` : "50%", background: (r.v ?? 0) < 0 ? "#4fa3e0" : "#f08a4b" }} /></span><b>{fmtN(r.v, 2)}</b><small>n={r.n}</small></div>)}
    <small className="os-chart-note" style={{ color: t.muted }}>单位 {unit}；条形以 0 为中心（蓝为负、橙为正）。</small></div>;
}
