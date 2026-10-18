// Element-first browsing UI: element selector, data-source switcher, source cards, comparison controls,
// comparison inspector and the synchronised side-by-side map.
import { useEffect, useRef, useState } from "react";
import { Columns2, SplitSquareHorizontal, Layers2, Diff, ExternalLink, AlertTriangle, Info, Database, GitCompare } from "lucide-react";
import maplibregl from "maplibre-gl";
import { ELEMENTS, PROVIDER_LABEL, PROVIDER_URL, STATE_LABEL, REPR_LABEL, providerRows, type ElementDef, type ElementId, type Source } from "../elements";
import { sourceStatus, type SourceStatus } from "../api";
/** Other tasks of a ready provider still running / failed (e.g. a newer cycle downloading). */
const busyOf = (s?: SourceStatus) => { if (!s) return ""; const t = s.tasks, parts: string[] = [];
  for (const k of ["downloading", "queued", "retrying", "timeout", "error", "validation_failed"] as const) if (t[k]) parts.push(`${STATE_LABEL[k][0]} ${t[k]}`); return parts.join(" · "); };
import type { DiffStats } from "../compare";
import { Section } from "./Panels";
import { Panel, Loading, Alert } from "./Inspectors";
import { TimeSeries } from "../charts/TimeSeries";
import { ProfileChart } from "../charts/Science";
import { fmtN } from "../charts/theme";
import { fmtTime } from "./Timeline";
import { StudioMap, type Theme } from "../map/StudioMap";
import { FieldLayer, type FieldStyle } from "../engine/FieldLayer";
import { sampler, type Field } from "../../viz/data";
import * as M from "../../viz/model";

export type CompareView = "swipe" | "overlay" | "diff" | "side";
export type CompareUi = { on: boolean; provider: string | null; view: CompareView; opacity: number; swipe: number; maxDt: number };
export const CMP_A = "#4cc3ef", CMP_B = "#f5b942";

const resText = (dx: number | null) => (dx == null ? "—" : dx >= 0.1 ? `${+dx.toFixed(3)}°` : `${+dx.toFixed(4)}°（≈${(dx * 111).toFixed(1)} km）`);
const spanText = (t0: number, t1: number) => (!Number.isFinite(t0) ? "无时间信息" : t0 === t1 ? fmtTime(t0, "utc") : `${fmtTime(t0, "utc", false)} → ${fmtTime(t1, "utc", false)}`);
const boundsText = (b: number[] | null) => (!b ? "—" : b[2] - b[0] >= 359 ? `全球（${fmtN(b[1], 0)}° – ${fmtN(b[3], 0)}°）` : M.regionText({ west: b[0], south: b[1], east: b[2], north: b[3] }));
const sourceLink = (p: string) => PROVIDER_URL[p] || "#";

/** Top-of-map element selector (always visible in element browsing). */
export function ElementBar({ counts, active, onPick }: { counts: { el: ElementDef; n: number }[]; active: ElementId | null; onPick: (id: ElementId) => void }) {
  return <nav className="os-elbar" aria-label="海洋气象要素">{counts.map(({ el, n }) =>
    <button key={el.id} className={(active === el.id ? "on" : "") + (n ? "" : " none")} onClick={() => onPick(el.id)} aria-pressed={active === el.id}
      title={n ? `${el.label}：${n} 个本地数据源` : `${el.label}：暂无本地数据（点击查看公开数据源）`}>
      <span>{el.label}</span>{n > 0 && <em>{n}</em>}</button>)}</nav>;
}

/** Source switcher under the element bar: one chip per local provider + comparison toggle. */
export function SourceSwitcher({ el, sources, provider, setProvider, compare, setCompare }: { el: ElementDef; sources: Source[]; provider: string | null; setProvider: (p: string) => void; compare: CompareUi; setCompare: (c: CompareUi) => void }) {
  if (!sources.length) return null;
  const canCompare = sources.length > 1;
  return <div className="os-srcbar" role="group" aria-label={`${el.label}数据源`}>
    {sources.map(s => { const on = s.provider === provider, b = compare.on && compare.provider === s.provider;
      return <button key={s.provider} className={(on ? "on" : "") + (b ? " cmp" : "")} onClick={() => setProvider(s.provider)} title={`${s.label} · ${spanText(s.t0, s.t1)} · 分辨率 ${resText(s.dx)}`}>
        {compare.on && (on || b) && <i className="ab">{on ? "A" : "B"}</i>}<b>{s.label}</b><small>{resText(s.dx).split("（")[0]}</small></button>; })}
    <span className="sep" />
    <button className={"cmpbtn" + (compare.on ? " on" : "")} disabled={!canCompare} onClick={() => setCompare({ ...compare, on: !compare.on, provider: compare.provider && compare.provider !== provider ? compare.provider : sources.find(s => s.provider !== provider)?.provider || null })}
      title={canCompare ? "与另一数据源对比（卷帘 / 叠加 / 差值 / 并排）" : "至少需要两个本地数据源才能对比"}><GitCompare size={13} />对比</button>
  </div>;
}

