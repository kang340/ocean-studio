// GPU scalar field: the decoded data slice is uploaded as an R32F texture and coloured per fragment.
// Draped on a subdivided mesh through MapLibre's projectTile(), so the same code renders on the
// Web-Mercator map and on the globe. Missing cells are never filled: a fragment is drawn only when
// enough of its four neighbours are valid (anti-aliased coastline instead of a staircase).
import type maplibregl from "maplibre-gl";
import type { Field } from "../../viz/data";
import { compile, floatTexture, lutTexture, setProjection, mercX, mercY, MERC_LAT, type GL, type Program } from "./glu";

const NODATA = -1e30;
const VS = (prelude: string, define: string) => `#version 300 es
${prelude}
${define}
layout(location = 0) in vec2 a_merc;
uniform float u_shift;
out vec2 v_merc;
void main() {
  v_merc = a_merc;
  gl_Position = projectTile(a_merc + vec2(u_shift, 0.0));
}`;
const FS = `#version 300 es
precision highp float;
in vec2 v_merc;
uniform highp sampler2D u_data, u_prev, u_ax, u_ay;
uniform sampler2D u_lut;
uniform ivec2 u_size; uniform vec2 u_ax_range, u_ay_range; uniform float u_ax_n, u_ay_n;
uniform float u_mix, u_lo, u_hi, u_opacity, u_bands, u_global;
out vec4 color;
const float PI = 3.141592653589793;
float axis(highp sampler2D t, float n, float v, vec2 r) {
  float p = (v - r.x) / (r.y - r.x) * (n - 1.0);
  if (p < -0.5 || p > n - 0.5) return -1.0;
  p = clamp(p, 0.0, n - 1.0); float i = floor(p); float f = p - i;
  float a = texelFetch(t, ivec2(int(i), 0), 0).r, b = texelFetch(t, ivec2(int(min(i + 1.0, n - 1.0)), 0), 0).r;
  return mix(a, b, f);
}
// NaN-aware bilinear: returns (value, coverage)
vec2 bilin(highp sampler2D t, float gx, float gy) {
  float x0 = floor(gx), y0 = floor(gy); float fx = gx - x0, fy = gy - y0;
  int i0 = int(x0), j0 = int(y0), i1 = min(i0 + 1, u_size.x - 1), j1 = min(j0 + 1, u_size.y - 1);
  if (u_global > 0.5 && i0 + 1 >= u_size.x) { i1 = 0; }
  if (i0 >= u_size.x) i0 = u_size.x - 1;
  float a = texelFetch(t, ivec2(i0, j0), 0).r, b = texelFetch(t, ivec2(i1, j0), 0).r, c = texelFetch(t, ivec2(i0, j1), 0).r, d = texelFetch(t, ivec2(i1, j1), 0).r;
  vec4 w = vec4((1.0 - fx) * (1.0 - fy), fx * (1.0 - fy), (1.0 - fx) * fy, fx * fy);
  vec4 ok = vec4(a > -1e29, b > -1e29, c > -1e29, d > -1e29);
  float cover = dot(w, ok);
  if (cover < 1e-4) return vec2(0.0, 0.0);
  return vec2(dot(w * ok, vec4(a, b, c, d)) / cover, cover);
}
void main() {
  float lon = v_merc.x * 360.0 - 180.0;
  float lat = degrees(atan(sinh(PI * (1.0 - 2.0 * v_merc.y))));
  float gx;
  if (u_global > 0.5) {
    lon = u_ax_range.x + mod(lon - u_ax_range.x, 360.0);
    // between the last column and the first column + 360°: wrap (bilin() pairs index nx-1 with 0)
    if (lon > u_ax_range.y) gx = float(u_size.x - 1) + (lon - u_ax_range.y) / (u_ax_range.x + 360.0 - u_ax_range.y);
    else gx = axis(u_ax, u_ax_n, lon, u_ax_range);
  } else gx = axis(u_ax, u_ax_n, lon, u_ax_range);
  float gy = axis(u_ay, u_ay_n, lat, u_ay_range);
  if (gx < 0.0 || gy < 0.0) discard;
  vec2 cur = bilin(u_data, gx, gy);
  float v = cur.x, cover = cur.y;
  if (u_mix < 0.999) { vec2 pv = bilin(u_prev, gx, gy); if (pv.y > 0.0 && cover > 0.0) { v = mix(pv.x, v, u_mix); } }
  if (cover < 0.35) discard;
  float t = clamp((v - u_lo) / (u_hi - u_lo), 0.0, 1.0);
  if (u_bands > 1.5) t = (floor(t * u_bands * 0.9999) + 0.5) / u_bands;
  vec4 c = texture(u_lut, vec2(t * (255.0 / 256.0) + 0.5 / 256.0, 0.5));
  float edge = smoothstep(0.35, 0.65, cover);
  float a = c.a * u_opacity * edge;
  color = vec4(c.rgb * a, a);
}`;

