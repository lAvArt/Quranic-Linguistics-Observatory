import { describe, expect, it } from "vitest";
import {
  GRID_CELL,
  GRID_START,
  gridCell,
  SURAH_COUNT,
  TAU,
  admitLabels,
  admitRadialLabels,
  angleDiff,
  angleOf,
  barLength,
  BAR_MAX,
  BAR_MIN,
  focusGrid,
  focusSpan,
  occurrencePositions,
  OCC_MAX_LEN,
  OCC_START,
  pointAt,
  ringSlots,
  sectorPath,
  type LabelBox,
  type RadialLabel,
} from "@/lib/viz/structureMap/layout";

describe("ring slots", () => {
  it("gives 114 equal slots that tile the circle, surah 1 just right of the top", () => {
    const slots = ringSlots();
    expect(slots.size).toBe(SURAH_COUNT);
    const total = [...slots.values()].reduce((s, v) => s + v.half * 2, 0);
    expect(total).toBeCloseTo(TAU, 9);
    const first = slots.get(1)!;
    expect(first.mid).toBeGreaterThan(0);
    expect(first.mid).toBeLessThan(0.1);
    for (let id = 2; id <= SURAH_COUNT; id++) {
      const prev = slots.get(id - 1)!;
      const cur = slots.get(id)!;
      expect(cur.mid - cur.half).toBeCloseTo(prev.mid + prev.half, 9);
    }
  });

  it("opens a focused surah where it rests and keeps the rest in order without gaps", () => {
    for (const focus of [1, 2, 57, 114]) {
      const span = focusSpan(400);
      const slots = ringSlots(focus, span);
      const even = TAU / SURAH_COUNT;
      expect(slots.get(focus)!.mid).toBeCloseTo((focus - 0.5) * even, 9);
      expect(slots.get(focus)!.half * 2).toBeCloseTo(span, 9);
      const total = [...slots.values()].reduce((s, v) => s + v.half * 2, 0);
      expect(total).toBeCloseTo(TAU, 9);
      // Walk clockwise from the focus: each slot starts where the last ended.
      let prev = slots.get(focus)!;
      for (let k = 1; k < SURAH_COUNT; k++) {
        const id = ((focus - 1 + k) % SURAH_COUNT) + 1;
        const cur = slots.get(id)!;
        expect(angleDiff(cur.mid - cur.half, prev.mid + prev.half)).toBeCloseTo(0, 9);
        prev = cur;
      }
    }
  });

  it("opens wider for more roots, within 60°–150°", () => {
    const deg = (n: number) => (focusSpan(n) * 180) / Math.PI;
    expect(deg(4)).toBeCloseTo(60, 9);
    expect(deg(1200)).toBeCloseTo(150, 9);
    expect(deg(300)).toBeGreaterThan(deg(100));
  });
});

describe("geometry helpers", () => {
  it("measures angles clockwise from 12 o'clock", () => {
    for (const a of [0, 0.3, Math.PI / 2, Math.PI, 4, TAU - 0.01]) {
      const p = pointAt(a, 100);
      expect(angleOf(p.x, p.y)).toBeCloseTo(a, 9);
    }
    expect(pointAt(Math.PI / 2, 10).x).toBeCloseTo(10, 9);
  });

  it("scales bars by the square root of length", () => {
    expect(barLength(0, 100)).toBe(BAR_MIN);
    expect(barLength(100, 100)).toBe(BAR_MAX);
    expect(barLength(25, 100)).toBeCloseTo(BAR_MIN + (BAR_MAX - BAR_MIN) * 0.5, 9);
  });

  it("writes a closed sector path with the large-arc flag past a half turn", () => {
    expect(sectorPath(0, 1, 10, 20)).toMatch(/^M.*A20,20 0 0 1 .*L.*A10,10 0 0 0 .*Z$/);
    expect(sectorPath(0, 4, 10, 20)).toContain("A20,20 0 1 1");
  });
});

describe("drilled surah grid", () => {
  it("gives every root its own cell, no two closer than the cell size", () => {
    const span = focusSpan(585);
    const slot = ringSlots(2, span).get(2)!;
    const cells = focusGrid(slot, 585);
    expect(cells).toHaveLength(585);
    let closest = Infinity;
    for (let i = 0; i < cells.length; i++)
      for (let j = i + 1; j < cells.length; j++) closest = Math.min(closest, Math.hypot(cells[i].x - cells[j].x, cells[i].y - cells[j].y));
    expect(closest).toBeGreaterThanOrEqual(GRID_CELL * 0.93);
    expect(gridCell(585)).toBe(GRID_CELL);
  });

  it("keeps every cell inside the surah's sector and puts the most frequent in the middle", () => {
    const slot = ringSlots(36, focusSpan(180)).get(36)!;
    const cells = focusGrid(slot, 180);
    for (const c of cells) expect(Math.abs(angleDiff(c.angle, slot.mid))).toBeLessThanOrEqual(slot.half);
    expect(cells[0].r).toBe(GRID_START);
    expect(cells[0].angle).toBeCloseTo(slot.mid, 9);
  });

  it("fits a short surah in a row or two", () => {
    const slot = ringSlots(112, focusSpan(9)).get(112)!;
    const cells = focusGrid(slot, 9);
    expect(Math.max(...cells.map((c) => c.row))).toBeLessThanOrEqual(1);
  });
});

