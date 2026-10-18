import { t as i18nText } from "../../i18n";
// Observation platforms on the map: clustered at small scales, per-type icons, value colour, QC ring,
// trajectories coloured by time (gaps dashed, implausible jumps flagged). One instance per dataset.
import type maplibregl from "maplibre-gl";
import type { ObsFeatures } from "../api";

export const TYPE_STYLE: Record<string, { label: string; color: string; shape: string }> = {
  argo: { label: i18nText("Argo 剖面浮标"), color: "#f5b942", shape: "argo" }, animal: { label: i18nText("动物搭载 CTD"), color: "#e78ac3", shape: "argo" },
  ship_ctd: { label: i18nText("船测站位"), color: "#9b8cf0", shape: "hex" }, drifter: { label: i18nText("漂流浮标"), color: "#55d6be", shape: "diamond" },
  mooring: { label: i18nText("锚系浮标"), color: "#6aa9ff", shape: "square" }, tide_gauge: { label: i18nText("潮位站"), color: "#ff8f6b", shape: "triangle" },
  wave_buoy: { label: i18nText("波浪浮标"), color: "#4fc3f7", shape: "wave" }, met_buoy: { label: i18nText("气象浮标"), color: "#a3d977", shape: "flag" },
  fixed: { label: i18nText("固定平台"), color: "#7fb2ff", shape: "square" }, moving: { label: i18nText("移动平台（船舶 / 漂流）"), color: "#ffd166", shape: "diamond" }, unknown: { label: i18nText("其他"), color: "#b0bec5", shape: "circle" },
};

/** White glyph per platform type, drawn once into an ImageData (SDF-free, crisp at 2× DPR). */
function icon(shape: string, size = 22): ImageData {
  const c = document.createElement("canvas"); c.width = c.height = size; const g = c.getContext("2d")!, m = size / 2;
  g.strokeStyle = "#ffffff"; g.fillStyle = "#ffffff"; g.lineWidth = 2; g.lineJoin = "round"; g.lineCap = "round";
  g.beginPath();
  switch (shape) {
    case "argo": g.moveTo(m, 4); g.lineTo(m, size - 4); g.moveTo(m - 4, 7); g.lineTo(m + 4, 7); g.moveTo(m - 3, 11); g.lineTo(m + 3, 11); g.moveTo(m - 2, 15); g.lineTo(m + 2, 15); g.stroke(); break;
    case "diamond": g.moveTo(m, 5); g.lineTo(size - 5, m); g.lineTo(m, size - 5); g.lineTo(5, m); g.closePath(); g.fill(); break;
    case "square": g.rect(6.5, 6.5, size - 13, size - 13); g.fill(); break;
    case "triangle": g.moveTo(m, 5); g.lineTo(size - 5, size - 6); g.lineTo(5, size - 6); g.closePath(); g.fill(); break;
    case "hex": for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i; g.lineTo(m + 6 * Math.cos(a), m + 6 * Math.sin(a)); } g.closePath(); g.fill(); break;
    case "wave": g.moveTo(4, m + 1); g.bezierCurveTo(m - 4, m - 6, m - 1, m + 7, m + 1, m + 1); g.bezierCurveTo(m + 3, m - 5, size - 6, m + 6, size - 4, m - 1); g.stroke(); break;
    case "flag": g.moveTo(7, size - 4); g.lineTo(7, 4); g.lineTo(size - 5, 8); g.lineTo(7, 12); g.stroke(); break;
    default: g.arc(m, m, 4, 0, Math.PI * 2); g.fill();
  }
  return g.getImageData(0, 0, size, size);
}

const hav = (x1: number, y1: number, x2: number, y2: number) => { const r = Math.PI / 180, a = Math.sin((y2 - y1) * r / 2) ** 2 + Math.cos(y1 * r) * Math.cos(y2 * r) * Math.sin((x2 - x1) * r / 2) ** 2; return 12742 * Math.asin(Math.min(1, Math.sqrt(a))); };

