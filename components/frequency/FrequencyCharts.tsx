"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

/**
 * The three charts on /frequency, with hover read-out.
 *
 * Client components purely for the pointer interaction. They receive only the
 * columns a chart plots — never the full report — so the page keeps shipping
 * a small payload while every mark becomes inspectable.
 *
 * One pointer listener per chart finds the nearest mark and positions an HTML
 * tooltip over the SVG; 500 points scan far faster than the frame budget, so
 * no quadtree. Native <title> tooltips are deliberately absent: the browser's
 * own bubble would fire a second later, on top of this one.
 *
 * Charts are numeric and stay ltr in both locales rather than mirroring.
 */

const W = 720;
/** How near the pointer must come, in viewBox units, to latch onto a mark. */
const HIT_RADIUS = 26;

export interface RankPoint {
  /** rank */ r: number;
  /** count */ c: number;
  /** root */ b: string;
  /** gloss */ g: string | null;
}

export interface ReachPoint {
  /** root */ b: string;
  /** count */ c: number;
  /** sūrahs */ s: number;
  /** share of occurrences in its top sūrah */ t: number;
  /** that sūrah's number */ u: number;
  /** gloss */ g: string | null;
}

export interface Bucket {
  lo: number;
  hi: number | null;
  roots: number;
  words: number;
}

function useFormats() {
  const locale = useLocale();
  return useMemo(() => {
    const nf = new Intl.NumberFormat(locale);
    const pf = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1, minimumFractionDigits: 1 });
    const pf0 = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });
    return { n: (v: number) => nf.format(v), pct: (v: number) => pf.format(v), pct0: (v: number) => pf0.format(v) };
  }, [locale]);
}

/** Pointer position in viewBox units, or null when it lands outside. */
function useSvgPointer(height: number) {
  const ref = useRef<SVGSVGElement | null>(null);
  const toViewBox = useCallback(
    (clientX: number, clientY: number) => {
      const el = ref.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      return {
        x: ((clientX - rect.left) / rect.width) * W,
        y: ((clientY - rect.top) / rect.height) * height,
      };
    },
    [height],
  );
  return { ref, toViewBox };
}

function Tooltip({
  x,
  y,
  height,
  children,
}: {
  x: number;
  y: number;
  height: number;
  children: React.ReactNode;
}) {
  // Percentages, so the bubble tracks the SVG as it scales with the container.
  // Flipped below the mark near the top edge, and nudged in at the sides.
  const below = y < height * 0.3;
  const left = Math.min(88, Math.max(12, (x / W) * 100));
  // aria-hidden: a pointer-only affordance that would otherwise announce on
  // every mouse move. The same numbers reach assistive tech through the
  // leaderboard table and the bands chart's own hidden table.
  return (
    <div
      className={`fq-tip ${below ? "is-below" : ""}`}
      style={{ insetInlineStart: `${left}%`, top: `${(y / height) * 100}%` }}
      aria-hidden="true"
    >
      {children}
    </div>
  );
}

/* ─── Rank against occurrences ───────────────────────────────────────────── */

export function RankChart({ points, label, axis }: { points: RankPoint[]; label: string; axis: string }) {
  const H = 360;
  const m = { t: 16, r: 16, b: 40, l: 54 };
  const t = useTranslations("Frequency");
  const { n } = useFormats();
  const [hit, setHit] = useState<number | null>(null);
  const { ref, toViewBox } = useSvgPointer(H);

  const maxRank = Math.log10(points.length);
  const maxCount = Math.log10(points[0].c);
  const x = useCallback((rank: number) => m.l + (Math.log10(rank) / maxRank) * (W - m.l - m.r), [maxRank, m.l, m.r]);
  const y = useCallback((count: number) => H - m.b - (Math.log10(count) / maxCount) * (H - m.t - m.b), [maxCount, m.b, m.t]);

  const onMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const p = toViewBox(e.clientX, e.clientY);
      if (!p) return;
      let best = -1;
      let bestDist = HIT_RADIUS * HIT_RADIUS;
      for (let i = 0; i < points.length; i++) {
        const dx = x(points[i].r) - p.x;
        const dy = y(points[i].c) - p.y;
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      setHit(best === -1 ? null : best);
    },
    [points, toViewBox, x, y],
  );

  const active = hit === null ? null : points[hit];

  return (
    <div className="fq-chart" dir="ltr">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={label}
        className="fq-svg"
        onPointerMove={onMove}
        onPointerLeave={() => setHit(null)}
      >
        <line x1={m.l} y1={H - m.b} x2={W - m.r} y2={H - m.b} className="fq-axis" />
        <line x1={m.l} y1={m.t} x2={m.l} y2={H - m.b} className="fq-axis" />
        {[1, 10, 100, 500].map((v) => (
          <g key={v} className="fq-tick">
            <line x1={x(v)} y1={H - m.b} x2={x(v)} y2={H - m.b + 5} />
            <text x={x(v)} y={H - m.b + 18} textAnchor="middle">{n(v)}</text>
          </g>
        ))}
        {[10, 100, 1000].map((v) => (
          <g key={v} className="fq-tick">
            <line x1={m.l - 5} y1={y(v)} x2={m.l} y2={y(v)} />
            <text x={m.l - 9} y={y(v) + 4} textAnchor="end">{n(v)}</text>
          </g>
        ))}
        {points.map((p, i) => (
          <circle
            key={p.b}
            cx={x(p.r).toFixed(1)}
            cy={y(p.c).toFixed(1)}
            r={hit === i ? 4.5 : 1.7}
            className={hit === i ? "fq-dot is-hit" : "fq-dot"}
          />
        ))}
        <text x={W / 2} y={H - 4} textAnchor="middle" className="fq-axis-label">{axis}</text>
      </svg>
      {active ? (
        <Tooltip x={x(active.r)} y={y(active.c)} height={H}>
          <span className="fq-tip-root" dir="rtl" lang="ar">{active.b}</span>
          {active.g ? <span className="fq-tip-gloss">{active.g}</span> : null}
          <span className="fq-tip-row">{t("tipRank", { n: n(active.r) })}</span>
          <span className="fq-tip-row fq-tip-strong">{t("tipOccurrences", { n: n(active.c) })}</span>
        </Tooltip>
      ) : null}
    </div>
  );
}

