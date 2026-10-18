// Unified time control: model valid times (dots), observation density per dataset (histogram lanes),
// coverage bars, the observation window and a draggable cursor. Only real data times are offered.
import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, Square, SkipBack, SkipForward } from "lucide-react";
import { fmtN } from "../charts/theme";

export type Lane = { key: string; label: string; color: string; t0: number; t1: number; hist?: { start: number; step: number; counts: number[] } };
type Props = {
  domain: [number, number]; cursor: number; setCursor: (t: number) => void; frames: number[]; frameShown: number | null;
  lanes: Lane[]; windowH: number; setWindowH: (h: number) => void; playing: boolean; setPlaying: (p: boolean) => void; stop: () => void;
  step: "model" | number; setStep: (s: "model" | number) => void; fps: number; setFps: (n: number) => void; step1: (dir: 1 | -1) => void;
  interp: boolean; setInterp: (b: boolean) => void; canInterp: boolean; loading: boolean; cached: boolean[]; tz: "utc" | "local"; setTz: (t: "utc" | "local") => void;
  depth?: { values: number[]; units: string } | null; depthValue?: number | null; setDepth?: (d: number) => void; compact?: boolean;
};
const pad = (n: number) => String(n).padStart(2, "0");
export const fmtTime = (ms: number | null | undefined, tz: "utc" | "local" = "utc", withYear = true) => {
  if (ms == null || !Number.isFinite(ms)) return "—"; const d = new Date(ms);
  const [Y, M, D, h, m] = tz === "utc" ? [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()] : [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()];
  return `${withYear ? Y + "-" : ""}${pad(M)}-${pad(D)} ${pad(h)}:${pad(m)}${tz === "utc" ? " UTC" : ""}`;
};
const offsetLabel = () => { const o = -new Date().getTimezoneOffset() / 60; return `UTC${o >= 0 ? "+" : ""}${o}`; };

