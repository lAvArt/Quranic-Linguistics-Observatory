/**
 * Which labels the structure map shows, and where, for one settled view.
 *
 * Text stays a constant size on screen whatever the zoom (the label layer
 * scales it by 1/zoom), so whether two labels collide depends on the zoom:
 * this runs when a gesture ends, not on every frame. Surah names and
 * occurrence tips run outward along their spokes and are placed with
 * `admitRadialLabels`; root labels sit flat beside their dots and are placed
 * with `admitLabels`, clear of the names and of other roots' dots.
 */
import {
  ARC_WIDTH,
  OVERVIEW_ROOTS,
  RING,
  ROOT_START,
  ROOT_STEP,
  admitLabels,
  admitRadialLabels,
  dotRadius,
  estimateTextWidth,
  focusGrid,
  gridCell,
  occurrencePositions,
  pointAt,
  type LabelBox,
  type Obstacle,
  type RadialLabel,
  type RadialObstacle,
  type Slot,
} from "./layout";
import type { Occurrence, StructureModel } from "./model";

export const NAME_PX = 11;
export const NAME_AR_PX = 13;
export const ROOT_PX = 15;
export const TIP_PX = 11;
/** Drill mode: this many of the surah's commonest roots are labelled first. */
const HEAVY_ROOTS = 14;
const LINE = 1.3;
const GAP_PX = 5;

export type MapMode = "overview" | "drill" | "occurrence";

export interface View {
  /** d3 zoom transform: screen = centre + t + k·world. */
  k: number;
  x: number;
  y: number;
  /** Element size in px. */
  w: number;
  h: number;
}

export interface LabelInput {
  mode: MapMode;
  slots: Map<number, Slot>;
  model: StructureModel;
  focusId: number | null;
  occurrences: Map<number, Occurrence[]>;
  view: View;
  surahName: (n: number) => string;
  /** Surah names are Arabic script (the Arabic locale). */
  arabicNames: boolean;
  rootText: (root: number) => string;
  formatCount: (n: number) => string;
  /** Always admitted first: the selected surah, root or occurrence surah. */
  prioritySurah?: number | null;
  priorityRoot?: number | null;
}

export interface LabelSpec {
  id: string;
  x: number;
  y: number;
  rotate: number;
  anchor: "start" | "middle" | "end";
  text: string;
  kind: "surah" | "root" | "tip";
  arabic: boolean;
  strong?: boolean;
  heavy?: boolean;
}

export interface LabelResult {
  labels: LabelSpec[];
  /** Drill mode: how many of the surah's roots got a label. */
  rootsLabelled: number;
}

const deg = (a: number) => (a * 180) / Math.PI;

/** A drilled root's dot: as big as its cell allows, by its count in the surah. */
export function drillDotRadius(count: number, max: number, cell: number): number {
  return dotRadius(count, max, 2.4, Math.min(15, cell * 0.36));
}

/** A spoke label's anchor, rotation and anchor side so it reads left-to-right. */
function spoke(angle: number, r: number) {
  const p = pointAt(angle, r);
  const right = angle < Math.PI;
  return { x: p.x, y: p.y, rotate: right ? deg(angle) - 90 : deg(angle) + 90, anchor: right ? ("start" as const) : ("end" as const) };
}