function trim(f: Field, data: Float32Array) {
  if ((f.global || f.lon[f.nx - 1] - f.lon[0] >= 359) && f.nx > 2 && f.lon[f.nx - 1] - f.lon[0] > 360 - f.dx * 0.5) {
    const nx = f.nx - 1, d = new Float32Array(nx * f.ny); for (let j = 0; j < f.ny; j++) d.set(data.subarray(j * f.nx, j * f.nx + nx), j * nx); return { nx, data: d };
  }
  return { nx: f.nx, data };
}
type Tile = { tex: WebGLTexture; prev: WebGLTexture; ax: WebGLTexture; ay: WebGLTexture; nx: number; ny: number; axn: number; ayn: number;
  axr: [number, number]; ayr: [number, number]; global: boolean; vao: WebGLVertexArrayObject; vbo: WebGLBuffer; ibo: WebGLBuffer; count: number; key: string; hasPrev: boolean };

export type FieldStyle = { lo: number; hi: number; opacity: number; bands: number; lut: Uint8ClampedArray };

export class FieldLayer implements maplibregl.CustomLayerInterface {
  id: string; type = "custom" as const; renderingMode = "2d" as const;
  private map!: maplibregl.Map; private gl!: GL; private programs = new Map<string, Program>();
  private tiles: Tile[] = []; private lut: WebGLTexture | null = null; private style: FieldStyle | null = null;
  private fadeStart = 0; private fadeMs = 0; private staticMix: number | null = null;
  /** Swipe comparison: draw only left/right of a CSS-pixel x position (null = everywhere). */
  private clip: { x: number; side: "left" | "right" } | null = null;
  constructor(id: string) { this.id = id; }
  setClip(c: { x: number; side: "left" | "right" } | null) { this.clip = c; this.map?.triggerRepaint(); }
  private visible = true;
  setVisible(v: boolean) { if (v !== this.visible) { this.visible = v; this.map?.triggerRepaint(); } }
  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext) { this.map = map; this.gl = gl as GL; }
  onRemove() { const gl = this.gl; for (const t of this.tiles) this.free(t); this.tiles = []; if (this.lut) gl.deleteTexture(this.lut); for (const p of this.programs.values()) gl.deleteProgram(p.p); }
  private free(t: Tile) { const gl = this.gl; for (const x of [t.tex, t.prev, t.ax, t.ay]) gl.deleteTexture(x); gl.deleteBuffer(t.vbo); gl.deleteBuffer(t.ibo); gl.deleteVertexArray(t.vao); }

  setStyle(s: FieldStyle) { const changed = !this.style || this.style.lut !== s.lut; this.style = s; if (this.gl && changed) this.lut = lutTexture(this.gl, s.lut, this.lut); this.map?.triggerRepaint(); }

  /** Replace the drawn slices (base + optional detail). `fadeMs` blends values from the previous slice of the same grid. */
  setFields(fields: { f: Field; values: Float32Array }[], fadeMs = 0) {
    if (!this.gl) return; const gl = this.gl;
    const next: Tile[] = [];
    fields.forEach(({ f, values }, k) => {
      const key = `${f.nx}x${f.ny}|${f.lon[0]}|${f.lat[0]}|${f.lon[f.nx - 1]}`;
      const old = this.tiles[k];
      const data = new Float32Array(values.length); for (let i = 0; i < values.length; i++) { const v = values[i]; data[i] = v === v ? v : NODATA; }
      if (old && old.key === key) {
        // swap: previous ← current, current ← new
        const tmp = old.prev; old.prev = old.tex; const tr = trim(f, data); old.tex = floatTexture(gl, tr.nx, f.ny, tr.data, tmp); old.hasPrev = fadeMs > 0; next.push(old); return;
      }
      if (old) this.free(old);
      next.push(this.build(f, data, key));
    });
    for (let k = fields.length; k < this.tiles.length; k++) this.free(this.tiles[k]);
    this.tiles = next; this.fadeStart = performance.now(); this.fadeMs = fadeMs; this.staticMix = null; this.map.triggerRepaint();
  }
  clear() { for (const t of this.tiles) this.free(t); this.tiles = []; this.map?.triggerRepaint(); }
  /** Display-only time interpolation: draw (1−w)·a + w·b of two slices on the same grid. */
  setPair(f: Field, a: Float32Array, b: Float32Array, w: number) {
    this.setFields([{ f, values: a }], 0); this.setFields([{ f, values: b }], 0);
    if (this.tiles[0]) this.tiles[0].hasPrev = true; this.staticMix = w; this.map.triggerRepaint();
  }

  private build(f0: Field, data0: Float32Array, key: string): Tile {
    const gl = this.gl; let f = f0, data = data0;
    if ((f0.global || f0.lon[f0.nx - 1] - f0.lon[0] >= 359) && f0.nx > 2 && f0.lon[f0.nx - 1] - f0.lon[0] > 360 - f0.dx * 0.5) {
      const nx = f0.nx - 1, d = new Float32Array(nx * f0.ny); for (let j = 0; j < f0.ny; j++) d.set(data0.subarray(j * f0.nx, j * f0.nx + nx), j * nx);
      f = { ...f0, nx, lon: f0.lon.slice(0, nx), global: true }; data = d;
    }
    const tex = floatTexture(gl, f.nx, f.ny, data), prev = floatTexture(gl, f.nx, f.ny, data);
    // axis lookup: evenly spaced coordinate → fractional grid index (handles slightly irregular axes)
    const look = (axis: number[], n: number) => {
      const m = Math.min(8192, Math.max(64, n * 4)), lo = axis[0], hi = axis[n - 1], out = new Float32Array(m);
      let j = 0;
      for (let i = 0; i < m; i++) { const v = lo + (hi - lo) * i / (m - 1); while (j < n - 2 && axis[j + 1] <= v) j++; out[i] = n < 2 ? 0 : j + (v - axis[j]) / ((axis[j + 1] - axis[j]) || 1); }
      return { tex: floatTexture(gl, m, 1, out), n: m, r: [lo, hi] as [number, number] };
    };
    const global = f.global || (f.lon[f.nx - 1] - f.lon[0] + f.dx >= 359.5);
    const ax = look(f.lon, f.nx), ay = look(f.lat, f.ny);
    // mesh over the field bounds (Mercator), dense enough to follow the globe's curvature
    const [w, s, e, n] = f.bounds, south = Math.max(-MERC_LAT, s), north = Math.min(MERC_LAT, n);
    const cols = Math.max(8, Math.min(256, Math.ceil((e - w) / 1.5))), rows = Math.max(8, Math.min(192, Math.ceil((north - south) / 1.5)));
    const v = new Float32Array((cols + 1) * (rows + 1) * 2); let o = 0;
    for (let j = 0; j <= rows; j++) { const lat = south + (north - south) * j / rows; for (let i = 0; i <= cols; i++) { v[o++] = mercX(w + (e - w) * i / cols); v[o++] = mercY(lat); } }
    const idx = new Uint32Array(cols * rows * 6); o = 0;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1; idx.set([a, b, c, b, d, c], o); o += 6; }
    const vao = gl.createVertexArray()!; gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    const ibo = gl.createBuffer()!; gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { tex, prev, ax: ax.tex, ay: ay.tex, nx: f.nx, ny: f.ny, axn: ax.n, ayn: ay.n, axr: ax.r, ayr: ay.r, global, vao, vbo, ibo, count: idx.length, key, hasPrev: false };
  }

  private program(sd: any) {
    let p = this.programs.get(sd.variantName);
    if (!p) { p = compile(this.gl, VS(sd.vertexShaderPrelude, sd.define), FS); this.programs.set(sd.variantName, p); }
    return p;
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, args: any) {
    const g = gl as GL; if (!this.visible || !this.tiles.length || !this.style || !this.lut) return;
    const prog = this.program(args.shaderData); g.useProgram(prog.p); setProjection(g, prog, args.defaultProjectionData);
    const s = this.style, u = prog.u;
    const mix = this.staticMix != null ? 1 : this.fadeMs > 0 ? Math.min(1, (performance.now() - this.fadeStart) / this.fadeMs) : 1;
    const eased = this.staticMix != null ? this.staticMix : mix * mix * (3 - 2 * mix);
    g.uniform1f(u.u_lo, s.lo); g.uniform1f(u.u_hi, s.hi); g.uniform1f(u.u_opacity, s.opacity); g.uniform1f(u.u_bands, s.bands);
    g.enable(g.BLEND); g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA); g.disable(g.DEPTH_TEST); g.disable(g.CULL_FACE); g.disable(g.STENCIL_TEST);
    const globe = (this.map.getProjection?.()?.type || "mercator") === "globe";
    if (this.clip) {
      const W = g.drawingBufferWidth, H = g.drawingBufferHeight, px = Math.round(this.clip.x * W / Math.max(1, this.map.getCanvas().clientWidth));
      g.enable(g.SCISSOR_TEST); if (this.clip.side === "left") g.scissor(0, 0, Math.max(0, px), H); else g.scissor(px, 0, Math.max(0, W - px), H);
    }
    for (const t of this.tiles) {
      g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, t.tex); g.uniform1i(u.u_data, 0);
      g.activeTexture(g.TEXTURE1); g.bindTexture(g.TEXTURE_2D, t.prev); g.uniform1i(u.u_prev, 1);
      g.activeTexture(g.TEXTURE2); g.bindTexture(g.TEXTURE_2D, t.ax); g.uniform1i(u.u_ax, 2);
      g.activeTexture(g.TEXTURE3); g.bindTexture(g.TEXTURE_2D, t.ay); g.uniform1i(u.u_ay, 3);
      g.activeTexture(g.TEXTURE4); g.bindTexture(g.TEXTURE_2D, this.lut); g.uniform1i(u.u_lut, 4);
      g.uniform2i(u.u_size, t.nx, t.ny); g.uniform2f(u.u_ax_range, t.axr[0], t.axr[1]); g.uniform2f(u.u_ay_range, t.ayr[0], t.ayr[1]);
      g.uniform1f(u.u_ax_n, t.axn); g.uniform1f(u.u_ay_n, t.ayn); g.uniform1f(u.u_global, t.global ? 1 : 0);
      g.uniform1f(u.u_mix, t.hasPrev ? eased : 1);
      g.bindVertexArray(t.vao);
      for (const shift of globe ? [0] : [-1, 0, 1]) { g.uniform1f(u.u_shift, shift); g.drawElements(g.TRIANGLES, t.count, g.UNSIGNED_INT, 0); }
    }
    g.bindVertexArray(null);
    if (this.clip) g.disable(g.SCISSOR_TEST);
    if (mix < 1) this.map.triggerRepaint();
  }
}