export function Timeline(p: Props) {
  const svg = useRef<SVGSVGElement>(null), [w, setW] = useState(800), drag = useRef(false);
  useEffect(() => { if (!svg.current) return; const ro = new ResizeObserver(e => setW(Math.max(300, e[0].contentRect.width))); ro.observe(svg.current); return () => ro.disconnect(); }, []);
  const [a, b] = p.domain, span = Math.max(1, b - a), PX = 10, X = (t: number) => PX + (t - a) / span * (w - 2 * PX);
  const ticks = useMemo(() => {
    // pick a step so labels are ≥ 70 px apart; months / years for long spans
    const H = 3.6e6, D = 24 * H, steps = [H, 3 * H, 6 * H, 12 * H, D, 2 * D, 5 * D, 10 * D, 30 * D, 91 * D, 182 * D, 365 * D];
    const minPx = 70, px = (w - 20) / span, stepMs = steps.find(st => st * px >= minPx) || 365 * D, out: { t: number; major: boolean; label: string }[] = [];
    const lab = (t: number) => { const d = new Date(t); return stepMs >= 30 * D ? `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}` : stepMs >= D ? `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` : `${pad(d.getUTCHours())}:00`; };
    if (stepMs >= 30 * D) { const d = new Date(a); let y = d.getUTCFullYear(), m = d.getUTCMonth() + 1; const mstep = Math.round(stepMs / (30 * D));
      for (let k = 0; k < 60; k++) { const t = Date.UTC(y, m, 1); if (t > b) break; if (t >= a) out.push({ t, major: true, label: lab(t) }); m += mstep; } }
    else for (let t = Math.ceil(a / stepMs) * stepMs; t <= b && out.length < 60; t += stepMs) out.push({ t, major: true, label: lab(t) });
    return out;
  }, [a, b, span, w]);
  const seek = (clientX: number) => {
    const r = svg.current!.getBoundingClientRect(), t = a + Math.max(0, Math.min(1, (clientX - r.left - PX) / (r.width - 2 * PX))) * span;
    if (p.step === "model" && p.frames.length) { let best = p.frames[0]; for (const f of p.frames) if (Math.abs(f - t) < Math.abs(best - t)) best = f; p.setCursor(best); }
    else p.setCursor(Math.round(t / 6e5) * 6e5);
  };
  const H = p.compact ? 40 : 30 + p.lanes.length * 14 + 14, laneY = (i: number) => 22 + i * 14;
  const dtFrame = p.frameShown != null ? (p.cursor - p.frameShown) / 3.6e6 : null;
  return <div className={"os-timeline" + (p.compact ? " compact" : "")} aria-label="时间轴">
    <div className="tl-ctl">
      <button className="icon" title="上一步 (←)" aria-label="上一步" onClick={() => p.step1(-1)}><SkipBack size={15} /></button>
      <button className="icon play" title={p.playing ? "暂停 (空格)" : "播放 (空格)"} aria-label={p.playing ? "暂停" : "播放"} onClick={() => p.setPlaying(!p.playing)}>{p.playing ? <Pause size={16} /> : <Play size={16} />}</button>
      <button className="icon" title="下一步 (→)" aria-label="下一步" onClick={() => p.step1(1)}><SkipForward size={15} /></button>
      <button className="icon" title="停止并回到起点" aria-label="停止" onClick={p.stop}><Square size={13} /></button>
    </div>
    <div className="tl-now">
      <strong>{fmtTime(p.cursor, p.tz)}</strong>
      <span>{p.frameShown != null ? <>模式 {fmtTime(p.frameShown, p.tz, false)}{dtFrame && Math.abs(dtFrame) > 0.01 ? <em className={Math.abs(dtFrame) > 3 ? "warn" : ""}> Δ{dtFrame > 0 ? "+" : ""}{fmtN(dtFrame, 1)} h{p.interp && p.canInterp ? " · 插值显示" : ""}</em> : null}</> : "无模式数据"}
        {p.lanes.length > 0 && <> · 观测 {fmtTime(p.cursor - p.windowH * 3.6e6, p.tz, false).slice(6)} – {fmtTime(p.cursor, p.tz, false).slice(6)}</>}</span>
      {p.loading && <i className="tl-loading">读取中</i>}
    </div>
    <svg ref={svg} className="tl-track" height={H} onPointerDown={e => { drag.current = true; (e.target as Element).setPointerCapture?.(e.pointerId); p.setPlaying(false); seek(e.clientX); }}
      onPointerMove={e => drag.current && seek(e.clientX)} onPointerUp={() => { drag.current = false; }} role="slider" aria-valuemin={a} aria-valuemax={b} aria-valuenow={p.cursor} aria-label="当前时间">
      <rect x={PX} y={8} width={w - 2 * PX} height={H - 14} rx="4" className="tl-bg" />
      {ticks.map(t => <g key={t.t}><line x1={X(t.t)} x2={X(t.t)} y1={8} y2={H - 6} className={t.major ? "tl-tick major" : "tl-tick"} /><text x={X(t.t) + 3} y={H - 8} className="tl-ticklabel">{t.label}</text></g>)}
      <rect x={X(p.cursor - p.windowH * 3.6e6)} y={8} width={Math.max(1, X(p.cursor) - X(p.cursor - p.windowH * 3.6e6))} height={H - 14} className="tl-window" />
      {!p.compact && p.lanes.map((l, i) => { const y = laneY(i); return <g key={l.key}>
        <rect x={X(l.t0)} y={y + 9} width={Math.max(2, X(l.t1) - X(l.t0))} height={2} fill={l.color} opacity="0.55" rx="1" />
        {l.hist && (() => { const mx = Math.max(...l.hist.counts, 1); return l.hist.counts.map((c, k) => c ? <rect key={k} x={X(l.hist!.start + k * l.hist!.step)} y={y + 9 - c / mx * 9} width={Math.max(1, X(l.hist!.start + (k + 1) * l.hist!.step) - X(l.hist!.start + k * l.hist!.step) - 0.5)} height={c / mx * 9} fill={l.color} opacity="0.85"><title>{`${l.label} · ${fmtTime(l.hist!.start + k * l.hist!.step, p.tz)} · ${c} 条`}</title></rect> : null); })()}
        <text x={PX + 4} y={y + 6} className="tl-lane">{l.label}</text></g>; })}
      {p.frames.map((f, i) => <circle key={f} cx={X(f)} cy={p.compact ? 20 : 15} r={f === p.frameShown ? 4 : 2.6} className={"tl-frame" + (p.cached[i] ? " ready" : "") + (f === p.frameShown ? " on" : "")}><title>{"模式时刻 " + fmtTime(f, p.tz)}</title></circle>)}
      <line x1={X(p.cursor)} x2={X(p.cursor)} y1={4} y2={H - 4} className="tl-cursor" /><circle cx={X(p.cursor)} cy={4} r="4" className="tl-cursor-head" />
    </svg>
    <div className="tl-opts">
      <select value={p.step} onChange={e => p.setStep(e.target.value === "model" ? "model" : Number(e.target.value))} aria-label="步长" title="播放步长">
        <option value="model" disabled={!p.frames.length}>步长：模式时刻</option>{[1, 3, 6, 12, 24].map(h => <option key={h} value={h}>步长：{h} h</option>)}</select>
      <select value={p.fps} onChange={e => p.setFps(Number(e.target.value))} aria-label="播放速度" title="播放速度">{[0.5, 1, 2, 4, 8].map(v => <option key={v} value={v}>{v} 帧/秒</option>)}</select>
      {p.lanes.length > 0 && <select value={p.windowH} onChange={e => p.setWindowH(Number(e.target.value))} aria-label="观测时间窗" title="显示截至当前时刻多长时间内的观测">{[1, 3, 6, 12, 24, 72, 240, 24 * 365 * 5].map(h => <option key={h} value={h}>观测窗 {h >= 24 * 365 ? "全部" : h >= 24 ? h / 24 + " 天" : h + " h"}</option>)}</select>}
      <label className="tl-check" title={p.canInterp ? "游标位于两个模式时刻之间时，按时间权重线性混合两帧（仅用于显示，点查询仍报告原始时刻）" : "需要游标两侧都有模式时刻"}><input type="checkbox" checked={p.interp} disabled={!p.canInterp} onChange={e => p.setInterp(e.target.checked)} />时间插值</label>
      {p.depth && p.depth.values.length > 1 && p.setDepth && <select value={p.depthValue ?? ""} onChange={e => p.setDepth!(Number(e.target.value))} aria-label="深度">{p.depth.values.map(v => <option key={v} value={v}>深度 {fmtN(v, v < 10 ? 1 : 0)} {p.depth!.units || "m"}</option>)}</select>}
      <button className="tz" onClick={() => p.setTz(p.tz === "utc" ? "local" : "utc")} title="切换显示时区（数据均以 UTC 存储）">{p.tz === "utc" ? "UTC" : offsetLabel()}</button>
    </div>
  </div>;
}
