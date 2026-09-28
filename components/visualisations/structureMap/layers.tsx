"use client";

/**
 * The structure map's drawing, one memoised layer per concern, so a hover or
 * a zoom repaints only what it changes (see docs/VIZ_ARCHITECTURE.md,
 * "Quran structure map"). Geometry lives in lib/viz/structureMap/layout.ts;
 * these components only turn it into SVG.
 *
 * Units are world units (px at zoom 1). Strokes that should stay hairlines at
 * any zoom use vector-effect="non-scaling-stroke"; text that should stay a
 * constant screen size lives in the label layer and reads --sm-u (1/zoom).
 */
import { memo, type ReactNode } from "react";
import { SURAH_NAMES } from "@/lib/data/surahData";
import {
  ARC_WIDTH,
  BAR_GAP,
  OVERVIEW_ROOTS,
  RING,
  ROOT_START,
  ROOT_STEP,
  SURAH_COUNT,
  TAU,
  barLength,
  dotRadius,
  focusGrid,
  gridCell,
  occurrencePositions,
  pointAt,
  sectorPath,
  type Slot,
} from "@/lib/viz/structureMap/layout";
import { drillDotRadius, type LabelSpec } from "@/lib/viz/structureMap/labels";
import type { Occurrence, StructureModel, SurahProfile } from "@/lib/viz/structureMap/model";

export const CAT_VAR = (n: number) => (SURAH_NAMES[n]?.revelationPlace === "madinah" ? "var(--viz-cat-madani)" : "var(--viz-cat-makki)");

const EVEN_HALF = TAU / SURAH_COUNT / 2;
/** Inward bars keep an ordinary slot's width even in an opened sector. */
const BAR_HALF_MAX = EVEN_HALF * 0.62;

const f2 = (n: number) => n.toFixed(2);

function arcGap(half: number) {
  return Math.min(half * 0.14, 0.0045);
}

/* ─────────────────────────── ring ─────────────────────────── */

interface RingProps {
  slots: Map<number, Slot>;
  model: StructureModel;
  focusId: number | null;
  /** Occurrence mode: surahs holding the root. Others dim. */
  lit: Set<number> | null;
}

/** 114 arcs tinted Makki/Madani, each with an inward bar for its length. */
export const RingLayer = memo(function RingLayer({ slots, model, focusId, lit }: RingProps) {
  const arcs: ReactNode[] = [];
  const bars: ReactNode[] = [];
  for (let n = 1; n <= SURAH_COUNT; n++) {
    const slot = slots.get(n);
    const profile = model.surahs[n - 1];
    if (!slot || !profile) continue;
    const g = arcGap(slot.half);
    const dim = lit ? !lit.has(n) : focusId != null && n !== focusId;
    const fill = CAT_VAR(n);
    arcs.push(
      <path
        key={n}
        d={sectorPath(slot.mid - slot.half + g, slot.mid + slot.half - g, RING, RING + ARC_WIDTH)}
        fill={fill}
        opacity={dim ? (lit ? 0.16 : 0.42) : 0.95}
      />,
    );
    const bh = Math.min(slot.half * 0.62, BAR_HALF_MAX);
    const len = barLength(profile.words, model.maxWords);
    bars.push(
      <path
        key={n}
        d={sectorPath(slot.mid - bh, slot.mid + bh, RING - BAR_GAP - len, RING - BAR_GAP)}
        fill={fill}
        opacity={dim ? 0.1 : n === focusId ? 0.8 : 0.46}
      />,
    );
  }
  return (
    <g className="sm-ring">
      <circle r={RING - BAR_GAP} fill="none" stroke="var(--line)" vectorEffect="non-scaling-stroke" strokeWidth={1} />
      <g className="sm-bars">{bars}</g>
      <g className="sm-arcs">{arcs}</g>
    </g>
  );
});

/* ───────────────────────── overview roots ───────────────────────── */

interface OverviewProps {
  slots: Map<number, Slot>;
  model: StructureModel;
  colorFor: (root: number) => string;
  maxCount: number;
}

/** Each surah's most frequent roots, stacked outward on a faint stem. */
export const OverviewRootsLayer = memo(function OverviewRootsLayer({ slots, model, colorFor, maxCount }: OverviewProps) {
  let stems = "";
  const dots: ReactNode[] = [];
  for (const profile of model.surahs) {
    const slot = slots.get(profile.n);
    if (!slot) continue;
    const top = profile.roots.slice(0, OVERVIEW_ROOTS);
    if (!top.length) continue;
    const a = pointAt(slot.mid, RING + ARC_WIDTH + 5);
    const b = pointAt(slot.mid, ROOT_START + (top.length - 1) * ROOT_STEP);
    stems += `M${f2(a.x)},${f2(a.y)}L${f2(b.x)},${f2(b.y)}`;
    top.forEach((r, i) => {
      const p = pointAt(slot.mid, ROOT_START + i * ROOT_STEP);
      dots.push(<circle key={`${profile.n}-${r.root}`} cx={f2(p.x)} cy={f2(p.y)} r={f2(dotRadius(r.count, maxCount, 2.2, 8.2))} fill={colorFor(r.root)} />);
    });
  }
  return (
    <g className="sm-overview sm-enter">
      <path d={stems} stroke="var(--ink)" strokeOpacity={0.14} strokeWidth={1} vectorEffect="non-scaling-stroke" fill="none" />
      <g stroke="var(--bg-0)" strokeWidth={0.8}>
        {dots}
      </g>
    </g>
  );
});

/* ───────────────────────── drilled surah ───────────────────────── */

