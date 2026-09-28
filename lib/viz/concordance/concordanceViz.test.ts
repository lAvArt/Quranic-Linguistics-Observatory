import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { findRootIndex, selectConcordance, type ConcordancePayload } from "@/lib/corpus/concordanceClient";
import {
  COLOUR,
  IDENTITY_ZOOM,
  MAX_ZOOM,
  THIN_RING_PX,
  TICK_STRIDE,
  angleAt,
  buildTicks,
  clampZoom,
  composeZoom,
  frameFor,
  hitTest,
  meetingHistogram,
  overlaid,
  ringTargets,
  rotationToTop,
  threadsFor,
  transformBetween,
  wiringFor,
  zoomFrame,
  zoomRings,
  type LiveRing,
} from "@/lib/viz/concordance/geometry";
import { RingMotion, TRAVEL_MS } from "@/lib/viz/concordance/motion";

const file = path.resolve(process.cwd(), "public", "data", "concordance.json");
const payload = JSON.parse(readFileSync(file, "utf8")) as ConcordancePayload;
const pick = (...r: string[]) => r.map((x) => findRootIndex(payload, x));
const selection = selectConcordance(payload, pick("خلق", "سمو", "ارض"), "ayah");
const frame = frameFor(1000, 800);

describe("concordance geometry", () => {
  it("gives every ayah a tick, so the rings are made of ayahs", () => {
    const ticks = buildTicks(payload, selection, false);
    let grey = 0;
    for (let i = 0; i < ticks.length; i += TICK_STRIDE) if (ticks[i + 3] === COLOUR.AYAH) grey++;
    expect(grey).toBe(6236);
  });

  it("draws one meeting mark per meeting, and never a root slot on a meeting ayah", () => {
    const ticks = buildTicks(payload, selection, false);
    let meetings = 0;
    for (let i = 0; i < ticks.length; i += TICK_STRIDE) if (ticks[i + 3] === COLOUR.MEETING) meetings++;
    expect(meetings).toBe(selection.totalMeetings);
    expect(meetings).toBe(59);
  });

  it("makes a short surah's ticks longer than a long surah's", () => {
    const ticks = buildTicks(payload, selection, false);
    const halfWidthOf = (surah: number) => {
      for (let i = 0; i < ticks.length; i += TICK_STRIDE) if (ticks[i] === surah) return ticks[i + 2];
      return 0;
    };
    expect(halfWidthOf(112)).toBeGreaterThan(halfWidthOf(2) * 10);
  });

  it("collapses a thin tick to its first root", () => {
    const thin = buildTicks(payload, selection, true);
    for (let i = 0; i < thin.length; i += TICK_STRIDE) {
      const c = thin[i + 3];
      if (c >= COLOUR.ROOT_1 && c <= COLOUR.ROOT_3) expect(thin[i + 4]).toBe(0);
    }
  });

  it("lays out only qualifying rings in the stacked view, innermost first", () => {
    const { targets, order } = ringTargets(selection, "stacked", "mushaf", frame);
    expect(order).toHaveLength(39);
    const shown = [...targets.values()].filter((t) => t.half > 0);
    expect(shown).toHaveLength(39);
    // Mushaf order runs 114 → 1 outward.
    expect(order[0]).toBeGreaterThan(order[order.length - 1]);
    for (let i = 1; i < order.length; i++) {
      expect(targets.get(order[i])!.r).toBeGreaterThan(targets.get(order[i - 1])!.r);
    }
  });

  it("shows all 114 in the full view, dimming what does not qualify", () => {
    const { targets } = ringTargets(selection, "all", "mushaf", frame);
    const shown = [...targets.entries()].filter(([, t]) => t.half > 0);
    expect(shown).toHaveLength(114);
    const dim = shown.filter(([, t]) => t.alpha < 1);
    expect(dim).toHaveLength(114 - 39);
  });

  it("puts a position under the 12 o'clock marker once turned", () => {
    for (const pos of [0.02, 0.5, 0.97]) {
      const a = angleAt(pos, rotationToTop(pos));
      expect(Math.cos(a)).toBeCloseTo(0, 9);
      expect(Math.sin(a)).toBeCloseTo(-1, 9);
    }
  });

  it("finds the ayah under the pointer, even with a ring turned", () => {
    const { targets } = ringTargets(selection, "stacked", "mushaf", frame);
    const counts = new Map(selection.surahs.map((s) => [s.n, s.ayahCount]));
    for (const rot of [0, 1.3, -2.2]) {
      const live = new Map<number, LiveRing>();
      for (const [n, t] of targets) if (t.half > 0) live.set(n, { ...t, rot });
      const surah = 2;
      const ring = live.get(surah)!;
      const ayah = 30;
      const pos = (ayah - 0.5) / counts.get(surah)!;
      const a = angleAt(pos, rot);
      const hit = hitTest(frame.cx + Math.cos(a) * ring.r, frame.cy + Math.sin(a) * ring.r, frame, live, counts);
      expect(hit).toEqual({ surah, ayah });
    }
  });

  it("joins meetings ring to ring, and counts histogram meetings once each", () => {
    const { targets, order } = ringTargets(selection, "stacked", "mushaf", frame);
    const live = new Map<number, LiveRing>();
    for (const [n, t] of targets) if (t.half > 0) live.set(n, { ...t, rot: 0 });
    const threads = threadsFor(order, selection, live);
    // Every meeting except those on the outermost ring has somewhere to go.
    const outer = selection.surahs.find((s) => s.n === order[order.length - 1])!;
    expect(threads).toHaveLength(59 - outer.meetings.length);
    expect(meetingHistogram(selection, order).reduce((a, b) => a + b, 0)).toBe(59);
  });

  it("stacks the overlaid bars from every qualifying ayah hit", () => {
    const { bins, chords } = overlaid(selection);
    const refs = bins.reduce((s, b) => s + b.refs.length, 0);
    const hits = selection.qualifying.reduce((s, q) => s + q.hits.length, 0);
    expect(refs).toBe(hits);
    expect(bins.reduce((s, b) => s + b.meetings, 0)).toBe(59);
    expect(chords.length).toBeGreaterThan(0);
  });

  it("wires every pair of ayahs sharing a root inside a selected ring", () => {
    const ibrahim = selectConcordance(payload, pick("امن", "عمل", "صلح"), "ayah").surahs.find((s) => s.n === 14)!;
    // The spec's figure: امن in 6 ayahs, عمل in 3, صلح in 1 → 15 + 3 + 0 chords.
    expect(ibrahim.perRoot).toEqual([6, 3, 1]);
    expect(wiringFor(ibrahim, 3)).toHaveLength(18);
    expect(ibrahim.meetings.map((m) => m.ayah)).toEqual([23]);
  });
});

