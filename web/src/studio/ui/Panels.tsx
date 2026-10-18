import { t as i18nText } from "../../i18n";
import { useMemo, useState } from "react";
import { Search, Layers, Wind, Waves, Spline, Database, Radio, GitCompare, ChevronDown, Play, AlertTriangle, Check, Info } from "lucide-react";
import type { VizDataset, ObsSummary, Suggestion, VizVector } from "../api";
import { tms } from "../api";
import { fmtN } from "../charts/theme";
import { fmtTime } from "./Timeline";
import { gradientCss, PALETTES } from "../../viz/palettes";
import { TYPE_STYLE } from "../map/ObsLayer";
import { QC_COLOR, QC_ZH } from "./Inspectors";
import type { ScalarOpt } from "../../viz/model";
import { bytes } from "../../api";

export function Section({ icon, title, children, open: o = true, right }: { icon: React.ReactNode; title: string; children: React.ReactNode; open?: boolean; right?: React.ReactNode }) {
  const [open, setOpen] = useState(o);
  return <section className={"os-sec" + (open ? " open" : "")}><header><button onClick={() => setOpen(!open)} aria-expanded={open}>{icon}<span>{title}</span><ChevronDown size={13} className="chev" /></button>{right}</header>{open && <div className="os-sec-body">{children}</div>}</section>;
}
const Slider = ({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string }) =>
  <label className="os-slider"><span>{label}<b>{fmt ? fmt(value) : value}</b></span><input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} /></label>;
const Toggle = ({ on, set, label, hint }: { on: boolean; set: (b: boolean) => void; label: string; hint?: string }) =>
  <label className="os-switch" title={hint}><input type="checkbox" checked={on} onChange={e => set(e.target.checked)} /><i /><span>{label}</span></label>;
const Seg = <T extends string>({ value, set, items }: { value: T; set: (v: T) => void; items: [T, string][] }) =>
  <div className="os-seg">{items.map(([k, l]) => <button key={k} className={value === k ? "on" : ""} onClick={() => set(k)}>{l}</button>)}</div>;

export function DatasetList({ items, active, onPick, kind }: { items: VizDataset[]; active: string | null; onPick: (id: string) => void; kind: "grid" | "observations" }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => items.filter(d => d.kind === kind && (!q || [d.provider_label, d.dataset, d.path, ...(d.summary?.variables.map(v => v.name + v.label) || [])].join(" ").toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => Number(b.renderable) - Number(a.renderable) || (b.completed || 0) - (a.completed || 0)), [items, q, kind]);
  return <div className="os-dslist">
    <div className="os-search"><Search size={13} /><input value={q} onChange={e => setQ(e.target.value)} placeholder={kind === "grid" ? i18nText("搜索模式产品、变量、文件") : i18nText("搜索观测产品、平台、变量")} aria-label={i18nText("搜索数据集")} /></div>
    <div className="os-dsitems">{list.map(d => { const s = d.summary, o = d.observations, t = s?.times?.length ? s.times : o?.times || [];
      return <button key={d.id} className={"os-ds" + (d.id === active ? " on" : "") + (d.renderable ? "" : " off")} onClick={() => d.renderable && onPick(d.id)} title={d.reason || d.path}>
        <div className="r1"><strong>{d.provider_label}</strong><span>{bytes(d.bytes)}</span></div>
        <div className="r2">{d.dataset?.length > 40 ? "…" + d.dataset.slice(-39) : d.dataset}</div>
        <div className="r3">{t.length ? (t[0] === t[t.length - 1] ? fmtTime(tms(t[0]), "utc") : `${fmtTime(tms(t[0]), "utc", false)} → ${fmtTime(tms(t[t.length - 1]), "utc", false)}`) : i18nText("无时间信息")}
          {s ? i18nText(" · {0} 步{1}", s.steps, s.depth_levels ? i18nText(" · {0} 层", s.depth_levels) : "") : o ? i18nText(" · {0} 平台 · {1} 条", o.stations, o.records.toLocaleString()) : ""}</div>
        {!d.renderable && d.reason && <div className="why"><AlertTriangle size={11} />{d.reason}</div>}
      </button>; })}
      {!list.length && <div className="os-empty-s">{i18nText("没有匹配的数据文件。")}</div>}</div>
  </div>;
}

