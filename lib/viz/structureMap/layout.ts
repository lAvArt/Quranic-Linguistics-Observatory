/**
 * Geometry for the Quran structure map (components/visualisations/
 * CorpusArchitectureMap.tsx). Pure functions, no DOM: the component draws what
 * these return, and the tests check the promises the picture makes — nothing
 * overlaps, every surah keeps its place, a drilled surah gets room to breathe.
 *
 * World units: the SVG viewBox is -VIEW..VIEW on both axes, centred on the
 * corpus. Angles are clockwise from 12 o'clock, in radians, so surah 1 sits
 * just right of the top and the ring reads like a clock face.
 *
 *   inward bar    each surah's length in words, pointing at the centre
 *   ring arc      the surah itself, tinted Makki or Madani
 *   outward       its roots (overview), its whole root set (drilled), or the
 *                 ayahs of the selected root (occurrence mode)
 */

export const VIEW = 1000;
export const SURAH_COUNT = 114;
export const TAU = Math.PI * 2;

export const RING = 460;
export const ARC_WIDTH = 10;
/** Gap between a surah's arc and its inward length bar. */
export const BAR_GAP = 7;
export const BAR_MIN = 16;
export const BAR_MAX = 120;

/** Overview: each surah's most frequent roots, stacked outward. */
export const OVERVIEW_ROOTS = 5;
export const ROOT_START = RING + ARC_WIDTH + 34;
export const ROOT_STEP = 19;

/** Drilled surah: every root, in rows that each hold as many as fit. */
export const GRID_START = RING + ARC_WIDTH + 42;
export const GRID_CELL = 30;

/** Cell size for a drilled surah: roomier for short surahs, so their labels fit without zooming. */
export function gridCell(count: number): number {
  return count <= 40 ? 48 : count <= 150 ? 38 : GRID_CELL;
}

/** Occurrence mode: one dot per ayah holding the root, stacked outward. */
export const OCC_START = RING + ARC_WIDTH + 30;
export const OCC_STEP = 10;
export const OCC_MAX_LEN = 380;

export interface Slot {
  id: number;
  /** Centre angle. */
  mid: number;
  /** Half the angle the surah occupies. */
  half: number;
}

export interface Point {
  x: number;
  y: number;
}

export function pointAt(angle: number, r: number): Point {
  return { x: r * Math.sin(angle), y: -r * Math.cos(angle) };
}

/** The ring angle of a world point, in [0, 2π). */
export function angleOf(x: number, y: number): number {
  const a = Math.atan2(x, -y);
  return a < 0 ? a + TAU : a;
}

/** Signed shortest difference a − b, in (−π, π]. */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

/**
 * How wide a drilled surah opens, from how many roots it has: enough for a
 * short surah's roots to sit in one or two rows, up to 150° for the longest.
 */
export function focusSpan(rootCount: number): number {
  const deg = Math.max(60, Math.min(150, 48 + 5.2 * Math.sqrt(rootCount)));
  return (deg * Math.PI) / 180;
}

/**
 * Every surah's place on the ring. Without a focus, 114 equal slots. With one,
 * the focused surah opens to `span` around its own resting angle — so it opens
 * where the reader clicked it — and the other 113 share what's left, in order.
 */
export function ringSlots(focusId: number | null = null, span = 0): Map<number, Slot> {
  const slots = new Map<number, Slot>();
  const even = TAU / SURAH_COUNT;
  if (!focusId || span <= 0) {
    for (let id = 1; id <= SURAH_COUNT; id++) slots.set(id, { id, mid: (id - 0.5) * even, half: even / 2 });
    return slots;
  }
  const focusMid = (focusId - 0.5) * even;
  slots.set(focusId, { id: focusId, mid: focusMid, half: span / 2 });
  const rest = (TAU - span) / (SURAH_COUNT - 1);
  for (let k = 1; k < SURAH_COUNT; k++) {
    const id = ((focusId - 1 + k) % SURAH_COUNT) + 1;
    // Kept in [0, 2π): which half of the ring a label is on decides how it's turned.
    slots.set(id, { id, mid: (focusMid + span / 2 + (k - 0.5) * rest) % TAU, half: rest / 2 });
  }
  return slots;
}

/** Length of a surah's inward bar, by word count (square-root scale). */
export function barLength(words: number, maxWords: number): number {
  if (maxWords <= 0) return BAR_MIN;
  return BAR_MIN + (BAR_MAX - BAR_MIN) * Math.sqrt(Math.max(0, words) / maxWords);
}

/** An annular sector from angle a0 to a1 (clockwise), radius r0 to r1, as SVG path data. */
export function sectorPath(a0: number, a1: number, r0: number, r1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p0 = pointAt(a0, r1);
  const p1 = pointAt(a1, r1);
  const p2 = pointAt(a1, r0);
  const p3 = pointAt(a0, r0);
  const f = (n: number) => n.toFixed(2);
  return (
    `M${f(p0.x)},${f(p0.y)}A${r1},${r1} 0 ${large} 1 ${f(p1.x)},${f(p1.y)}` +
    `L${f(p2.x)},${f(p2.y)}A${r0},${r0} 0 ${large} 0 ${f(p3.x)},${f(p3.y)}Z`
  );
}

