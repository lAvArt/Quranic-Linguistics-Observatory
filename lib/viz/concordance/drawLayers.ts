/**
 * The 2D canvas layers around the WebGL ticks.
 *
 *   back   outer scale, 12 o'clock marker, meeting histogram, threads, surah
 *          numbers — or, in the overlaid view, the whole overlaid ring
 *   front  the selected ring's band and inner wiring, and the hover outline
 *
 * Each is a function of its inputs only; the component decides when to call
 * them. None is expensive — tens to a few hundred shapes — so they redraw
 * every frame while rings move without the cost the ticks would have.
 */
import {
  LABEL_GAP,
  SWEEP,
  angleAt,
  type Frame,
  type LiveRing,
  type OverlaidBin,
  type OverlaidChord,
  type Thread,
} from "./geometry";

export interface Ink {
  ink: string;
  muted: string;
  line: string;
  accent: string;
  roots: string[];
  meeting: string;
  makki: string;
  madani: string;
}

export function prepare(canvas: HTMLCanvasElement, w: number, h: number, dpr: number): CanvasRenderingContext2D | null {
  const W = Math.round(w * dpr);
  const H = Math.round(h * dpr);
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

function sector(ctx: CanvasRenderingContext2D, f: Frame, r0: number, r1: number, a0: number, a1: number) {
  ctx.beginPath();
  ctx.arc(f.cx, f.cy, r1, a0, a1);
  ctx.arc(f.cx, f.cy, r0, a1, a0, true);
  ctx.closePath();
}

/** Outer 0–100 scale, fixed while the rings turn, with the marker at 12. */
export function drawScale(ctx: CanvasRenderingContext2D, f: Frame, ink: Ink, markerLit: boolean) {
  ctx.save();
  ctx.strokeStyle = ink.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(f.cx, f.cy, f.scale, angleAt(0), angleAt(1));
  ctx.stroke();

  ctx.fillStyle = ink.muted;
  ctx.font = "10px var(--font-sans, system-ui), sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let v = 0; v <= 100; v += 2) {
    const a = angleAt(v / 100);
    const major = v % 10 === 0;
    const len = major ? 5 : 2.5;
    ctx.beginPath();
    ctx.moveTo(f.cx + Math.cos(a) * f.scale, f.cy + Math.sin(a) * f.scale);
    ctx.lineTo(f.cx + Math.cos(a) * (f.scale + len), f.cy + Math.sin(a) * (f.scale + len));
    ctx.stroke();
    if (major) ctx.fillText(String(v), f.cx + Math.cos(a) * (f.scale + 15), f.cy + Math.sin(a) * (f.scale + 15));
  }

  // The marker a ring's anchor turns to. It lights once the rings are aligned.
  const my = f.cy - f.scale - 3;
  ctx.fillStyle = markerLit ? ink.accent : ink.muted;
  ctx.beginPath();
  ctx.moveTo(f.cx - 5, my - 8);
  ctx.lineTo(f.cx + 5, my - 8);
  ctx.lineTo(f.cx, my);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Where meetings fall, 0–100 through a surah, as bars inside the scale. */
export function drawHistogram(ctx: CanvasRenderingContext2D, f: Frame, counts: number[], ink: Ink, alpha: number) {
  if (alpha <= 0.01) return;
  const peak = Math.max(1, ...counts);
  const n = counts.length;
  const w = (SWEEP / n) * 0.6;
  ctx.save();
  ctx.globalAlpha = alpha * 0.55;
  ctx.fillStyle = ink.muted;
  counts.forEach((c, i) => {
    if (!c) return;
    const a = angleAt((i + 0.5) / n);
    const len = (f.histOuter - f.histInner) * (c / peak);
    sector(ctx, f, f.histInner, f.histInner + Math.max(2, len), a - w / 2, a + w / 2);
    ctx.fill();
  });
  ctx.restore();
}

function pointAt(f: Frame, r: number, a: number): [number, number] {
  return [f.cx + Math.cos(a) * r, f.cy + Math.sin(a) * r];
}

/** Faint lines from each meeting to the nearest meeting on the next ring out. */
export function drawThreads(
  ctx: CanvasRenderingContext2D,
  f: Frame,
  threads: Thread[],
  rings: Map<number, LiveRing>,
  ink: Ink,
  alpha: number,
) {
  if (alpha <= 0.01 || !threads.length) return;
  ctx.save();
  ctx.strokeStyle = ink.ink;
  ctx.globalAlpha = 0.14 * alpha;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (const th of threads) {
    const a = rings.get(th.from.surah);
    const b = rings.get(th.to.surah);
    if (!a || !b || a.half <= 0.05 || b.half <= 0.05) continue;
    const [x0, y0] = pointAt(f, a.r, angleAt(th.from.pos, a.rot));
    const [x1, y1] = pointAt(f, b.r, angleAt(th.to.pos, b.rot));
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
  }
  ctx.stroke();
  ctx.restore();
}

/** Surah numbers in each ring's 12 o'clock gap — only while they fit. */
export function drawSurahNumbers(ctx: CanvasRenderingContext2D, f: Frame, rings: Map<number, LiveRing>, ink: Ink) {
  let spacing = Infinity;
  const radii = [...rings.values()].filter((r) => r.half > 0.05).map((r) => r.r).sort((a, b) => a - b);
  for (let i = 1; i < radii.length; i++) spacing = Math.min(spacing, radii[i] - radii[i - 1]);
  if (spacing < 10) return;
  ctx.save();
  ctx.fillStyle = ink.muted;
  ctx.font = "9px var(--font-sans, system-ui), sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const [n, ring] of rings) {
    if (ring.half <= 0.05) continue;
    ctx.globalAlpha = Math.min(1, ring.alpha) * 0.8;
    // The gap is centred on -π/2 before the ring turns, and turns with it.
    const a = -Math.PI / 2 + ring.rot;
    ctx.fillText(String(n), f.cx + Math.cos(a) * ring.r, f.cy + Math.sin(a) * ring.r);
  }
  ctx.restore();
}