export type CmpStatus = { aLabel: string; bLabel: string; aTime: string | null; bTime: string | null; dtH: number | null; aDepth: number | null; bDepth: number | null; unit: string; unitB: string;
  blockers: string[]; notes: string[]; stats: DiffStats | null; grid: string; loading: boolean };

/** Left-dock panel for element browsing: source cards (local + not yet downloaded) and comparison settings. */
export function ElementPanel({ el, sources, provider, setProvider, activeFile, compare, setCompare, status }: { el: ElementDef; sources: Source[]; provider: string | null; setProvider: (p: string) => void;
  activeFile: { name: string; path: string } | null; compare: CompareUi; setCompare: (c: CompareUi) => void; status: CmpStatus | null }) {
  const set = (k: keyof CompareUi, v: any) => setCompare({ ...compare, [k]: v });
  // real task states per provider; the panel still works from the local catalogue when the endpoint is unavailable
  const [st, setSt] = useState<SourceStatus[] | null>(null), [stErr, setStErr] = useState("");
  useEffect(() => { let stop = false, t = 0;
    const load = () => sourceStatus(el.id).then(r => { if (stop) return; setSt(r.sources); setStErr("");
      if (r.sources.some(s => ["downloading", "queued", "retrying"].includes(s.state))) t = window.setTimeout(load, 8000); })
      .catch(e => { if (!stop) { setSt(null); setStErr(String(e?.message || e)); } });
    load(); return () => { stop = true; clearTimeout(t); }; }, [el.id, sources.length]);
  const byP = new Map((st || []).map(s => [s.provider, s])), rows = providerRows(el, sources, st);
  return <>
    <Section icon={<Database size={14} />} title={`${el.label} · 数据源`} right={<small className="os-sec-note">{sources.length} 个本地</small>}>
      <div className="os-srccards">
        {sources.map(s => { const on = s.provider === provider, b = compare.on && compare.provider === s.provider;
          return <button key={s.provider} className={"os-srccard" + (on ? " on" : "") + (b ? " cmp" : "")} onClick={() => setProvider(s.provider)}>
            <div className="r1"><strong>{s.label}</strong>{compare.on && (on || b) && <i className="ab">{on ? "A" : "B"}</i>}<span className="ok">本地可用</span></div>
            <dl><dt>时间</dt><dd>{spanText(s.t0, s.t1)}</dd><dt>分辨率</dt><dd>{resText(s.dx)}{s.depthLevels ? ` · ${s.depthLevels} 层` : " · 单层"}</dd>
              <dt>范围</dt><dd>{boundsText(s.bounds)}</dd><dt>文件</dt><dd>{s.files.length} 个 · {s.steps} 个时次 · 更新 {fmtTime(s.updated * 1000, "utc", false)}</dd></dl>
            {s.mixedGrids && <div className="why"><Info size={11} />该数据源的本地文件网格不同（区域 / 全球），按时间与视野自动选择</div>}
            {byP.get(s.provider)?.representativeness && <div className="why"><Info size={11} />{REPR_LABEL[byP.get(s.provider)!.representativeness!]}{byP.get(s.provider)!.meta?.time_spacing_h ? ` · 时间间隔 ${byP.get(s.provider)!.meta!.time_spacing_h} h` : ""}</div>}
            {busyOf(byP.get(s.provider)) && <div className="why"><Info size={11} />另有任务{busyOf(byP.get(s.provider))}</div>}
            {on && activeFile && <div className="file" title={activeFile.path}>当前文件 {activeFile.name}</div>}
          </button>; })}
        {rows.map(({ provider: p, state }) => { const s = byP.get(p), [txt, tone] = state ? STATE_LABEL[state] || [state, "muted"] : ["暂无本地数据", "muted"];
          return <div key={p} className={"os-srccard missing st-" + tone} aria-disabled="true"><div className="r1"><strong>{PROVIDER_LABEL[p] || p}</strong><span className={"st " + tone}>{txt}</span></div>
            {s?.last_error && <div className="why err" title={s.last_error.message}><AlertTriangle size={11} />{s.last_error.message.slice(0, 140)}</div>}
            {s?.products?.length ? <small className="os-note">产品 {s.products.slice(0, 2).join("、")}</small> : null}
            <a className="os-dl" href={sourceLink(p)} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} />{PROVIDER_LABEL[p] || p} 数据官网</a></div>; })}
      </div>
      {stErr && <small className="os-note">数据源状态暂不可用（{stErr.slice(0, 80)}），仅显示目录中的本地数据。</small>}
    </Section>
    {sources.length > 1 && <Section icon={<GitCompare size={14} />} title="数据源对比" right={<label className="os-switch mini"><input type="checkbox" checked={compare.on} onChange={e => set("on", e.target.checked)} /><i /></label>}>
      {!compare.on ? <small className="os-note">开启后以 A（当前数据源）与 B 对比：卷帘、透明叠加、差值（A − B）或并排联动地图。对比前统一单位、时间、深度与网格，无法匹配时给出原因。</small> : <>
        <label className="os-field">对比数据源 B<select value={compare.provider || ""} onChange={e => set("provider", e.target.value)}>{sources.filter(s => s.provider !== provider).map(s => <option key={s.provider} value={s.provider}>{s.label}</option>)}</select></label>
        <div className="os-seg os-cmpviews">{([["swipe", "卷帘", <SplitSquareHorizontal size={13} />], ["overlay", "叠加", <Layers2 size={13} />], ["diff", "差值", <Diff size={13} />], ["side", "并排", <Columns2 size={13} />]] as [CompareView, string, React.ReactNode][]).map(([k, l, ic]) =>
          <button key={k} className={compare.view === k ? "on" : ""} onClick={() => set("view", k)}>{ic}{l}</button>)}</div>
        {compare.view === "overlay" && <label className="os-slider"><span>B 透明度<b>{Math.round(compare.opacity * 100)}%</b></span><input type="range" min={0} max={1} step={0.05} value={compare.opacity} onChange={e => set("opacity", Number(e.target.value))} /></label>}
        <label className="os-slider"><span>时间匹配容差<b>±{compare.maxDt} h</b></span><input type="range" min={0} max={24} step={1} value={compare.maxDt} onChange={e => set("maxDt", Number(e.target.value))} /></label>
        {status && <CompareStatus s={status} />}
      </>}
    </Section>}
  </>;
}

