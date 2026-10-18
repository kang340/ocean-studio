// Offline vector basemap: Natural Earth 1:50m overview, 1:10m detail tiles loaded for the view (z ≥ 4).
import type maplibregl from "maplibre-gl";

export type BasemapColors = { ocean: string; land: string; coast: string; border: string; grid: string; gridOpacity: number };
export const DETAIL_ZOOM = 4.2;
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

function graticule(): GeoJSON.FeatureCollection {
  const f: any[] = [];
  for (let lon = -180; lon <= 180; lon += 30) f.push({ type: "Feature", properties: { major: lon === 0 }, geometry: { type: "LineString", coordinates: Array.from({ length: 35 }, (_, i) => [lon, -85 + i * 5]) } });
  for (let lat = -60; lat <= 60; lat += 30) f.push({ type: "Feature", properties: { major: lat === 0 }, geometry: { type: "LineString", coordinates: Array.from({ length: 73 }, (_, i) => [-180 + i * 5, lat]) } });
  return { type: "FeatureCollection", features: f };
}

/** Style fragment; layer ids are stable anchors for data layers (fields go before "land" or "graticule"). */
export function basemapStyle(c: BasemapColors) {
  const coastWidth: any = ["interpolate", ["linear"], ["zoom"], 1, 0.45, 5, 0.9, 9, 1.6];
  return {
    sources: {
      overview: { type: "geojson", data: "/basemap/overview.json", tolerance: 0.25, buffer: 8 },
      detail: { type: "geojson", data: EMPTY, tolerance: 0.15, buffer: 16 },
      graticule: { type: "geojson", data: graticule() },
    },
    layers: [
      { id: "ocean", type: "background", paint: { "background-color": c.ocean } },
      { id: "land", type: "fill", source: "overview", maxzoom: 5, filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": c.land, "fill-antialias": true } },
      // Detail land is clipped into tiles: antialiasing off so tile seams never show; the coastline is a separate line layer.
      { id: "land-detail", type: "fill", source: "detail", minzoom: DETAIL_ZOOM, filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": c.land, "fill-antialias": false } },
      { id: "graticule", type: "line", source: "graticule", paint: { "line-color": c.grid, "line-opacity": c.gridOpacity, "line-width": ["case", ["==", ["get", "major"], true], 0.9, 0.5] } },
      { id: "borders", type: "line", source: "overview", maxzoom: DETAIL_ZOOM, filter: ["==", ["get", "k"], "border"], paint: { "line-color": c.border, "line-width": 0.5, "line-opacity": 0.8 } },
      { id: "borders-detail", type: "line", source: "detail", minzoom: DETAIL_ZOOM, filter: ["==", ["get", "k"], "border"], paint: { "line-color": c.border, "line-width": 0.6, "line-opacity": 0.8, "line-dasharray": [3, 2] } },
      { id: "coast", type: "line", source: "overview", maxzoom: DETAIL_ZOOM, filter: ["==", ["geometry-type"], "Polygon"], paint: { "line-color": c.coast, "line-width": coastWidth } },
      { id: "coast-detail", type: "line", source: "detail", minzoom: DETAIL_ZOOM, filter: ["==", ["get", "k"], "coast"], paint: { "line-color": c.coast, "line-width": coastWidth } },
    ],
  };
}

export function setBasemapColors(m: maplibregl.Map, c: BasemapColors) {
  if (!m.getLayer("ocean")) return;
  m.setPaintProperty("ocean", "background-color", c.ocean);
  for (const id of ["land", "land-detail"]) m.setPaintProperty(id, "fill-color", c.land);
  for (const id of ["coast", "coast-detail"]) m.setPaintProperty(id, "line-color", c.coast);
  for (const id of ["borders", "borders-detail"]) m.setPaintProperty(id, "line-color", c.border);
  m.setPaintProperty("graticule", "line-color", c.grid); m.setPaintProperty("graticule", "line-opacity", c.gridOpacity);
}

/** Loads the 10° detail tiles covering the view after each move; keeps a small in-memory tile cache. */
export function attachDetailTiles(m: maplibregl.Map) {
  const cache = new Map<string, any[]>(); let index: Set<string> | null = null; let seq = 0;
  fetch("/basemap/index.json").then(r => r.json()).then(d => { index = new Set(d.tiles.map((t: number[]) => `${t[0]}_${t[1]}`)); update(); }).catch(() => { index = new Set(); });
  const update = async () => {
    if (!index || m.getZoom() < DETAIL_ZOOM - 0.3) return;
    const b = m.getBounds(), req = ++seq, keys: string[] = [];
    const x0 = Math.floor((b.getWest() + 180) / 10), x1 = Math.floor((b.getEast() + 180) / 10);
    const y0 = Math.max(0, Math.floor((b.getSouth() + 90) / 10)), y1 = Math.min(17, Math.floor((b.getNorth() + 90) / 10));
    for (let x = x0; x <= x1 && keys.length < 72; x++) for (let y = y0; y <= y1; y++) { const k = `${((x % 36) + 36) % 36}_${y}`; if (index.has(k) && !keys.includes(k)) keys.push(k); }
    await Promise.all(keys.filter(k => !cache.has(k)).map(k => fetch(`/basemap/tiles/${k}.json`).then(r => r.json()).then(d => cache.set(k, d.features)).catch(() => cache.set(k, []))));
    if (req !== seq) return;
    (m.getSource("detail") as maplibregl.GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: keys.flatMap(k => cache.get(k) || []) });
    if (cache.size > 160) for (const k of [...cache.keys()].slice(0, 60)) if (!keys.includes(k)) cache.delete(k);
  };
  m.on("moveend", update); m.on("load", update);
  return update;
}
