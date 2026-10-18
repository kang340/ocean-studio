import { language, t as i18nText } from "../../i18n";
// Ocean Studio map: offline vector basemap (Natural Earth 1:50m / 1:10m), optional NASA GIBS imagery,
// bundled glyphs for labels, and stable anchors for data layers.
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { attachDetailTiles, basemapStyle, setBasemapColors, type BasemapColors } from "../../viz/basemap";
import { SEAS } from "./seas";

export type Theme = "light" | "dark";
export type Basemap = "vector" | "satellite";
export const PALETTE: Record<Theme, BasemapColors & { sky: string; horizon: string; label: string; halo: string; seaLabel: string; contour: string; contourHalo: string }> = {
  dark: { ocean: "#061220", land: "#101d2b", coast: "#3f5d79", border: "#24384d", grid: "#86a3bd", gridOpacity: 0.09, sky: "#01050a", horizon: "#2b6aa0",
    label: "#c9d8e6", halo: "rgba(4,12,22,0.85)", seaLabel: "rgba(150,186,214,0.7)", contour: "rgba(232,242,251,0.62)", contourHalo: "rgba(4,12,22,0.8)" },
  light: { ocean: "#b9cfdf", land: "#f2f3ee", coast: "#6d8598", border: "#b3bec7", grid: "#3e5d76", gridOpacity: 0.13, sky: "#e2ecf3", horizon: "#ffffff",
    label: "#22384c", halo: "rgba(255,255,255,0.9)", seaLabel: "rgba(48,90,125,0.62)", contour: "rgba(10,28,44,0.6)", contourHalo: "rgba(255,255,255,0.85)" },
};
const FONT = ["Noto Sans Regular"], FONT_B = ["Noto Sans Bold"];

function graticuleLabels(): GeoJSON.FeatureCollection {
  const f: any[] = [];
  for (let lon = -150; lon <= 180; lon += 30) for (const lat of [-60, 0, 60]) f.push({ type: "Feature", properties: { t: lon === 0 ? "0°" : `${Math.abs(lon)}°${lon < 0 ? "W" : "E"}` }, geometry: { type: "Point", coordinates: [lon, lat + 2.5] } });
  for (const lat of [-60, -30, 30, 60]) for (let lon = -165; lon <= 165; lon += 90) f.push({ type: "Feature", properties: { t: `${Math.abs(lat)}°${lat < 0 ? "S" : "N"}` }, geometry: { type: "Point", coordinates: [lon, lat] } });
  return { type: "FeatureCollection", features: f };
}

