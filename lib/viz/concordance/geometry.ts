/**
 * Geometry for the concordance rings (docs/CONCORDANCE-RINGS.md).
 *
 * Pure functions, no canvas: where each ring sits, what each tick is, where a
 * pointer lands, which meetings a thread joins, and the histogram and overlaid
 * bars. The renderers only turn these numbers into pixels, so everything a
 * reader is shown can be tested without a browser.
 *
 * Angles are clockwise from 12 o'clock, screen convention (y down). A ring's
 * ayahs sweep from just right of the 12 o'clock gap round to just left of it;
 * the gap holds the surah number, and the outer scale's 0 and 100 flank it.
 */
import type { ConcordancePayload, ConcordanceSelection, RingOrder, SurahHit } from "@/lib/corpus/concordanceClient";
import { NO_ROOT, orderRings } from "@/lib/corpus/concordanceClient";

/** Radians left empty at 12 o'clock, each side of the top. */
export const LABEL_GAP = 0.13;
/** Radians the ayahs of one ring are spread across. */
export const SWEEP = Math.PI * 2 - LABEL_GAP * 2;
/** Share of an ayah's arc that its tick fills; the rest is the gap between ticks. */
export const TICK_FILL = 0.8;
/** Below this full ring thickness, in px, a tick shows only its first root. */
export const THIN_RING_PX = 5.5;

export type View = "stacked" | "all" | "overlaid";

/** Colour slots the renderers look up. 1–3 are the chosen roots in order. */
export const COLOUR = { AYAH: 0, ROOT_1: 1, ROOT_2: 2, ROOT_3: 3, MEETING: 4 } as const;

/** Angle of a normalised position on a ring turned by `rot`. */
export function angleAt(pos: number, rot = 0): number {
  return -Math.PI / 2 + LABEL_GAP + pos * SWEEP + rot;
}

/** The rotation that puts position `pos` under the 12 o'clock marker. */
export function rotationToTop(pos: number): number {
  return -(LABEL_GAP + pos * SWEEP);
}

// ── Layout ──────────────────────────────────────────────────────────────────

export interface Frame {
  cx: number;
  cy: number;
  /** Radius of the outer scale circle. */
  scale: number;
  /** Histogram band, just inside the scale. */
  histInner: number;
  histOuter: number;
  /** Where the rings may live. */
  ringInner: number;
  ringOuter: number;
}

/**
 * Fit the rings to an area of the stage — normally the part the shell's
 * chrome leaves visible (see getVisibleArea), so nothing sits under the dock,
 * the drawer, the status pill or the toolbar. With no area, the whole stage.
 */
export function frameFor(
  w: number,
  h: number,
  area: { x: number; y: number; width: number; height: number } = { x: 0, y: 0, width: w, height: h },
): Frame {
  const R = Math.min(area.width, area.height) / 2;
  const scale = R - 26;
  const histOuter = scale - 6;
  const histInner = scale - 34;
  const ringOuter = histInner - 8;
  const ringInner = Math.max(40, ringOuter * 0.22);
  return { cx: area.x + area.width / 2, cy: area.y + area.height / 2, scale, histInner, histOuter, ringInner, ringOuter };
}

export interface RingTarget {
  /** Centre-line radius. */
  r: number;
  /** Half the ring's radial thickness. 0 = collapsed (not shown). */
  half: number;
  /** 1 for a qualifying ring, lower for one shown dimmed. */
  alpha: number;
}

/**
 * Where every surah's ring should be for a view and order. All 114 get a
 * target, so moving between views is only ever a change of targets: a ring
 * that leaves collapses to zero thickness where it stands, and one that
 * arrives grows from zero at its new radius.
 */
export function ringTargets(
  selection: ConcordanceSelection,
  view: View,
  order: RingOrder,
  frame: Frame,
): { targets: Map<number, RingTarget>; order: number[]; thin: boolean } {
  const shown: SurahHit[] =
    view === "all" ? selection.surahs : view === "stacked" ? selection.qualifying : [];
  const ordered = orderRings(shown, order);
  const n = ordered.length;
  const step = n > 1 ? (frame.ringOuter - frame.ringInner) / (n - 1) : 0;
  // Thick enough to read; never so thick that neighbours touch.
  const half = n > 1 ? Math.max(0.9, Math.min(8, step * 0.42)) : Math.min(8, (frame.ringOuter - frame.ringInner) / 2);

  const targets = new Map<number, RingTarget>();
  ordered.forEach((s, i) => {
    targets.set(s.n, {
      r: n > 1 ? frame.ringInner + step * i : (frame.ringInner + frame.ringOuter) / 2,
      half,
      alpha: view === "all" && !s.qualifies ? 0.32 : 1,
    });
  });
  // Every other surah collapses. Its radius is left for the caller to hold.
  for (const s of selection.surahs) {
    if (!targets.has(s.n)) targets.set(s.n, { r: NaN, half: 0, alpha: 0 });
  }
  return { targets, order: ordered.map((s) => s.n), thin: half * 2 < THIN_RING_PX };
}