/** Radius of a root or occurrence dot for a count, relative to the largest shown. */
export function dotRadius(count: number, max: number, min = 2.4, maxR = 8): number {
  if (max <= 0) return min;
  return min + (maxR - min) * Math.sqrt(Math.min(1, count / max));
}

/** Overview: a surah's top roots, outward along its centre angle. */
export function overviewRootPositions(slot: Slot, count: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < count; i++) out.push(pointAt(slot.mid, ROOT_START + i * ROOT_STEP));
  return out;
}

export interface GridCell extends Point {
  angle: number;
  r: number;
  row: number;
}

/**
 * Drilled surah: every root in a cell of its own. Rows hold as many cells as
 * their arc fits at GRID_CELL spacing, and fill inside-out in frequency order;
 * within a row the most frequent sit in the middle and the rest alternate
 * outward, so the heaviest roots gather at the centre of the sector.
 */
export function focusGrid(slot: Slot, count: number): GridCell[] {
  const cells: GridCell[] = [];
  const usable = slot.half * 2 * 0.94;
  const cell = gridCell(count);
  let placed = 0;
  for (let row = 0; placed < count; row++) {
    const r = GRID_START + row * cell;
    const capacity = Math.max(1, Math.floor((usable * r) / cell));
    const n = Math.min(capacity, count - placed);
    const spacing = usable / capacity;
    for (let j = 0; j < n; j++) {
      // 0, +1, −1, +2, −2 … around the centre of the row.
      const offset = j === 0 ? 0 : j % 2 === 1 ? (j + 1) / 2 : -j / 2;
      const angle = slot.mid + offset * spacing;
      cells.push({ ...pointAt(angle, r), angle, r, row });
    }
    placed += n;
  }
  return cells;
}

/** How far out a drilled surah's grid reaches. */
export function gridOuterRadius(slot: Slot, count: number): number {
  const cells = focusGrid(slot, count);
  return cells.length ? cells[cells.length - 1].r : GRID_START;
}

/** Occurrence mode: one dot per ayah, stacked outward; long stacks tighten to OCC_MAX_LEN. */
export function occurrencePositions(slot: Slot, count: number): Point[] {
  const step = count > 1 ? Math.min(OCC_STEP, OCC_MAX_LEN / (count - 1)) : 0;
  const out: Point[] = [];
  for (let i = 0; i < count; i++) out.push(pointAt(slot.mid, OCC_START + i * step));
  return out;
}

export interface LabelBox {
  id: string;
  /** Screen position of the label's anchor point. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** "start" grows right, "end" grows left, "middle" centres on x. */
  anchor: "start" | "middle" | "end";
  priority: number;
  /** Other places to try, in order, when the first is taken. */
  alts?: { x: number; y: number; anchor: "start" | "middle" | "end" }[];
  /** May cover soft obstacles (lesser marks); still clears hard ones and other labels. */
  bold?: boolean;
}

export interface Obstacle {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Only labels that aren't `bold` must avoid it. */
  soft?: boolean;
}

/**
 * Greedy label placement in screen space: highest priority first, each label
 * admitted at the first of its positions whose box clears every box already
 * admitted (and any obstacles, such as dots). Returns each admitted id with
 * the index of the position it took (0 = the label's own x/y). A uniform grid
 * keeps the overlap test local, so a few thousand candidates cost a few
 * milliseconds.
 */
export function admitLabels(candidates: LabelBox[], obstacles: Obstacle[] = [], pad = 3): Map<string, number> {
  const CELL = 48;
  type Box = { x0: number; y0: number; x1: number; y1: number; soft?: boolean };
  const grid = new Map<string, Box[]>();
  const keysFor = (x0: number, y0: number, x1: number, y1: number) => {
    const keys: string[] = [];
    for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++)
      for (let gy = Math.floor(y0 / CELL); gy <= Math.floor(y1 / CELL); gy++) keys.push(`${gx},${gy}`);
    return keys;
  };
  const insert = (b: Box) => {
    for (const k of keysFor(b.x0, b.y0, b.x1, b.y1)) {
      const list = grid.get(k);
      if (list) list.push(b);
      else grid.set(k, [b]);
    }
  };
  const hits = (b: Box, ignoreSoft: boolean) => {
    for (const k of keysFor(b.x0, b.y0, b.x1, b.y1)) {
      for (const o of grid.get(k) ?? []) {
        if (ignoreSoft && o.soft) continue;
        if (b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0) return true;
      }
    }
    return false;
  };
  for (const o of obstacles) insert({ x0: o.x - o.w / 2, y0: o.y - o.h / 2, x1: o.x + o.w / 2, y1: o.y + o.h / 2, soft: o.soft });

  const admitted = new Map<string, number>();
  const ordered = [...candidates].sort((a, b) => b.priority - a.priority);
  for (const c of ordered) {
    const places = [{ x: c.x, y: c.y, anchor: c.anchor }, ...(c.alts ?? [])];
    for (let i = 0; i < places.length; i++) {
      const p = places[i];
      const x0 = p.anchor === "start" ? p.x : p.anchor === "end" ? p.x - c.w : p.x - c.w / 2;
      const box = { x0: x0 - pad, y0: p.y - c.h / 2 - pad, x1: x0 + c.w + pad, y1: p.y + c.h / 2 + pad };
      if (hits(box, !!c.bold)) continue;
      insert(box);
      admitted.set(c.id, i);
      break;
    }
  }
  return admitted;
}