function CompareStatus({ s }: { s: CmpStatus }) {
  const row = (k: string, a: React.ReactNode, b: React.ReactNode, warn = false) => <tr className={warn ? "warn" : ""}><th>{k}</th><td>{a}</td><td>{b}</td></tr>;
  const z = (v: number | null) => (v == null ? "单层" : `${fmtN(v, v < 10 ? 2 : 1)} m`);
  return <div className="os-cmpstatus">
    <table><thead><tr><th /><th><i className="ab">A</i>{s.aLabel}</th><th><i className="ab b">B</i>{s.bLabel}</th></tr></thead><tbody>
      {row("时次", s.aTime ? fmtTime(Date.parse(s.aTime), "utc", false) : "—", s.bTime ? fmtTime(Date.parse(s.bTime), "utc", false) : "—", (s.dtH ?? 0) > 0)}
      {row("深度", z(s.aDepth), z(s.bDepth), s.aDepth !== s.bDepth)}
      {row("单位", s.unit || "—", s.unitB || "—", s.unit !== s.unitB)}
    </tbody></table>
    {s.dtH != null && s.dtH > 0 && !s.blockers.length && <small className="os-note">Δt = {fmtN(s.dtH, 1)} h（在容差内，取 B 的最近时次，不做时间插值）</small>}
    {s.blockers.map(b => <div key={b} className="os-alert warn"><AlertTriangle size={12} />{b}</div>)}
    {s.notes.map(n => <small key={n} className="os-note"><Info size={11} /> {n}</small>)}
    {s.loading && <Loading text="读取对比数据…" />}
    {s.stats && !s.blockers.length && <>
      <div className="os-statgrid">{([["偏差 A−B", s.stats.bias], ["MAE", s.stats.mae], ["RMSE", s.stats.rmse], ["相关 r", s.stats.r]] as [string, number][]).map(([k, v]) =>
        <div key={k}><span>{k}</span><b>{fmtN(v, k === "相关 r" ? 3 : 2)}</b><em>{k === "相关 r" ? "" : s.unit}</em></div>)}</div>
      <small className="os-note">当前视野内 {s.stats.n.toLocaleString()} 个共同有效格点 · cos(纬度) 面积加权 · {s.grid}</small>
    </>}
  </div>;
}

