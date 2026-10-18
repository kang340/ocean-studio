import { t as i18nText } from "../i18n";
// Scientific colour scales and per-quantity display conventions.
// Stops approximate cmocean (Thyng et al. 2016, MIT) and perceptually uniform matplotlib maps.
export type Palette = { id: string; label: string; stops: string[]; transparentLow?: boolean };

export const PALETTES: Record<string, Palette> = {
  thermal: { id: "thermal", label: "Thermal", stops: ["#042333", "#1b2f6b", "#4b2991", "#7a2f8f", "#a83b7c", "#d1515f", "#ee7140", "#fa9f2c", "#f8d046", "#e8fa5b"] },
  haline: { id: "haline", label: "Haline", stops: ["#2a186c", "#14439c", "#106592", "#2a7d8c", "#3f948a", "#56ab81", "#76c06f", "#a6d15b", "#d6df5a", "#fdee99"] },
  speed: { id: "speed", label: "Speed", stops: ["#0b1b38", "#123d6b", "#14628f", "#1b87a4", "#30aaa8", "#5fc79a", "#9bdc86", "#d3e97f", "#fdf3a6", "#fffdf0"] },
  wind: { id: "wind", label: "Wind", stops: ["#3a3f9a", "#3c71c2", "#3fa3c9", "#45c39f", "#7fd368", "#d6d64c", "#f2a23c", "#ea6a3c", "#c93e5c", "#8f2a7a", "#5b1e64"] },
  balance: { id: "balance", label: "Balance", stops: ["#181c43", "#2c3e94", "#3c6fbf", "#79a1d1", "#c6d4e6", "#f1ecec", "#e5bfb3", "#d58a72", "#bd5040", "#8e1c29", "#3c0912"] },
  pressure: { id: "pressure", label: "Pressure", stops: ["#5a2b7a", "#4a58b2", "#3f8fc4", "#62bcc0", "#a7d8c2", "#efefd8", "#f3cf8c", "#ec9a59", "#d6603f", "#a2302f"] },
  rain: { id: "rain", label: "Rain", transparentLow: true, stops: ["#b9e3f5", "#77c3ec", "#3c97da", "#2b6bc2", "#4b4bb0", "#7d3aa8", "#b33497", "#de4a74", "#f27c4f", "#fbbf3c"] },
  waves: { id: "waves", label: "Waves", stops: ["#08214a", "#123f7c", "#1f63a5", "#2f8bbd", "#56b2c5", "#93d3c5", "#d0e9b4", "#f6df86", "#f4a659", "#e0623f", "#a92b3b"] },
  period: { id: "period", label: "Period", stops: ["#1a0f3c", "#35237a", "#4d3fa6", "#5d64bd", "#6b8bc8", "#83b0cf", "#a7d0d7", "#d3ebe4"] },
  ice: { id: "ice", label: "Ice", stops: ["#040613", "#1a1b3d", "#2f3168", "#3c4a92", "#4568a8", "#5486b5", "#6ea4c1", "#97c1cf", "#c6dde3", "#f2fbfc"] },
  algae: { id: "algae", label: "Algae", stops: ["#d7f9d0", "#a8e08b", "#77c655", "#4aa93a", "#2a8a30", "#18692c", "#0e4b25", "#08301b"] },
  viridis: { id: "viridis", label: "Viridis", stops: ["#440154", "#482878", "#3e4a89", "#31688e", "#26828e", "#1f9e89", "#35b779", "#6ece58", "#b5de2b", "#fde725"] },
  gray: { id: "gray", label: "Clouds", transparentLow: true, stops: ["#3c4652", "#6d7884", "#a1aab3", "#cfd5da", "#f4f6f8"] },
  humidity: { id: "humidity", label: "Humidity", stops: ["#8c5a2b", "#c2914f", "#e3c58a", "#eef0d3", "#a8dcc8", "#5bb5b5", "#2f83a3", "#1c548a"] },
};

