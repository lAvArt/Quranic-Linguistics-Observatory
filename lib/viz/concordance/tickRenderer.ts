/**
 * Draws the concordance ticks — one per ayah plus the coloured root segments —
 * every frame, fast enough to animate.
 *
 * WebGL2, one instanced draw call: each tick is an annular sector, generated
 * in the vertex shader from a shared strip mesh, with its ring's radius,
 * thickness, rotation and opacity read from a small per-surah texture. That
 * texture is the only thing that changes while rings turn or travel — the
 * spec's point that turning is "one number per ring per frame" and the tick
 * geometry is never rebuilt. Edges are anti-aliased in the fragment shader.
 *
 * Where WebGL2 is missing or software-emulated (failIfMajorPerformanceCaveat),
 * the same instances are drawn as one small Path2D sector each on a 2D canvas.
 * Correct, just slower; it only matters while something is moving.
 */
import { LABEL_GAP, SWEEP, TICK_STRIDE } from "./geometry";

export interface RingUniform {
  r: number;
  half: number;
  rot: number;
  alpha: number;
  /** 0 Makki, 1 Madani. */
  place: number;
}

export interface TickPalette {
  /** Index = geometry COLOUR slot: ayah, root 1–3, meeting. RGBA 0–1. */
  slots: [number, number, number, number][];
  makki: [number, number, number, number];
  madani: [number, number, number, number];
}

export interface DrawParams {
  cx: number;
  cy: number;
  width: number;
  height: number;
  dpr: number;
  rings: Map<number, RingUniform>;
  palette: TickPalette;
  /** 0–1: how strongly the ayah ticks take their surah's revelation-place tint. */
  tint: number;
}

export interface TickRenderer {
  readonly kind: "webgl2" | "canvas2d";
  setTicks(ticks: Float32Array): void;
  draw(p: DrawParams): void;
  dispose(): void;
}

/** Surah texture width; 114 surahs plus room for 1-based indexing. */
const TEX_W = 128;
/** Segments per tick along its arc — enough for a 3-ayah surah's long dashes. */
const STRIP = 12;

const VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_corner;
layout(location=1) in vec4 a_tick;   // surah, pos, halfWidth, colour
layout(location=2) in vec2 a_rad;    // lo, hi (fractions of ring thickness)
uniform highp sampler2D u_rings;     // row 0: r, half, rot, alpha   row 1: place
uniform vec2 u_center;
uniform vec2 u_viewport;
uniform float u_gap;
uniform float u_sweep;
out vec2 v_off;
out vec2 v_half;
flat out float v_colour;
flat out float v_alpha;
flat out float v_place;
void main() {
  int s = int(a_tick.x + 0.5);
  vec4 ring = texelFetch(u_rings, ivec2(s, 0), 0);
  float place = texelFetch(u_rings, ivec2(s, 1), 0).x;
  float thick = 2.0 * ring.y;
  float r0 = ring.x - ring.y + a_rad.x * thick;
  float r1 = ring.x - ring.y + a_rad.y * thick;
  // Never thinner than one device pixel, or a tick shimmers in and out.
  float mid = 0.5 * (r0 + r1);
  float halfR = max(0.5 * (r1 - r0), 0.5);
  float halfA = a_tick.z * u_sweep;
  // Pad a pixel beyond each edge so the fragment shader has room to fade.
  float padA = 1.0 / max(mid, 1.0);
  float rr = mid + mix(-halfR - 1.0, halfR + 1.0, a_corner.y);
  float da = mix(-halfA - padA, halfA + padA, a_corner.x);
  float ang = -1.5707963267948966 + u_gap + a_tick.y * u_sweep + ring.z + da;
  vec2 p = u_center + rr * vec2(cos(ang), sin(ang));
  vec2 clip = p / u_viewport * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_off = vec2(rr - mid, da * mid);
  v_half = vec2(halfR, halfA * mid);
  v_colour = a_tick.w;
  v_alpha = ring.y > 0.05 ? ring.w : 0.0;
  v_place = place;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 v_off;
in vec2 v_half;
flat in float v_colour;
flat in float v_alpha;
flat in float v_place;
uniform vec4 u_slots[5];
uniform vec4 u_makki;
uniform vec4 u_madani;
uniform float u_tint;
out vec4 o;
void main() {
  float cov = clamp(v_half.x - abs(v_off.x) + 0.5, 0.0, 1.0)
            * clamp(v_half.y - abs(v_off.y) + 0.5, 0.0, 1.0);
  int c = int(v_colour + 0.5);
  vec4 col = u_slots[c];
  if (c == 0) {
    vec3 placeCol = v_place > 0.5 ? u_madani.rgb : u_makki.rgb;
    col.rgb = mix(col.rgb, placeCol, 0.4 * u_tint);
  }
  float a = col.a * cov * v_alpha;
  if (a < 0.003) discard;
  o = vec4(col.rgb * a, a);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`shader: ${log}`);
  }
  return sh;
}

