// Data-driven flow overlay: particles advected by the loaded u/v slice, or a screen-space arrow grid.
// Seeds are random screen positions; every displacement is a bilinear sample of the real field
// (linearly blended between consecutive time steps while the timeline advances).
import type maplibregl from "maplibre-gl";
import { sampler, type Field } from "./data";
import { lut } from "./palettes";

export type FlowField = { field: Field; u: Float32Array; v: Float32Array; reference: number; kind: string };

/** u/v vector field, or a wave field turned into propagation vectors (direction "from" → heading "to"). */
export function vectorField(f: Field, kind: string, opts: { uIndex?: number; vIndex?: number; dirIndex?: number; magIndex?: number }): FlowField {
  const n = f.nx * f.ny, u = new Float32Array(n), v = new Float32Array(n);
  if (opts.dirIndex != null) {
    const d = f.arrays[opts.dirIndex], h = opts.magIndex != null ? f.arrays[opts.magIndex] : null;
    for (let i = 0; i < n; i++) {
      const to = (d[i] + 180) * Math.PI / 180, m = h ? h[i] : 1, s = m === m ? Math.max(0.15, m) : NaN;
      u[i] = Math.sin(to) * s; v[i] = Math.cos(to) * s; // heading scaled by wave height
    }
  } else { u.set(f.arrays[opts.uIndex!]); v.set(f.arrays[opts.vIndex!]); }
  const reference = kind === "wind" ? 10 : kind === "wave" ? 3 : kind === "current" ? 0.6 : percentile(u, v, 0.9) || 1;
  return { field: f, u, v, reference, kind };
}
function percentile(u: Float32Array, v: Float32Array, p: number) {
  const s: number[] = []; const step = Math.max(1, Math.floor(u.length / 20000));
  for (let i = 0; i < u.length; i += step) { const m = Math.hypot(u[i], v[i]); if (m === m) s.push(m); }
  s.sort((x, y) => x - y); return s[Math.floor(s.length * p)] || 0;
}

export type FlowOptions = { mode: "particles" | "arrows" | "off"; density: number; speed: number; color: "white" | "speed" | "dark"; trail: number; width: number; palette: string; range: [number, number] };
type Sample = { fx: (x: number) => number; fy: (y: number) => number };

export class FlowLayer {
  map: maplibregl.Map; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; opts: FlowOptions;
  private cur: FlowField | null = null; private prev: FlowField | null = null; private sCur: Sample | null = null; private sPrev: Sample | null = null;
  private blendStart = 0; private blendMs = 0;
  private lon = new Float64Array(0); private lat = new Float64Array(0); private age = new Float32Array(0); private life = new Float32Array(0); private count = 0;
  private raf = 0; private table = lut("speed"); private dpr = 1; private last = 0; private dirtyArrows = true; private wasMoving = false;
  private handlers: [string, () => void][] = [];
  constructor(map: maplibregl.Map, opts: FlowOptions) {
    this.map = map; this.opts = opts;
    this.canvas = document.createElement("canvas"); this.canvas.className = "flow-canvas";
    map.getCanvasContainer().appendChild(this.canvas); this.ctx = this.canvas.getContext("2d")!;
    const resize = () => { this.resize(); this.reseed(); this.dirtyArrows = true; };
    const render = () => { if (this.opts.mode === "arrows") this.dirtyArrows = true; };
    this.handlers = [["resize", resize], ["render", render]];
    for (const [e, h] of this.handlers) map.on(e as any, h);
    this.resize(); this.table = lut(opts.palette); this.raf = requestAnimationFrame(this.tick);
  }
  destroy() { cancelAnimationFrame(this.raf); for (const [e, h] of this.handlers) this.map.off(e as any, h); this.canvas.remove(); }

