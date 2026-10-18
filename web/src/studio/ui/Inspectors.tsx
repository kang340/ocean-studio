import { useEffect, useMemo, useState } from "react";
import { X, Download, MapPin, Loader2, Plus, Check, ExternalLink, Crosshair } from "lucide-react";
import { obsPlatform, obsExportUrl, runMatch, tms, type Platform, type PlatformVar, type MatchResult, type QcClass } from "../api";
import { TimeSeries, type TsSeries } from "../charts/TimeSeries";
import { ProfileChart, TSDiagram, Rose, Scatter, Histogram, Bars, type ProfileLine } from "../charts/Science";
import { fmtN, downloadText } from "../charts/theme";
import { fmtTime } from "./Timeline";
import { TYPE_STYLE } from "../map/ObsLayer";

export const QC_COLOR: Record<string, string> = { good: "#3ccf95", probably_good: "#8fd6b0", suspect: "#ffb020", bad: "#ff4d4f", missing: "#6b7c8d", none: "#9fb3c8" };
export const QC_ZH: Record<string, string> = { good: "正常", probably_good: "基本可信", suspect: "可疑", bad: "错误", missing: "缺测", none: "未质控" };
const isQcExcluded = (q: QcClass) => q === "bad" || q === "missing";

export function Panel({ title, sub, onClose, children, tabs, tab, setTab, actions }: { title: React.ReactNode; sub?: React.ReactNode; onClose: () => void; children: React.ReactNode; tabs?: [string, string][]; tab?: string; setTab?: (t: string) => void; actions?: React.ReactNode }) {
  return <aside className="os-inspector" aria-label="详情面板">
    <header><div className="ttl"><strong>{title}</strong>{sub && <small>{sub}</small>}</div>{actions}<button className="icon" onClick={onClose} aria-label="关闭"><X size={15} /></button></header>
    {tabs && <nav className="os-tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab!(k)}>{l}</button>)}</nav>}
    <div className="os-insp-body">{children}</div>
  </aside>;
}
export const Loading = ({ text = "读取中…" }: { text?: string }) => <div className="os-loading"><Loader2 size={15} className="spin" />{text}</div>;
export const Alert = ({ children, tone = "danger" }: { children: React.ReactNode; tone?: "danger" | "warn" | "info" }) => <div className={"os-alert " + tone}>{children}</div>;

function QcBar({ counts }: { counts: Record<string, number> }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  return <div className="os-qcbar" title={Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `${QC_ZH[k]} ${n}`).join("，")}>{Object.entries(counts).map(([k, n]) => n ? <i key={k} style={{ width: `${n / total * 100}%`, background: QC_COLOR[k] }} /> : null)}</div>;
}

// ---------------------------------------------------------------- platform inspector
export type ModelCtx = { id: string; label: string; provider: string } | null;
export function PlatformInspector({ ds, dsLabel, pid, onClose, cursor, model, basket, toggleBasket, onShowTrack, onSeek, tz }: {
  ds: string; dsLabel: string; pid: string; onClose: () => void; cursor: number; model: ModelCtx; basket: { ds: string; pid: string }[]; toggleBasket: (ds: string, pid: string) => void;
  onShowTrack: (t: Platform["track"] | null) => void; onSeek: (t: number) => void; tz: "utc" | "local" }) {
  const [p, setP] = useState<Platform | null>(null), [err, setErr] = useState(""), [tab, setTab] = useState("overview");
  useEffect(() => { let stale = false; setP(null); setErr(""); obsPlatform(ds, pid).then(r => { if (!stale) { setP(r); setTab(r.profiles?.length ? "profile" : r.variables.length ? "series" : "overview"); } }).catch(e => !stale && setErr(e.message)); return () => { stale = true; }; }, [ds, pid]);
  useEffect(() => { onShowTrack(p?.track || null); return () => onShowTrack(null); }, [p]);
  const style = TYPE_STYLE[p?.type || "unknown"] || TYPE_STYLE.unknown, inBasket = basket.some(b => b.ds === ds && b.pid === pid);
  const tabs: [string, string][] = p ? [["overview", "概览"], ...(p.profiles?.length ? [["profile", "剖面 / T-S"]] as [string, string][] : []), ...(p.variables.length && !p.profiles?.length ? [["series", "时间序列"]] as [string, string][] : []),
    ...(p.track ? [["track", "轨迹"]] as [string, string][] : []), ...(roseInputs(p).length ? [["rose", "玫瑰图"]] as [string, string][] : []), ...(model ? [["model", "模式对比"]] as [string, string][] : []), ["qc", "质量控制"], ["raw", "原始记录"]] : [];
  return <Panel title={<><span className="os-dot" style={{ background: style.color }} />{pid}</>} sub={p ? `${p.type_label || style.label} · ${dsLabel}` : dsLabel} onClose={onClose} tabs={tabs} tab={tab} setTab={setTab}
    actions={<><button className="icon" title={inBasket ? "移出对比篮" : "加入多站对比"} onClick={() => toggleBasket(ds, pid)}>{inBasket ? <Check size={15} /> : <Plus size={15} />}</button>
      <a className="icon" title="导出该平台全部原始记录（CSV，含原始 QC 码）" href={obsExportUrl(ds, pid)}><Download size={15} /></a></>}>
    {err && <Alert>{err}</Alert>}{!p && !err && <Loading />}
    {p && tab === "overview" && <Overview p={p} tz={tz} />}
    {p && tab === "series" && <SeriesTab p={p} ds={ds} cursor={cursor} basket={basket} onSeek={onSeek} />}
    {p && tab === "profile" && <ProfileTab p={p} ds={ds} basket={basket} tz={tz} />}
    {p && tab === "track" && <TrackTab p={p} tz={tz} />}
    {p && tab === "rose" && <RoseTab p={p} />}
    {p && tab === "model" && model && <ModelTab p={p} ds={ds} model={model} />}
    {p && tab === "qc" && <QcTab p={p} />}
    {p && tab === "raw" && <RawTab p={p} ds={ds} />}
  </Panel>;
}

