"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import {
  findRootIndex,
  loadConcordance,
  orderRings,
  selectConcordance,
  suggestRoots,
  MAX_ROOTS,
  type ConcordancePayload,
  type ConcordanceRoot,
  type ConcordanceSelection,
  type MeetIn,
  type RingOrder,
  type SurahHit,
} from "@/lib/corpus/concordanceClient";
import { prefersReducedMotion } from "@/lib/viz/motionPrefs";

/**
 * Concordance Rings — two or three roots across the whole Quran.
 * Spec and figures: docs/CONCORDANCE-RINGS.md.
 *
 * Every surah is a ring, every ayah a tick on it, and the ticks light where a
 * chosen root occurs. Where every chosen root shares one ayah, the tick is a
 * meeting.
 *
 * Canvas, in three layers, because that is what keeps it fast: the ring tracks
 * and labels are drawn once and never touched again, the ticks redraw only when
 * the selection changes, and hover owns a layer of its own so moving the
 * pointer never repaints thousands of ticks. The spec's WebGL tick path is for
 * the animated views, which are not built yet; a static 2D render of this many
 * marks is comfortably fast.
 *
 * Views built here: stacked (qualifying surahs only) and all 114 (the rest
 * dimmed). Overlaid and align-at-first-meeting are still to come.
 */

/** A gap at 12 o'clock carries the surah number, as in the spec's figures. */
const LABEL_GAP = 0.13;
/** Radians of ring swept by the ayah ticks. */
const SWEEP = Math.PI * 2 - LABEL_GAP * 2;
/** Target on-screen length of one ayah tick, in px. */
const TICK_PX = 9;

type View = "stacked" | "all";

interface Ring {
  surah: SurahHit;
  /** Centre-line radius. */
  r: number;
  /** Radial half-thickness available to ticks. */
  half: number;
  dim: boolean;
}

interface HoverTarget {
  ring: Ring;
  ayah: number;
  mask: number;
  meeting: boolean;
  x: number;
  y: number;
}

/** Recurring phrases from the spec, as one-click presets. */
const PRESETS: { key: string; roots: string[] }[] = [
  { key: "believeAndDoGood", roots: ["امن", "عمل", "صلح"] },
  { key: "painfulPunishment", roots: ["عذب", "الم"] },
  { key: "creationOfHeavensEarth", roots: ["خلق", "سمو", "ارض"] },
  { key: "forgivingMerciful", roots: ["غفر", "رحم"] },
  { key: "worldlyLife", roots: ["حيي", "دنو"] },
  { key: "gardensRivers", roots: ["جنن", "جري", "نهر"] },
  { key: "waterFromSky", roots: ["نزل", "سمو", "موه"] },
  { key: "sunAndMoon", roots: ["شمس", "قمر"] },
];