// ---------------------------------------------------------------- mode A
export type FieldUi = { palette: string; opacity: number; bands: number; contours: boolean; contourStep: number };
export type FlowUi = { particles: boolean; arrows: boolean; density: number; speed: number; trail: number; width: number; bright: number; color: "white" | "speed" | "dark" };
export function ModelPanel(p: {
  datasets: VizDataset[]; modelId: string | null; setModelId: (id: string) => void; scalars: ScalarOpt[]; scalarId: string | null; setScalarId: (s: string) => void;
  range: [number, number] | null; setRange: (r: [number, number]) => void; autoRange: () => void; field: FieldUi; setField: (f: FieldUi) => void;
  vectors: VizVector[]; vectorId: string | null; setVectorId: (s: string) => void; flowSource: string | null; setFlowSource: (s: string | null) => void; flowSets: VizDataset[];
  flow: FlowUi; setFlow: (f: FlowUi) => void; waveVec: VizVector | null; waves: boolean; setWaves: (b: boolean) => void; unit: string; frameNote: string; hideDatasets?: boolean;
}) {
  const f = p.field, set = (k: keyof FieldUi, v: any) => p.setField({ ...f, [k]: v }), fl = p.flow, setF = (k: keyof FlowUi, v: any) => p.setFlow({ ...fl, [k]: v });
  const scalar = p.scalars.find(s => s.id === p.scalarId), pal = f.palette || scalar?.spec.palette || "viridis";
  return <>
    {!p.hideDatasets && <Section icon={<Database size={14} />} title={i18nText("模式数据集")}><DatasetList items={p.datasets} active={p.modelId} onPick={p.setModelId} kind="grid" />{p.frameNote && <small className="os-note">{p.frameNote}</small>}</Section>}
    <Section icon={<Layers size={14} />} title={i18nText("颜色场")}>
      <label className="os-field">{i18nText("变量")}<select value={p.scalarId || "none"} onChange={e => p.setScalarId(e.target.value)}><option value="none">{i18nText("不显示")}</option>{p.scalars.map(s => <option key={s.id} value={s.id}>{s.label} · {s.short}{(s.spec.unit || s.units) ? ` (${s.spec.unit || s.units})` : ""}</option>)}</select></label>
      {scalar && p.scalarId !== "none" && <>
        <div className="os-palettes">{["thermal", "haline", "speed", "wind", "waves", "balance", "pressure", "rain", "ice", "algae", "viridis", "gray"].map(id => <button key={id} title={PALETTES[id].label} className={pal === id ? "on" : ""} style={{ background: gradientCss(id) }} onClick={() => set("palette", id)} />)}</div>
        <div className="os-range"><input type="number" step="any" aria-label={i18nText("色标最小值")} value={p.range ? +p.range[0].toPrecision(5) : ""} onChange={e => p.range && p.setRange([Number(e.target.value), p.range[1]])} /><span>–</span>
          <input type="number" step="any" aria-label={i18nText("色标最大值")} value={p.range ? +p.range[1].toPrecision(5) : ""} onChange={e => p.range && p.setRange([p.range[0], Number(e.target.value)])} /><em>{p.unit}</em>
          <button onClick={p.autoRange} title={i18nText("按当前视图数据 2%–98% 分位数拉伸")}>{i18nText("按视图")}</button></div>
        <Slider label={i18nText("不透明度")} value={f.opacity} min={0.1} max={1} step={0.02} onChange={v => set("opacity", v)} fmt={v => Math.round(v * 100) + "%"} />
        <div className="os-row2"><Toggle on={f.bands > 0} set={b => set("bands", b ? 14 : 0)} label={i18nText("分级色带")} /><Toggle on={f.contours} set={b => set("contours", b)} label={i18nText("等值线 + 标注")} /></div>
        {f.contours && <label className="os-field inline">{i18nText("间隔")}<input type="number" step="any" min={0} value={f.contourStep || scalar.spec.contour || ""} placeholder={i18nText("自动")} onChange={e => set("contourStep", Number(e.target.value) || 0)} /><em>{p.unit}</em></label>}
      </>}
    </Section>
    <Section icon={<Wind size={14} />} title={i18nText("流场动画与矢量")}>
      <label className="os-field">{i18nText("矢量数据")}<select value={p.flowSource || p.modelId || ""} onChange={e => p.setFlowSource(e.target.value === p.modelId ? null : e.target.value)}><option value={p.modelId || ""}>{i18nText("当前数据集")}{p.vectors.length ? "" : i18nText("（无 U/V）")}</option>{p.flowSets.filter(d => d.id !== p.modelId).map(d => <option key={d.id} value={d.id}>{d.provider_label} · {d.dataset}</option>)}</select></label>
      <label className="os-field">{i18nText("矢量")}<select value={p.vectorId || "none"} onChange={e => p.setVectorId(e.target.value)}><option value="none">{i18nText("不显示")}</option>{p.vectors.filter(v => v.u).map(v => <option key={v.id} value={v.id}>{v.label}（{v.u}, {v.v}）</option>)}</select></label>
      {p.vectorId && p.vectorId !== "none" && <>
        <div className="os-row2"><Toggle on={fl.particles} set={b => setF("particles", b)} label={i18nText("粒子流（GPU）")} /><Toggle on={fl.arrows} set={b => setF("arrows", b)} label={i18nText("矢量箭头")} /></div>
        <Slider label={i18nText("粒子密度")} value={fl.density} min={0.3} max={3} step={0.1} onChange={v => setF("density", v)} fmt={v => v.toFixed(1) + "×"} />
        <Slider label={i18nText("速度比例")} value={fl.speed} min={0.2} max={4} step={0.1} onChange={v => setF("speed", v)} fmt={v => v.toFixed(1) + "×"} />
        <Slider label={i18nText("尾迹长度")} value={fl.trail} min={8} max={48} step={1} onChange={v => setF("trail", v)} fmt={v => v + i18nText(" 步")} />
        <Slider label={i18nText("亮度")} value={fl.bright} min={0.3} max={1.6} step={0.05} onChange={v => setF("bright", v)} fmt={v => Math.round(v * 100) + "%"} />
        <Slider label={i18nText("线宽")} value={fl.width} min={0.6} max={3} step={0.1} onChange={v => setF("width", v)} fmt={v => v.toFixed(1) + " px"} />
        <Seg value={fl.color} set={v => setF("color", v)} items={[["white", i18nText("白色")], ["speed", i18nText("按速度着色")], ["dark", i18nText("深色")]]} />
        <small className="os-note">{i18nText("位移 = 双线性插值的真实 U/V × 时间步；屏幕速度与物理速度成正比。随机数只决定粒子起点和寿命。")}</small>
      </>}
    </Section>
    {p.waveVec && <Section icon={<Waves size={14} />} title={i18nText("海浪传播")} open={false}>
      <Toggle on={p.waves} set={p.setWaves} label={i18nText("浪向传播动画（{0} 来向 → 去向）", p.waveVec.direction)} />
      <small className="os-note">{i18nText("波向文件为“来向”（气象惯例），动画沿传播去向（+180°）；粒子亮度与有效波高成正比，不代表波浪相速度。")}</small>
    </Section>}
  </>;
}