export class ObsLayer {
  map: maplibregl.Map; key: string; private ids: string[] = [];
  constructor(map: maplibregl.Map, key: string) {
    this.map = map; this.key = key;
    for (const [t, s] of Object.entries(TYPE_STYLE)) { const id = "os-icon-" + s.shape; if (!map.hasImage(id)) map.addImage(id, icon(s.shape), { pixelRatio: 2 }); void t; }
    const P = this.p.bind(this), m = map, empty: any = { type: "FeatureCollection", features: [] };
    m.addSource(P("pts"), { type: "geojson", data: empty, cluster: true, clusterRadius: 52, clusterMaxZoom: 4, clusterProperties: { suspect: ["+", ["case", ["==", ["get", "qc"], "suspect"], 1, 0]] } });
    m.addSource(P("dens"), { type: "geojson", data: empty });
    m.addSource(P("trk"), { type: "geojson", data: empty });
    m.addSource(P("sel"), { type: "geojson", data: empty });
    const typeColor: any = ["match", ["get", "type"], ...Object.entries(TYPE_STYLE).flatMap(([k, v]) => [k, v.color]), "#b0bec5"];
    this.add({ id: P("heat"), type: "heatmap", source: P("dens"), layout: { visibility: "none" }, paint: {
      "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 6, 6, 22], "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 0.6, 6, 1.4], "heatmap-opacity": 0.75,
      "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(0,0,0,0)", 0.15, "rgba(40,90,160,0.5)", 0.4, "#2f89c5", 0.65, "#5fd3c0", 0.85, "#f4e27a", 1, "#ffffff"] } });
    this.add({ id: P("trk"), type: "line", source: P("trk"), filter: ["!=", ["get", "gap"], true], layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ["interpolate", ["linear"], ["get", "tn"], 0, "#2b5c8a", 0.5, "#3fb6c9", 1, "#e8f6a0"], "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.8, 7, 2.2], "line-opacity": 0.85 } });
    this.add({ id: P("trk-gap"), type: "line", source: P("trk"), filter: ["==", ["get", "gap"], true], paint: { "line-color": "#9fb3c8", "line-width": 1, "line-dasharray": [2, 3], "line-opacity": 0.6 } });
    this.add({ id: P("cluster"), type: "circle", source: P("pts"), filter: ["has", "point_count"], paint: {
      "circle-color": "rgba(56,182,230,0.16)", "circle-stroke-color": "rgba(150,220,245,0.55)", "circle-stroke-width": 1,
      "circle-radius": ["interpolate", ["linear"], ["get", "point_count"], 2, 9, 20, 13, 100, 18, 1000, 26] } });
    this.add({ id: P("cluster-n"), type: "symbol", source: P("pts"), filter: ["has", "point_count"], layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": ["Noto Sans Bold"], "text-size": 10, "text-allow-overlap": true },
      paint: { "text-color": "#e9f6fc" } });
    this.add({ id: P("pt"), type: "circle", source: P("pts"), filter: ["!", ["has", "point_count"]], paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 4.5, 6, 7.5, 10, 10], "circle-color": typeColor,
      "circle-stroke-color": ["match", ["get", "qc"], "suspect", "#ffb020", "bad", "#ff4d4f", "rgba(255,255,255,0.9)"], "circle-stroke-width": ["match", ["get", "qc"], "suspect", 2.2, "bad", 2.6, 1.1] } });
    this.add({ id: P("pt-icon"), type: "symbol", source: P("pts"), minzoom: 3.2, filter: ["!", ["has", "point_count"]], layout: {
      "icon-image": ["concat", "os-icon-", ["match", ["get", "type"], ...Object.entries(TYPE_STYLE).flatMap(([k, v]) => [k, v.shape]), "circle"]], "icon-size": ["interpolate", ["linear"], ["zoom"], 3, 0.55, 8, 0.8], "icon-allow-overlap": true } });
    this.add({ id: P("sel"), type: "circle", source: P("sel"), paint: { "circle-radius": 13, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });
    this.typeColor = typeColor;
  }
  private typeColor: any;
  private p(s: string) { return `os-obs-${this.key}-${s}`; }
  private add(l: any) { this.map.addLayer(l); this.ids.push(l.id); }
  get pointLayers() { return [this.p("pt"), this.p("cluster")]; }
  get pointSource() { return this.p("pts"); }
  destroy() { for (const id of [...this.ids].reverse()) if (this.map.getLayer(id)) this.map.removeLayer(id); for (const s of ["pts", "dens", "trk", "sel"]) if (this.map.getSource(this.p(s))) this.map.removeSource(this.p(s)); }
  setData(f: ObsFeatures, colorStops: [number, string][] | null, opts: { tracks: boolean; density: boolean; cursorMs?: number | null; visible: boolean }) {
    const pts = f.points, n = pts.id.length;
    const feats: any[] = new Array(n);
    for (let i = 0; i < n; i++) feats[i] = { type: "Feature", properties: { id: pts.id[i], type: pts.type[i], value: pts.value ? pts.value[i] : null, qc: pts.qc ? pts.qc[i] : "none", time: pts.time[i], ds: this.key }, geometry: { type: "Point", coordinates: [pts.lon[i], pts.lat[i]] } };
    (this.map.getSource(this.p("pts")) as any).setData({ type: "FeatureCollection", features: feats });
    (this.map.getSource(this.p("dens")) as any).setData({ type: "FeatureCollection", features: feats });
    const segs: any[] = [];
    if (opts.tracks) {
      let t0 = Infinity, t1 = -Infinity; for (const t of f.tracks) { t0 = Math.min(t0, t.t[0]); t1 = Math.max(t1, t.t[t.t.length - 1]); }
      for (const t of f.tracks) {
        const dts = t.t.slice(1).map((x, i) => x - t.t[i]).sort((a, b) => a - b), med = dts[Math.floor(dts.length / 2)] || 3600;
        for (let i = 1; i < t.lon.length; i++) {
          if (opts.cursorMs != null && t.t[i] * 1000 > opts.cursorMs) break;
          let x0 = t.lon[i - 1], x1 = t.lon[i]; if (x1 - x0 > 180) x1 -= 360; else if (x0 - x1 > 180) x1 += 360;
          const dt = t.t[i] - t.t[i - 1], gap = dt > Math.max(3 * med, 6 * 3600);
          // implied fix-to-fix speed: never draw a straight line for a physically impossible jump (bad position fix)
          const km = hav(t.lon[i - 1], t.lat[i - 1], t.lon[i], t.lat[i]), ms = dt > 0 ? km * 1000 / dt : Infinity, limit = t.type === "drifter" || t.type === "argo" ? 3 : 25;
          if (ms > limit) continue;
          segs.push({ type: "Feature", properties: { id: t.id, gap, tn: (t.t[i] - t0) / Math.max(1, t1 - t0) }, geometry: { type: "LineString", coordinates: [[x0, t.lat[i - 1]], [x1, t.lat[i]]] } });
        }
      }
    }
    (this.map.getSource(this.p("trk")) as any).setData({ type: "FeatureCollection", features: segs });
    const color: any = colorStops && f.variable ? ["case", ["==", ["typeof", ["get", "value"]], "number"], ["interpolate", ["linear"], ["get", "value"], ...colorStops.flat()], "#5c6f80"] : this.typeColor;
    this.map.setPaintProperty(this.p("pt"), "circle-color", color);
    const vis = (on: boolean) => (on && opts.visible ? "visible" : "none");
    for (const id of ["pt", "pt-icon", "cluster", "cluster-n"]) this.map.setLayoutProperty(this.p(id), "visibility", vis(!opts.density));
    this.map.setLayoutProperty(this.p("heat"), "visibility", vis(opts.density));
    for (const id of ["trk", "trk-gap"]) this.map.setLayoutProperty(this.p(id), "visibility", vis(opts.tracks));
  }
  select(p: [number, number] | null) { (this.map.getSource(this.p("sel")) as any)?.setData({ type: "FeatureCollection", features: p ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: p } }] : [] }); }
  moveToTop() { for (const id of this.ids) if (this.map.getLayer(id)) this.map.moveLayer(id); }
}
