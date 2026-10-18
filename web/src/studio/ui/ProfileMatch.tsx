// Model vs Argo vertical profile comparison: depth-binned statistics, scatter, per-profile overlay and T–S.
import { useMemo, useState } from "react";
import { FileDown } from "lucide-react";
import type { ProfileMatch, ModelColumn, ObsProfile } from "../profmatch";
import { interpColumn } from "../profmatch";
import { Panel, Alert, UNMATCH } from "./Inspectors";
import { ProfileChart, Scatter, TSDiagram, type ProfileLine, type TSPoint } from "../charts/Science";
import { fmtN, downloadText } from "../charts/theme";
import { fmtTime } from "./Timeline";

export type ProfileRun = { T: ProfileMatch | null; S: ProfileMatch | null; columns: Record<string, { T?: ModelColumn; S?: ModelColumn }>; obs: Record<string, { T?: ObsProfile; S?: ObsProfile }>;
  obsLabel: string; adjusted: boolean; progress?: [number, number] | null; error?: string };
const UNMATCH_P: Record<string, string> = { ...UNMATCH, below_model: "深于模式最深有效层", above_model: "浅于模式最浅层（超出 5 m）", model_gap: "模式该处全层缺测" };
const C_OBS = "#4cc3ef", C_MOD = "#f5b942";