function cssVar(el: HTMLElement, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

interface ConcordanceRingsProps {
  theme?: "light" | "dark";
  /** Seeds the first root slot when the user arrives with a root selected. */
  highlightRoot?: string | null;
  onRootSelect?: (root: string) => void;
}

export default function ConcordanceRings({
  theme = "dark",
  highlightRoot,
  onRootSelect,
}: ConcordanceRingsProps) {
  const t = useTranslations("Visualizations.ConcordanceRings");
  const containerRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const tickRef = useRef<HTMLCanvasElement>(null);
  const hoverRef = useRef<HTMLCanvasElement>(null);

  const [payload, setPayload] = useState<ConcordancePayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [rootIndices, setRootIndices] = useState<number[]>([]);
  const [meetIn, setMeetIn] = useState<MeetIn>("ayah");
  const [order, setOrder] = useState<RingOrder>("mushaf");
  const [view, setView] = useState<View>("stacked");
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<HoverTarget | null>(null);
  const [query, setQuery] = useState("");
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => setIsMounted(true), []);

  // ── Data ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let on = true;
    loadConcordance()
      .then((d) => on && setPayload(d))
      .catch(() => on && setFailed(true));
    return () => { on = false; };
  }, []);

  // Seed from the shell's selected root, once, so arriving with a root chosen
  // does not land on an empty canvas.
  useEffect(() => {
    if (!payload || !highlightRoot || rootIndices.length) return;
    const i = findRootIndex(payload, highlightRoot);
    if (i >= 0) setRootIndices([i]);
  }, [payload, highlightRoot, rootIndices.length]);

  // Default to the spec's headline preset so the view is never blank on open.
  useEffect(() => {
    if (!payload || rootIndices.length || highlightRoot) return;
    const seeded = PRESETS[2].roots.map((r) => findRootIndex(payload, r)).filter((i) => i >= 0);
    if (seeded.length) setRootIndices(seeded);
  }, [payload, rootIndices.length, highlightRoot]);

  // ── Size ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setSize({ w: Math.max(0, Math.floor(width)), h: Math.max(0, Math.floor(height)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const selection: ConcordanceSelection | null = useMemo(
    () => (payload ? selectConcordance(payload, rootIndices, meetIn) : null),
    [payload, rootIndices, meetIn],
  );

  // ── Ring geometry ───────────────────────────────────────────────────────
  const rings = useMemo<Ring[]>(() => {
    if (!selection || !size.w || !size.h) return [];
    const source = view === "all" ? selection.surahs : selection.qualifying;
    if (!source.length) return [];
    const ordered = orderRings(source, order);

    const outer = Math.min(size.w, size.h) / 2 - 58;
    const inner = Math.max(28, outer * 0.16);
    const n = ordered.length;
    const step = n > 1 ? (outer - inner) / (n - 1) : 0;
    // Thick enough to read, never so thick that neighbouring rings touch.
    const half = Math.max(1.2, Math.min(7, (step || outer - inner) * 0.36));

    return ordered.map((surah, i) => ({
      surah,
      r: n > 1 ? inner + step * i : (inner + outer) / 2,
      half,
      dim: view === "all" && !surah.qualifies,
    }));
  }, [selection, size, order, view]);

  const colours = useCallback(() => {
    const el = containerRef.current ?? document.body;
    return {
      root: [
        cssVar(el, "--viz-root-1", "#56a697"),
        cssVar(el, "--viz-root-2", "#e8924a"),
        cssVar(el, "--viz-root-3", "#a78bfa"),
      ],
      meeting: cssVar(el, "--viz-meeting", "#f3e9d8"),
      makki: cssVar(el, "--viz-cat-makki", "#56a697"),
      madani: cssVar(el, "--viz-cat-madani", "#e8924a"),
      ink: cssVar(el, "--ink-muted", "rgba(236,228,216,.55)"),
      line: cssVar(el, "--line", "rgba(198,222,230,.12)"),
    };
  }, []);

  /** Angle of a normalised position, clockwise from the 12 o'clock gap. */
  const angleOf = (pos: number) => -Math.PI / 2 + LABEL_GAP + pos * SWEEP;

  const setupCanvas = (c: HTMLCanvasElement | null) => {
    if (!c || !size.w || !size.h) return null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = size.w * dpr;
    c.height = size.h * dpr;
    c.style.width = `${size.w}px`;
    c.style.height = `${size.h}px`;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    return ctx;
  };

  // ── Base layer: tracks, surah numbers, outer scale ──────────────────────
  useEffect(() => {
    const ctx = setupCanvas(baseRef.current);
    if (!ctx || !rings.length) return;
    const c = colours();
    const cx = size.w / 2;
    const cy = size.h / 2;

    // A scaffold, not a band: the ticks are the data, and a saturated track
    // this wide buries them. Tinted by revelation place, but only just.
    for (const ring of rings) {
      ctx.globalAlpha = ring.dim ? 0.05 : 0.16;
      ctx.strokeStyle = ring.surah.revelationPlace === "madinah" ? c.madani : c.makki;
      ctx.lineWidth = Math.min(1.4, ring.half);
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.arc(cx, cy, ring.r, angleOf(0), angleOf(1));
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Surah numbers sit in the 12 o'clock gap, and only while they fit.
    ctx.globalAlpha = 1;
    ctx.fillStyle = c.ink;
    ctx.font = "9px var(--font-sans, system-ui), sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const spacing = rings.length > 1 ? rings[1].r - rings[0].r : 20;
    if (spacing >= 9) {
      for (const ring of rings) {
        ctx.globalAlpha = ring.dim ? 0.3 : 0.75;
        ctx.fillText(String(ring.surah.n), cx, cy - ring.r);
      }
    }
    ctx.globalAlpha = 1;
  }, [rings, size, theme, colours]);

  // ── Tick layer: one mark per ayah that carries a chosen root ────────────
  useEffect(() => {
    const ctx = setupCanvas(tickRef.current);
    if (!ctx || !rings.length || !selection) return;
    const c = colours();
    const cx = size.w / 2;
    const cy = size.h / 2;
    const slots = selection.roots.length || 1;

    for (const ring of rings) {
      const { surah, r, half } = ring;
      ctx.globalAlpha = ring.dim ? 0.25 : 1;
      // Each root gets its own radial slot, the first innermost.
      const slotH = (half * 2) / slots;

      for (const hit of surah.hits) {
        const a = angleOf(hit.pos);
        const grow = 0.45 + 0.55 * (hit.words / surah.maxWords);

        // A tick is a dash ALONG the ring — an arc of roughly constant screen
        // length — so it reads the same on the innermost ring as the outermost.
        // Radial thickness is the root's slot; word count sets how much of it
        // is filled, which is the spec's "height proportional to word count".
        const halfArc = Math.min(TICK_PX / 2 / r, (SWEEP / surah.ayahCount) * 0.45);

        if (hit.meeting) {
          ctx.strokeStyle = c.meeting;
          ctx.lineWidth = half * 1.9;
          ctx.beginPath();
          ctx.arc(cx, cy, r, a - halfArc * 1.35, a + halfArc * 1.35);
          ctx.stroke();
          continue;
        }
        for (let s = 0; s < slots; s++) {
          if (!(hit.mask & (1 << s))) continue;
          const mid = r - half + slotH * (s + 0.5);
          ctx.strokeStyle = c.root[s % c.root.length];
          ctx.lineWidth = Math.max(1, slotH * 0.82 * grow);
          ctx.beginPath();
          ctx.arc(cx, cy, mid, a - halfArc, a + halfArc);
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
  }, [rings, selection, size, theme, colours]);

  // ── Hover layer ─────────────────────────────────────────────────────────
  useEffect(() => {
    const ctx = setupCanvas(hoverRef.current);
    if (!ctx || !hover) return;
    const c = colours();
    const cx = size.w / 2;
    const cy = size.h / 2;
    const { ring } = hover;
    const surahHit = ring.surah.hits.find((h) => h.ayah === hover.ayah);
    if (!surahHit) return;
    const a = angleOf(surahHit.pos);
    ctx.strokeStyle = c.meeting;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (ring.r - ring.half - 3), cy + Math.sin(a) * (ring.r - ring.half - 3));
    ctx.lineTo(cx + Math.cos(a) * (ring.r + ring.half + 3), cy + Math.sin(a) * (ring.r + ring.half + 3));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }, [hover, size, colours]);

  // ── Pointer → nearest tick ──────────────────────────────────────────────
  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!rings.length) return setHover(null);
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left - size.w / 2;
      const py = e.clientY - rect.top - size.h / 2;
      const radius = Math.hypot(px, py);

      // Nearest ring by radius, then nearest ayah by angle inside it.
      let ring: Ring | null = null;
      let best = Infinity;
      for (const r of rings) {
        const d = Math.abs(r.r - radius);
        if (d < best) { best = d; ring = r; }
      }
      if (!ring || best > Math.max(6, ring.half + 4)) return setHover(null);

      let angle = Math.atan2(py, px) + Math.PI / 2 - LABEL_GAP;
      while (angle < 0) angle += Math.PI * 2;
      const pos = angle / SWEEP;
      if (pos > 1) return setHover(null);

      let hit = null;
      let bestD = Infinity;
      for (const h of ring.surah.hits) {
        const d = Math.abs(h.pos - pos);
        if (d < bestD) { bestD = d; hit = h; }
      }
      // Within roughly one ayah's worth of arc.
      if (!hit || bestD > 1.5 / ring.surah.ayahCount) return setHover(null);
      setHover({
        ring,
        ayah: hit.ayah,
        mask: hit.mask,
        meeting: hit.meeting,
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    },
    [rings, size],
  );

  // ── Root selection ──────────────────────────────────────────────────────
  const suggestions = useMemo(
    () => (payload && query.trim() ? suggestRoots(payload, query, 6) : []),
    [payload, query],
  );

  const addRoot = useCallback(
    (root: ConcordanceRoot) => {
      if (!payload) return;
      const i = findRootIndex(payload, root.bare);
      if (i < 0) return;
      setRootIndices((prev) => (prev.includes(i) || prev.length >= MAX_ROOTS ? prev : [...prev, i]));
      setQuery("");
      onRootSelect?.(root.bare);
    },
    [payload, onRootSelect],
  );

  const applyPreset = useCallback(
    (roots: string[]) => {
      if (!payload) return;
      setRootIndices(roots.map((r) => findRootIndex(payload, r)).filter((i) => i >= 0));
    },
    [payload],
  );

  const reduced = typeof window !== "undefined" && prefersReducedMotion();

  const sidebar = (
    <div className="cr-panel">
      <section className="cr-card">
        <h3>{t("rootsLabel")}</h3>
        <ul className="cr-chosen">
          {selection?.roots.map((r, i) => (
            <li key={r.bare}>
              <i className="cr-swatch" style={{ background: `var(--viz-root-${i + 1})` }} />
              <span className="cr-root" dir="rtl" lang="ar">{r.bare}</span>
              <span className="cr-gloss">{r.gloss ?? ""}</span>
              <button
                type="button"
                aria-label={t("removeRoot", { root: r.bare })}
                onClick={() => setRootIndices((prev) => prev.filter((_, k) => k !== i))}
              >
                ×
              </button>
            </li>
          ))}
          {!selection?.roots.length ? <li className="cr-empty">{t("noRoots")}</li> : null}
        </ul>
        {(selection?.roots.length ?? 0) < MAX_ROOTS ? (
          <>
            <input
              className="cr-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("rootPlaceholder")}
              aria-label={t("rootPlaceholder")}
              spellCheck={false}
              autoComplete="off"
            />
            {suggestions.length ? (
              <ul className="cr-suggest">
                {suggestions.map((r) => (
                  <li key={r.bare}>
                    <button type="button" onClick={() => addRoot(r)}>
                      <span className="cr-root" dir="rtl" lang="ar">{r.bare}</span>
                      <span className="cr-gloss">{r.gloss ?? r.bw}</span>
                      <span className="cr-count">{r.count}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </section>

      <section className="cr-card">
        <h3>{t("presetsLabel")}</h3>
        <ul className="cr-presets">
          {PRESETS.map((p) => (
            <li key={p.key}>
              <button type="button" onClick={() => applyPreset(p.roots)}>
                {t(`presets.${p.key}` as "presets.sunAndMoon")}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="cr-card">
        <h3>{t("meetInLabel")}</h3>
        <div className="header-button-group" role="group" aria-label={t("meetInLabel")}>
          {(["ayah", "surah"] as MeetIn[]).map((m) => (
            <button
              key={m}
              type="button"
              className={`control-pill-btn ${meetIn === m ? "active" : ""}`}
              onClick={() => setMeetIn(m)}
            >
              {t(`meetIn.${m}` as "meetIn.ayah")}
            </button>
          ))}
        </div>

        <h3>{t("viewLabel")}</h3>
        <div className="header-button-group" role="group" aria-label={t("viewLabel")}>
          {(["stacked", "all"] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              className={`control-pill-btn ${view === v ? "active" : ""}`}
              onClick={() => setView(v)}
            >
              {t(`view.${v}` as "view.stacked")}
            </button>
          ))}
        </div>

        <h3>{t("orderLabel")}</h3>
        <div className="header-button-group" role="group" aria-label={t("orderLabel")}>
          {(["mushaf", "length", "meetings"] as RingOrder[]).map((o) => (
            <button
              key={o}
              type="button"
              className={`control-pill-btn ${order === o ? "active" : ""}`}
              onClick={() => setOrder(o)}
            >
              {t(`order.${o}` as "order.mushaf")}
            </button>
          ))}
        </div>
      </section>
    </div>
  );

  const portal =
    isMounted && typeof document !== "undefined" && document.getElementById("viz-sidebar-portal")
      ? createPortal(sidebar, document.getElementById("viz-sidebar-portal")!)
      : null;

  return (
    <div
      ref={containerRef}
      className="cr-stage"
      onPointerMove={onPointerMove}
      onPointerLeave={() => setHover(null)}
      data-reduced={reduced ? "true" : undefined}
    >
      <canvas ref={baseRef} className="cr-layer" aria-hidden="true" />
      <canvas ref={tickRef} className="cr-layer" aria-hidden="true" />
      <canvas ref={hoverRef} className="cr-layer" aria-hidden="true" />

      {/* The centre carries the chosen roots and the totals, as in the spec. */}
      {selection?.roots.length ? (
        <div className="cr-centre" aria-hidden="true">
          <div className="cr-centre-roots" dir="rtl" lang="ar">
            {selection.roots.map((r, i) => (
              <span key={r.bare} style={{ color: `var(--viz-root-${i + 1})` }}>{r.bare}</span>
            ))}
          </div>
          <div className="cr-centre-meta">
            {t("centreSummary", {
              surahs: (view === "all" ? selection.qualifying.length : rings.length),
              meetings: selection.totalMeetings,
            })}
          </div>
        </div>
      ) : null}

      {hover ? (
        <div className="cr-tip" style={{ left: hover.x, top: hover.y }} role="status">
          <b>{hover.ring.surah.arabic || hover.ring.surah.name}</b>
          <span className="cr-tip-ref" dir="ltr">{hover.ring.surah.n}:{hover.ayah}</span>
          <span className="cr-tip-roots">
            {selection?.roots.map((r, i) =>
              hover.mask & (1 << i) ? (
                <i key={r.bare} className="cr-root" style={{ color: `var(--viz-root-${i + 1})` }}>{r.bare}</i>
              ) : null,
            )}
          </span>
          {hover.meeting ? <span className="cr-tip-meeting">{t("meeting")}</span> : null}
        </div>
      ) : null}

      {/* A text alternative: the rings are a picture of this table. */}
      <table className="cr-sr">
        <caption>{t("tableCaption")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("colSurah")}</th>
            <th scope="col">{t("colMeetings")}</th>
            <th scope="col">{t("colAyahs")}</th>
          </tr>
        </thead>
        <tbody>
          {(selection?.qualifying ?? []).map((s) => (
            <tr key={s.n}>
              <th scope="row">{s.n} {s.name}</th>
              <td>{s.meetings.length}</td>
              <td>{s.meetings.map((m) => `${s.n}:${m.ayah}`).join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {failed ? <p className="cr-note">{t("loadFailed")}</p> : null}
      {!payload && !failed ? <p className="cr-note">{t("loading")}</p> : null}
      {payload && selection && !selection.roots.length ? <p className="cr-note">{t("noRoots")}</p> : null}
      {payload && selection?.roots.length && !rings.length ? (
        <p className="cr-note">{t("noMatches")}</p>
      ) : null}

      {portal}
    </div>
  );
}