function Overview({ p, tz }: { p: Platform; tz: "utc" | "local" }) {
  const t0 = tms(p.time[0]), t1 = tms(p.time[p.time.length - 1]);
  return <div className="os-stack">
    <dl className="os-kv">
      <div><dt>平台类型</dt><dd>{p.type_label}</dd></div><div><dt>数据产品</dt><dd>{p.family}</dd></div>
      <div><dt>记录数</dt><dd>{p.records.toLocaleString()}{p.profiles ? ` · ${p.profiles.length} 条剖面` : ""}</dd></div>
      <div><dt>观测时间</dt><dd>{fmtTime(t0, tz)}{t1 !== t0 ? <><br />→ {fmtTime(t1, tz)}</> : null}</dd></div>
      <div><dt>最新位置</dt><dd>{fmtN(p.lat[p.lat.length - 1], 3)}°N, {fmtN(p.lon[p.lon.length - 1], 3)}°E</dd></div>
      {p.vertical && <div><dt>垂向坐标</dt><dd>{p.vertical.name}（{p.vertical.unit}）{p.vertical.is_pressure ? " · 已按 UNESCO 1983 换算深度" : ""}</dd></div>}
      {p.track && <div><dt>轨迹</dt><dd>{p.track.lon.length} 个定位 · 中位间隔 {fmtN(p.track.median_dt_s / 3600, 1)} h{p.track.gap.some(Boolean) ? ` · ${p.track.gap.filter(Boolean).length} 处缺测间隔` : ""}{p.track.jump.some(Boolean) ? ` · ${p.track.jump.filter(Boolean).length} 处异常跳点` : ""}</dd></div>}
    </dl>
    <div className="os-subhead">变量与质量</div>
    {p.variables.map(v => <div key={v.name} className="os-varrow"><div><b>{v.label}</b><code>{v.name}</code><span>{fmtN(v.min, 3)} ~ {fmtN(v.max, 3)} {v.display_unit}</span></div><QcBar counts={countQc(v.qc)} /><small>{v.qc_scheme}</small></div>)}
    {p.notes.map((n, i) => <Alert key={i} tone="info">{n}</Alert>)}
    {p.source && <a className="os-link" href={p.source} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} />数据来源</a>}
  </div>;
}
const countQc = (q: QcClass[]) => { const c: Record<string, number> = { good: 0, probably_good: 0, suspect: 0, bad: 0, missing: 0, none: 0 }; for (const x of q) c[x]++; return c; };

function SeriesTab({ p, ds, cursor, basket, onSeek }: { p: Platform; ds: string; cursor: number; basket: { ds: string; pid: string }[]; onSeek: (t: number) => void }) {
  const vars = p.variables.filter(v => !/^(row|obs)$/.test(v.name)), [sel, setSel] = useState<string[]>(() => vars.slice(0, 1).map(v => v.name));
  const [others, setOthers] = useState<Platform[]>([]);
  const extra = basket.filter(b => b.ds === ds && b.pid !== p.id);
  useEffect(() => { let stale = false; Promise.all(extra.map(b => obsPlatform(b.ds, b.pid).catch(() => null))).then(r => !stale && setOthers(r.filter(Boolean) as Platform[])); return () => { stale = true; }; }, [extra.map(b => b.pid).join()]);
  const t = p.time.map(tms), units: string[] = [];
  const series: TsSeries[] = [];
  for (const name of sel) { const v = vars.find(x => x.name === name)!; if (!v) continue; if (!units.includes(v.display_unit)) units.push(v.display_unit);
    series.push({ label: `${p.id} · ${v.label}`, unit: v.display_unit, t, v: v.display_values, qc: v.qc, axis: units.indexOf(v.display_unit) > 0 ? 1 : 0 });
    others.forEach(o => { const ov = o.variables.find(x => x.name === name); if (ov) series.push({ label: `${o.id} · ${ov.label}`, unit: ov.display_unit, t: o.time.map(tms), v: ov.display_values, qc: ov.qc, dash: true, axis: units.indexOf(v.display_unit) > 0 ? 1 : 0 }); }); }
  return <div className="os-stack">
    <div className="os-chips">{vars.map(v => <button key={v.name} className={sel.includes(v.name) ? "on" : ""} onClick={() => setSel(s => s.includes(v.name) ? s.filter(x => x !== v.name) : [...s, v.name].slice(-3))}>{v.label}<small>{v.display_unit}</small></button>)}</div>
    {series.length ? <TimeSeries series={series.filter(s => (units.indexOf(s.unit) <= 1))} marker={cursor} exportName={`${p.id}_series`} onPick={onSeek} /> : <div className="os-chart-empty">选择要显示的变量</div>}
    {extra.length > 0 && <small className="os-note">虚线为对比篮中同一数据集的其他平台（{extra.map(b => b.pid).join("、")}）。</small>}
    {units.length > 2 && <Alert tone="warn">最多同时显示两种单位，其余变量已隐藏。</Alert>}
  </div>;
}

