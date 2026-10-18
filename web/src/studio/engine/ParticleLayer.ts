// GPU flow tracers. Particles are advected on the CPU with bilinear samples of the real U/V slice
// (blended between consecutive time steps); their recent positions live in a ring buffer on the GPU
// and are drawn as anti-aliased, speed-coloured trail segments through MapLibre's projectTile().
// Trails are true geographic pathlines, so they stay correct while panning, zooming and on the globe.
// Random numbers are used only for seed positions and lifetimes.
import type maplibregl from "maplibre-gl";
import { sampler } from "../../viz/data";
import type { FlowField } from "../../viz/flow";
import { compile, lutTexture, setProjection, mercX, mercY, type GL, type Program } from "./glu";

const VS = (prelude: string, define: string) => `#version 300 es
${prelude}
${define}
layout(location = 0) in vec4 a_a;   // older end: merc x, merc y, speed, age
layout(location = 1) in vec4 a_b;   // newer end
uniform vec2 u_viewport; uniform float u_width, u_fade, u_shift, u_lo, u_hi;
out float v_side; out float v_speed; out float v_alpha;
void main() {
  int corner = gl_VertexID;            // 0..3 triangle strip
  float along = (corner == 1 || corner == 3) ? 1.0 : 0.0;
  float side = (corner >= 2) ? 1.0 : -1.0;
  bool valid = a_a.w >= 0.0 && a_b.w >= 1.0 && abs(a_b.w - a_a.w - 1.0) < 0.5;
  vec4 pa = projectTile(a_a.xy + vec2(u_shift, 0.0)), pb = projectTile(a_b.xy + vec2(u_shift, 0.0));
  if (!valid || pa.w <= 0.0 || pb.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 sa = pa.xy / pa.w * u_viewport * 0.5, sb = pb.xy / pb.w * u_viewport * 0.5;
  vec2 d = sb - sa; float len = length(d);
  if (len > 80.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; } // projection seam
  vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0), nrm = vec2(-dir.y, dir.x);
  vec4 p = along > 0.5 ? pb : pa; vec2 s = along > 0.5 ? sb : sa;
  float t = clamp((a_b.z - u_lo) / max(1e-6, u_hi - u_lo), 0.0, 1.0);
  float hw = u_width * (0.7 + 0.6 * t) * 0.5 + 0.75;
  s += nrm * side * hw + dir * (along > 0.5 ? 0.5 : -0.5);
  gl_Position = vec4(s / (u_viewport * 0.5) * p.w, p.z, p.w);
  v_side = side * hw; v_speed = t; v_alpha = u_fade;
}`;
const FS = `#version 300 es
precision highp float;
in float v_side; in float v_speed; in float v_alpha;
uniform sampler2D u_lut; uniform float u_mode, u_bright, u_width;
out vec4 color;
void main() {
  float hw = u_width * (0.7 + 0.6 * v_speed) * 0.5;
  float aa = 1.0 - smoothstep(hw - 0.5, hw + 0.75, abs(v_side));
  float a = aa * v_alpha * (0.32 + 0.68 * v_speed) * u_bright;
  vec3 c = u_mode < 0.5 ? vec3(1.0) : u_mode < 1.5 ? texture(u_lut, vec2(v_speed * 0.996 + 0.002, 0.5)).rgb : vec3(0.04, 0.10, 0.17);
  a = clamp(a, 0.0, 1.0);
  color = vec4(c * a, a);
}`;

export type ParticleStyle = { density: number; speed: number; trail: number; width: number; bright: number; color: "white" | "speed" | "dark"; lut: Uint8ClampedArray; range: [number, number] };