interface DrillProps {
  slot: Slot;
  profile: SurahProfile;
  colorFor: (root: number) => string;
}

/** Every root of the opened surah, one cell each, heaviest at the centre. */
export const DrillLayer = memo(function DrillLayer({ slot, profile, colorFor }: DrillProps) {
  const cells = focusGrid(slot, profile.roots.length);
  const cell = gridCell(profile.roots.length);
  const max = profile.roots[0]?.count ?? 1;
  const outer = cells.length ? cells[cells.length - 1].r : RING;
  const g = arcGap(slot.half);
  return (
    <g className="sm-drill sm-enter">
      <path
        d={sectorPath(slot.mid - slot.half + g, slot.mid + slot.half - g, RING + ARC_WIDTH + 14, outer + 22)}
        fill="var(--ink)"
        opacity={0.035}
      />
      <g stroke="var(--bg-0)" strokeWidth={0.8}>
        {profile.roots.map((r, i) => {
          const c = cells[i];
          return <circle key={r.root} cx={f2(c.x)} cy={f2(c.y)} r={f2(drillDotRadius(r.count, max, cell))} fill={colorFor(r.root)} />;
        })}
      </g>
    </g>
  );
});

/* ───────────────────────── occurrences ───────────────────────── */

interface OccurrenceProps {
  slots: Map<number, Slot>;
  occurrences: Map<number, Occurrence[]>;
}

/** One dot per ayah holding the selected root, stacked outward in ayah order. */
export const OccurrenceLayer = memo(function OccurrenceLayer({ slots, occurrences }: OccurrenceProps) {
  const groups: ReactNode[] = [];
  occurrences.forEach((list, n) => {
    const slot = slots.get(n);
    if (!slot) return;
    const pts = occurrencePositions(slot, list.length);
    const step = list.length > 1 ? Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) : 12;
    const a = pointAt(slot.mid, RING + ARC_WIDTH + 5);
    const b = pts[pts.length - 1];
    const cap = Math.max(1.3, step * 0.46);
    groups.push(
      <g key={n} fill={CAT_VAR(n)}>
        <path
          d={`M${f2(a.x)},${f2(a.y)}L${f2(b.x)},${f2(b.y)}`}
          stroke={CAT_VAR(n)}
          strokeOpacity={0.45}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        {list.map((o, i) => (
          <circle key={o.ayah} cx={f2(pts[i].x)} cy={f2(pts[i].y)} r={f2(Math.min(cap, o.count > 2 ? 5.4 : o.count > 1 ? 4.4 : 3.3))} />
        ))}
      </g>,
    );
  });
  return <g className="sm-occurrences sm-enter">{groups}</g>;
});

/* ───────────────────────── overlay ───────────────────────── */

export interface Mark {
  x: number;
  y: number;
  r: number;
  tone: "hover" | "selection";
}

interface OverlayProps {
  slots: Map<number, Slot>;
  /** Surah arcs to outline. */
  outline: { n: number; tone: "hover" | "selection" }[];
  /** Presence ticks outside the ring: surah → words carrying the root. */
  ticks: { counts: Map<number, number>; max: number; tone: "hover" | "selection" } | null;
  marks: Mark[];
}

const TONE = { hover: "var(--ink)", selection: "var(--selection)" };

/** Hover and selection: small, cheap to redraw on every pointer move that changes the target. */
export const OverlayLayer = memo(function OverlayLayer({ slots, outline, ticks, marks }: OverlayProps) {
  const tickPaths: string[] = [];
  if (ticks) {
    ticks.counts.forEach((c, n) => {
      const slot = slots.get(n);
      if (!slot) return;
      const w = Math.min(slot.half * 0.7, EVEN_HALF * 0.7);
      const r0 = RING + ARC_WIDTH + 3;
      tickPaths.push(sectorPath(slot.mid - w, slot.mid + w, r0, r0 + 4 + 18 * Math.sqrt(c / Math.max(1, ticks.max))));
    });
  }
  return (
    <g className="sm-overlay" pointerEvents="none">
      {ticks && <path d={tickPaths.join("")} fill={TONE[ticks.tone]} opacity={0.85} />}
      {outline.map(({ n, tone }) => {
        const slot = slots.get(n);
        if (!slot) return null;
        return (
          <path
            key={`o${n}`}
            d={sectorPath(slot.mid - slot.half, slot.mid + slot.half, RING - 2, RING + ARC_WIDTH + 2)}
            fill="none"
            stroke={TONE[tone]}
            strokeWidth={1.6}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      {marks.map((m, i) => (
        <circle
          key={i}
          cx={f2(m.x)}
          cy={f2(m.y)}
          r={f2(m.r)}
          fill="none"
          stroke={TONE[m.tone]}
          strokeWidth={m.tone === "selection" ? 2.2 : 1.6}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  );
});

/* ───────────────────────── labels ───────────────────────── */

/** Text at a constant screen size: font size and halo read --sm-u, set on this layer every zoom tick. */
export const LabelLayer = memo(function LabelLayer({ labels }: { labels: LabelSpec[] }) {
  return (
    <>
      {labels.map((l) => (
        <text
          key={l.id}
          className={`sm-label sm-label--${l.kind}${l.arabic ? " is-arabic" : ""}${l.heavy ? " is-heavy" : ""}${l.strong ? " is-strong" : ""}`}
          transform={`translate(${f2(l.x)},${f2(l.y)})${l.rotate ? ` rotate(${l.rotate.toFixed(1)})` : ""}`}
          textAnchor={l.anchor}
          dy="0.35em"
        >
          {l.text}
        </text>
      ))}
    </>
  );
});