function pickTS(p: Platform, adjusted: boolean) {
  const find = (kind: string) => { const vs = p.variables.filter(v => v.kind === kind); return (adjusted ? vs.find(v => /adjusted/i.test(v.name)) : vs.find(v => !/adjusted/i.test(v.name))) || vs[0]; };
  return { T: find("sea_temperature"), S: find("salinity") };
}
function ProfileTab({ p, ds, basket, tz }: { p: Platform; ds: string; basket: { ds: string; pid: string }[]; tz: "utc" | "local" }) {
  const hasAdj = p.variables.some(v => /adjusted/i.test(v.name)), [adjusted, setAdjusted] = useState(hasAdj), [useDepth, setUseDepth] = useState(false), [showBad, setShowBad] = useState(false);
  const profs = p.profiles || [], [chosen, setChosen] = useState<string[]>(() => profs.slice(-3).map(x => x.key));
  const [others, setOthers] = useState<Platform[]>([]);
  const extra = basket.filter(b => b.ds === ds && b.pid !== p.id);
  useEffect(() => { let stale = false; Promise.all(extra.map(b => obsPlatform(b.ds, b.pid).catch(() => null))).then(r => !stale && setOthers((r.filter(Boolean) as Platform[]).filter(o => o.profiles?.length))); return () => { stale = true; }; }, [extra.map(b => b.pid).join()]);
  const zOf = (pl: Platform) => (useDepth || !pl.vertical?.is_pressure ? pl.vertical!.depth_m : pl.vertical!.values) as number[];
  const zLabel = useDepth || !p.vertical?.is_pressure ? "深度 m" : `压力 ${p.vertical?.unit || "dbar"}`;
  const lines = (kind: "T" | "S") => {
    const out: ProfileLine[] = [];
    const add = (pl: Platform, keys: string[], dash: boolean) => { const v = pickTS(pl, adjusted)[kind]; if (!v) return; const z = zOf(pl);
      for (const k of keys) { const g = pl.profiles!.find(x => x.key === k); if (!g) continue;
        out.push({ label: `${pl.id}${g.cycle ? " #" + g.cycle : ""} ${fmtTime(tms(g.time), tz, false).slice(0, 11)}`, dash, z: g.rows.map(i => z[i]), v: g.rows.map(i => showBad || !isQcExcluded(v.qc[i]) ? v.display_values[i] : null), qc: g.rows.map(i => v.qc[i]) }); } };
    add(p, chosen, false); others.forEach(o => add(o, o.profiles!.slice(-1).map(x => x.key), true)); return out;
  };
  const { T, S } = pickTS(p, adjusted);
  const ts = useMemo(() => { if (!T || !S) return []; const z = p.vertical!.depth_m as number[]; const pts: any[] = [];
    for (const k of chosen) { const g = profs.find(x => x.key === k); if (!g) continue; for (const i of g.rows) { const t = T.display_values[i], s = S.display_values[i]; if (t == null || s == null) continue; if (!showBad && (isQcExcluded(T.qc[i]) || isQcExcluded(S.qc[i]))) continue; pts.push({ t, s, z: z[i] ?? 0, group: k, qc: T.qc[i] === "bad" || S.qc[i] === "bad" ? "bad" : T.qc[i] === "suspect" || S.qc[i] === "suspect" ? "suspect" : "good" }); } }
    return pts; }, [chosen, adjusted, showBad, p]);
  return <div className="os-stack">
    <div className="os-chips scroll">{profs.map(g => <button key={g.key} className={chosen.includes(g.key) ? "on" : ""} onClick={() => setChosen(c => c.includes(g.key) ? c.filter(x => x !== g.key) : [...c, g.key].slice(-8))} title={`${g.levels} 层 · ${g.lat}°, ${g.lon}°`}>{g.cycle ? `#${g.cycle}` : "剖面"}<small>{fmtTime(tms(g.time), tz, false).slice(0, 11)}</small></button>)}</div>
    <div className="os-toggles">
      {hasAdj && <label><input type="checkbox" checked={adjusted} onChange={e => setAdjusted(e.target.checked)} />使用订正值（*_ADJUSTED）</label>}
      {p.vertical?.is_pressure && <label><input type="checkbox" checked={useDepth} onChange={e => setUseDepth(e.target.checked)} />纵轴换算为深度</label>}
      <label><input type="checkbox" checked={showBad} onChange={e => setShowBad(e.target.checked)} />显示 QC 错误值</label>
    </div>
    {T && <ProfileChart title={`温度 · ${T.name}`} lines={lines("T")} unit={T.display_unit} zLabel={zLabel} exportName={`${p.id}_temperature_profile`} />}
    {S && <ProfileChart title={`盐度 · ${S.name}`} lines={lines("S")} unit={S.display_unit} zLabel={zLabel} exportName={`${p.id}_salinity_profile`} />}
    {T && S && <TSDiagram title="T–S 图" points={ts} exportName={`${p.id}_ts`} />}
    {!T && !S && <Alert tone="info">该剖面文件没有可识别的温度或盐度变量。</Alert>}
    {extra.length > 0 && <small className="os-note">虚线为对比篮中其他平台的最近一条剖面。</small>}
    <small className="os-note">Argo 原始值（TEMP / PSAL）与订正值（*_ADJUSTED）为不同产品，不混用；橙色为可疑、红色为错误 QC，默认不参与绘线。</small>
  </div>;
}