/** Point comparison: values, paired time series and (for layered data) vertical profiles of A and B. */
export function CompareInspector({ data, onClose, tz }: { data: any; onClose: () => void; tz: "utc" | "local" }) {
  const d = data, unit = d.unit || "";
  return <Panel title={<>数据源对比 · 点位</>} sub={`${Math.abs(d.lat).toFixed(3)}°${d.lat < 0 ? "S" : "N"} ${Math.abs(d.lon).toFixed(3)}°${d.lon < 0 ? "W" : "E"}`} onClose={onClose}>
    {d.loading && <Loading />}
    {d.error && <Alert>{d.error}</Alert>}
    {d.a && <div className="os-cmpvals">
      <div className="a"><span><i className="ab">A</i>{d.aLabel}</span><b>{fmtN(d.a.value, d.decimals)}</b><em>{unit}</em><small>{d.a.time ? fmtTime(Date.parse(d.a.time), tz) : ""}{d.a.depth != null ? ` · ${fmtN(d.a.depth, 1)} m` : ""}</small></div>
      <div className="b"><span><i className="ab b">B</i>{d.bLabel}</span><b>{fmtN(d.b?.value, d.decimals)}</b><em>{unit}</em><small>{d.b?.time ? fmtTime(Date.parse(d.b.time), tz) : ""}{d.b?.depth != null ? ` · ${fmtN(d.b.depth, 1)} m` : ""}</small></div>
      <div className="d"><span>A − B</span><b>{d.a.value != null && d.b?.value != null ? fmtN(d.a.value - d.b.value, d.decimals) : "—"}</b><em>{unit}</em><small>{d.blockers?.length ? "不可直接相减：" + d.blockers[0] : d.dtH ? `Δt ${fmtN(d.dtH, 1)} h` : "同一时次"}</small></div>
    </div>}
    {d.series && <div className="os-card"><h4>时间序列（各自原生时次）</h4><TimeSeries series={d.series} height={200} decimals={d.decimals} exportName="compare-series" /></div>}
    {d.profiles && <div className="os-card"><h4>垂直剖面</h4><ProfileChart lines={d.profiles} unit={unit} zLabel="深度 (m)" exportName="compare-profile" height={320} /></div>}
    {d.method && <small className="os-note">{d.method}</small>}
  </Panel>;
}