export interface RadialLabel {
  id: string;
  /** Ring angle the label runs outward along. */
  angle: number;
  /** Screen px from the ring centre to the label's inner end. */
  r0: number;
  /** Screen px along the radius. */
  length: number;
  /** Screen px across (the font's line height). */
  thickness: number;
  priority: number;
}

/** A band of the ring labels must stay out of: angles a0→a1 (clockwise), radii r0–r1 in screen px. */
export interface RadialObstacle {
  a0: number;
  a1: number;
  r0: number;
  r1: number;
}

/**
 * Placement for labels that run outward along a spoke, like the surah names
 * round the ring. Axis-aligned boxes can't test these (a diagonal label's box
 * is mostly empty), but two spokes are simple to test exactly: where their
 * radial extents overlap, the gap between them at the inner end of the overlap
 * is r·sin Δθ. Greedy by priority, like `admitLabels`. Radii are screen px
 * from the ring's centre, so the result depends on the zoom but not the pan.
 */
export function admitRadialLabels(candidates: RadialLabel[], obstacles: RadialObstacle[] = [], pad = 2): Set<string> {
  const placed: RadialLabel[] = [];
  const admitted = new Set<string>();
  const ordered = [...candidates].sort((a, b) => b.priority - a.priority);
  for (const c of ordered) {
    const c1 = c.r0 + c.length;
    let blocked = false;
    for (const o of obstacles) {
      if (Math.max(c.r0, o.r0) >= Math.min(c1, o.r1)) continue;
      const rho = Math.max(c.r0, o.r0, 1);
      const margin = Math.asin(Math.min(1, (c.thickness / 2 + pad) / rho));
      const span = ((o.a1 - o.a0) % TAU + TAU) % TAU;
      const into = ((c.angle - o.a0 + margin) % TAU + TAU) % TAU;
      if (into <= span + 2 * margin) {
        blocked = true;
        break;
      }
    }
    if (!blocked) {
      for (const p of placed) {
        const lo = Math.max(c.r0, p.r0);
        if (lo >= Math.min(c1, p.r0 + p.length)) continue;
        const d = Math.abs(angleDiff(c.angle, p.angle));
        if (d >= Math.PI / 2) continue;
        if (lo * Math.sin(d) < (c.thickness + p.thickness) / 2 + pad) {
          blocked = true;
          break;
        }
      }
    }
    if (blocked) continue;
    placed.push(c);
    admitted.add(c.id);
  }
  return admitted;
}

/** Rough rendered width of a label, in px, for the placement test. */
export function estimateTextWidth(text: string, fontPx: number): number {
  let w = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    // Arabic letters join and run narrower per character than Latin capitals.
    w += code >= 0x0600 && code <= 0x06ff ? 0.52 : code >= 0x30 && code <= 0x39 ? 0.58 : 0.56;
  }
  return w * fontPx;
}

/** Slots part-way between two layouts, for the ring opening onto a surah. Angles take the short way round. */
export function interpolateSlots(from: Map<number, Slot>, to: Map<number, Slot>, t: number): Map<number, Slot> {
  const out = new Map<number, Slot>();
  to.forEach((b, id) => {
    const a = from.get(id) ?? b;
    out.set(id, { id, mid: a.mid + angleDiff(b.mid, a.mid) * t, half: a.half + (b.half - a.half) * t });
  });
  return out;
}

/** World-space box around a set of points, padded. */
export function boundsOf(points: Point[], pad: number): { x: number; y: number; width: number; height: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x: x0 - pad, y: y0 - pad, width: x1 - x0 + pad * 2, height: y1 - y0 + pad * 2 };
}

/** The ring's four extreme points, so a fit always keeps the whole Quran in frame. */
export function ringExtent(r = RING + ARC_WIDTH): Point[] {
  return [pointAt(0, r), pointAt(Math.PI / 2, r), pointAt(Math.PI, r), pointAt((3 * Math.PI) / 2, r)];
}