function TrackTab({ p, tz }: { p: Platform; tz: "utc" | "local" }) {
  const tr = p.track!, t = tr.time.slice(1).map(tms);
  return <div className="os-stack">
    <dl className="os-kv compact">
      <div><dt>定位点</dt><dd>{tr.lon.length}</dd></div><div><dt>中位间隔</dt><dd>{fmtN(tr.median_dt_s / 3600, 2)} h</dd></div>
      <div><dt>总距离</dt><dd>{fmtN(tr.dist_km.reduce((a: number, b) => a + (b || 0), 0), 1)} km</dd></div><div><dt>平均漂移速度</dt><dd>{fmtN(avg(tr.speed_ms.filter((_, i) => !tr.gap[i] && !tr.jump[i])), 3)} m/s</dd></div>
    </dl>
    <TimeSeries title="定位间漂移速度（大圆距离 / 时间间隔）" series={[{ label: "速度", unit: "m/s", t, v: tr.speed_ms, qc: tr.jump.map((j, i) => (j ? "bad" : tr.gap[i] ? "suspect" : "good")) }]} height={150} exportName={`${p.id}_speed`} decimals={3} />
    <table className="os-table"><thead><tr><th>时间</th><th>间隔</th><th>距离</th><th>速度</th><th>方向</th><th /></tr></thead><tbody>
      {tr.time.slice(1).map((x, i) => <tr key={i} className={tr.jump[i] ? "bad" : tr.gap[i] ? "warn" : ""}><td>{fmtTime(tms(x), tz, false)}</td><td>{fmtN(tr.dt_s[i] / 3600, 2)} h</td><td>{fmtN(tr.dist_km[i], 2)} km</td><td>{fmtN(tr.speed_ms[i], 3)}</td><td>{fmtN(tr.bearing[i], 0)}°</td><td>{tr.jump[i] ? "异常跳点" : tr.gap[i] ? "缺测间隔" : ""}</td></tr>).slice(0, 400)}
    </tbody></table>
    <small className="os-note">“缺测间隔”：间隔 &gt; 3 × 中位间隔且 &gt; 6 h，地图上以虚线表示，不插值；“异常跳点”：定位间速度 &gt; {tr.speed_limit_ms} m/s（物理上不可信）。</small>
  </div>;
}
const avg = (a: (number | null)[]) => { const v = a.filter((x): x is number => x != null && Number.isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };

function roseInputs(p: Platform | null) {
  if (!p) return [];
  const out: { title: string; dir: number[]; speed: number[]; unit: string; convention: "from" | "to" }[] = [];
  const by = (k: string) => p.variables.find(v => v.kind === k), good = (v: PlatformVar, i: number) => !isQcExcluded(v.qc[i]) && v.display_values[i] != null;
  const wd = by("wind_direction"), ws = by("wind_speed");
  if (wd && ws) { const idx = wd.display_values.map((_, i) => i).filter(i => good(wd, i) && good(ws, i)); out.push({ title: "风玫瑰（实测）", dir: idx.map(i => wd.display_values[i]!), speed: idx.map(i => ws.display_values[i]!), unit: ws.display_unit, convention: "from" }); }
  const wu = by("wind_u"), wv = by("wind_v");
  if (!wd && wu && wv) { const idx = wu.display_values.map((_, i) => i).filter(i => good(wu, i) && good(wv, i)); out.push({ title: "风玫瑰（由 U/V 计算）", dir: idx.map(i => (Math.atan2(-wu.display_values[i]!, -wv.display_values[i]!) * 180 / Math.PI + 360) % 360), speed: idx.map(i => Math.hypot(wu.display_values[i]!, wv.display_values[i]!)), unit: wu.display_unit, convention: "from" }); }
  const cu = by("current_u"), cv = by("current_v");
  if (cu && cv) { const idx = cu.display_values.map((_, i) => i).filter(i => good(cu, i) && good(cv, i)); out.push({ title: "流玫瑰（实测 U/V）", dir: idx.map(i => (Math.atan2(cu.display_values[i]!, cv.display_values[i]!) * 180 / Math.PI + 360) % 360), speed: idx.map(i => Math.hypot(cu.display_values[i]!, cv.display_values[i]!)), unit: cu.display_unit, convention: "to" }); }
  if (!cu && p.track && p.track.speed_ms.length >= 3) { const idx = p.track.speed_ms.map((_, i) => i).filter(i => !p.track!.gap[i] && !p.track!.jump[i] && p.track!.speed_ms[i] != null); out.push({ title: "漂移玫瑰（由定位计算）", dir: idx.map(i => p.track!.bearing[i]!), speed: idx.map(i => p.track!.speed_ms[i]!), unit: "m/s", convention: "to" }); }
  return out;
}
function RoseTab({ p }: { p: Platform }) { return <div className="os-stack">{roseInputs(p).map((r, i) => <Rose key={i} {...r} exportName={`${p.id}_rose_${i}`} />)}</div>; }

function ModelTab({ p, ds, model }: { p: Platform; ds: string; model: NonNullable<ModelCtx> }) {
  const vars = p.variables.filter(v => ["sea_temperature", "wind_speed", "pressure", "wave_height", "wave_period", "salinity", "air_temperature", "sea_level", "wind_u", "wind_v", "current_u", "current_v"].includes(v.kind));
  const [v, setV] = useState(vars[0]?.name || ""), [r, setR] = useState<MatchResult | null>(null), [err, setErr] = useState(""), [busy, setBusy] = useState(false), [dt, setDt] = useState(3);
  useEffect(() => { if (!v) return; let stale = false; setBusy(true); setErr(""); setR(null);
    runMatch({ model: model.id, obs: ds, obs_var: v, max_dt_h: dt, time_interp: true, qc: "default", platform: p.id, depth_max: 30, max_pairs: 5000 }).then(x => !stale && setR(x)).catch(e => !stale && setErr(e.message)).finally(() => !stale && setBusy(false));
    return () => { stale = true; }; }, [v, model.id, dt, p.id]);
  if (!vars.length) return <Alert tone="info">该平台没有可与模式比较的物理量。</Alert>;
  const order = r ? r.pairs.time.map((t, i) => [tms(t), i] as const).sort((a, b) => a[0] - b[0]) : [];
  return <div className="os-stack">
    <div className="os-row"><label>观测变量<select value={v} onChange={e => setV(e.target.value)}>{vars.map(x => <option key={x.name} value={x.name}>{x.label} · {x.name}</option>)}</select></label>
      <label>最大时间差<select value={dt} onChange={e => setDt(Number(e.target.value))}>{[1, 3, 6, 12].map(h => <option key={h} value={h}>±{h} h</option>)}</select></label></div>
    <small className="os-note">模式：{model.label}</small>
    {busy && <Loading text="在模式网格中提取该平台的时空匹配值…" />}{err && <Alert>{err}</Alert>}
    {r && r.pairs_total === 0 && <Alert tone="warn">没有匹配样本：{Object.entries(r.unmatched).filter(([, n]) => n).map(([k, n]) => `${UNMATCH[k] || k} ${n}`).join("，") || "观测时间不在模式时间范围内"}。模式 {r.coverage.model.map(x => fmtTime(tms(x))).join(" → ")}；观测 {r.coverage.obs?.map(x => fmtTime(tms(x))).join(" → ")}。</Alert>}
    {r && r.pairs_total > 0 && <>
      <TimeSeries title={`${r.obs_variable.label}：观测 vs 模式（${r.unit}）`} series={[{ label: "观测", unit: r.unit, t: order.map(o => o[0]), v: order.map(o => r.pairs.obs[o[1]]), qc: order.map(o => r.pairs.qc[o[1]]), points: true },
        { label: "模式（插值到观测时空）", unit: r.unit, t: order.map(o => o[0]), v: order.map(o => r.pairs.model[o[1]]), dash: true, points: true }]} height={180} exportName={`${p.id}_model_vs_obs`} />
      <StatCards s={r.stats} unit={r.unit} /><MethodNote r={r} /></>}
  </div>;
}
export const UNMATCH: Record<string, string> = { qc_excluded: "QC 排除", obs_missing: "观测缺测", outside_time: "超出时间容差", outside_domain: "在模式范围外", model_missing: "模式缺测（陆地 / 冰）", outside_bbox: "在所选区域外", deeper_than_limit: "深于匹配深度上限" };

function QcTab({ p }: { p: Platform }) {
  return <div className="os-stack">{p.variables.map(v => { const c = countQc(v.qc); return <div key={v.name} className="os-qcblock">
    <div className="os-subhead">{v.label} <code>{v.name}</code>{v.qc_column && <> · 质控列 <code>{v.qc_column}</code></>}</div>
    <QcBar counts={c} /><div className="os-qclegend">{Object.entries(c).filter(([, n]) => n).map(([k, n]) => <span key={k}><i style={{ background: QC_COLOR[k] }} />{QC_ZH[k]} {n}</span>)}</div>
    <small className="os-note">{v.qc_scheme}</small>
    {Object.keys(v.qc_codes).length > 0 && <table className="os-table"><thead><tr><th>原始码</th><th>归类</th><th>含义</th></tr></thead><tbody>{Object.entries(v.qc_codes).map(([k, x]) => <tr key={k}><td>{k}</td><td><span className="os-qctag" style={{ color: QC_COLOR[x.class] }}>{QC_ZH[x.class]}</span></td><td>{x.text}</td></tr>)}</tbody></table>}
  </div>; })}<small className="os-note">统计、绘线和模式匹配默认排除“错误 / 缺测”记录；“未质控”指来源未提供质控码，保留并标注。原始记录全部保留，可在“原始记录”中查看或导出。</small></div>;
}

function RawTab({ p, ds }: { p: Platform; ds: string }) {
  const [page, setPage] = useState(0), size = 100, n = p.records, rows = Array.from({ length: Math.min(size, n - page * size) }, (_, k) => page * size + k);
  return <div className="os-stack">
    <div className="os-row"><span className="os-note">{n.toLocaleString()} 条记录 · 第 {page + 1} / {Math.ceil(n / size)} 页</span><div className="os-pager"><button disabled={!page} onClick={() => setPage(page - 1)}>上一页</button><button disabled={(page + 1) * size >= n} onClick={() => setPage(page + 1)}>下一页</button><a className="btn" href={obsExportUrl(ds, p.id)}><Download size={13} />CSV</a></div></div>
    <div className="os-tablewrap"><table className="os-table raw"><thead><tr><th>时间 UTC</th><th>纬度</th><th>经度</th>{p.vertical && <th>{p.vertical.name}</th>}{p.variables.map(v => <th key={v.name}>{v.name}<small>{v.unit}</small></th>)}</tr></thead>
      <tbody>{rows.map(i => <tr key={i}><td>{p.time[i]?.replace("T", " ").replace("Z", "")}</td><td>{fmtN(p.lat[i], 4)}</td><td>{fmtN(p.lon[i], 4)}</td>{p.vertical && <td>{fmtN(p.vertical.values[i], 2)}</td>}
        {p.variables.map(v => <td key={v.name} className={"qc-" + v.qc[i]} title={`QC 原始码 ${v.qc_raw[i] ?? "—"} · ${QC_ZH[v.qc[i]]}`}>{v.raw[i] == null ? "—" : fmtN(v.raw[i], 4)}{v.qc_raw[i] != null && <sup>{v.qc_raw[i]}</sup>}</td>)}</tr>)}</tbody></table></div>
  </div>;
}

export function StatCards({ s, unit }: { s: MatchResult["stats"]; unit: string }) {
  const cards: [string, string, string][] = [["样本数", s.n.toLocaleString(), "有效配对"], ["偏差 Bias", fmtN(s.bias, 3), unit + " · 模式 − 观测"], ["MAE", fmtN(s.mae, 3), unit], ["RMSE", fmtN(s.rmse, 3), unit],
    ["相关系数 r", fmtN(s.r, 3), s.n < 3 ? "样本不足" : "Pearson"], ["稳健标准差", fmtN(s.robust_std, 3), unit + " · 1.4826×MAD"], ["回归斜率", fmtN(s.slope, 3), "模式 = a × 观测 + b"], ["离群配对", String(s.outliers ?? 0), "RMSE（剔除后）" + fmtN(s.rmse_excl_outliers, 3)]];
  return <div className="os-stats">{cards.map(([k, v, d]) => <div key={k}><span>{k}</span><b>{v}</b><small>{d}</small></div>)}</div>;
}
export function MethodNote({ r }: { r: MatchResult }) {
  return <details className="os-method" open={false}><summary>匹配方法与可追溯信息</summary>
    <dl className="os-kv compact">{Object.entries(r.method).map(([k, v]) => <div key={k}><dt>{({ space: "空间", time: "时间", depth: "深度", units: "单位" } as any)[k] || k}</dt><dd>{v}</dd></div>)}
      <div><dt>实际最大 |Δt|</dt><dd>{fmtN(r.max_abs_dt_h, 2)} h</dd></div><div><dt>到格点最大距离</dt><dd>{fmtN(r.max_dist_km, 1)} km</dd></div>
      <div><dt>空间方法</dt><dd>双线性 {r.space_methods.bilinear} · 最近格点 {r.space_methods.nearest}</dd></div><div><dt>时间方法</dt><dd>最近时刻 {r.time_methods.nearest} · 线性插值 {r.time_methods.linear}</dd></div>
      <div><dt>QC 规则</dt><dd>{r.qc === "default" ? "排除 错误 / 缺测" : "仅 正常 / 基本可信"}</dd></div><div><dt>离群规则</dt><dd>{r.outlier_rule}</dd></div>
      <div><dt>模式时刻</dt><dd>{r.frames.map(f => f.time.slice(5, 16).replace("T", " ")).join("、")}</dd></div></dl>
    {r.notes.map((n, i) => <Alert key={i} tone="info">{n}</Alert>)}
    {r.excluded_frames.length > 0 && <small className="os-note">未纳入的同类模式文件：{r.excluded_frames.map(e => `${e.time.slice(0, 16)}（${e.reason}）`).join("；")}</small>}
  </details>;
}

// ---------------------------------------------------------------- match results
export function MatchInspector({ r, onClose, onFly, title }: { r: MatchResult; onClose: () => void; onFly: (lon: number, lat: number, pid: string) => void; title: string }) {
  const [tab, setTab] = useState("stats");
  const top = useMemo(() => r.pairs.obs.map((o, i) => i).sort((a, b) => Math.abs(r.pairs.model[b] - r.pairs.obs[b]) - Math.abs(r.pairs.model[a] - r.pairs.obs[a])).slice(0, 150), [r]);
  const csv = () => downloadText(["platform,time_utc,lon,lat,obs,model,model_minus_obs,dt_h,dist_km,space_method,time_interp,dz_m,qc,outlier", ...r.pairs.obs.map((o, i) => [r.pairs.platform[i], r.pairs.time[i], r.pairs.lon[i], r.pairs.lat[i], o, r.pairs.model[i], (r.pairs.model[i] - o).toFixed(4), r.pairs.dt_h[i], r.pairs.dist_km[i], ["bilinear", "nearest"][r.pairs.method[i]] || r.pairs.method[i], r.pairs.time_interp[i], r.pairs.dz_m[i], r.pairs.qc[i], r.pairs.outlier[i]].join(","))].join("\n"), `match_${r.obs_variable.name}.csv`);
  return <Panel title={title} sub={`${r.obs_variable.label} · ${r.unit} · ${r.pairs_total.toLocaleString()} 对`} onClose={onClose} tabs={[["stats", "统计"], ["plots", "散点 / 分布"], ["groups", "分组误差"], ["pairs", "配对样本"]]} tab={tab} setTab={setTab}
    actions={<button className="icon" title="导出配对样本 CSV" onClick={csv}><Download size={15} /></button>}>
    {tab === "stats" && <div className="os-stack"><StatCards s={r.stats} unit={r.unit} />
      <div className="os-subhead">样本筛选</div>
      <dl className="os-kv compact"><div><dt>候选观测</dt><dd>{r.candidates.toLocaleString()}</dd></div>{Object.entries(r.unmatched).filter(([, n]) => n).map(([k, n]) => <div key={k}><dt>{UNMATCH[k] || k}</dt><dd>{n.toLocaleString()}</dd></div>)}</dl>
      <dl className="os-kv compact"><div><dt>观测均值</dt><dd>{fmtN(r.stats.obs_mean, 3)} {r.unit}</dd></div><div><dt>模式均值</dt><dd>{fmtN(r.stats.model_mean, 3)} {r.unit}</dd></div><div><dt>散度指数 SI</dt><dd>{fmtN(r.stats.scatter_index, 3)}</dd></div><div><dt>95% |差值|</dt><dd>{fmtN(r.stats.p95_abs, 3)} {r.unit}</dd></div></dl>
      <MethodNote r={r} /></div>}
    {tab === "plots" && <div className="os-stack"><Scatter obs={r.pairs.obs} model={r.pairs.model} unit={r.unit} stats={r.stats} outlier={r.pairs.outlier} onPick={i => onFly(r.pairs.lon[i], r.pairs.lat[i], r.pairs.platform[i])} exportName={`scatter_${r.obs_variable.name}`} />
      {r.diff_hist && <Histogram title="差值分布（模式 − 观测）" counts={r.diff_hist.counts} edges={r.diff_hist.edges} unit={r.unit} />}</div>}
    {tab === "groups" && <div className="os-stack">
      <Bars label="按平台类型" value="偏差" unit={r.unit} rows={r.by_type.map(x => ({ name: x.label, v: x.bias ?? null, n: x.n }))} />
      <Bars label="按纬度带" value="偏差" unit={r.unit} rows={r.by_lat.map(x => ({ name: `${x.band[0]}°~${x.band[1]}°`, v: x.bias ?? null, n: x.n }))} />
      {r.by_time.length > 1 && <TimeSeries title="按模式时刻：RMSE 与偏差" series={[{ label: "RMSE", unit: r.unit, t: r.by_time.map(x => tms(x.time)), v: r.by_time.map(x => x.rmse ?? null), points: true }, { label: "偏差", unit: r.unit, t: r.by_time.map(x => tms(x.time)), v: r.by_time.map(x => x.bias ?? null), dash: true, points: true }]} height={160} exportName="error_by_time" decimals={3} />}
      <table className="os-table"><thead><tr><th>分组</th><th>n</th><th>Bias</th><th>RMSE</th><th>r</th></tr></thead><tbody>{[...r.by_type.map(x => [x.label, x] as const), ...r.by_lat.map(x => [`${x.band[0]}°~${x.band[1]}°`, x] as const)].map(([k, x]) => <tr key={k}><td>{k}</td><td>{x.n}</td><td>{fmtN(x.bias, 3)}</td><td>{fmtN(x.rmse, 3)}</td><td>{fmtN(x.r, 3)}</td></tr>)}</tbody></table></div>}
    {tab === "pairs" && <div className="os-stack"><small className="os-note">按 |模式 − 观测| 降序列出前 150 对（共返回 {r.pairs_returned.toLocaleString()} 对{r.pairs_total > r.pairs_returned ? `，为全部 ${r.pairs_total.toLocaleString()} 对的固定种子随机子样` : ""}）。点击定位。</small>
      <div className="os-tablewrap"><table className="os-table"><thead><tr><th>平台</th><th>时间</th><th>观测</th><th>模式</th><th>差</th><th>Δt</th><th>距离</th></tr></thead><tbody>
        {top.map(i => <tr key={i} className={r.pairs.outlier[i] ? "bad clickable" : "clickable"} onClick={() => onFly(r.pairs.lon[i], r.pairs.lat[i], r.pairs.platform[i])}><td>{r.pairs.platform[i]}</td><td>{r.pairs.time[i].slice(5, 16).replace("T", " ")}</td><td>{fmtN(r.pairs.obs[i], 2)}</td><td>{fmtN(r.pairs.model[i], 2)}</td><td>{fmtN(r.pairs.model[i] - r.pairs.obs[i], 2)}</td><td>{fmtN(r.pairs.dt_h[i], 1)}h</td><td>{fmtN(r.pairs.dist_km[i], 0)}km</td></tr>)}</tbody></table></div></div>}
  </Panel>;
}

// ---------------------------------------------------------------- map point / region
export function PointInspector({ data, onClose, near, onPlatform, tz, scalarLabel, depthAxis }: { data: any; onClose: () => void; near: { ds: string; label: string; platforms: any[] }[]; onPlatform: (ds: string, pid: string) => void; tz: "utc" | "local"; scalarLabel?: string; depthAxis?: boolean }) {
  const d = data?.data;
  return <Panel title={<><MapPin size={14} />{fmtN(data.lat, 3)}°{data.lat < 0 ? "S" : "N"}, {fmtN(Math.abs(data.lon), 3)}°{data.lon < 0 ? "W" : "E"}</>} sub={data.time ? fmtTime(tms(data.time), tz) + (data.depth != null ? ` · ${fmtN(data.depth, 1)} m` : "") : undefined} onClose={onClose}>
    <div className="os-stack">
      {data.loading && <Loading />}{data.error && <Alert>{data.error}</Alert>}
      {d && !d.inside && <Alert tone="warn">该位置在模式数据范围之外</Alert>}
      {d?.derived?.length > 0 && <div className="os-derived">{d.derived.map((x: any) => <div key={x.label}><span>{x.label}</span><b>{x.value}</b><small>{x.sub}</small></div>)}</div>}
      {d?.values?.length > 0 && <table className="os-table"><tbody>{d.values.map((v: any) => <tr key={v.name}><td>{v.label}<small><code>{v.name}</code></small></td><td className="num"><b>{fmtN(v.display, v.decimals ?? 2)}</b> {v.unit}</td><td><span className={"os-method m-" + v.method}>{({ bilinear: "双线性", nearest: "最近格点", missing: "缺测" } as any)[v.method] || v.method}</span></td></tr>)}</tbody></table>}
      {d?.grid_point && <small className="os-note">最近格点 {fmtN(d.grid_point.lat, 3)}°, {fmtN(d.grid_point.lon, 3)}°；数值为原网格插值，非显示图像取色。</small>}
      {data.series && <TimeSeries title={`${scalarLabel || "数值"} · 该点时间序列`} series={data.series} height={160} exportName="point_series" />}
      {data.profile && depthAxis && <ProfileChart title="该点垂向剖面" lines={[{ label: data.profile.label, z: data.profile.z, v: data.profile.v }]} unit={data.profile.unit} zLabel="深度 m" height={240} exportName="point_profile" />}
      {near.some(n => n.platforms.length) && <><div className="os-subhead"><Crosshair size={12} />附近观测（150 km 内）</div>
        {near.map(n => n.platforms.slice(0, 8).map(pl => <button key={n.ds + pl.id} className="os-nearrow" onClick={() => onPlatform(n.ds, pl.id)}><span className="os-dot" style={{ background: (TYPE_STYLE[pl.type] || TYPE_STYLE.unknown).color }} /><b>{pl.id}</b><small>{n.label} · {fmtN(pl.dist_km, 0)} km · {pl.records} 条</small></button>))}</>}
    </div></Panel>;
}

export function RegionInspector({ data, onClose, near, onPlatform, tz }: { data: any; onClose: () => void; near: { ds: string; label: string; platforms: any[]; total: number }[]; onPlatform: (ds: string, pid: string) => void; tz: "utc" | "local" }) {
  const r = data.data, [w, s, e, n] = data.bbox;
  return <Panel title="区域分析" sub={`${fmtN(s, 2)}°~${fmtN(n, 2)}°N · ${fmtN(w, 2)}°~${fmtN(e, 2)}°E`} onClose={onClose}>
    <div className="os-stack">{data.loading && <Loading />}{data.error && <Alert>{data.error}</Alert>}
      {r && !r.stats && !data.loading && <Alert tone="info">{r.note || "区域内没有有效格点"}（统计只计入格点中心位于所选区域内的网格）。</Alert>}
      {r?.stats && r.stats.circular && <div className="os-stats">{[["面积加权圆均值", r.stats.mean], ["圆标准差", r.stats.std], ["范围起（顺时针）", r.stats.min], ["范围止", r.stats.max]].map(([k, v]) => <div key={k as string}><span>{k}</span><b>{fmtN(v as number, 1)}</b><small>°</small></div>)}
        <div><span>有效格点</span><b>{r.stats.cells.toLocaleString()}</b><small>合成矢量长度 {fmtN(r.stats.resultant, 2)}</small></div></div>}
      {r?.stats && !r.stats.circular && <div className="os-stats">{[["面积加权均值", r.stats.mean, 0], ["标准差", r.stats.std, 1], ["最小值", r.stats.min, 0], ["最大值", r.stats.max, 0]].map(([k, v, spread]) => <div key={k as string}><span>{k}</span><b>{fmtN(data.conv ? (spread ? (v as number) * Math.abs(data.conv(1) - data.conv(0)) : data.conv(v)) : (v as number), 3)}</b><small>{data.unit}</small></div>)}
        <div><span>有效格点</span><b>{r.stats.cells.toLocaleString()}</b><small>有效比例 {fmtN(r.stats.valid_fraction * 100, 1)}%</small></div></div>}
      {r?.selection && <small className="os-note">{r.selection}{r.factor > 1 ? ` · 先按 ${r.factor}×${r.factor} 块平均` : ""}</small>}
      {r?.histogram && <Histogram title="区域内数值分布" counts={r.histogram.counts} edges={r.histogram.edges.map((x: number) => data.conv ? data.conv(x) : x)} unit={data.unit} />}
      {r?.series?.points?.length > 1 && <TimeSeries title="区域均值随时间" series={[{ label: "均值", unit: data.unit, t: r.series.points.map((p: any) => tms(p.time)), v: r.series.points.map((p: any) => p.mean == null ? null : data.conv ? data.conv(p.mean) : p.mean), points: true }]} height={150} exportName="region_mean" />}
      <div className="os-subhead">区域内的观测平台</div>
      {near.map(nb => <div key={nb.ds}><small className="os-note">{nb.label}：{nb.total} 个平台</small>{nb.platforms.slice(0, 30).map(pl => <button key={pl.id} className="os-nearrow" onClick={() => onPlatform(nb.ds, pl.id)}><span className="os-dot" style={{ background: (TYPE_STYLE[pl.type] || TYPE_STYLE.unknown).color }} /><b>{pl.id}</b><small>{pl.records} 条 · {fmtTime(tms(pl.t1), tz, false)}</small></button>)}</div>)}
      {!near.some(nb => nb.total) && <Alert tone="info">所选区域内没有已加载的观测平台。</Alert>}
    </div></Panel>;
}