export function ProfileMatchInspector({ run, onClose, onFly, tz }: { run: ProfileRun; onClose: () => void; onFly: (lon: number, lat: number, pid: string) => void; tz: "utc" | "local" }) {
  const [tab, setTab] = useState("overview"), [pick, setPick] = useState<string | null>(null);
  const vars = ([["T", run.T], ["S", run.S]] as const).filter(([, m]) => m) as ["T" | "S", ProfileMatch][];
  const main = run.T || run.S;
  const profiles = useMemo(() => { const by = new Map<string, any>(); for (const [k, m] of vars) for (const p of m.profiles) { const o = by.get(p.key) || { ...p, T: null, S: null }; o[k] = p; by.set(p.key, o); } return [...by.values()].sort((a, b) => a.time.localeCompare(b.time)); }, [run.T, run.S]);
  const sel = pick ? profiles.find(p => p.key === pick) : profiles.find(p => (p.T?.n || p.S?.n));
  if (!main) return <Panel title="模式–Argo 剖面对比" onClose={onClose}>{run.error ? <Alert>{run.error}</Alert> : <Alert tone="info">尚无结果</Alert>}</Panel>;
  const csv = () => { const rows = ["variable,platform,profile,time_utc,lon,lat,depth_m,obs,model,model_minus_obs,dt_h,dz_nearest_level_m"];
    for (const [k, m] of vars) for (const x of m.pairs) rows.push([k === "T" ? "temperature" : "salinity", x.platform, x.key, x.time, x.lon, x.lat, x.z.toFixed(2), x.obs, x.model.toFixed(4), (x.model - x.obs).toFixed(4), x.dtH.toFixed(2), x.dzNear.toFixed(2)].join(","));
    downloadText(rows.join("\n"), "model_argo_profile_pairs.csv"); };
  return <Panel title="模式–Argo 温盐剖面对比" sub={`${run.obsLabel} × ${main.modelLabel}`} onClose={onClose} tabs={[["overview", "按深度统计"], ["scatter", "散点"], ["profiles", "单条剖面"], ["list", "剖面列表"]]} tab={tab} setTab={setTab}
    actions={<button className="icon" title="导出全部配对 CSV" onClick={csv}><FileDown size={15} /></button>}>
    {run.progress && run.progress[0] < run.progress[1] && <div className="os-progress-inline"><i style={{ width: `${run.progress[0] / run.progress[1] * 100}%` }} />{run.progress[0]} / {run.progress[1]} 条剖面</div>}
    {tab === "overview" && <div className="os-stack">
      {vars.map(([k, m]) => <div key={k} className="os-card"><h4>{k === "T" ? "温度" : "盐度"} · {m.modelLabel}</h4>
        <div className="os-statgrid">{([["配对", m.stats.n, 0, ""], ["偏差 M−O", m.stats.bias, 3, m.unit], ["MAE", m.stats.mae, 3, m.unit], ["RMSE", m.stats.rmse, 3, m.unit], ["相关 r", m.stats.r, 3, ""]] as [string, number, number, string][]).map(([l, v, d, u]) =>
          <div key={l}><span>{l}</span><b>{l === "配对" ? v.toLocaleString() : fmtN(v, d)}</b><em>{u}</em></div>)}</div>
        {m.bins.length > 1 && <ProfileChart title="偏差与 RMSE 随深度（按层段）" unit={m.unit} zLabel="深度 m" height={260} exportName={`profile_bias_${k}`}
          lines={[{ label: "偏差 模式−观测", z: m.bins.map(b => (b.z0 + b.z1) / 2), v: m.bins.map(b => b.bias), color: "#ef8a62" }, { label: "RMSE", z: m.bins.map(b => (b.z0 + b.z1) / 2), v: m.bins.map(b => b.rmse), color: "#9b8cf0", dash: true }]} />}
        <table className="os-table compact"><thead><tr><th>深度段 m</th><th>n</th><th>观测均值</th><th>模式均值</th><th>偏差</th><th>RMSE</th></tr></thead>
          <tbody>{m.bins.map(b => <tr key={b.z0}><td>{b.z0}–{b.z1}</td><td>{b.n}</td><td>{fmtN(b.obsMean, 3)}</td><td>{fmtN(b.modelMean, 3)}</td><td className={Math.abs(b.bias) > b.rmse * 0.7 ? "warn" : ""}>{fmtN(b.bias, 3)}</td><td>{fmtN(b.rmse, 3)}</td></tr>)}</tbody></table>
        <small className="os-note">未匹配：{Object.entries(m.unmatched).filter(([, n]) => n).map(([r, n]) => `${UNMATCH_P[r] || r} ${n}`).join("，") || "无"}</small>
      </div>)}
      <small className="os-note">方法：剖面位置取模式水平双线性值（近岸缺测时取最近有效格点）；时间取 ±{main.maxDtH} h 内最近的模式时次（不做三维时间插值）；观测压力按 UNESCO 1983 换算为深度后，在相邻两个有效模式层之间线性插值；
        不向模式最深有效层以下外推。观测 QC 为错误 / 缺测的层不参与{run.adjusted ? "；优先使用 *_ADJUSTED 订正值（该剖面无订正值时用原始值）" : ""}。日均产品的时间戳为当日 00:00 UTC，代表全天平均。</small>
    </div>}
    {tab === "scatter" && <div className="os-stack">{vars.map(([k, m]) => <Scatter key={k} obs={m.pairs.map(p => p.obs)} model={m.pairs.map(p => p.model)} unit={m.unit} stats={{ ...m.stats }} exportName={`argo_scatter_${k}`}
      onPick={i => { const p = m.pairs[i]; setPick(p.key); setTab("profiles"); onFly(p.lon, p.lat, p.platform); }} />)}</div>}
    {tab === "profiles" && sel && <ProfileDetail run={run} p={sel} tz={tz} profiles={profiles} setPick={k => { setPick(k); const p = profiles.find(x => x.key === k); if (p) onFly(p.lon, p.lat, p.platform); }} />}
    {tab === "list" && <table className="os-table compact"><thead><tr><th>平台</th><th>时间</th><th>Δt h</th><th>T 偏差</th><th>S 偏差</th><th>层数</th></tr></thead>
      <tbody>{profiles.map(p => <tr key={p.key} className={"clickable" + (p.T?.reason || p.S?.reason ? " dim" : "")} title={p.T?.reason || p.S?.reason || ""} onClick={() => { setPick(p.key); setTab("profiles"); onFly(p.lon, p.lat, p.platform); }}>
        <td>{p.platform}{p.cycle ? ` #${p.cycle}` : ""}</td><td>{fmtTime(Date.parse(p.time), tz, false).slice(0, 11)}</td><td>{fmtN(p.dtH, 1)}</td><td>{fmtN(p.T?.bias, 2)}</td><td>{fmtN(p.S?.bias, 3)}</td><td>{(p.T?.n || 0) + "/" + (p.S?.n || 0)}</td></tr>)}</tbody></table>}
  </Panel>;
}