  /** New time step: particles keep their positions; velocities blend from the old field over `blendMs`. */
  setField(flow: FlowField | null, blendMs = 0) {
    const same = flow && this.cur && flow.field.nx === this.cur.field.nx && flow.field.ny === this.cur.field.ny && flow.field.lon[0] === this.cur.field.lon[0] && flow.field.lat[0] === this.cur.field.lat[0];
    if (flow === this.cur) return;
    this.prev = same && blendMs > 0 ? this.cur : null; this.sPrev = this.prev ? this.sCur : null;
    this.cur = flow; this.sCur = flow ? sampler(flow.field) : null; this.blendStart = performance.now(); this.blendMs = this.prev ? blendMs : 0;
    if (!this.count || !same) this.reseed(); else this.revalidate();
    this.dirtyArrows = true;
  }
  setOptions(o: Partial<FlowOptions>) {
    const before = this.opts; this.opts = { ...this.opts, ...o };
    if (this.opts.palette !== before.palette) this.table = lut(this.opts.palette);
    if (this.opts.density !== before.density || this.opts.mode !== before.mode) { this.clear(); this.reseed(); }
    this.dirtyArrows = true;
  }
  private resize() {
    const c = this.map.getCanvas(); this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth, h = c.clientHeight;
    if (this.canvas.width !== Math.round(w * this.dpr) || this.canvas.height !== Math.round(h * this.dpr)) {
      this.canvas.width = Math.round(w * this.dpr); this.canvas.height = Math.round(h * this.dpr);
      this.canvas.style.width = w + "px"; this.canvas.style.height = h + "px";
    }
  }
  /** Swipe comparison: show the overlay canvas only on one side of a vertical screen line (CSS px). */
  setClip(c: { x: number; side: "left" | "right" } | null) {
    this.canvas.style.clipPath = c ? (c.side === "left" ? `inset(0 calc(100% - ${Math.round(c.x)}px) 0 0)` : `inset(0 0 0 ${Math.round(c.x)}px)`) : "";
  }
  clear() { this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); }
  private globe() { return (this.map.getProjection?.()?.type || "mercator") === "globe"; }
  private occluded(lon: number, lat: number) {
    try { return (this.map.transform as any).isLocationOccluded({ lng: lon, lat }); } catch { return false; }
  }

  /** Velocity at lon/lat, blended between the previous and current time step. */
  private velocity(lon: number, lat: number, out: Float64Array): boolean {
    const c = this.cur, s = this.sCur; if (!c || !s) return false;
    const gx = s.fx(lon), gy = s.fy(lat); if (gx < 0 || gy < 0) return false;
    const f = c.field; let u = bil(c.u, f.nx, f.ny, gx, gy), v = bil(c.v, f.nx, f.ny, gx, gy);
    if (!(u === u && v === v)) return false;
    if (this.prev && this.blendMs) {
      const t = (performance.now() - this.blendStart) / this.blendMs;
      if (t >= 1) { this.prev = null; this.sPrev = null; }
      else {
        const pu = bil(this.prev.u, f.nx, f.ny, gx, gy), pv = bil(this.prev.v, f.nx, f.ny, gx, gy);
        if (pu === pu && pv === pv) { u = pu + (u - pu) * t; v = pv + (v - pv) * t; }
      }
    }
    out[0] = u; out[1] = v; return true;
  }
  private tmp = new Float64Array(2);
  private spawn(k: number) {
    const w = this.canvas.width / this.dpr, h = this.canvas.height / this.dpr, globe = this.globe();
    for (let attempt = 0; attempt < 8; attempt++) {
      const x = Math.random() * w, y = Math.random() * h, ll = this.map.unproject([x, y]);
      if (!ll || Math.abs(ll.lat) > 85) continue;
      if (globe) { const back = this.map.project(ll); if (Math.abs(back.x - x) > 2 || Math.abs(back.y - y) > 2) continue; } // off the globe disk
      if (!this.velocity(ll.lng, ll.lat, this.tmp)) continue;
      this.lon[k] = ll.lng; this.lat[k] = ll.lat; this.age[k] = 0; this.life[k] = 45 + Math.random() * 85; return;
    }
    this.age[k] = 0; this.life[k] = -1; // retry next frame
  }
  reseed() {
    const w = this.canvas.width / this.dpr, h = this.canvas.height / this.dpr;
    // ~1 particle per 230 px² at density 1 (Earth Nullschool uses a comparable screen density).
    const n = this.opts.mode === "particles" && this.cur ? Math.round(Math.max(1000, Math.min(14000, (w * h) / 230 * this.opts.density * (this.globe() ? 0.6 : 1)))) : 0;
    this.count = n; this.lon = new Float64Array(n); this.lat = new Float64Array(n); this.age = new Float32Array(n); this.life = new Float32Array(n);
    for (let k = 0; k < n; k++) { this.spawn(k); this.age[k] = Math.random() * Math.max(0, this.life[k]); }
  }
  private revalidate() { for (let k = 0; k < this.count; k++) if (!this.velocity(this.lon[k], this.lat[k], this.tmp)) this.spawn(k); }

  private tick = (t: number) => {
    this.raf = requestAnimationFrame(this.tick);
    if (!this.cur || this.opts.mode === "off") { if (this.last) { this.clear(); this.last = 0; } return; }
    if (this.opts.mode === "arrows") { if (this.dirtyArrows) { this.dirtyArrows = false; this.drawArrows(); } this.last = t; return; }
    const dt = this.last ? Math.min(2.5, (t - this.last) / 16.7) : 1; this.last = t;
    const t0 = performance.now(); this.step(dt);
    const st = (window as any).__flowStats; if (st) { st.frames++; st.cost += performance.now() - t0; st.particles = this.count; } // opt-in perf probe
  };

  private step(dt: number) {
    const ctx = this.ctx, d = this.dpr, map = this.map, globe = this.globe();
    const moving = map.isMoving();
    if (moving !== this.wasMoving) { this.wasMoving = moving; if (moving) this.clear(); }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // While the camera moves, trails are reprojected every frame, so fade old pixels quickly to avoid smears.
    ctx.globalCompositeOperation = "destination-in"; ctx.fillStyle = `rgba(0,0,0,${moving ? 0.55 : this.opts.trail})`; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.globalCompositeOperation = "source-over"; ctx.setTransform(d, 0, 0, d, 0, 0); ctx.lineCap = "round";
    const W = this.canvas.width / d, H = this.canvas.height / d;
    const world = 512 * 2 ** map.getZoom(), degPerPx = 360 / world;
    const pxPerStep = 0.9 * this.opts.speed * dt, ref = this.cur!.reference;
    // Fast Web-Mercator projection (no rotation / pitch in this app); the globe uses MapLibre's projector.
    const c = map.getCenter(), cx = W / 2, cy = H / 2, cMx = (c.lng + 180) / 360, cMy = mercY(c.lat);
    const proj = globe ? null : (lon: number, lat: number, o: Float64Array) => { o[0] = cx + ((lon + 180) / 360 - cMx) * world; o[1] = cy + (mercY(lat) - cMy) * world; };
    const bins = 10, paths: Path2D[] = Array.from({ length: bins }, () => new Path2D()), [lo, hi] = this.opts.range, span = (hi - lo) || 1;
    const vel = this.tmp, a = new Float64Array(2), b = new Float64Array(2);
    for (let k = 0; k < this.count; k++) {
      if (this.age[k] > this.life[k]) { this.spawn(k); continue; }
      const lon = this.lon[k], lat = this.lat[k];
      if (!this.velocity(lon, lat, vel)) { this.spawn(k); continue; }
      const u = vel[0], v = vel[1], m = Math.hypot(u, v), s = pxPerStep / ref * degPerPx, cl = Math.cos(lat * Math.PI / 180) || 1e-6;
      // Mercator: screen x ∝ Δλ, y ∝ Δφ/cosφ → Δλ = u·s, Δφ = v·s·cosφ keeps the true heading.
      // Globe: both axes ∝ arc length → Δλ = u·s/cosφ, Δφ = v·s (keeps speed uniform with latitude).
      const nlon = globe ? lon + u * s / cl : lon + u * s, nlat = globe ? lat + v * s : lat + v * s * cl;
      if (Math.abs(nlat) > 85) { this.spawn(k); continue; }
      if (proj) { proj(lon, lat, a); proj(nlon, nlat, b); }
      else {
        if (this.occluded(nlon, nlat)) { this.spawn(k); continue; }
        const p0 = map.project([lon, lat]), p1 = map.project([nlon, nlat]); a[0] = p0.x; a[1] = p0.y; b[0] = p1.x; b[1] = p1.y;
      }
      this.lon[k] = nlon; this.lat[k] = nlat; this.age[k] += dt;
      if (b[0] < -20 || b[1] < -20 || b[0] > W + 20 || b[1] > H + 20) { this.spawn(k); continue; }
      if (Math.abs(b[0] - a[0]) > 40 || Math.abs(b[1] - a[1]) > 40) continue; // seam / projection jump
      const q = Math.max(0, Math.min(bins - 1, Math.floor(((m - lo) / span) * bins)));
      paths[q].moveTo(a[0], a[1]); paths[q].lineTo(b[0], b[1]);
    }
    for (let q = 0; q < bins; q++) {
      const f = (q + 0.5) / bins;
      ctx.lineWidth = this.opts.width * (0.75 + 0.6 * f);
      if (this.opts.color === "speed") { const i = Math.round(f * 255) * 4; ctx.strokeStyle = `rgba(${this.table[i]},${this.table[i + 1]},${this.table[i + 2]},0.95)`; }
      else { const al = 0.38 + 0.6 * f; ctx.strokeStyle = this.opts.color === "dark" ? `rgba(10,26,42,${al})` : `rgba(255,255,255,${al})`; }
      ctx.stroke(paths[q]);
    }
  }

  private drawArrows() {
    this.resize(); this.clear(); if (!this.cur) return;
    const ctx = this.ctx, d = this.dpr; ctx.setTransform(d, 0, 0, d, 0, 0);
    const w = this.canvas.width / d, h = this.canvas.height / d, gap = Math.max(20, 44 / Math.sqrt(this.opts.density)), ref = this.cur.reference;
    const [lo, hi] = this.opts.range, globe = this.globe(), vel = this.tmp;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (let y = gap / 2; y < h; y += gap) for (let x = gap / 2; x < w; x += gap) {
      const ll = this.map.unproject([x, y]); if (!ll || Math.abs(ll.lat) > 85) continue;
      if (globe) { const back = this.map.project(ll); if (Math.abs(back.x - x) > 2 || Math.abs(back.y - y) > 2) continue; }
      if (!this.velocity(ll.lng, ll.lat, vel)) continue;
      const u = vel[0], v = vel[1], m = Math.hypot(u, v); if (!(m > 1e-6)) continue;
      // Screen direction from projecting a short geographic step along the vector (correct on the globe too).
      const c = Math.cos(ll.lat * Math.PI / 180) || 1e-6, e = 0.05 / m;
      const q = this.map.project([ll.lng + u * e / c, ll.lat + v * e]); let dx = q.x - x, dy = q.y - y; const L = Math.hypot(dx, dy) || 1;
      const len = gap * (0.3 + 0.62 * Math.min(1, m / (ref * 1.8))); dx = dx / L * len; dy = dy / L * len;
      const t = Math.max(0, Math.min(255, Math.round(((m - lo) / (hi - lo || 1)) * 255))) * 4;
      ctx.strokeStyle = this.opts.color === "speed" ? `rgb(${this.table[t]},${this.table[t + 1]},${this.table[t + 2]})` : this.opts.color === "dark" ? "rgba(10,26,42,.85)" : "rgba(255,255,255,.9)";
      ctx.lineWidth = 1 + Math.min(1.2, m / ref * 0.6);
      const x0 = x - dx / 2, y0 = y - dy / 2, x1 = x + dx / 2, y1 = y + dy / 2, an = Math.atan2(dy, dx), hl = Math.min(6.5, 3 + len * 0.22);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
      ctx.moveTo(x1 - hl * Math.cos(an - 0.5), y1 - hl * Math.sin(an - 0.5)); ctx.lineTo(x1, y1); ctx.lineTo(x1 - hl * Math.cos(an + 0.5), y1 - hl * Math.sin(an + 0.5));
      ctx.stroke();
    }
  }
}

const mercY = (lat: number) => { const s = Math.sin(Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };

function bil(a: Float32Array, nx: number, ny: number, gx: number, gy: number) {
  if (nx < 2 || ny < 2) return a[0];
  const i = Math.min(nx - 2, Math.floor(gx)), j = Math.min(ny - 2, Math.floor(gy)), tx = gx - i, ty = gy - j, r = j * nx;
  const v00 = a[r + i], v10 = a[r + i + 1], v01 = a[r + nx + i], v11 = a[r + nx + i + 1];
  if (v00 === v00 && v10 === v10 && v01 === v01 && v11 === v11) return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
  // At the coast: renormalise over the valid corners so particles flow right up to the shoreline.
  let s = 0, w = 0;
  if (v00 === v00) { s += v00 * (1 - tx) * (1 - ty); w += (1 - tx) * (1 - ty); } if (v10 === v10) { s += v10 * tx * (1 - ty); w += tx * (1 - ty); }
  if (v01 === v01) { s += v01 * (1 - tx) * ty; w += (1 - tx) * ty; } if (v11 === v11) { s += v11 * tx * ty; w += tx * ty; }
  return w >= 0.5 ? s / w : NaN;
}