// ── Ticks ───────────────────────────────────────────────────────────────────

/** Floats per tick instance: surah, pos, halfWidth, colour, lo, hi. */
export const TICK_STRIDE = 6;

/**
 * Every tick of every surah, as a flat instance buffer.
 *
 * One grey tick per ayah — the rings are made of these, which is why a short
 * surah shows long dashes and a long one short dashes — then, over it, one
 * coloured segment per chosen root present, in that root's radial slot, or a
 * single meeting mark where they all are.
 *
 * `lo`/`hi` are fractions of the ring's thickness from its inner edge. The
 * tick's height is the ayah's word count relative to the longest ayah in the
 * surah. `halfWidth` is a fraction of the sweep.
 *
 * Built for all 114 surahs whatever the view, so a view or order change never
 * rebuilds it; only a change of roots, or of ring thinness, does.
 */
export function buildTicks(payload: ConcordancePayload, selection: ConcordanceSelection, thin: boolean): Float32Array {
  const slots = selection.roots.length;
  const hitsBySurah = new Map(selection.surahs.map((s) => [s.n, s]));
  const out: number[] = [];

  for (const s of payload.surahs) {
    const n = s.ayahs.length;
    const hit = hitsBySurah.get(s.n)!;
    const maxWords = hit.maxWords;
    const halfW = (0.5 / n) * TICK_FILL;
    const byAyah = new Map(hit.hits.map((h) => [h.ayah, h]));

    for (let i = 0; i < n; i++) {
      const pos = (i + 0.5) / n;
      const height = 0.35 + 0.65 * (s.ayahs[i].length / maxWords);
      out.push(s.n, pos, halfW, COLOUR.AYAH, 0, height);

      const h = byAyah.get(i + 1);
      if (!h) continue;
      if (h.meeting) {
        // A meeting outranks its parts: one mark, a little wider, full height.
        out.push(s.n, pos, halfW * 1.12, COLOUR.MEETING, 0, Math.max(height, 0.85));
        continue;
      }
      if (thin || slots === 1) {
        let first = 0;
        while (first < slots && !(h.mask & (1 << first))) first++;
        out.push(s.n, pos, halfW, COLOUR.ROOT_1 + first, 0, height);
        continue;
      }
      const band = height / slots;
      for (let b = 0; b < slots; b++) {
        if (!(h.mask & (1 << b))) continue;
        // A hair of gap between slots keeps two roots on one ayah readable.
        out.push(s.n, pos, halfW, COLOUR.ROOT_1 + b, band * b + band * 0.06, band * (b + 1) - band * 0.06);
      }
    }
  }
  return new Float32Array(out);
}

// ── Pointer ─────────────────────────────────────────────────────────────────

export interface LiveRing {
  r: number;
  half: number;
  rot: number;
  alpha: number;
}

/**
 * The ayah under a point, given where every ring is right now — so hover keeps
 * working while the rings move, as the spec asks.
 */
