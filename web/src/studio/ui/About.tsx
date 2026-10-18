// "About · Data" dialog: what the page is, which files the catalogue serves, where they come from, keyboard shortcuts.
import { useEffect, useRef } from "react";
import { X, Database, Waves, Keyboard, ExternalLink, Github, Sparkles } from "lucide-react";
import type { VizDataset } from "../api";
import { bytes } from "../../api";

const CREDITS: [string, string, string][] = [
  ["NOAA NCEP GFS / WAVEWATCH III", "https://www.nco.ncep.noaa.gov/pmb/products/", "美国政府公开数据"],
  ["E.U. Copernicus Marine Service (CMEMS)", "https://marine.copernicus.eu", "Copernicus Marine 许可，需注明来源"],
  ["Copernicus Climate Change Service · ERA5", "https://cds.climate.copernicus.eu", "CC-BY 4.0"],
  ["NOAA OSMC (Observing System Monitoring Center)", "https://osmc.noaa.gov", "美国政府公开数据"],
  ["Argo (Ifremer ERDDAP / Argo GDAC)", "https://argo.ucsd.edu", "免费开放，引用 doi:10.17882/42182"],
  ["Natural Earth 底图", "https://www.naturalearthdata.com", "公有领域"],
];
/** One-click demo scenes over the bundled samples (plain URL state, so they are also shareable links). */
export const SCENES: { title: string; sub: string; q: string }[] = [
  { title: "全球风场 · 三维地球", sub: "GFS 10 m 风 · GPU 粒子流 · 4 个时次", q: "el=wind&src=gfs&view=globe&t=2026-10-15T12:00:00Z" },
  { title: "海浪双源卷帘对比", sub: "CMEMS vs WAVEWATCH III · 西太平洋", q: "el=waves&src=copernicus&cmp=wavewatch&cv=swipe&t=2026-10-15T00:00:00Z" },
  { title: "GFS − ERA5 风速差值", sub: "同一时次、统一网格逐格相减", q: "el=wind&src=gfs&cmp=era5&cv=diff&t=2026-10-10T00:00:00Z" },
  { title: "西北太平洋三维海温", sub: "CMEMS 0.083° · 40 层 · 可做垂向断面", q: "el=sea_temperature&src=copernicus" },
  { title: "全球观测平台样例", sub: "OSMC 浮标 / 船舶 / 岸站 · QC 分级", q: "mode=obs&obs=osmc-20261015" },
  { title: "模式–观测匹配检验", sub: "GFS / WW3 对 OSMC · Argo 剖面对 CMEMS", q: "mode=fusion&obs=osmc-20261015" },
];
const KEYS: [string, string][] = [["Space", "播放 / 暂停"], ["← →", "上一 / 下一时次"], ["G", "二维 / 三维地球"], ["P", "演示模式"], ["F", "全屏"], ["Esc", "关闭面板 / 取消工具"], ["?", "打开本窗口"]];
const KIND: Record<string, string> = { grid: "网格", observations: "观测", imagery: "影像", table: "表格" };

const span = (d: VizDataset) => {
  const t = d.kind === "observations" ? d.observations?.times : d.summary?.times;
  if (!t?.length) return "—";
  const f = (s: string) => s.replace("T", " ").replace(/:00(\.000)?Z$|Z$/, "").slice(0, 16);
  return t[0] === t[t.length - 1] ? f(t[0]) : `${f(t[0])} → ${f(t[t.length - 1])}`;
};

export function AboutDialog({ datasets, onClose, onOpen }: { datasets: VizDataset[]; onClose: () => void; onOpen: (d: VizDataset) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.focus(); }, []);
  const total = datasets.reduce((n, d) => n + (d.bytes || 0), 0);
  return <div className="os-modal" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="os-about" role="dialog" aria-modal="true" aria-labelledby="os-about-title" tabIndex={-1} ref={box}>
      <header>
        <div><h2 id="os-about-title"><Waves size={18} />Ocean Studio</h2>
          <p>在浏览器中浏览全球海洋 / 大气数值模式与现场观测：二维地图与三维地球、GPU 粒子流场、多数据源对比、垂向断面，以及模式–观测（含 Argo 剖面）匹配检验。所有数值都直接读取自本地文件，不做插补或填充。</p></div>
        <button className="icon" onClick={onClose} aria-label="关闭"><X size={16} /></button>
      </header>
      <section>
        <h3><Sparkles size={14} />示例场景<small>2026 年 10 月样例数据 · 非实时</small></h3>
        <div className="os-scenes">{SCENES.map((x, i) => <a key={x.q} href={"?" + x.q} className="os-scene"><i>{String(i + 1).padStart(2, "0")}</i><b>{x.title}</b><small>{x.sub}</small></a>)}</div>
      </section>
      <section>
        <h3><Database size={14} />数据目录<small>{datasets.length} 个文件 · {bytes(total)}</small></h3>
        <div className="os-cat" role="list">
          {datasets.map(d => <button key={d.id} role="listitem" className={"row" + (d.renderable ? "" : " off")} disabled={!d.renderable} onClick={() => onOpen(d)} title={d.reason || "在地图上打开"}>
            <span className={"k " + d.kind}>{KIND[d.kind] || d.kind}</span>
            <span className="t"><b>{d.title || d.dataset}</b><small>{d.provider_label} · {span(d)}</small></span>
            <span className="s">{bytes(d.bytes)}</span>
          </button>)}
        </div>
        <p className="os-note">数据目录由 <code>samples/catalog.json</code> 定义；设置环境变量 <code>OCEAN_STUDIO_DATA</code> 可指向你自己的数据目录。</p>
      </section>
      <div className="os-about-cols">
        <section><h3><ExternalLink size={14} />样例数据来源</h3>
          <ul className="os-credits">{CREDITS.map(([n, u, l]) => <li key={n}><a href={u} target="_blank" rel="noopener noreferrer">{n}</a><small>{l}</small></li>)}</ul></section>
        <section><h3><Keyboard size={14} />快捷键</h3>
          <dl className="os-keys">{KEYS.map(([k, v]) => <div key={k}><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>)}</dl></section>
      </div>
      <footer><Github size={13} />开源项目 · MIT License · 样例数据版权归各数据提供方所有</footer>
    </div>
  </div>;
}