// ---------------------------------------------------------------- mode B
export type ObsUi = { variable: Record<string, string | null>; qc: "default" | "good" | "all"; tracks: boolean; density: boolean; types: string[]; unify: boolean; depthMax: number | null };
export function ObsPanel(p: { datasets: VizDataset[]; selected: string[]; toggle: (id: string) => void; summaries: Record<string, ObsSummary>; ui: ObsUi; setUi: (u: ObsUi) => void; counts: Record<string, number>; canUnify: boolean }) {
  const ui = p.ui, set = (k: keyof ObsUi, v: any) => p.setUi({ ...ui, [k]: v });
  const types = useMemo(() => { const m: Record<string, number> = {}; for (const id of p.selected) for (const t of p.summaries[id]?.types || []) m[t.id] = (m[t.id] || 0) + t.count; return m; }, [p.selected, p.summaries]);
  return <>
    <Section icon={<Radio size={14} />} title={i18nText("观测数据集")} right={<small className="os-badge">{p.selected.length} {" " + i18nText("已加载")}</small>}>
      <div className="os-dslist"><div className="os-dsitems">{p.datasets.filter(d => d.kind === "observations").sort((a, b) => (b.observations?.records || 0) - (a.observations?.records || 0)).map(d => { const on = p.selected.includes(d.id), o = d.observations;
        return <button key={d.id} className={"os-ds check" + (on ? " on" : "") + (d.renderable ? "" : " off")} onClick={() => d.renderable && p.toggle(d.id)} title={d.path}>
          <span className="box">{on && <Check size={11} />}</span>
          <div><div className="r1"><strong>{d.dataset}</strong><span>{o ? i18nText("{0} 平台", o.stations) : ""}</span></div>
            <div className="r3">{o?.times?.length ? `${fmtTime(tms(o.times[0]), "utc", false)} → ${fmtTime(tms(o.times[1]), "utc", false)}` : ""}{o ? i18nText(" · {0} 条{1}", o.records.toLocaleString(), o.vertical ? i18nText(" · 剖面") : "") : ""}</div></div></button>; })}</div></div>
    </Section>
    {p.selected.map(id => { const s = p.summaries[id]; if (!s) return null; const vars = s.variables.filter(v => v.valid > 0);
      return <Section key={id} icon={<span className="os-dot" style={{ background: "var(--accent)" }} />} title={s.dataset} right={<small className="os-badge">{(p.counts[id] ?? 0).toLocaleString()} {" " + i18nText("点")}</small>}>
        <small className="os-note">{s.family} · {s.platform_count.toLocaleString()} {" " + i18nText("平台 ·") + " "}{s.records.toLocaleString()} {" " + i18nText("条")}</small>
        <label className="os-field">{i18nText("着色变量")}<select value={ui.variable[id] ?? ""} onChange={e => set("variable", { ...ui.variable, [id]: e.target.value || null })}><option value="">{i18nText("按平台类型")}</option>{vars.map(v => <option key={v.name} value={v.name}>{v.label} · {v.name}（{v.display_unit}）· {v.valid.toLocaleString()}</option>)}</select></label>
        {s.notes.map((n, i) => <small key={i} className="os-note warn"><Info size={11} />{n}</small>)}
      </Section>; })}
    {p.selected.length > 0 && <Section icon={<Spline size={14} />} title={i18nText("显示与筛选")}>
      <label className="os-field">{i18nText("质量控制")}<select value={ui.qc} onChange={e => set("qc", e.target.value)}><option value="default">{i18nText("排除 错误 / 缺测（默认）")}</option><option value="good">{i18nText("仅 正常 / 基本可信")}</option><option value="all">{i18nText("全部记录（含错误）")}</option></select></label>
      <div className="os-row2"><Toggle on={ui.tracks} set={b => set("tracks", b)} label={i18nText("移动平台轨迹")} /><Toggle on={ui.density} set={b => set("density", b)} label={i18nText("站点密度热图")} /></div>
      {p.canUnify && <Toggle on={ui.unify} set={b => set("unify", b)} label={i18nText("与模式颜色场统一色标")} hint={i18nText("同一物理量时使用模式色标，便于直接比较")} />}
      {p.selected.some(id => p.summaries[id]?.vertical) && <label className="os-field">{i18nText("剖面取值深度")}<select value={ui.depthMax ?? ""} onChange={e => set("depthMax", e.target.value === "" ? null : Number(e.target.value))}><option value="">{i18nText("最浅有效层")}</option>{[10, 50, 100, 500, 1000, 2000].map(d => <option key={d} value={d}>≤ {d} {" " + i18nText("m 内最浅层")}</option>)}</select></label>}
      <div className="os-legend-types">{Object.entries(types).map(([t, n]) => { const st = TYPE_STYLE[t] || TYPE_STYLE.unknown; return <span key={t}><i style={{ background: st.color }} />{st.label}<b>{n.toLocaleString()}</b></span>; })}</div>
      <div className="os-legend-types qc">{(["suspect", "bad"] as const).map(k => <span key={k}><i className="ring" style={{ borderColor: QC_COLOR[k] }} />{QC_ZH[k]}{i18nText("（外圈）")}</span>)}</div>
    </Section>}
  </>;
}