describe("occurrence stacks", () => {
  it("stacks outward and never runs past the maximum length", () => {
    const slot = ringSlots().get(2)!;
    const pts = occurrencePositions(slot, 200);
    const r = (p: { x: number; y: number }) => Math.hypot(p.x, p.y);
    expect(r(pts[0])).toBeCloseTo(OCC_START, 6);
    expect(r(pts[pts.length - 1])).toBeCloseTo(OCC_START + OCC_MAX_LEN, 6);
    const short = occurrencePositions(slot, 3);
    expect(r(short[1]) - r(short[0])).toBeCloseTo(10, 6);
  });
});

describe("label admission", () => {
  it("admits the higher-priority label of two that collide", () => {
    const a: LabelBox = { id: "a", x: 100, y: 100, w: 40, h: 12, anchor: "start", priority: 1 };
    const b: LabelBox = { id: "b", x: 120, y: 104, w: 40, h: 12, anchor: "start", priority: 5 };
    const c: LabelBox = { id: "c", x: 400, y: 100, w: 40, h: 12, anchor: "start", priority: 0 };
    expect([...admitLabels([a, b, c]).keys()].sort()).toEqual(["b", "c"]);
  });

  it("falls back to an alternative position when the first is taken", () => {
    const first: LabelBox = { id: "first", x: 100, y: 50, w: 40, h: 10, anchor: "start", priority: 2 };
    const second: LabelBox = { id: "second", x: 104, y: 50, w: 40, h: 10, anchor: "start", priority: 1, alts: [{ x: 96, y: 50, anchor: "end" }] };
    const placed = admitLabels([first, second], [], 1);
    expect(placed.get("first")).toBe(0);
    expect(placed.get("second")).toBe(1);
  });

  it("respects anchors and obstacles", () => {
    const end: LabelBox = { id: "end", x: 100, y: 50, w: 40, h: 10, anchor: "end", priority: 1 };
    const start: LabelBox = { id: "start", x: 104, y: 50, w: 40, h: 10, anchor: "start", priority: 1 };
    expect(admitLabels([end, start], [], 1).size).toBe(2);
    expect(admitLabels([start], [{ x: 120, y: 50, w: 6, h: 6 }]).size).toBe(0);
  });

  it("never admits two overlapping boxes out of a dense field", () => {
    const cands: LabelBox[] = [];
    for (let i = 0; i < 600; i++) cands.push({ id: String(i), x: (i * 37) % 500, y: (i * 53) % 400, w: 30 + (i % 5) * 6, h: 11, anchor: "middle", priority: i % 17 });
    const ids = admitLabels(cands, [], 0);
    const kept = cands.filter((c) => ids.has(c.id));
    for (let i = 0; i < kept.length; i++)
      for (let j = i + 1; j < kept.length; j++) {
        const a = kept[i];
        const b = kept[j];
        const overlap = Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;
        expect(overlap).toBe(false);
      }
  });
});

describe("radial label admission", () => {
  const spoke = (id: string, angleDeg: number, r0 = 300, priority = 0, length = 60): RadialLabel => ({
    id,
    angle: (angleDeg * Math.PI) / 180,
    r0,
    length,
    thickness: 12,
    priority,
  });

  it("keeps neighbouring spokes only when their gap clears a line of text", () => {
    // At r = 300 px, 1° is ~5.2 px apart; 3° is ~15.7 px.
    expect([...admitRadialLabels([spoke("a", 10, 300, 2), spoke("b", 11)])]).toEqual(["a"]);
    expect(admitRadialLabels([spoke("a", 10), spoke("b", 13)]).size).toBe(2);
  });

  it("lets spokes share an angle when their radial extents don't meet", () => {
    expect(admitRadialLabels([spoke("in", 40, 200, 0, 50), spoke("out", 40, 260, 0, 50)]).size).toBe(2);
  });

  it("ignores spokes on opposite sides, across the wrap at 12 o'clock too", () => {
    expect(admitRadialLabels([spoke("a", 0), spoke("b", 180)]).size).toBe(2);
    expect([...admitRadialLabels([spoke("a", 359.5, 300, 1), spoke("b", 0.5)])]).toEqual(["a"]);
  });

  it("keeps labels out of a reserved sector, including one across 12 o'clock", () => {
    const sector = { a0: (-20 * Math.PI) / 180 + 2 * Math.PI, a1: (20 * Math.PI) / 180, r0: 0, r1: 1000 };
    const ids = admitRadialLabels([spoke("in", 5), spoke("edge", 21), spoke("clear", 30)], [sector]);
    expect([...ids]).toEqual(["clear"]);
  });
});