describe("concordance zoom", () => {
  it("folds a gesture's live transform into the zoom, and back again", () => {
    const from = { k: 1.5, x: 20, y: -35 };
    const to = { k: 3.2, x: -140, y: 60 };
    const t = transformBetween(from, to, frame);
    const got = composeZoom(from, frame, t.s, t.dx, t.dy);
    expect(got.k).toBeCloseTo(to.k, 9);
    expect(got.x).toBeCloseTo(to.x, 9);
    expect(got.y).toBeCloseTo(to.y, 9);
  });

  it("keeps a pinch point still: the ring under two fingers stays under them", () => {
    // A live transform about (x, y) — s·q + (x − s·x) — leaves (x, y) fixed on
    // screen, so the base point there must map to the same screen point after.
    const [x, y, s] = [620, 280, 2.4];
    const z = composeZoom(IDENTITY_ZOOM, frame, s, x - s * x, y - s * y);
    const zf = zoomFrame(frame, z);
    // (x, y) at the fit is this base point; under the new zoom it lands back on (x, y).
    expect(zf.cx + (x - frame.cx) * z.k).toBeCloseTo(x, 9);
    expect(zf.cy + (y - frame.cy) * z.k).toBeCloseTo(y, 9);
  });

  it("never zooms out past the fit, snaps home there, and caps the zoom", () => {
    expect(clampZoom({ k: 0.6, x: 40, y: 40 }, frame)).toEqual(IDENTITY_ZOOM);
    expect(clampZoom({ k: 1.01, x: 40, y: 40 }, frame)).toEqual(IDENTITY_ZOOM);
    expect(clampZoom({ k: 50, x: 0, y: 0 }, frame).k).toBe(MAX_ZOOM);
    const far = clampZoom({ k: 2, x: 1e6, y: -1e6 }, frame);
    expect(far.x).toBe(frame.scale * 2);
    expect(far.y).toBe(-frame.scale * 2);
  });

  it("finds the ayah under the pointer on a zoomed, panned view", () => {
    const { targets } = ringTargets(selection, "stacked", "mushaf", frame);
    const counts = new Map(selection.surahs.map((s) => [s.n, s.ayahCount]));
    const live = new Map<number, LiveRing>();
    for (const [n, t] of targets) if (t.half > 0) live.set(n, { ...t, rot: 0.4 });
    const z = { k: 3, x: -120, y: 80 };
    const zf = zoomFrame(frame, z);
    const zl = zoomRings(live, z.k);
    const surah = 2;
    const ayah = 140;
    const pos = (ayah - 0.5) / counts.get(surah)!;
    const a = angleAt(pos, 0.4);
    const r = zl.get(surah)!.r;
    expect(hitTest(zf.cx + Math.cos(a) * r, zf.cy + Math.sin(a) * r, zf, zl, counts)).toEqual({ surah, ayah });
  });

  it("reports the ring thickness, so a zoom can un-thin the rings", () => {
    const layout = ringTargets(selection, "all", "mushaf", frameFor(390, 560));
    expect(layout.thin).toBe(true);
    // Enough zoom makes every ring thick enough for one slot per root.
    const k = Math.ceil(THIN_RING_PX / (layout.half * 2));
    expect(layout.half * 2 * k).toBeGreaterThanOrEqual(THIN_RING_PX);
  });
});