/** Second map for side-by-side comparison; camera and cursor are linked both ways with the main map. */
export type SideApi = { cross: (ll: maplibregl.LngLatLike | null) => void };
export function SideMap({ main, theme, globe, fields, style, ocean, label, unit, decimals, apiRef, onHover }: { main: StudioMap | null; theme: Theme; globe: boolean; fields: { f: Field; values: Float32Array }[]; style: FieldStyle | null;
  ocean: boolean; label: string; unit: string; decimals: number; apiRef: React.MutableRefObject<SideApi | null>; onHover: (ll: maplibregl.LngLat | null) => void }) {
  const el = useRef<HTMLDivElement>(null), cross = useRef<HTMLDivElement>(null), readout = useRef<HTMLDivElement>(null);
  const S = useRef<{ m: StudioMap; f: FieldLayer } | null>(null), [ready, setReady] = useState(false), live = useRef({ fields, unit, decimals, onHover });
  live.current = { fields, unit, decimals, onHover };
  useEffect(() => {
    if (!el.current || !main) return;
    const c = main.map.getCenter(), m = new StudioMap(el.current, theme, { globe, center: [c.lng, c.lat], zoom: main.map.getZoom() });
    m.ready.then(() => { const f = new FieldLayer("side-field"); m.map.addLayer(f, m.anchor("ocean-field")); S.current = { m, f }; setReady(true); m.map.resize(); });
    let lock = false;
    const sync = (from: maplibregl.Map, to: maplibregl.Map) => () => { if (lock) return; lock = true; to.jumpTo({ center: from.getCenter(), zoom: from.getZoom(), bearing: from.getBearing(), pitch: from.getPitch() }); lock = false; };
    const a = sync(main.map, m.map), b = sync(m.map, main.map);
    main.map.on("move", a); m.map.on("move", b);
    m.map.on("mousemove", e => { live.current.onHover(e.lngLat); const r = readout.current, f = live.current.fields; if (!r) return;
      let v = NaN; for (const x of [...f].reverse()) { const s = sampler(x.f), gx = s.fx(e.lngLat.lng), gy = s.fy(e.lngLat.lat); if (gx >= 0 && gy >= 0) { const k = (x.f.ny > 1 ? Math.round(gy) : 0) * x.f.nx + Math.round(gx); v = x.values[Math.min(x.values.length - 1, k)]; break; } }
      r.textContent = Number.isFinite(v) ? `${fmtN(v, live.current.decimals)} ${live.current.unit}` : "—"; r.style.opacity = "1"; });
    m.map.on("mouseout", () => { live.current.onHover(null); if (readout.current) readout.current.style.opacity = "0"; });
    apiRef.current = { cross: ll => { const x = cross.current; if (!x) return; if (!ll) { x.style.opacity = "0"; return; } const p = m.map.project(ll); x.style.transform = `translate(${p.x}px,${p.y}px)`; x.style.opacity = "1"; } };
    return () => { main.map.off("move", a); m.map.off("move", b); apiRef.current = null; S.current = null; setReady(false); m.map.remove(); };
  }, [main]);
  useEffect(() => { if (ready) S.current!.m.setTheme(theme); }, [theme, ready]);
  useEffect(() => { if (ready) S.current!.m.setProjection(globe); }, [globe, ready]);
  useEffect(() => {
    const s = S.current; if (!ready || !s) return;
    if (!fields.length || !style) { s.f.clear(); return; }
    s.f.setStyle(style); s.f.setFields(fields); s.m.map.moveLayer("side-field", s.m.anchor(ocean ? "ocean-field" : "air-field")); s.m.coastContrast(!ocean);
  }, [ready, fields, style, ocean]);
  return <div className="os-sidemap"><div ref={el} className="os-map" /><div className="os-sidelabel"><i className="ab b">B</i>{label}</div><div ref={readout} className="os-sideread" /><div ref={cross} className="os-cross" /></div>;
}

/** Map overlay for an element with no local data: never draws a placeholder layer. */
export function NoLocalData({ el }: { el: ElementDef }) {
  return <div className="os-empty os-nolocal"><h2>{el.label} · 暂无本地数据</h2><p>当前数据目录中没有包含{el.label}的文件，地图不显示任何{el.label}图层。可从以下公开数据源获取 NetCDF / GRIB2 文件，放入数据目录并登记到 <code>catalog.json</code>：</p>
    <div className="os-dllinks">{el.providers.map(p => <a key={p} className="os-primary" href={sourceLink(p)} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} />{PROVIDER_LABEL[p] || p}</a>)}</div></div>;
}

/** Draggable swipe divider (CSS px, relative to the map). */
export function SwipeHandle({ x, setX, aLabel, bLabel }: { x: number; setX: (f: number) => void; aLabel: string; bLabel: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const down = (e: React.PointerEvent) => { e.preventDefault(); const host = ref.current!.parentElement!; const r = host.getBoundingClientRect();
    const mv = (ev: PointerEvent) => setX(Math.min(0.98, Math.max(0.02, (ev.clientX - r.left) / r.width))); const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up); };
  return <div ref={ref} className="os-swipe" style={{ left: `${x * 100}%` }}>
    <span className="lab l"><i className="ab">A</i>{aLabel}</span><span className="lab r"><i className="ab b">B</i>{bLabel}</span>
    <button onPointerDown={down} aria-label="拖动卷帘分隔线" title="拖动比较" onKeyDown={e => { if (e.key === "ArrowLeft") setX(Math.max(0.02, x - 0.02)); if (e.key === "ArrowRight") setX(Math.min(0.98, x + 0.02)); }}>⟷</button></div>;
}
export { ELEMENTS };