export class StudioMap {
  map: maplibregl.Map; ready: Promise<void>; theme: Theme; basemap: Basemap = "vector";
  constructor(el: HTMLElement, theme: Theme, view: { center?: [number, number]; zoom?: number; globe?: boolean }) {
    this.theme = theme; const c = PALETTE[theme], base = basemapStyle(c);
    const sources: any = { ...base.sources,
      gibs: { type: "raster", tiles: ["https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg"], tileSize: 256, maxzoom: 8,
        attribution: i18nText("影像 NASA GIBS Blue Marble") },
      seas: { type: "geojson", data: { type: "FeatureCollection", features: SEAS.map(s => ({ type: "Feature", properties: { zh: s[0], en: s[1], rank: s[4] }, geometry: { type: "Point", coordinates: [s[2], s[3]] } })) } },
      gratlabels: { type: "geojson", data: graticuleLabels() } };
    const layers: any[] = [...base.layers];
    layers.splice(1, 0, { id: "satellite", type: "raster", source: "gibs", layout: { visibility: "none" }, paint: { "raster-opacity": 1, "raster-fade-duration": 200, "raster-saturation": -0.15 } });
    layers.push(
      { id: "grat-labels", type: "symbol", source: "gratlabels", layout: { "text-field": ["get", "t"], "text-font": FONT, "text-size": 10, "text-allow-overlap": false }, paint: { "text-color": c.grid, "text-opacity": 0.55, "text-halo-color": c.halo, "text-halo-width": 1 } },
      { id: "sea-labels", type: "symbol", source: "seas", filter: ["<=", ["get", "rank"], 2], layout: { "text-field": language === "en" ? ["get", "en"] : ["format", ["get", "zh"], { "font-scale": 1 }, "\n", {}, ["get", "en"], { "font-scale": 0.74 }],
        "text-font": FONT, "text-size": ["interpolate", ["linear"], ["zoom"], 1, ["match", ["get", "rank"], 1, 13, 10.5], 6, ["match", ["get", "rank"], 1, 17, 13]], "text-letter-spacing": 0.12,
        "text-max-width": 12, "text-allow-overlap": false, "symbol-sort-key": ["get", "rank"] }, paint: { "text-color": c.seaLabel, "text-halo-color": c.halo, "text-halo-width": 0.6 } },
      { id: "sea-labels-minor", type: "symbol", source: "seas", minzoom: 3, filter: [">", ["get", "rank"], 2], layout: { "text-field": ["get", language === "en" ? "en" : "zh"], "text-font": FONT, "text-size": 11, "text-letter-spacing": 0.08, "text-allow-overlap": false },
        paint: { "text-color": c.seaLabel, "text-halo-color": c.halo, "text-halo-width": 0.6 } },
    );
    this.map = new maplibregl.Map({
      container: el, attributionControl: false, center: view.center || [125, 22], zoom: view.zoom ?? 2, minZoom: 0.6, maxZoom: 11, renderWorldCopies: true, fadeDuration: 120,
      localIdeographFontFamily: "'PingFang SC','Microsoft YaHei UI','Microsoft YaHei','Noto Sans SC',sans-serif",
      style: { version: 8, glyphs: "/glyphs/{fontstack}/{range}.pbf", sources, layers } as any,
    });
    this.map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: i18nText("海岸线 Natural Earth · 数据来自本地数据目录") }), "bottom-right");
    this.map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-right");
    this.map.dragRotate.disable(); this.map.touchZoomRotate.disableRotation(); this.map.boxZoom.disable();
    attachDetailTiles(this.map);
    this.ready = new Promise(res => this.map.once("load", () => { this.setProjection(!!view.globe, false); res(); }));
  }
  isGlobe() { return ((this.map as any).getProjection?.()?.type || "mercator") === "globe"; }
  setProjection(globe: boolean, animate = true) {
    const m = this.map, c = m.getCenter(), z = m.getZoom();
    (m as any).setProjection({ type: globe ? "globe" : "mercator" });
    if (animate) m.jumpTo({ center: c, zoom: z }); // keep the view across projections
    this.sky(); m.getContainer().closest(".os-stage")?.classList.toggle("globe", globe);
  }
  private sky() {
    const c = PALETTE[this.theme];
    try { (this.map as any).setSky({ "sky-color": c.sky, "horizon-color": c.horizon, "sky-horizon-blend": 0.55, "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 4, 0.55, 7, 0] }); } catch { /* sky unsupported */ }
  }
  setTheme(t: Theme) {
    this.theme = t; const c = PALETTE[t], m = this.map; if (!m.getLayer("ocean")) return;
    setBasemapColors(m, c);
    for (const id of ["sea-labels", "sea-labels-minor"]) { m.setPaintProperty(id, "text-color", c.seaLabel); m.setPaintProperty(id, "text-halo-color", c.halo); }
    m.setPaintProperty("grat-labels", "text-color", c.grid); m.setPaintProperty("grat-labels", "text-halo-color", c.halo);
    for (const id of ["contours"]) if (m.getLayer(id)) m.setPaintProperty(id, "line-color", c.contour);
    if (m.getLayer("contour-labels")) { m.setPaintProperty("contour-labels", "text-color", c.contour); m.setPaintProperty("contour-labels", "text-halo-color", c.contourHalo); }
    this.sky(); this.setBasemap(this.basemap);
  }
  setBasemap(b: Basemap) {
    this.basemap = b; const m = this.map, sat = b === "satellite";
    m.setLayoutProperty("satellite", "visibility", sat ? "visible" : "none");
    for (const id of ["land", "land-detail"]) m.setPaintProperty(id, "fill-opacity", sat ? 0 : 1);
    m.setPaintProperty("ocean", "background-color", sat ? "#02070d" : PALETTE[this.theme].ocean);
  }
  /** Layer used as `beforeId`: ocean fields under land, atmospheric fields above land below lines. */
  anchor(kind: "ocean-field" | "air-field" | "particles" | "overlay") {
    return kind === "ocean-field" ? "land" : kind === "air-field" ? "graticule" : kind === "particles" ? "grat-labels" : "sea-labels";
  }
  /** Coastlines contrast with whatever covers the land. */
  coastContrast(overLand: boolean) {
    const m = this.map, c = PALETTE[this.theme];
    const coast = overLand ? (this.theme === "dark" ? "rgba(236,244,252,0.75)" : "rgba(8,22,36,0.7)") : c.coast;
    const border = overLand ? (this.theme === "dark" ? "rgba(236,244,252,0.32)" : "rgba(8,22,36,0.3)") : c.border;
    for (const id of ["coast", "coast-detail"]) m.setPaintProperty(id, "line-color", coast);
    for (const id of ["borders", "borders-detail"]) m.setPaintProperty(id, "line-color", border);
  }
  setContours(data: GeoJSON.FeatureCollection | null, unit = "") {
    const m = this.map, src = m.getSource("contours") as maplibregl.GeoJSONSource | undefined, c = PALETTE[this.theme];
    if (!data) { for (const id of ["contour-labels", "contours"]) if (m.getLayer(id)) m.removeLayer(id); if (src) m.removeSource("contours"); return; }
    if (src) { src.setData(data); return; }
    m.addSource("contours", { type: "geojson", data, tolerance: 0.25 });
    m.addLayer({ id: "contours", type: "line", source: "contours", layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": c.contour, "line-width": ["interpolate", ["linear"], ["zoom"], 1, ["case", ["==", ["get", "major"], true], 1.1, 0.5], 7, ["case", ["==", ["get", "major"], true], 2, 1]] } }, "borders");
    m.addLayer({ id: "contour-labels", type: "symbol", source: "contours", filter: ["==", ["get", "major"], true],
      layout: { "symbol-placement": "line", "symbol-spacing": 340, "text-field": ["get", "label"], "text-font": FONT_B, "text-size": 10.5, "text-keep-upright": true, "text-max-angle": 30, "text-padding": 6 },
      paint: { "text-color": c.contour, "text-halo-color": c.contourHalo, "text-halo-width": 1.4 } }, "sea-labels");
    void unit;
  }
  fit(b: number[], pad = 60) {
    const [w, s, e, n] = b;
    if (e - w >= 300) { this.map.easeTo({ center: [this.map.getCenter().lng, 15], zoom: this.isGlobe() ? 1.8 : 1.5, duration: 600 }); return; }
    this.map.fitBounds([[w, Math.max(-80, s)], [e, Math.min(82, n)]], { padding: pad, maxZoom: 7.5, duration: 600 });
  }
  viewBox(): [number, number, number, number] | null {
    const b = this.map.getBounds(); let w = b.getWest(), e = b.getEast();
    if (e - w >= 300 || this.map.getZoom() < 2.6) return null;
    const pad = (e - w) * 0.15, dy = (b.getNorth() - b.getSouth()) * 0.15; w -= pad; e += pad; const sh = Math.floor((w + 180) / 360) * 360;
    return [w - sh, Math.max(-89, b.getSouth() - dy), e - sh, Math.min(89, b.getNorth() + dy)];
  }
}