export class ParticleLayer implements maplibregl.CustomLayerInterface {
  id: string; type = "custom" as const; renderingMode = "2d" as const;
  private map!: maplibregl.Map; private gl!: GL; private programs = new Map<string, Program>();
  private flow: FlowField | null = null; private prev: FlowField | null = null; private s: ReturnType<typeof sampler> | null = null;
  private blendStart = 0; private blendMs = 0; private pairW: number | null = null;
  private n = 0; private H = 24; private head = 0; private lon = new Float64Array(0); private lat = new Float64Array(0); private age = new Int32Array(0); private life = new Int32Array(0);
  private slot = new Float32Array(0); private buf: WebGLBuffer | null = null; private vao: WebGLVertexArrayObject | null = null; private lut: WebGLTexture | null = null;
  private style: ParticleStyle; private last = 0; private frame = 0; private enabled = true; private dirtyCount = true;
  stats = { particles: 0, simMs: 0 };
  /** Swipe comparison: draw only on one side of a vertical screen line (CSS px). Screen-space, so valid on the globe too. */
  private clip: { x: number; side: "left" | "right" } | null = null;
  setClip(c: { x: number; side: "left" | "right" } | null) { this.clip = c; this.map?.triggerRepaint(); }
  constructor(id: string, style: ParticleStyle) { this.id = id; this.style = style; }
  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map; this.gl = gl as GL; this.lut = lutTexture(this.gl, this.style.lut);
    this.vao = this.gl.createVertexArray(); map.on("resize", this.onResize);
  }
  onRemove() { const gl = this.gl; this.map.off("resize", this.onResize); if (this.buf) gl.deleteBuffer(this.buf); if (this.vao) gl.deleteVertexArray(this.vao); if (this.lut) gl.deleteTexture(this.lut); for (const p of this.programs.values()) gl.deleteProgram(p.p); }
  private onResize = () => { this.dirtyCount = true; };
  setEnabled(on: boolean) { this.enabled = on; this.map?.triggerRepaint(); }
  setStyle(st: Partial<ParticleStyle>) {
    const before = this.style; this.style = { ...this.style, ...st };
    if (st.lut && st.lut !== before.lut && this.gl) this.lut = lutTexture(this.gl, st.lut, this.lut);
    if (st.density !== undefined && st.density !== before.density) this.dirtyCount = true;
    if (st.trail !== undefined && Math.round(st.trail) !== Math.round(before.trail)) this.dirtyCount = true;
    this.map?.triggerRepaint();
  }
  /** New slice: particles keep their positions and velocities blend over `blendMs`. A different grid re-seeds. */
  setField(flow: FlowField | null, blendMs = 0) {
    if (flow === this.flow) return;
    const same = !!(flow && this.flow && flow.field.nx === this.flow.field.nx && flow.field.ny === this.flow.field.ny && flow.field.lon[0] === this.flow.field.lon[0] && flow.field.lat[0] === this.flow.field.lat[0]);
    this.prev = same && blendMs > 0 ? this.flow : null; this.flow = flow; this.s = flow ? sampler(flow.field) : null;
    this.blendStart = performance.now(); this.blendMs = this.prev ? blendMs : 0; this.pairW = null;
    if (!same) this.dirtyCount = true;
    this.map?.triggerRepaint();
  }
  /** Display-only time interpolation between two slices of the same grid. */
  setPair(a: FlowField, b: FlowField, w: number) { const reseed = !this.flow || this.flow.field.nx !== b.field.nx; this.prev = a; this.flow = b; this.s = sampler(b.field); this.pairW = w; this.blendMs = 0; if (reseed) this.dirtyCount = true; this.map?.triggerRepaint(); }
  reseed() { this.dirtyCount = true; this.map?.triggerRepaint(); }
  private globe() { return (this.map.getProjection?.()?.type || "mercator") === "globe"; }
  private allocate() {
    const c = this.map.getCanvas(), w = c.clientWidth, h = c.clientHeight;
    const n = this.flow ? Math.round(Math.max(1500, Math.min(26000, (w * h) / 200 * this.style.density * (this.globe() ? 0.75 : 1)))) : 0;
    const H = Math.max(6, Math.min(48, Math.round(this.style.trail)));
    this.n = n; this.H = H; this.head = 0; this.frame = 0;
    this.lon = new Float64Array(n); this.lat = new Float64Array(n); this.age = new Int32Array(n); this.life = new Int32Array(n); this.slot = new Float32Array(n * 4);
    const gl = this.gl; if (this.buf) gl.deleteBuffer(this.buf);
    this.buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const init = new Float32Array(n * 4 * H); for (let i = 3; i < init.length; i += 4) init[i] = -1; // no history yet
    gl.bufferData(gl.ARRAY_BUFFER, init, gl.DYNAMIC_DRAW);
    for (let k = 0; k < n; k++) { this.spawn(k); this.age[k] = 0; this.life[k] = Math.floor(Math.random() * this.life[k]) + 4; }
    this.dirtyCount = false; this.stats.particles = n;
  }
  private vel(lon: number, lat: number, out: Float64Array) {
    const f = this.flow, s = this.s; if (!f || !s) return false;
    const gx = s.fx(lon), gy = s.fy(lat); if (gx < 0 || gy < 0) return false;
    const F = f.field; let u = bil(f.u, F.nx, F.ny, gx, gy), v = bil(f.v, F.nx, F.ny, gx, gy);
    if (!(u === u && v === v)) return false;
    if (this.prev && (this.blendMs || this.pairW != null)) {
      const t = this.pairW != null ? this.pairW : (performance.now() - this.blendStart) / this.blendMs;
      if (t >= 1 && this.pairW == null) this.prev = null;
      else { const pu = bil(this.prev.u, F.nx, F.ny, gx, gy), pv = bil(this.prev.v, F.nx, F.ny, gx, gy); if (pu === pu && pv === pv) { u = pu + (u - pu) * t; v = pv + (v - pv) * t; } }
    }
    out[0] = u; out[1] = v; return true;
  }
  private tmp = new Float64Array(2);
  private spawn(k: number) {
    const c = this.map.getCanvas(), w = c.clientWidth, h = c.clientHeight, globe = this.globe();
    for (let i = 0; i < 6; i++) {
      const x = Math.random() * w, y = Math.random() * h, ll = this.map.unproject([x, y]);
      if (!ll || Math.abs(ll.lat) > 84) continue;
      if (globe) { const b = this.map.project(ll); if (Math.abs(b.x - x) > 2 || Math.abs(b.y - y) > 2) continue; }
      if (!this.vel(ll.lng, ll.lat, this.tmp)) continue;
      this.lon[k] = ll.lng; this.lat[k] = ll.lat; this.age[k] = 0; this.life[k] = 40 + Math.floor(Math.random() * 90); return;
    }
    this.age[k] = -1; this.life[k] = 1;
  }
  prerender() {
    if (!this.enabled || !this.flow || !this.gl) return;
    if (this.dirtyCount || !this.buf) this.allocate();
    const now = performance.now(), dt = this.last ? Math.min(2.5, (now - this.last) / 16.7) : 1; this.last = now; this.frame++;
    const t0 = performance.now(), map = this.map, globe = this.globe();
    const world = 512 * 2 ** map.getZoom(), degPerPx = 360 / world, step = 0.9 * this.style.speed * dt / this.flow.reference * degPerPx;
    const b = map.getBounds(), W = b.getWest() - 2, E = b.getEast() + 2, S = Math.max(-85, b.getSouth() - 2), N = Math.min(85, b.getNorth() + 2);
    const sl = this.slot, vel = this.tmp, tr: any = map.transform;
    for (let k = 0; k < this.n; k++) {
      let ok = this.age[k] >= 0 && this.age[k] < this.life[k];
      if (ok) {
        const lon = this.lon[k], lat = this.lat[k];
        if (!this.vel(lon, lat, vel)) ok = false;
        else {
          const u = vel[0], v = vel[1], cl = Math.cos(lat * Math.PI / 180) || 1e-6;
          // Mercator: Δλ = u·s, Δφ = v·s·cosφ keeps the true heading on screen; globe: arc-length scaling.
          const nlon = globe ? lon + u * step / cl : lon + u * step, nlat = globe ? lat + v * step : lat + v * step * cl;
          if (Math.abs(nlat) > 85) ok = false;
          else if (!globe && (nlat < S || nlat > N || nlon < W || nlon > E)) ok = false;
          else if (globe && (k + this.frame) % 10 === 0 && tr.isLocationOccluded?.({ lng: nlon, lat: nlat })) ok = false;
          else { this.lon[k] = nlon; this.lat[k] = nlat; this.age[k]++; sl[k * 4 + 2] = Math.hypot(u, v); }
        }
      }
      if (!ok) { this.spawn(k); sl[k * 4 + 2] = 0; }
      sl[k * 4] = mercX(this.lon[k]); sl[k * 4 + 1] = mercY(this.lat[k]); sl[k * 4 + 3] = this.age[k];
    }
    this.head = (this.head + 1) % this.H;
    const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this.buf); gl.bufferSubData(gl.ARRAY_BUFFER, this.head * this.n * 16, sl);
    this.stats.simMs = performance.now() - t0;
  }
  private program(sd: any) { let p = this.programs.get(sd.variantName); if (!p) { p = compile(this.gl, VS(sd.vertexShaderPrelude, sd.define), FS); this.programs.set(sd.variantName, p); } return p; }
  render(gl: WebGLRenderingContext | WebGL2RenderingContext, args: any) {
    const g = gl as GL; if (!this.enabled || !this.flow || !this.buf || !this.n) return;
    const prog = this.program(args.shaderData), u = prog.u; g.useProgram(prog.p); setProjection(g, prog, args.defaultProjectionData);
    g.uniform2f(u.u_viewport, g.drawingBufferWidth, g.drawingBufferHeight);
    const dpr = g.drawingBufferWidth / (this.map.getCanvas().clientWidth || 1);
    g.uniform1f(u.u_width, this.style.width * dpr); g.uniform1f(u.u_lo, this.style.range[0]); g.uniform1f(u.u_hi, this.style.range[1]);
    g.uniform1f(u.u_mode, this.style.color === "white" ? 0 : this.style.color === "speed" ? 1 : 2); g.uniform1f(u.u_bright, this.style.bright);
    g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, this.lut); g.uniform1i(u.u_lut, 0);
    g.enable(g.BLEND); g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA); g.disable(g.DEPTH_TEST); g.disable(g.CULL_FACE); g.disable(g.STENCIL_TEST);
    if (this.clip) {
      const W = g.drawingBufferWidth, Hh = g.drawingBufferHeight, px = Math.round(this.clip.x * W / Math.max(1, this.map.getCanvas().clientWidth));
      g.enable(g.SCISSOR_TEST); if (this.clip.side === "left") g.scissor(0, 0, Math.max(0, px), Hh); else g.scissor(px, 0, Math.max(0, W - px), Hh);
    }
    g.bindVertexArray(this.vao); g.bindBuffer(g.ARRAY_BUFFER, this.buf);
    g.enableVertexAttribArray(0); g.enableVertexAttribArray(1); g.vertexAttribDivisor(0, 1); g.vertexAttribDivisor(1, 1);
    const H = this.H, stride = this.n * 16, globe = this.globe();
    for (const shift of globe ? [0] : [-1, 0, 1]) {
      g.uniform1f(u.u_shift, shift);
      for (let j = H - 1; j >= 1; j--) { // oldest segment first so the heads draw on top
        const a = (this.head - j + H) % H, b = (this.head - j + 1 + H) % H;
        g.vertexAttribPointer(0, 4, g.FLOAT, false, 16, a * stride); g.vertexAttribPointer(1, 4, g.FLOAT, false, 16, b * stride);
        g.uniform1f(u.u_fade, Math.pow(1 - (j - 1) / (H - 1), 1.6));
        g.drawArraysInstanced(g.TRIANGLE_STRIP, 0, 4, this.n);
      }
    }
    g.vertexAttribDivisor(0, 0); g.vertexAttribDivisor(1, 0); g.bindVertexArray(null);
    if (this.clip) g.disable(g.SCISSOR_TEST);
    this.map.triggerRepaint(); // continuous animation while particles are on
  }
}

function bil(a: Float32Array, nx: number, ny: number, gx: number, gy: number) {
  if (nx < 2 || ny < 2) return a[0];
  const i = Math.min(nx - 2, Math.floor(gx)), j = Math.min(ny - 2, Math.floor(gy)), tx = gx - i, ty = gy - j, r = j * nx;
  const v00 = a[r + i], v10 = a[r + i + 1], v01 = a[r + nx + i], v11 = a[r + nx + i + 1];
  if (v00 === v00 && v10 === v10 && v01 === v01 && v11 === v11) return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
  let s = 0, w = 0; // coast: renormalise over valid corners, die where most of the cell is land
  if (v00 === v00) { s += v00 * (1 - tx) * (1 - ty); w += (1 - tx) * (1 - ty); } if (v10 === v10) { s += v10 * tx * (1 - ty); w += tx * (1 - ty); }
  if (v01 === v01) { s += v01 * (1 - tx) * ty; w += (1 - tx) * ty; } if (v11 === v11) { s += v11 * tx * ty; w += tx * ty; }
  return w >= 0.5 ? s / w : NaN;
}
