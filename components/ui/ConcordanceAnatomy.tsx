"use client";

import { useTranslations } from "next-intl";

/**
 * The concordance rings in miniature, for the explainer: three surahs of
 * different lengths stretched to the same circle, the gap and ▼ marker at the
 * top, the clockwise 0–100 scale, meetings joined by threads, and the
 * histogram bars inside the scale. Colours are the mode's own tokens, so the
 * diagram follows the theme the way the canvas does.
 */

const CX = 120;
const CY = 124;
const SCALE_R = 96;
/** Half the gap at the top, in radians — wider than the canvas's, to read small. */
const GAP = 0.2;
const SWEEP = Math.PI * 2 - GAP * 2;
const TICK_W = 8;

interface Ring {
  surah: number;
  r: number;
  ayahs: number;
  /** 0-based ayah index → what lights there. */
  lit: Record<number, "root1" | "root2" | "meeting">;
}

// Outer ring first: in the default order the lowest-numbered surah is outside.
const RINGS: Ring[] = [
  { surah: 2, r: 78, ayahs: 30, lit: { 3: "root1", 9: "meeting", 14: "root2", 20: "root1", 25: "meeting" } },
  { surah: 7, r: 62, ayahs: 20, lit: { 2: "root2", 6: "meeting", 12: "root1", 16: "root2" } },
  { surah: 10, r: 46, ayahs: 12, lit: { 4: "meeting", 8: "root1" } },
];

const angle = (pos: number) => -Math.PI / 2 + GAP + pos * SWEEP;
const at = (r: number, a: number) => [CX + Math.cos(a) * r, CY + Math.sin(a) * r] as const;

/** An arc of radius r from position p0 to p1 (0–1 along the sweep), clockwise. */
function arc(r: number, p0: number, p1: number) {
  const a0 = angle(p0);
  const a1 = angle(p1);
  const [x0, y0] = at(r, a0);
  const [x1, y1] = at(r, a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

const COLOUR = {
  root1: "var(--viz-root-1)",
  root2: "var(--viz-root-2)",
  meeting: "var(--viz-meeting)",
} as const;

/** Positions of each ring's meetings, for the threads. */
const meetings = RINGS.map((ring) =>
  Object.entries(ring.lit)
    .filter(([, kind]) => kind === "meeting")
    .map(([i]) => (Number(i) + 0.5) / ring.ayahs),
);

/** Histogram bars inside the scale: [position, length in px]. */
const BARS: [number, number][] = [
  [0.3, 4],
  [0.325, 9],
  [0.35, 6],
  [0.375, 3],
  [0.84, 4],
];

export default function ConcordanceAnatomy() {
  const t = useTranslations("VizExplainer");

  return (
    <figure className="cr-anatomy">
      <svg viewBox="0 0 240 240" role="img" aria-label={t("concordance-rings.figure.label")} style={{ direction: "ltr" }}>
        {/* Scale, its ticks every 10, and 0 / 50 / 100 */}
        <path d={arc(SCALE_R, 0, 1)} fill="none" stroke="var(--line)" strokeWidth={1} />
        {Array.from({ length: 11 }, (_, k) => {
          const a = angle(k / 10);
          const [x0, y0] = at(SCALE_R, a);
          const [x1, y1] = at(SCALE_R + (k % 5 === 0 ? 5 : 2.5), a);
          return <line key={k} x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--ink-muted)" strokeWidth={1} />;
        })}
        {[0, 50, 100].map((v) => {
          const [x, y] = at(SCALE_R + 14, angle(v / 100));
          return (
            <text key={v} x={x} y={y} className="cr-anatomy-num" textAnchor="middle" dominantBaseline="middle">
              {v}
            </text>
          );
        })}

        {/* Clockwise, from 0 */}
        <path d={arc(SCALE_R + 10, 0.08, 0.2)} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeLinecap="round" />
        {(() => {
          const a = angle(0.2);
          const [x, y] = at(SCALE_R + 10, a);
          // Arrowhead along the tangent, pointing clockwise.
          const tx = -Math.sin(a);
          const ty = Math.cos(a);
          const nx = Math.cos(a);
          const ny = Math.sin(a);
          const p = (f: number, s: number) => `${(x - tx * f + nx * s).toFixed(2)},${(y - ty * f + ny * s).toFixed(2)}`;
          return <polygon points={`${x.toFixed(2)},${y.toFixed(2)} ${p(5, 2.6)} ${p(5, -2.6)}`} fill="var(--accent)" />;
        })()}

        {/* The marker every ring starts beside */}
        <polygon points={`${CX - 5},${CY - SCALE_R - 11} ${CX + 5},${CY - SCALE_R - 11} ${CX},${CY - SCALE_R - 3}`} fill="var(--accent)" />

        {/* Histogram bars, just inside the scale */}
        {BARS.map(([pos, len]) => {
          const a = angle(pos);
          const [x0, y0] = at(SCALE_R - 3, a);
          const [x1, y1] = at(SCALE_R - 3 - len, a);
          return <line key={pos} x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--ink-muted)" strokeWidth={3} strokeLinecap="round" />;
        })}

        {/* Rings: every ayah a tick, lit where a root occurs */}
        {RINGS.map((ring) => {
          const slot = 1 / ring.ayahs;
          const fill = slot * 0.62;
          return (
            <g key={ring.surah}>
              {Array.from({ length: ring.ayahs }, (_, i) => {
                const p0 = i * slot + (slot - fill) / 2;
                const kind = ring.lit[i];
                return (
                  <path
                    key={i}
                    d={arc(ring.r, p0, p0 + fill)}
                    fill="none"
                    stroke={kind ? COLOUR[kind] : "var(--ink-muted)"}
                    strokeOpacity={kind ? 1 : 0.35}
                    strokeWidth={TICK_W}
                  />
                );
              })}
              <text x={CX} y={CY - ring.r} className="cr-anatomy-surah" textAnchor="middle" dominantBaseline="middle">
                {ring.surah}
              </text>
            </g>
          );
        })}

        {/* Threads: a meeting to the nearest one on the next ring out */}
        {meetings.slice(1).map((inner, k) => {
          const outerRing = RINGS[k];
          const innerRing = RINGS[k + 1];
          return inner.map((p) => {
            const nearest = meetings[k].reduce((best, q) => (Math.abs(q - p) < Math.abs(best - p) ? q : best));
            const [x0, y0] = at(innerRing.r + TICK_W / 2, angle(p));
            const [x1, y1] = at(outerRing.r - TICK_W / 2, angle(nearest));
            return <line key={`${k}-${p}`} x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--viz-meeting)" strokeOpacity={0.75} strokeWidth={1.2} />;
          });
        })}
      </svg>
      <figcaption>{t("concordance-rings.figure.caption")}</figcaption>
    </figure>
  );
}