/* ─── Roots and words by frequency band ──────────────────────────────────── */

export function BandsChart({
  buckets,
  totalRoots,
  totalWords,
  label,
  axis,
}: {
  buckets: Bucket[];
  totalRoots: number;
  totalWords: number;
  label: string;
  axis: string;
}) {
  const H = 264;
  const m = { t: 14, r: 14, b: 48, l: 48 };
  const t = useTranslations("Frequency");
  const { n, pct } = useFormats();
  const [hit, setHit] = useState<number | null>(null);
  const { ref, toViewBox } = useSvgPointer(H);

  const max = Math.max(...buckets.map((b) => Math.max(b.roots / totalRoots, b.words / totalWords)));
  const slot = (W - m.l - m.r) / buckets.length;
  const bandLabel = (b: Bucket) =>
    b.hi === null ? `${n(b.lo)}+` : b.lo === b.hi ? n(b.lo) : `${n(b.lo)}–${n(b.hi)}`;

  const onMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const p = toViewBox(e.clientX, e.clientY);
      if (!p) return;
      const i = Math.floor((p.x - m.l) / slot);
      setHit(i >= 0 && i < buckets.length ? i : null);
    },
    [buckets.length, m.l, slot, toViewBox],
  );

  const active = hit === null ? null : buckets[hit];

  return (
    <div className="fq-chart" dir="ltr">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={label}
        className="fq-svg"
        onPointerMove={onMove}
        onPointerLeave={() => setHit(null)}
      >
        <line x1={m.l} y1={H - m.b} x2={W - m.r} y2={H - m.b} className="fq-axis" />
        {buckets.map((b, i) => {
          const left = m.l + i * slot;
          const hRoots = ((b.roots / totalRoots) / max) * (H - m.t - m.b);
          const hWords = ((b.words / totalWords) / max) * (H - m.t - m.b);
          return (
            <g key={b.lo} className={hit === i ? "fq-bgrp is-hit" : "fq-bgrp"}>
              {hit === i ? (
                <rect x={left.toFixed(1)} y={m.t} width={slot.toFixed(1)} height={H - m.t - m.b} className="fq-band-hit" />
              ) : null}
              <rect
                x={(left + slot * 0.12).toFixed(1)}
                y={(H - m.b - hRoots).toFixed(1)}
                width={(slot * 0.34).toFixed(1)}
                height={hRoots.toFixed(1)}
                className="fq-bar-alt"
              />
              <rect
                x={(left + slot * 0.5).toFixed(1)}
                y={(H - m.b - hWords).toFixed(1)}
                width={(slot * 0.34).toFixed(1)}
                height={hWords.toFixed(1)}
                className="fq-bar-accent"
              />
              <text x={(left + slot / 2).toFixed(1)} y={H - m.b + 16} textAnchor="middle" className="fq-tick-sm">
                {bandLabel(b)}
              </text>
            </g>
          );
        })}
        <text x={W / 2} y={H - 6} textAnchor="middle" className="fq-axis-label">{axis}</text>
      </svg>
      {active && hit !== null ? (
        <Tooltip x={m.l + hit * slot + slot / 2} y={m.t + 10} height={H}>
          <span className="fq-tip-root fq-tip-plain">{t("tipBand", { range: bandLabel(active) })}</span>
          <span className="fq-tip-row">
            <i className="fq-swatch fq-swatch--alt" />
            {t("tipRoots", { n: n(active.roots), share: pct(active.roots / totalRoots) })}
          </span>
          <span className="fq-tip-row">
            <i className="fq-swatch fq-swatch--accent" />
            {t("tipWords", { n: n(active.words), share: pct(active.words / totalWords) })}
          </span>
        </Tooltip>
      ) : null}
      {/* The bars are a picture of these eleven numbers; the table is how a
          screen reader gets them. */}
      <table className="fq-sr">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">{axis}</th>
            <th scope="col">{t("legendRoots")}</th>
            <th scope="col">{t("legendWords")}</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => (
            <tr key={b.lo}>
              <th scope="row">{bandLabel(b)}</th>
              <td>{t("tipRoots", { n: n(b.roots), share: pct(b.roots / totalRoots) })}</td>
              <td>{t("tipWords", { n: n(b.words), share: pct(b.words / totalWords) })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Occurrences against sūrah reach ────────────────────────────────────── */

export function ReachChart({
  points,
  peak,
  label,
  axis,
}: {
  points: ReachPoint[];
  peak: number;
  label: string;
  axis: string;
}) {
  const H = 340;
  const m = { t: 16, r: 16, b: 44, l: 54 };
  const t = useTranslations("Frequency");
  const { n, pct0 } = useFormats();
  const [hit, setHit] = useState<number | null>(null);
  const { ref, toViewBox } = useSvgPointer(H);

  const lo = Math.log10(20);
  const hi = Math.log10(peak);
  const x = useCallback((count: number) => m.l + ((Math.log10(count) - lo) / (hi - lo)) * (W - m.l - m.r), [hi, lo, m.l, m.r]);
  const y = useCallback((surahs: number) => H - m.b - (surahs / 114) * (H - m.t - m.b), [m.b, m.t]);

  const onMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const p = toViewBox(e.clientX, e.clientY);
      if (!p) return;
      let best = -1;
      let bestDist = HIT_RADIUS * HIT_RADIUS;
      for (let i = 0; i < points.length; i++) {
        const dx = x(points[i].c) - p.x;
        const dy = y(points[i].s) - p.y;
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      setHit(best === -1 ? null : best);
    },
    [points, toViewBox, x, y],
  );

  const active = hit === null ? null : points[hit];

  return (
    <div className="fq-chart" dir="ltr">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={label}
        className="fq-svg"
        onPointerMove={onMove}
        onPointerLeave={() => setHit(null)}
      >
        <line x1={m.l} y1={H - m.b} x2={W - m.r} y2={H - m.b} className="fq-axis" />
        <line x1={m.l} y1={m.t} x2={m.l} y2={H - m.b} className="fq-axis" />
        {[20, 50, 100, 300, 1000, peak].map((v) => (
          <g key={v} className="fq-tick">
            <line x1={x(v)} y1={H - m.b} x2={x(v)} y2={H - m.b + 5} />
            <text x={x(v)} y={H - m.b + 18} textAnchor="middle">{n(v)}</text>
          </g>
        ))}
        {[0, 30, 60, 90, 114].map((v) => (
          <g key={v} className="fq-tick">
            <line x1={m.l - 5} y1={y(v)} x2={m.l} y2={y(v)} />
            <text x={m.l - 9} y={y(v) + 4} textAnchor="end">{n(v)}</text>
          </g>
        ))}
        {points.map((p, i) => (
          <circle
            key={p.b}
            cx={x(p.c).toFixed(1)}
            cy={y(p.s).toFixed(1)}
            r={hit === i ? Math.max(6, 2 + Math.min(4, p.c / 250)) : 2 + Math.min(4, p.c / 250)}
            className={`${p.t > 0.15 ? "fq-dot fq-dot--concentrated" : "fq-dot"}${hit === i ? " is-hit" : ""}`}
          />
        ))}
        <text x={W / 2} y={H - 4} textAnchor="middle" className="fq-axis-label">{axis}</text>
      </svg>
      {active ? (
        <Tooltip x={x(active.c)} y={y(active.s)} height={H}>
          <span className="fq-tip-root" dir="rtl" lang="ar">{active.b}</span>
          {active.g ? <span className="fq-tip-gloss">{active.g}</span> : null}
          <span className="fq-tip-row fq-tip-strong">{t("tipOccurrences", { n: n(active.c) })}</span>
          <span className="fq-tip-row">{t("tipSurahs", { n: n(active.s) })}</span>
          {active.t > 0.15 ? (
            <span className="fq-tip-row fq-tip-warn">
              {t("tipInSurah", { share: pct0(active.t), n: n(active.u) })}
            </span>
          ) : null}
        </Tooltip>
      ) : null}
    </div>
  );
}