function ProfileDetail({ run, p, tz, profiles, setPick }: { run: ProfileRun; p: any; tz: "utc" | "local"; profiles: any[]; setPick: (k: string) => void }) {
  const col = run.columns[p.key] || {}, ob = run.obs[p.key] || {};
  const lines = (k: "T" | "S"): ProfileLine[] => { const o = ob[k], c = col[k]; const out: ProfileLine[] = [];
    if (o) out.push({ label: "Argo 观测", z: o.levels.map(l => l.z), v: o.levels.map(l => (l.qc === "bad" || l.qc === "missing" ? null : l.v)), qc: o.levels.map(l => l.qc), color: C_OBS });
    if (c) { const zmax = o ? Math.max(...o.levels.map(l => l.z)) * 1.05 : Infinity, keep = c.z.map((z, i) => i).filter(i => c.z[i] <= zmax);
      out.push({ label: "模式（原生层）", z: keep.map(i => c.z[i]), v: keep.map(i => c.v[i]), color: C_MOD, dash: true }); }
    return out; };
  const ts = useMemo(() => { const pts: TSPoint[] = []; const oT = ob.T, oS = ob.S, cT = col.T, cS = col.S; if (!oT || !oS) return pts;
    const sAt = new Map(oS.levels.map(l => [l.z.toFixed(2), l]));
    for (const l of oT.levels) { const s = sAt.get(l.z.toFixed(2)); if (!s || l.v == null || s.v == null || l.qc === "bad" || s.qc === "bad") continue; pts.push({ t: l.v, s: s.v, z: l.z, group: "obs" });
      if (cT && cS) { const a = interpColumn(cT.z, cT.v, l.z), b = interpColumn(cS.z, cS.v, l.z); if (!("reason" in a) && !("reason" in b)) pts.push({ t: a.v, s: b.v, z: l.z, group: "model" }); } }
    return pts; }, [p.key]);
  const idx = profiles.findIndex(x => x.key === p.key);
  return <div className="os-stack">
    <div className="os-profnav"><button className="os-ghost" disabled={idx <= 0} onClick={() => setPick(profiles[idx - 1].key)}>‹ 上一条</button>
      <div><b>{p.platform}{p.cycle ? ` #${p.cycle}` : ""}</b><small>{fmtTime(Date.parse(p.time), tz)} · {fmtN(p.lat, 3)}°N {fmtN(p.lon, 3)}°E{p.modelTime ? ` · 模式 ${fmtTime(Date.parse(p.modelTime), "utc", false)}` : ""}</small></div>
      <button className="os-ghost" disabled={idx >= profiles.length - 1} onClick={() => setPick(profiles[idx + 1].key)}>下一条 ›</button></div>
    {(p.T?.reason || p.S?.reason) && <Alert tone="warn">{p.T?.reason || p.S?.reason}</Alert>}
    {run.T && <ProfileChart title={`温度 · 偏差 ${fmtN(p.T?.bias, 3)} · RMSE ${fmtN(p.T?.rmse, 3)} ${run.T.unit}`} lines={lines("T")} unit={run.T.unit} zLabel="深度 m" exportName={`${p.platform}_T_model_vs_argo`} />}
    {run.S && <ProfileChart title={`盐度 · 偏差 ${fmtN(p.S?.bias, 3)} · RMSE ${fmtN(p.S?.rmse, 3)}`} lines={lines("S")} unit={run.S.unit} zLabel="深度 m" exportName={`${p.platform}_S_model_vs_argo`} />}
    {run.T && run.S && <TSDiagram title="T–S 图 · 观测与模式（同深度）" points={ts} hollow={{ group: "model", label: "模式", solidLabel: "Argo" }} exportName={`${p.platform}_ts_model_vs_argo`} />}
  </div>;
}