export type Spec = {
  label: string; palette: string; unit: string;
  convert?: (v: number) => number;
  range?: [number, number]; // fixed default range in display units; otherwise robust p02–p98
  symmetric?: boolean; contour?: number; decimals: number;
};

const K = (v: number) => v - 273.15;
/** Spellings of the same unit across CF / GRIB / CMEMS / HYCOM files (display + comparability only, values unchanged). */
const SAME_UNIT: Record<string, string> = { "degc": "°C", "degrees_c": "°C", "degree_c": "°C", "celsius": "°C", "deg c": "°C", "°c": "°C", "c": "°C",
  "psu": "PSU", "1e-3": "PSU", "0.001": "PSU", "pss-78": "PSU", "pss": "PSU", "1": "PSU", "m s**-1": "m/s", "m s-1": "m/s", "m/s": "m/s", "meters": "m", "metre": "m", "m": "m" };
export const canonUnit = (kind: string, units: string) => { const u = (units || "").toLowerCase().trim(); const c = SAME_UNIT[u];
  if (!c) return units; if (c === "PSU" && kind !== "salinity") return units; if (c === "°C" && !/temperature/.test(kind)) return units; return c; };
/** Velocity values arrive in m/s (the server converts cm/s, kn, km/h); anything else is shown with its own unit. */
const MPS = new Set(["", "m/s", "m s-1", "m s**-1", "m.s-1", "ms-1", "m s^-1", "meter second-1", "meters/second", "m/sec"]);
export const isMps = (units: string) => MPS.has((units || "").toLowerCase().trim().split(/\s+/).join(" "));
const SPEEDS = new Set(["wind_speed", "current_speed", "wind_u", "wind_v", "current_u", "current_v"]);
export function specFor(kind: string, units0: string): Spec {
  const units = canonUnit(kind, units0), u = (units || "").toLowerCase().trim();
  if (SPEEDS.has(kind) && !isMps(units)) // unrecognised speed unit: never relabel as m/s or apply m/s colour ranges
    return { label: (kind.startsWith("wind") ? i18nText("风速") : i18nText("流速")) + i18nText("（单位未识别）"), palette: kind.endsWith("speed") ? (kind === "wind_speed" ? "wind" : "speed") : "balance", unit: units, symmetric: !kind.endsWith("speed"), decimals: 3 };
  switch (kind) {
    case "air_temperature": return u === "k" ? { label: i18nText("气温"), palette: "thermal", unit: "°C", convert: K, range: [-35, 40], contour: 5, decimals: 1 }
      : { label: i18nText("气温"), palette: "thermal", unit: units || "°C", range: [-35, 40], contour: 5, decimals: 1 };
    case "sea_temperature": return u === "k" ? { label: i18nText("海温"), palette: "thermal", unit: "°C", convert: K, range: [-2, 32], contour: 2, decimals: 2 }
      : { label: i18nText("海温"), palette: "thermal", unit: units || "°C", range: [-2, 32], contour: 2, decimals: 2 };
    case "salinity": return { label: i18nText("盐度"), palette: "haline", unit: units || "PSU", contour: 0.5, decimals: 2 };
    case "pressure": return u === "pa" ? { label: i18nText("海平面气压"), palette: "pressure", unit: "hPa", convert: v => v / 100, range: [970, 1040], contour: 4, decimals: 1 }
      : { label: i18nText("气压"), palette: "pressure", unit: units, contour: 4, decimals: 1 };
    case "precipitation": return u === "m" ? { label: i18nText("降水"), palette: "rain", unit: "mm", convert: v => v * 1000, range: [0.1, 40], decimals: 1 }
      : { label: i18nText("降水"), palette: "rain", unit: u === "kg m**-2" || u === "kg m-2" ? "mm" : units, range: [0.1, 40], decimals: 1 };
    case "ssh": return { label: i18nText("海面高度"), palette: "balance", unit: units || "m", symmetric: true, contour: 0.1, decimals: 3 };
    case "wave_height": return { label: i18nText("有效波高"), palette: "waves", unit: units || "m", range: [0, 8], contour: 1, decimals: 2 };
    case "wave_period": return { label: i18nText("波周期"), palette: "period", unit: units || "s", range: [2, 18], decimals: 1 };
    case "wave_direction": return { label: i18nText("浪向（来向）"), palette: "viridis", unit: "°", range: [0, 360], decimals: 0 };
    case "sea_ice": return { label: i18nText("海冰密集度"), palette: "ice", unit: units, decimals: 2 };
    case "humidity": return { label: i18nText("相对湿度"), palette: "humidity", unit: units || "%", range: [0, 100], decimals: 0 };
    case "cloud": return { label: i18nText("云量"), palette: "gray", unit: units || "%", range: [0, 100], decimals: 0 };
    case "chlorophyll": return { label: i18nText("叶绿素"), palette: "algae", unit: units, decimals: 3 };
    case "mixed_layer": return { label: i18nText("混合层深度"), palette: "speed", unit: units || "m", decimals: 1 };
    case "wind_speed": return { label: i18nText("风速"), palette: "wind", unit: "m/s", range: [0, 25], decimals: 1 };
    case "current_speed": return { label: i18nText("流速"), palette: "speed", unit: "m/s", range: [0, 1.5], decimals: 2 };
    case "ice_speed": case "stress_speed": case "speed": return { label: i18nText("速度"), palette: "speed", unit: units, decimals: 3 };
    case "wind_u": case "wind_v": return { label: kind === "wind_u" ? i18nText("风 U 分量") : i18nText("风 V 分量"), palette: "balance", unit: "m/s", symmetric: true, range: [-20, 20], decimals: 1 };
    case "current_u": case "current_v": return { label: kind === "current_u" ? i18nText("流 U 分量") : i18nText("流 V 分量"), palette: "balance", unit: "m/s", symmetric: true, range: [-1, 1], decimals: 2 };
    default: return { label: "", palette: "viridis", unit: units, decimals: 3 };
  }
}