// ---------------------------------------------------------------- mode C
export type FusionUi = { model: string | null; obs: string | null; obsVar: string | null; maxDt: number; interp: boolean; qc: "default" | "good"; depthMax: number; useView: boolean };
export type ProfileUi = { modelT: string | null; modelS: string | null; maxDt: number; maxDepth: number; adjusted: boolean };
/** 3-D model grids carrying a depth-resolved variable of this kind (for Argo profile matching). */
export const layeredGrids = (datasets: VizDataset[], kind: string) => datasets.filter(d => d.kind === "grid" && d.renderable && (d.summary?.depth_levels || 0) > 1 && d.summary!.variables.some(v => v.kind === kind && v.mapable));
export function FusionPanel(p: { datasets: VizDataset[]; ui: FusionUi; setUi: (u: FusionUi) => void; suggestions: Suggestion[] | null; summaries: Record<string, ObsSummary>; run: () => void; busy: boolean; result: any; openResult: () => void;
  prof: ProfileUi; setProf: (u: ProfileUi) => void; runProfiles: () => void; profBusy: boolean; profResult: { n: number; rmse: number; unit: string } | null; openProfiles: () => void }) {
  const ui = p.ui, set = (k: keyof FusionUi, v: any) => p.setUi({ ...ui, [k]: v });
  const grids = p.datasets.filter(d => d.kind === "grid" && d.renderable), obs = p.datasets.filter(d => d.kind === "observations" && d.renderable);
  const s = ui.obs ? p.summaries[ui.obs] : null;
  const sug = (p.suggestions || []).filter(x => x.overlap);
  return <>
    <Section icon={<GitCompare size={14} />} title={i18nText("推荐配对（时间重叠）")}>
      {!p.suggestions && <small className="os-note">{i18nText("分析本地数据…")}</small>}
      {p.suggestions && !sug.length && <small className="os-note warn"><AlertTriangle size={11} />{i18nText("本地的模式与观测没有时间重叠的物理量配对。可在下方手动选择，但结果会提示超出时间容差。")}</small>}
      <div className="os-sugs">{dedupe(sug).slice(0, 8).map(x => <button key={x.model + x.obs + x.obs_var} className={ui.model === x.model && ui.obs === x.obs && ui.obsVar === x.obs_var ? "on" : ""} onClick={() => p.setUi({ ...ui, model: x.model, obs: x.obs, obsVar: x.obs_var })}>
        <b>{x.obs_label}</b><span>{x.model_provider.toUpperCase()} {x.model_dataset} × {x.obs_dataset}</span><small>{x.valid.toLocaleString()} {" " + i18nText("条观测")}</small></button>)}</div>
    </Section>
    <Section icon={<Database size={14} />} title={i18nText("匹配设置")}>
      <label className="os-field">{i18nText("模式数据")}<select value={ui.model || ""} onChange={e => set("model", e.target.value)}><option value="">{i18nText("选择…")}</option>{grids.map(d => <option key={d.id} value={d.id}>{d.provider_label} · {d.dataset} · {d.summary?.times?.[0]?.slice(0, 13).replace("T", " ")}</option>)}</select></label>
      <label className="os-field">{i18nText("观测数据")}<select value={ui.obs || ""} onChange={e => p.setUi({ ...ui, obs: e.target.value, obsVar: null })}><option value="">{i18nText("选择…")}</option>{obs.map(d => <option key={d.id} value={d.id}>{d.dataset} · {d.observations?.times?.[0]?.slice(0, 10)}</option>)}</select></label>
      <label className="os-field">{i18nText("观测变量")}<select value={ui.obsVar || ""} onChange={e => set("obsVar", e.target.value)} disabled={!s}><option value="">{i18nText("选择…")}</option>{s?.variables.filter(v => v.valid).map(v => <option key={v.name} value={v.name}>{v.label} · {v.name}（{v.display_unit}）</option>)}</select></label>
      <Slider label={i18nText("最大时间差")} value={ui.maxDt} min={0.5} max={24} step={0.5} onChange={v => set("maxDt", v)} fmt={v => "±" + v + " h"} />
      <Toggle on={ui.interp} set={b => set("interp", b)} label={i18nText("相邻模式时刻线性时间插值")} />
      <label className="os-field">{i18nText("质量控制")}<select value={ui.qc} onChange={e => set("qc", e.target.value)}><option value="default">{i18nText("排除 错误 / 缺测")}</option><option value="good">{i18nText("仅 正常 / 基本可信")}</option></select></label>
      {s?.vertical && <Slider label={i18nText("剖面匹配深度上限")} value={ui.depthMax} min={5} max={2000} step={5} onChange={v => set("depthMax", v)} fmt={v => v + " m"} />}
      <Toggle on={ui.useView} set={b => set("useView", b)} label={i18nText("仅当前地图范围")} />
      <button className="os-primary" disabled={!ui.model || !ui.obs || !ui.obsVar || p.busy} onClick={p.run}><Play size={13} />{p.busy ? i18nText("匹配中…") : i18nText("运行时空匹配")}</button>
      {p.result && <button className="os-ghost" onClick={p.openResult}>{i18nText("查看结果：")}{p.result.pairs_total.toLocaleString()} {" " + i18nText("对 · RMSE") + " "}{fmtN(p.result.stats.rmse, 3)} {p.result.unit}</button>}
      <small className="os-note">{i18nText("空间：双线性（缺测邻点时取最近有效格点）；时间：最近时刻或相邻两时刻线性插值；深度：最近模式层。不跨物理量比较。")}</small>
    </Section>
    {s?.vertical && <ProfileSection {...p} />}
  </>;
}
const dedupe = (x: Suggestion[]) => { const seen = new Set<string>(); return x.filter(s => { const k = s.obs + s.obs_var + s.model_provider; if (seen.has(k)) return false; seen.add(k); return true; }); };