export function computeLabels(input: LabelInput): LabelResult {
  const { mode, slots, model, focusId, occurrences, view, surahName, arabicNames, rootText, formatCount } = input;
  const { k } = view;
  const cx = view.w / 2 + view.x;
  const cy = view.h / 2 + view.y;
  const toScreen = (x: number, y: number) => ({ sx: cx + k * x, sy: cy + k * y });
  const onScreen = (x: number, y: number, m = 40) => {
    const { sx, sy } = toScreen(x, y);
    return sx > -m && sx < view.w + m && sy > -m && sy < view.h + m;
  };
  const namePx = arabicNames ? NAME_AR_PX : NAME_PX;

  const radial: RadialLabel[] = [];
  const specs = new Map<string, LabelSpec>();
  const obstacles: RadialObstacle[] = [];

  const addRadial = (id: string, angle: number, rWorld: number, text: string, px: number, priority: number, kind: LabelSpec["kind"], arabic: boolean, strong = false) => {
    const r = rWorld + GAP_PX / k;
    const s = spoke(angle, r);
    const length = estimateTextWidth(text, px);
    const tip = pointAt(angle, r + length / k);
    if (!onScreen(s.x, s.y) && !onScreen(tip.x, tip.y)) return;
    radial.push({ id, angle, r0: r * k, length, thickness: px * LINE, priority });
    specs.set(id, { id, ...s, text, kind, arabic, strong });
  };

  // Names where there is room round the ring for them; numbers on a small
  // screen until the reader zooms in (the tooltip and a tap still name it).
  const room = Math.min(view.w, view.h) / 2;
  const useNames = mode === "occurrence" || (ROOT_START + 100) * k + 70 <= room + 60 || RING * k > room * 1.15;
  const ringLabel = (n: number) => (useNames ? surahName(n) : formatCount(n));

  const namePriority = (n: number) => {
    const words = model.surahs[n - 1]?.words ?? 0;
    return (words / model.maxWords) * 2 + (n % 10 === 0 ? 1.5 : n % 5 === 0 ? 0.8 : 0) + (n === 1 || n === 114 ? 3 : 0) + (n === input.prioritySurah ? 100 : 0);
  };

  if (mode === "overview") {
    const r = ROOT_START + (OVERVIEW_ROOTS - 1) * ROOT_STEP + 10;
    slots.forEach((slot, n) => addRadial(`s${n}`, slot.mid, r, ringLabel(n), namePx, namePriority(n), "surah", arabicNames && useNames));
  } else if (mode === "drill") {
    const focus = focusId != null ? slots.get(focusId) : undefined;
    slots.forEach((slot, n) => {
      if (n === focusId) return;
      addRadial(`s${n}`, slot.mid, RING + ARC_WIDTH + 6, ringLabel(n), namePx, namePriority(n), "surah", arabicNames && useNames);
    });
    if (focus) obstacles.push({ a0: focus.mid - focus.half, a1: focus.mid + focus.half, r0: 0, r1: Infinity });
  } else {
    occurrences.forEach((list, n) => {
      const slot = slots.get(n);
      if (!slot) return;
      const pts = occurrencePositions(slot, list.length);
      const tipR = Math.hypot(pts[pts.length - 1].x, pts[pts.length - 1].y) + 6;
      // The stack itself, so no other surah's tip label is written across it.
      radial.push({ id: `stack${n}`, angle: slot.mid, r0: (RING + ARC_WIDTH) * k, length: (tipR - RING - ARC_WIDTH) * k, thickness: 8, priority: 1e9 });
      let words = 0;
      for (const o of list) words += o.count;
      const text = `${surahName(n)} · ${formatCount(words)}`;
      addRadial(`s${n}`, slot.mid, tipR, text, TIP_PX, words + (n === input.prioritySurah ? 1e6 : 0), "tip", arabicNames, n === input.prioritySurah);
    });
  }

  const radialIds = admitRadialLabels(radial, obstacles);
  const labels: LabelSpec[] = [];
  // Every admitted spoke label blocks the flat root labels below, by its screen box.
  const blockers: { x: number; y: number; w: number; h: number }[] = [];
  radialIds.forEach((id) => {
    const spec = specs.get(id);
    const cand = radial.find((c) => c.id === id);
    if (!spec || !cand) return;
    labels.push(spec);
    const a = pointAt(cand.angle, cand.r0 / k);
    const b = pointAt(cand.angle, (cand.r0 + cand.length) / k);
    const p = toScreen(a.x, a.y);
    const q = toScreen(b.x, b.y);
    const pad = cand.thickness / 2;
    blockers.push({ x: (p.sx + q.sx) / 2, y: (p.sy + q.sy) / 2, w: Math.abs(q.sx - p.sx) + pad * 2, h: Math.abs(q.sy - p.sy) + pad * 2 });
  });

  // Flat root labels, beside their dots.
  let rootsLabelled = 0;
  const flat: LabelBox[] = [];
  const flatSpecs = new Map<string, LabelSpec>();
  const dots: Obstacle[] = [];
  const rootPlace = new Map<string, { x: number; y: number; r: number }>();
  const lineH = ROOT_PX * 1.15;
  /**
   * `heavy` roots — the few commonest in view — are placed first and may sit
   * over a lesser dot (above, below or beside their own); every other label
   * must clear every dot that reads as a mark. Without that first pass the
   * biggest dots, packed side by side, blocked each other's labels at every
   * zoom, so the roots that matter most were the ones left unnamed.
   */
  const addRoot = (id: string, x: number, y: number, rWorld: number, root: number, priority: number, heavy: boolean) => {
    const { sx, sy } = toScreen(x, y);
    const rPx = rWorld * k;
    if (heavy || rPx >= 3.5) dots.push({ x: sx, y: sy, w: rPx * 2 + 2, h: rPx * 2 + 2, soft: !heavy });
    if (!onScreen(x, y, 10)) return;
    const text = rootText(root);
    const w = estimateTextWidth(text, ROOT_PX);
    const off = rPx + 3;
    const side = [
      { x: sx + off, y: sy, anchor: "start" as const },
      { x: sx - off, y: sy, anchor: "end" as const },
    ];
    const vertical = [
      { x: sx, y: sy - off - lineH / 2, anchor: "middle" as const },
      { x: sx, y: sy + off + lineH / 2, anchor: "middle" as const },
    ];
    const places = heavy ? [...side, ...vertical] : side;
    flat.push({ id, ...places[0], w, h: lineH, priority: priority + (heavy ? 1e5 : 0), alts: places.slice(1), bold: heavy });
    rootPlace.set(id, { x, y, r: off / k });
    flatSpecs.set(id, { id, x, y, rotate: 0, anchor: "start", text, kind: "root", arabic: true, strong: root === input.priorityRoot, heavy });
  };

  if (mode === "drill" && focusId != null) {
    const slot = slots.get(focusId);
    const profile = model.surahs[focusId - 1];
    const cell = gridCell(profile?.roots.length ?? 0);
    if (slot && profile && cell * k >= 12) {
      const cells = focusGrid(slot, profile.roots.length);
      const max = profile.roots[0]?.count ?? 1;
      profile.roots.forEach((r, i) => {
        const c = cells[i];
        addRoot(`r${r.root}`, c.x, c.y, drillDotRadius(r.count, max, cell), r.root, r.count + (r.root === input.priorityRoot ? 1e6 : 0), i < HEAVY_ROOTS);
      });
    }
  } else if (mode === "overview" && ROOT_STEP * k >= 14) {
    // Zoomed in far enough that a stack's dots sit a line apart.
    let maxCount = 1;
    for (const p of model.surahs) maxCount = Math.max(maxCount, p.roots[0]?.count ?? 0);
    slots.forEach((slot, n) => {
      const profile = model.surahs[n - 1];
      profile?.roots.slice(0, OVERVIEW_ROOTS).forEach((r, i) => {
        const p = pointAt(slot.mid, ROOT_START + i * ROOT_STEP);
        addRoot(`o${n}-${r.root}`, p.x, p.y, dotRadius(r.count, maxCount, 2.2, 8.2), r.root, r.count + (r.root === input.priorityRoot ? 1e6 : 0), i === 0);
      });
    });
  }

  if (flat.length) {
    // Other roots' dots block a label; its own dot sits just outside its box.
    const ids = admitLabels(flat, [...blockers, ...dots], 1.5);
    ids.forEach((alt, id) => {
      const spec = flatSpecs.get(id);
      const at = rootPlace.get(id);
      if (!spec || !at) return;
      const dy = at.r + lineH / 2 / k;
      const placed: Pick<LabelSpec, "x" | "y" | "anchor">[] = [
        { x: at.x + at.r, y: at.y, anchor: "start" },
        { x: at.x - at.r, y: at.y, anchor: "end" },
        { x: at.x, y: at.y - dy, anchor: "middle" },
        { x: at.x, y: at.y + dy, anchor: "middle" },
      ];
      labels.push({ ...spec, ...placed[alt] });
    });
    rootsLabelled = mode === "drill" ? ids.size : 0;
  }

  return { labels, rootsLabelled };
}