export function lut(paletteId: string, banded = 0): Uint8ClampedArray {
  const p = PALETTES[paletteId] || PALETTES.viridis, out = new Uint8ClampedArray(256 * 4);
  const rgb = p.stops.map(h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
  for (let i = 0; i < 256; i++) {
    let t = i / 255;
    if (banded > 1) t = Math.min(banded - 1, Math.floor(t * banded)) / (banded - 1);
    const x = t * (rgb.length - 1), k = Math.min(rgb.length - 2, Math.floor(x)), f = x - k;
    for (let c = 0; c < 3; c++) out[i * 4 + c] = rgb[k][c] + (rgb[k + 1][c] - rgb[k][c]) * f;
    out[i * 4 + 3] = p.transparentLow ? Math.round(255 * Math.min(1, 0.15 + t * 1.6)) : 255;
  }
  return out;
}

export function gradientCss(paletteId: string) {
  const p = PALETTES[paletteId] || PALETTES.viridis;
  return `linear-gradient(90deg, ${p.stops.map((s, i) => `${s} ${(i / (p.stops.length - 1) * 100).toFixed(1)}%`).join(", ")})`;
}

export function niceStep(span: number, target = 6) {
  const raw = span / Math.max(1, target), mag = 10 ** Math.floor(Math.log10(raw)), n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}

export function fmt(v: number | null | undefined, decimals = 2) {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e6)) return v.toExponential(2);
  return v.toFixed(decimals);
}

/** Direction in degrees clockwise from north that a vector points towards. */
export const bearing = (u: number, v: number) => (Math.atan2(u, v) * 180 / Math.PI + 360) % 360;
const COMPASS = [i18nText("北"), i18nText("东北偏北"), i18nText("东北"), i18nText("东北偏东"), i18nText("东"), i18nText("东南偏东"), i18nText("东南"), i18nText("东南偏南"), i18nText("南"), i18nText("西南偏南"), i18nText("西南"), i18nText("西南偏西"), i18nText("西"), i18nText("西北偏西"), i18nText("西北"), i18nText("西北偏北")];
export const compass = (deg: number) => COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