describe("concordance motion", () => {
  const settleOf = (m: RingMotion) => m.endsAt();

  function placed(count: number) {
    const m = new RingMotion();
    const targets = new Map<number, { r: number; half: number; alpha: number }>();
    for (let n = 1; n <= count; n++) targets.set(n, { r: 40 + n * 5, half: 3, alpha: 1 });
    m.travelTo(targets, 0, true);
    return { m, order: [...targets.keys()] };
  }

  it("settles 39 rings in about 3.1 s and 114 in about 4.7 s, expressively", () => {
    for (const [count, spec] of [[39, 3100], [114, 4700]] as const) {
      const { m, order } = placed(count);
      const targets = new Map(order.map((n) => [n, 1] as [number, number]));
      m.turnTo(targets, order, 0, "expressive");
      expect(Math.abs(settleOf(m) - spec)).toBeLessThan(60);
    }
  });

  it("settles all 114 in about 1.5 s calmly", () => {
    const { m, order } = placed(114);
    m.turnTo(new Map(order.map((n) => [n, 1] as [number, number])), order, 0, "calm");
    expect(Math.abs(settleOf(m) - 1500)).toBeLessThan(10);
  });

  it("alternates direction by ring, innermost anticlockwise, and lands on target", () => {
    const { m, order } = placed(4);
    m.turnTo(new Map(order.map((n) => [n, 0.5] as [number, number])), order, 0, "expressive");
    const early = m.sample(200);
    expect(early.get(order[0])!.rot).toBeLessThan(0); // anticlockwise first
    expect(early.get(order[1])!.rot).toBeGreaterThan(0);
    const end = m.endsAt();
    m.settle(end);
    for (const n of order) expect(m.pose(n, end)!.rot).toBeCloseTo(0.5, 9);
  });

  it("restarts from where a ring is, never snapping", () => {
    const { m, order } = placed(1);
    m.turnTo(new Map([[order[0], 2]]), order, 0, "calm");
    const mid = m.pose(order[0], 300)!.rot;
    m.turnTo(new Map([[order[0], 0]]), order, 300, "calm");
    expect(m.pose(order[0], 300)!.rot).toBeCloseTo(mid, 9);
  });

  it("collapses a leaving ring where it stands and grows an arriving one in place", () => {
    const m = new RingMotion();
    m.travelTo(new Map([[1, { r: 100, half: 4, alpha: 1 }], [2, { r: NaN, half: 0, alpha: 0 }]]), 0, true);
    m.travelTo(new Map([[1, { r: NaN, half: 0, alpha: 0 }], [2, { r: 200, half: 4, alpha: 1 }]]), 0);
    const mid = m.sample(TRAVEL_MS / 2 + 250);
    expect(mid.get(1)!.r).toBe(100); // shrinks without moving
    expect(mid.get(2)!.r).toBe(200); // grows at its destination
    const end = m.sample(m.endsAt());
    expect(end.get(1)!.half).toBe(0);
    expect(end.get(2)!.half).toBe(4);
  });

  it("dims a ring while it travels and restores it after", () => {
    const m = new RingMotion();
    m.travelTo(new Map([[1, { r: 100, half: 4, alpha: 1 }]]), 0, true);
    m.travelTo(new Map([[1, { r: 300, half: 4, alpha: 1 }]]), 0);
    expect(m.sample(TRAVEL_MS / 2).get(1)!.alpha).toBeCloseTo(0.6, 9);
    expect(m.sample(m.endsAt()).get(1)!.alpha).toBe(1);
    expect(m.travelling(TRAVEL_MS / 2)).toBe(true);
    expect(m.travelling(m.endsAt())).toBe(false);
  });

  it("jumps straight to the end state for reduced motion", () => {
    const { m, order } = placed(10);
    m.turnTo(new Map(order.map((n) => [n, 1.1] as [number, number])), order, 0, "instant");
    expect(m.turning(0)).toBe(false);
    for (const n of order) expect(m.pose(n, 0)!.rot).toBeCloseTo(1.1, 9);
  });
});