class GLTicks implements TickRenderer {
  readonly kind = "webgl2" as const;
  private prog: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private inst: WebGLBuffer;
  private tex: WebGLTexture;
  private texData = new Float32Array(TEX_W * 2 * 4);
  private count = 0;
  private u: Record<string, WebGLUniformLocation | null> = {};

  constructor(private gl: WebGL2RenderingContext) {
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(prog)}`);
    this.prog = prog;
    for (const name of ["u_rings", "u_center", "u_viewport", "u_gap", "u_sweep", "u_slots", "u_makki", "u_madani", "u_tint"]) {
      this.u[name] = gl.getUniformLocation(prog, name);
    }

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);

    // Shared strip: (t, side) pairs along the arc.
    const strip: number[] = [];
    for (let i = 0; i <= STRIP; i++) strip.push(i / STRIP, 0, i / STRIP, 1);
    const base = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, base);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(strip), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.inst = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    const stride = TICK_STRIDE * 4;
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);

    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, TEX_W, 2, 0, gl.RGBA, gl.FLOAT, this.texData);
  }

  setTicks(ticks: Float32Array): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    gl.bufferData(gl.ARRAY_BUFFER, ticks, gl.STATIC_DRAW);
    this.count = ticks.length / TICK_STRIDE;
  }

  draw(p: DrawParams): void {
    const gl = this.gl;
    const W = Math.round(p.width * p.dpr);
    const H = Math.round(p.height * p.dpr);
    // gl.viewport alone does not size the canvas; its backing store must match.
    const canvas = gl.canvas as HTMLCanvasElement;
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.count) return;

    // The per-surah texture is the whole per-frame upload: 2 × 128 texels.
    this.texData.fill(0);
    for (const [n, ring] of p.rings) {
      if (n < 0 || n >= TEX_W) continue;
      const i = n * 4;
      this.texData[i] = ring.r * p.dpr;
      this.texData[i + 1] = ring.half * p.dpr;
      this.texData[i + 2] = ring.rot;
      this.texData[i + 3] = ring.alpha;
      this.texData[(TEX_W + n) * 4] = ring.place;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TEX_W, 2, gl.RGBA, gl.FLOAT, this.texData);

    gl.useProgram(this.prog);
    gl.uniform1i(this.u.u_rings, 0);
    gl.uniform2f(this.u.u_center, p.cx * p.dpr, p.cy * p.dpr);
    gl.uniform2f(this.u.u_viewport, W, H);
    gl.uniform1f(this.u.u_gap, LABEL_GAP);
    gl.uniform1f(this.u.u_sweep, SWEEP);
    gl.uniform4fv(this.u.u_slots, new Float32Array(p.palette.slots.flat()));
    gl.uniform4fv(this.u.u_makki, p.palette.makki);
    gl.uniform4fv(this.u.u_madani, p.palette.madani);
    gl.uniform1f(this.u.u_tint, p.tint);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, (STRIP + 1) * 2, this.count);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.prog);
    gl.deleteBuffer(this.inst);
    gl.deleteTexture(this.tex);
    gl.deleteVertexArray(this.vao);
  }
}

class CanvasTicks implements TickRenderer {
  readonly kind = "canvas2d" as const;
  private ticks = new Float32Array(0);

  constructor(private ctx: CanvasRenderingContext2D) {}

  setTicks(ticks: Float32Array): void {
    this.ticks = ticks;
  }

  draw(p: DrawParams): void {
    const ctx = this.ctx;
    const W = Math.round(p.width * p.dpr);
    const H = Math.round(p.height * p.dpr);
    if (ctx.canvas.width !== W) ctx.canvas.width = W;
    if (ctx.canvas.height !== H) ctx.canvas.height = H;
    ctx.setTransform(p.dpr, 0, 0, p.dpr, 0, 0);
    ctx.clearRect(0, 0, p.width, p.height);
    const t = this.ticks;
    for (let i = 0; i < t.length; i += TICK_STRIDE) {
      const ring = p.rings.get(t[i]);
      if (!ring || ring.half <= 0.05 || ring.alpha <= 0.003) continue;
      const colour = t[i + 3];
      const [cr, cg, cb, a] = p.palette.slots[colour];
      let r = cr;
      let g = cg;
      let b = cb;
      if (colour === 0 && p.tint > 0) {
        const pc = ring.place > 0.5 ? p.palette.madani : p.palette.makki;
        r += (pc[0] - r) * 0.4 * p.tint;
        g += (pc[1] - g) * 0.4 * p.tint;
        b += (pc[2] - b) * 0.4 * p.tint;
      }
      const thick = ring.half * 2;
      const inner = ring.r - ring.half;
      let r0 = inner + t[i + 4] * thick;
      let r1 = inner + t[i + 5] * thick;
      if (r1 - r0 < 1) {
        const m = (r0 + r1) / 2;
        r0 = m - 0.5;
        r1 = m + 0.5;
      }
      const mid = -Math.PI / 2 + LABEL_GAP + t[i + 1] * SWEEP + ring.rot;
      const hw = t[i + 2] * SWEEP;
      ctx.fillStyle = `rgba(${r * 255},${g * 255},${b * 255},${a * ring.alpha})`;
      const path = new Path2D();
      path.arc(p.cx, p.cy, r1, mid - hw, mid + hw);
      path.arc(p.cx, p.cy, r0, mid + hw, mid - hw, true);
      path.closePath();
      ctx.fill(path);
    }
  }

  dispose(): void {}
}

/** WebGL2 where it is real hardware; the 2D path everywhere else. */
export function createTickRenderer(canvas: HTMLCanvasElement): TickRenderer | null {
  try {
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      failIfMajorPerformanceCaveat: true,
    });
    if (gl) return new GLTicks(gl);
  } catch {
    // Fall through to 2D.
  }
  const ctx = canvas.getContext("2d");
  return ctx ? new CanvasTicks(ctx) : null;
}

/** CSS colour → RGBA 0–1, via a scratch canvas so any CSS syntax works. */
export function parseColour(css: string, alpha = 1): [number, number, number, number] {
  if (typeof document === "undefined") return [0.5, 0.5, 0.5, alpha];
  const c = document.createElement("canvas").getContext("2d");
  if (!c) return [0.5, 0.5, 0.5, alpha];
  c.fillStyle = "#000";
  c.fillStyle = css;
  const v = String(c.fillStyle);
  if (v.startsWith("#")) {
    const hex = v.slice(1);
    return [parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255, alpha];
  }
  const m = v.match(/rgba?\(([^)]+)\)/);
  if (!m) return [0.5, 0.5, 0.5, alpha];
  const parts = m[1].split(",").map((x) => parseFloat(x));
  return [parts[0] / 255, parts[1] / 255, parts[2] / 255, (parts[3] ?? 1) * alpha];
}