function ProfileSection(p: Parameters<typeof FusionPanel>[0]) {
  const u = p.prof, set = (k: keyof ProfileUi, v: any) => p.setProf({ ...u, [k]: v }), T = layeredGrids(p.datasets, "sea_temperature"), S = layeredGrids(p.datasets, "salinity");
  const opt = (d: VizDataset) => <option key={d.id} value={d.id}>{d.provider_label} · {d.dataset.length > 34 ? "…" + d.dataset.slice(-33) : d.dataset} · {d.summary?.depth_levels} {" " + i18nText("层 ·") + " "}{d.summary?.times?.[0]?.slice(0, 10)}</option>;
  return <Section icon={<Spline size={14} />} title={i18nText("温盐剖面对比（三维模式 × Argo）")}>
    {!T.length && !S.length ? <small className="os-note warn"><AlertTriangle size={11} />{i18nText("本地没有带深度层的温度 / 盐度模式数据。可加入 HYCOM（t3z / s3z）或 CMEMS（thetao / so）的多层 NetCDF 并登记到 catalog.json。")}</small> : <>
      <label className="os-field">{i18nText("温度模式")}<select value={u.modelT || ""} onChange={e => set("modelT", e.target.value || null)}><option value="">{i18nText("不比较温度")}</option>{T.map(opt)}</select></label>
      <label className="os-field">{i18nText("盐度模式")}<select value={u.modelS || ""} onChange={e => set("modelS", e.target.value || null)}><option value="">{i18nText("不比较盐度")}</option>{S.map(opt)}</select></label>
      <Slider label={i18nText("最大时间差")} value={u.maxDt} min={1} max={36} step={1} onChange={v => set("maxDt", v)} fmt={v => "±" + v + " h"} />
      <Slider label={i18nText("最大比较深度")} value={u.maxDepth} min={50} max={2000} step={50} onChange={v => set("maxDepth", v)} fmt={v => v + " m"} />
      <Toggle on={u.adjusted} set={b => set("adjusted", b)} label={i18nText("优先使用 Argo 订正值（*_ADJUSTED）")} />
      <button className="os-primary" disabled={(!u.modelT && !u.modelS) || p.profBusy} onClick={p.runProfiles}><Play size={13} />{p.profBusy ? i18nText("剖面匹配中…") : i18nText("运行剖面匹配")}</button>
      {p.profResult && <button className="os-ghost" onClick={p.openProfiles}>{i18nText("查看剖面结果：")}{p.profResult.n.toLocaleString()} {" " + i18nText("层 · RMSE") + " "}{fmtN(p.profResult.rmse, 3)} {p.profResult.unit}</button>}
      <small className="os-note">{i18nText("逐条剖面取模式垂向柱，在相邻有效模式层之间线性插值到观测深度；按深度段统计偏差 / RMSE，并给出单条剖面与 T–S 对比。")}</small>
    </>}
  </Section>;
}