/** Radius the overlaid view's base circle sits at. */
export function overlaidBase(f: Frame): number {
  return f.ringInner + (f.ringOuter - f.ringInner) * 0.5;
}

/**
 * The overlaid view: one ring, stacked bars of each root's occurrences by
 * position with meetings on top, and every surah's consecutive occurrences of
 * a root joined by chords inside, all superimposed.
 */
export function drawOverlaid(
  ctx: CanvasRenderingContext2D,
  f: Frame,
  bins: OverlaidBin[],
  chords: OverlaidChord[],
  peak: number,
  ink: Ink,
) {
  const base = overlaidBase(f);
  const room = f.histOuter - base - 4;
  const n = bins.length;
  const w = (SWEEP / n) * 0.72;

  ctx.save();
  ctx.strokeStyle = ink.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(f.cx, f.cy, base, angleAt(0), angleAt(1));
  ctx.stroke();

  // Chords first, so the bars sit over their ends.
  ctx.lineWidth = 0.7;
  for (const c of chords) {
    const a0 = angleAt(c.a);
    const a1 = angleAt(c.b);
    const [x0, y0] = pointAt(f, base - 3, a0);
    const [x1, y1] = pointAt(f, base - 3, a1);
    // Pull the control point toward the centre in proportion to how far apart
    // the ends are, as radial-sura does: near neighbours arc shallowly.
    const span = Math.abs(Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)));
    const pull = (base - 3) * (1 - span / Math.PI) * 0.55;
    const [cx, cy] = pointAt(f, pull, (a0 + a1) / 2 + (Math.abs(a1 - a0) > Math.PI ? Math.PI : 0));
    ctx.strokeStyle = ink.roots[c.slot] ?? ink.muted;
    ctx.globalAlpha = 0.13;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(cx, cy, x1, y1);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  bins.forEach((b, i) => {
    const a = angleAt((i + 0.5) / n);
    let r = base + 2;
    const unit = room / peak;
    b.perRoot.forEach((c, slot) => {
      if (!c) return;
      ctx.fillStyle = ink.roots[slot] ?? ink.muted;
      sector(ctx, f, r, r + c * unit, a - w / 2, a + w / 2);
      ctx.fill();
      r += c * unit;
    });
    if (b.meetings) {
      ctx.fillStyle = ink.meeting;
      sector(ctx, f, r, r + b.meetings * unit, a - w / 2, a + w / 2);
      ctx.fill();
    }
  });
  ctx.restore();
}

/** The overlaid bin under a point, or -1. */
export function overlaidBinAt(f: Frame, x: number, y: number, bins: number): number {
  const dx = x - f.cx;
  const dy = y - f.cy;
  const radius = Math.hypot(dx, dy);
  if (radius < overlaidBase(f) - 8 || radius > f.histOuter + 4) return -1;
  let local = Math.atan2(dy, dx) + Math.PI / 2 - LABEL_GAP;
  local = ((local % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const pos = local / SWEEP;
  if (pos >= 1) return -1;
  return Math.min(bins - 1, Math.floor(pos * bins));
}

/**
 * A selected ring: a light band under it, and inside it every pair of ayahs
 * that share a chosen root joined by a curve, in that root's colour.
 */
export function drawSelection(
  ctx: CanvasRenderingContext2D,
  f: Frame,
  ring: LiveRing,
  wiring: { a: number; b: number; slot: number }[],
  ink: Ink,
) {
  if (ring.half <= 0.05) return;
  ctx.save();
  ctx.strokeStyle = ink.ink;
  ctx.globalAlpha = 0.14;
  ctx.lineWidth = ring.half * 2 + 5;
  ctx.beginPath();
  ctx.arc(f.cx, f.cy, ring.r, 0, Math.PI * 2);
  ctx.stroke();

  const inner = ring.r - ring.half - 1;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.6;
  for (const w of wiring) {
    const a0 = angleAt(w.a, ring.rot);
    const a1 = angleAt(w.b, ring.rot);
    const [x0, y0] = pointAt(f, inner, a0);
    const [x1, y1] = pointAt(f, inner, a1);
    const span = Math.abs(Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)));
    const pull = inner * (1 - span / Math.PI) * 0.6;
    const mid = Math.atan2(Math.sin(a0) + Math.sin(a1), Math.cos(a0) + Math.cos(a1));
    const [cx, cy] = pointAt(f, pull, mid);
    ctx.strokeStyle = ink.roots[w.slot] ?? ink.muted;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(cx, cy, x1, y1);
    ctx.stroke();
  }
  ctx.restore();
}

/** Outline round the tick under the pointer or the keyboard focus. */
export function drawFocus(ctx: CanvasRenderingContext2D, f: Frame, ring: LiveRing, pos: number, halfW: number, ink: Ink) {
  const a = angleAt(pos, ring.rot);
  const hw = Math.max(halfW * SWEEP, 2.5 / Math.max(ring.r, 1));
  ctx.save();
  ctx.strokeStyle = ink.ink;
  ctx.lineWidth = 1.5;
  sector(ctx, f, ring.r - ring.half - 2.5, ring.r + ring.half + 2.5, a - hw - 0.004, a + hw + 0.004);
  ctx.stroke();
  ctx.restore();
}