export function hitTest(
  x: number,
  y: number,
  frame: Frame,
  rings: Map<number, LiveRing>,
  ayahCounts: Map<number, number>,
): { surah: number; ayah: number } | null {
  const dx = x - frame.cx;
  const dy = y - frame.cy;
  const radius = Math.hypot(dx, dy);

  let surah = -1;
  let best = Infinity;
  for (const [n, ring] of rings) {
    if (ring.half <= 0.05 || ring.alpha <= 0.02) continue;
    const d = Math.abs(ring.r - radius);
    // Anywhere across the ring's thickness, plus a pixel of grace.
    if (d <= ring.half + 1.5 && d < best) {
      best = d;
      surah = n;
    }
  }
  if (surah < 0) return null;

  const ring = rings.get(surah)!;
  let local = Math.atan2(dy, dx) - ring.rot + Math.PI / 2 - LABEL_GAP;
  local = ((local % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const pos = local / SWEEP;
  if (pos >= 1) return null; // in the gap
  const n = ayahCounts.get(surah) ?? 0;
  if (!n) return null;
  return { surah, ayah: Math.min(n, Math.floor(pos * n) + 1) };
}

// ── Threads ─────────────────────────────────────────────────────────────────

export interface Thread {
  from: { surah: number; pos: number };
  to: { surah: number; pos: number };
}

/**
 * Each meeting joined to the nearest meeting on the next ring out, by angle as
 * the rings currently stand, so drift between surahs is visible.
 */
export function threadsFor(
  order: number[],
  selection: ConcordanceSelection,
  rings: Map<number, LiveRing>,
): Thread[] {
  const meetings = new Map(selection.surahs.map((s) => [s.n, s.meetings.map((m) => m.pos)]));
  const out: Thread[] = [];
  for (let i = 0; i + 1 < order.length; i++) {
    const a = order[i];
    const b = order[i + 1];
    const ma = meetings.get(a) ?? [];
    const mb = meetings.get(b) ?? [];
    if (!ma.length || !mb.length) continue;
    const ra = rings.get(a);
    const rb = rings.get(b);
    if (!ra || !rb) continue;
    for (const pa of ma) {
      const angA = angleAt(pa, ra.rot);
      let bestPos = mb[0];
      let bestD = Infinity;
      for (const pb of mb) {
        const d = Math.abs(Math.atan2(Math.sin(angleAt(pb, rb.rot) - angA), Math.cos(angleAt(pb, rb.rot) - angA)));
        if (d < bestD) {
          bestD = d;
          bestPos = pb;
        }
      }
      out.push({ from: { surah: a, pos: pa }, to: { surah: b, pos: bestPos } });
    }
  }
  return out;
}

// ── Histogram ───────────────────────────────────────────────────────────────

/** Where the meetings fall, 0–100 through a surah, across the rings shown. */
export function meetingHistogram(selection: ConcordanceSelection, shown: number[], bins = 60): number[] {
  const counts = new Array<number>(bins).fill(0);
  const set = new Set(shown);
  for (const s of selection.surahs) {
    if (!set.has(s.n)) continue;
    for (const m of s.meetings) counts[Math.min(bins - 1, Math.floor(m.pos * bins))]++;
  }
  return counts;
}

// ── Overlaid view ───────────────────────────────────────────────────────────

export interface OverlaidBin {
  /** Occurrences per chosen root that are NOT meetings. */
  perRoot: number[];
  meetings: number;
  /** Ayahs landing in this bin, for the hover list. */
  refs: { surah: number; ayah: number; meeting: boolean }[];
}

export interface OverlaidChord {
  a: number;
  b: number;
  slot: number;
}

/**
 * Every qualifying surah stretched onto one ring at normalised positions:
 * stacked bars per position, and inside the ring each surah's consecutive
 * occurrences of a root joined by a chord, all surahs superimposed.
 */
export function overlaid(selection: ConcordanceSelection, bins = 180): { bins: OverlaidBin[]; chords: OverlaidChord[] } {
  const slots = selection.roots.length;
  const out: OverlaidBin[] = Array.from({ length: bins }, () => ({
    perRoot: new Array<number>(slots).fill(0),
    meetings: 0,
    refs: [],
  }));
  const chords: OverlaidChord[] = [];

  for (const s of selection.qualifying) {
    const last = new Array<number>(slots).fill(-1);
    for (const h of s.hits) {
      const bin = out[Math.min(bins - 1, Math.floor(h.pos * bins))];
      bin.refs.push({ surah: s.n, ayah: h.ayah, meeting: h.meeting });
      if (h.meeting) bin.meetings++;
      for (let b = 0; b < slots; b++) {
        if (!(h.mask & (1 << b))) continue;
        if (!h.meeting) bin.perRoot[b]++;
        if (last[b] >= 0) chords.push({ a: last[b], b: h.pos, slot: b });
        last[b] = h.pos;
      }
    }
  }
  return { bins: out, chords };
}

/** Largest stacked bar, so the bars scale to the space they have. */
export function overlaidPeak(bins: OverlaidBin[]): number {
  let peak = 1;
  for (const b of bins) peak = Math.max(peak, b.meetings + b.perRoot.reduce((s, c) => s + c, 0));
  return peak;
}

// ── Selected-ring wiring ────────────────────────────────────────────────────

/**
 * Inside a selected ring, every pair of ayahs that share a chosen root is
 * joined, as radial-sura wires one surah.
 */
export function wiringFor(surah: SurahHit, slots: number): { a: number; b: number; slot: number }[] {
  const out: { a: number; b: number; slot: number }[] = [];
  for (let b = 0; b < slots; b++) {
    const positions = surah.hits.filter((h) => h.mask & (1 << b)).map((h) => h.pos);
    for (let i = 0; i < positions.length; i++)
      for (let j = i + 1; j < positions.length; j++) out.push({ a: positions[i], b: positions[j], slot: b });
  }
  return out;
}

/** Word indices in an ayah that carry each chosen root, for colouring hover text. */
export function rootWordSlots(payload: ConcordancePayload, rootIndices: number[], surah: number, ayah: number): number[] {
  const words = payload.surahs[surah - 1]?.ayahs[ayah - 1] ?? [];
  return words.map((idx) => (idx === NO_ROOT ? -1 : rootIndices.indexOf(idx)));
}
