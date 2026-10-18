// Small WebGL2 helpers shared by the Ocean Studio custom layers.
export type GL = WebGL2RenderingContext;

export function compile(gl: GL, vs: string, fs: string) {
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("shader: " + gl.getShaderInfoLog(s) + "\n" + src.split("\n").map((l, i) => `${i + 1}: ${l}`).slice(0, 400).join("\n"));
    return s;
  };
  const p = gl.createProgram()!; gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("link: " + gl.getProgramInfoLog(p));
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS), u: Record<string, WebGLUniformLocation> = {};
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i)!; const name = info.name.replace(/\[0\]$/, ""); u[name] = gl.getUniformLocation(p, info.name)!; }
  return { p, u };
}
export type Program = ReturnType<typeof compile>;

/** MapLibre projection uniforms (mercator and globe variants share the names). */
export function setProjection(gl: GL, prog: Program, pd: any) {
  const u = prog.u;
  if (u.u_projection_matrix) gl.uniformMatrix4fv(u.u_projection_matrix, false, pd.mainMatrix);
  if (u.u_projection_tile_mercator_coords) gl.uniform4f(u.u_projection_tile_mercator_coords, ...(pd.tileMercatorCoords as [number, number, number, number]));
  if (u.u_projection_clipping_plane) gl.uniform4f(u.u_projection_clipping_plane, ...(pd.clippingPlane as [number, number, number, number]));
  if (u.u_projection_transition) gl.uniform1f(u.u_projection_transition, pd.projectionTransition);
  if (u.u_projection_fallback_matrix) gl.uniformMatrix4fv(u.u_projection_fallback_matrix, false, pd.fallbackMatrix);
}

export function lutTexture(gl: GL, rgba: Uint8ClampedArray, tex?: WebGLTexture | null) {
  const t = tex || gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

/** R32F texture without filtering (sampled with texelFetch). */
export function floatTexture(gl: GL, w: number, h: number, data: Float32Array, tex?: WebGLTexture | null) {
  const t = tex || gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, w, h, 0, gl.RED, gl.FLOAT, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

export const MERC_LAT = 85.0511;
export const mercX = (lon: number) => (lon + 180) / 360;
export const mercY = (lat: number) => { const s = Math.sin(Math.max(-MERC_LAT, Math.min(MERC_LAT, lat)) * Math.PI / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
export const unMercY = (y: number) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;
