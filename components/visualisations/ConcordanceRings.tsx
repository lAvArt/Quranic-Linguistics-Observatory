"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import {
  findRootIndex,
  loadConcordance,
  loadConcordanceText,
  selectConcordance,
  MAX_ROOTS,
  type ConcordancePayload,
  type ConcordanceRoot,
  type ConcordanceText,
  type MeetIn,
  type RingOrder,
} from "@/lib/corpus/concordanceClient";
import {
  IDENTITY_ZOOM,
  MAX_ZOOM,
  THIN_RING_PX,
  TICK_FILL,
  TICK_STRIDE,
  angleAt,
  buildTicks,
  clampZoom,
  composeZoom,
  frameFor,
  hitTest,
  meetingHistogram,
  overlaid as buildOverlaid,
  overlaidPeak,
  ringTargets,
  rootWordSlots,
  rotationToTop,
  threadsFor,
  transformBetween,
  wiringFor,
  zoomFrame,
  zoomRings,
  type LiveRing,
  type View,
  type ViewZoom,
} from "@/lib/viz/concordance/geometry";
import { RingMotion, TRAVEL_MS, TRAVEL_STAGGER_MS, type TurnStyle } from "@/lib/viz/concordance/motion";
import { createTickRenderer, parseColour, type TickRenderer } from "@/lib/viz/concordance/tickRenderer";
import {
  drawFocus,
  drawHistogram,
  drawOverlaid,
  drawScale,
  drawSelection,
  drawSurahNumbers,
  drawThreads,
  overlaidBinAt,
  prepare,
  type Ink,
} from "@/lib/viz/concordance/drawLayers";
import { prefersReducedMotion } from "@/lib/viz/motionPrefs";
import { useVizControl } from "@/lib/hooks/VizControlContext";
import { usePortalTarget } from "@/lib/hooks/usePortalTarget";
import { getVisibleArea } from "@/lib/viz/fitToView";
import ConcordanceControls, { PRESETS, type Toggles } from "./concordance/ConcordanceControls";
import ConcordanceDrawer from "./concordance/ConcordanceDrawer";

/**
 * Concordance Rings — two or three roots across the whole Quran.
 * Spec, figures and motion: docs/CONCORDANCE-RINGS.md.
 *
 * Every surah is a ring and every ayah a tick on it; a tick lights in a root's
 * colour where that root occurs and becomes a meeting where every chosen root
 * shares the ayah.
 *
 * Three stacked canvases, each redrawn only when it has to be:
 *   back   2D — scale, marker, histogram, threads, surah numbers (or, in the
 *          overlaid view, the whole overlaid ring)
 *   ticks  WebGL2 — every ayah and root segment in one instanced draw; while
 *          rings turn or travel only a 2×128 texture of ring poses changes
 *   front  2D — the selected ring's band and wiring, the hover outline
 *
 * Motion lives in `RingMotion`: rings TRAVEL when order, view or roots change
 * and TURN when aligned. Both read time from the frame loop only.
 */

const VIEWS: View[] = ["stacked", "all", "overlaid"];
const ORDERS: RingOrder[] = ["mushaf", "length", "meetings", "firstMeeting"];
/** Below this width the rings are too thin to read; open overlaid instead. */
const NARROW_PX = 700;

/**
 * Layers to redraw. Hover and taps touch only the front layer; the rings and
 * the scale redraw only when something they show changes. (Redrawing all three
 * on every pointer move was what made the mode crawl on phones: the overlaid
 * view's back layer alone is several hundred strokes.)
 */
const BACK = 1;
const TICKS = 2;
const FRONT = 4;
const ALL = BACK | TICKS | FRONT;

/** Travel past which a press is a drag, not a tap, in CSS px. */
const TAP_SLOP = 8;
/** Two taps closer than this in time and space are a double tap. */
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_PX = 32;
/** How far a double tap zooms in. */
const TAP_ZOOM = 2.5;

interface Pointer {
  surah: number;
  ayah: number;
  x: number;
  y: number;
}

/** A press in progress: where it started, and whether it has become a drag. */
interface Press {
  id: number;
  type: string;
  x: number;
  y: number;
  moved: boolean;
}

/**
 * A gesture's live transform, q → s·q + (dx, dy) in stage px, shown as a CSS
 * transform on the layers while fingers move and folded into the zoom on
 * release — so a pinch costs the GPU a composite, not three canvas redraws.
 */
interface Live {
  s: number;
  dx: number;
  dy: number;
}

interface ConcordanceRingsProps {
  theme?: "light" | "dark";
  /** Seeds the first root slot when the user arrives with a root selected. */
  highlightRoot?: string | null;
  onRootSelect?: (root: string) => void;
}

function readDeepLink() {
  if (typeof window === "undefined") return null;
  const sp = new URLSearchParams(window.location.search);
  const roots = (sp.get("roots") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const view = sp.get("view") as View | null;
  const meet = sp.get("meet") as MeetIn | null;
  const order = sp.get("order") as RingOrder | null;
  return {
    roots,
    view: view && VIEWS.includes(view) ? view : null,
    meet: meet === "ayah" || meet === "surah" ? meet : null,
    order: order && ORDERS.includes(order) ? order : null,
  };
}

export default function ConcordanceRings({ theme = "dark", highlightRoot, onRootSelect }: ConcordanceRingsProps) {
  const t = useTranslations("Visualizations.ConcordanceRings");
  const locale = useLocale();
  const { setRightSidebarOpen } = useVizControl();

  const stageRef = useRef<HTMLDivElement>(null);
  const layersRef = useRef<HTMLDivElement>(null);
  const centreRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLCanvasElement>(null);
  const tickRef = useRef<HTMLCanvasElement>(null);
  const frontRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<TickRenderer | null>(null);
  const motionRef = useRef(new RingMotion());
  const rafRef = useRef(0);
  const placedRef = useRef(false);
  const alignedOnceRef = useRef(false);
  const fadeRef = useRef(1);

  const [payload, setPayload] = useState<ConcordancePayload | null>(null);
  const [text, setText] = useState<ConcordanceText | null>(null);
  const [failed, setFailed] = useState(false);
  const [rootIndices, setRootIndices] = useState<number[]>([]);
  const [meetIn, setMeetIn] = useState<MeetIn>("ayah");
  const [view, setView] = useState<View>("stacked");
  const [order, setOrder] = useState<RingOrder>("mushaf");
  const [toggles, setToggles] = useState<Toggles>({ threads: true, tint: true, histogram: true });
  const [aligned, setAligned] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [pointer, setPointer] = useState<Pointer | null>(null);
  const [focus, setFocus] = useState<{ surah: number; ayah: number } | null>(null);
  const [overBin, setOverBin] = useState<{ bin: number; x: number; y: number } | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [area, setArea] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [rendererKind, setRendererKind] = useState<"webgl2" | "canvas2d" | null>(null);
  // The committed zoom. The ref is what the frame loop and hit-testing read;
  // the state re-renders what depends on it (thin rings, the reset button).
  const [zoom, setZoom] = useState<ViewZoom>(IDENTITY_ZOOM);
  const zoomRef = useRef<ViewZoom>(IDENTITY_ZOOM);
  const liveRef = useRef<Live | null>(null);
  const pressRef = useRef<Press | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ d0: number; m0: { x: number; y: number } } | null>(null);
  const lastTapRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const wheelTimerRef = useRef(0);
  const dirtyRef = useRef(ALL);

  const sidebarEl = usePortalTarget("viz-sidebar-portal");
  const drawerEl = usePortalTarget("viz-context-portal");

  // ── Data + deep link ────────────────────────────────────────────────────
  useEffect(() => {
    let on = true;
    loadConcordance()
      .then((d) => {
        if (!on) return;
        setPayload(d);
        const link = readDeepLink();
        const fromLink = (link?.roots ?? []).map((r) => findRootIndex(d, r)).filter((i) => i >= 0).slice(0, MAX_ROOTS);
        const fromShell = highlightRoot ? [findRootIndex(d, highlightRoot)].filter((i) => i >= 0) : [];
        const preset = PRESETS[0].roots.map((r) => findRootIndex(d, r)).filter((i) => i >= 0);
        setRootIndices(fromLink.length ? fromLink : fromShell.length ? fromShell : preset);
        if (link?.meet) setMeetIn(link.meet);
        if (link?.order) setOrder(link.order);
        const narrow = window.innerWidth < NARROW_PX;
        setView(link?.view ?? (narrow ? "overlaid" : "stacked"));
      })
      .catch(() => on && setFailed(true));
    return () => {
      on = false;
    };
    // Runs once: highlightRoot seeds the first open only, and later shell
    // changes must not throw away a selection the reader has built here.
  }, []);

  // Keep the URL shareable: roots, view, rule and order ride in the query.
  useEffect(() => {
    if (!payload) return;
    const sp = new URLSearchParams(window.location.search);
    sp.set("roots", rootIndices.map((i) => payload.roots[i].bare).join(","));
    sp.set("view", view);
    if (meetIn !== "ayah") sp.set("meet", meetIn);
    else sp.delete("meet");
    if (order !== "mushaf") sp.set("order", order);
    else sp.delete("order");
    const next = `${window.location.pathname}?${sp.toString()}`;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(window.history.state, "", next);
    }
  }, [payload, rootIndices, view, meetIn, order]);

  // The words are only needed once someone hovers, so they load then.
  const wantText = useCallback(() => {
    if (text) return;
    loadConcordanceText().then(setText).catch(() => {});
  }, [text]);

  // ── Size, and the part of it the shell's chrome leaves visible ─────────
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
      const a = getVisibleArea(el);
      setArea((prev) =>
        Math.abs(prev.x - a.x) < 1 && Math.abs(prev.y - a.y) < 1 && Math.abs(prev.width - a.width) < 1 && Math.abs(prev.height - a.height) < 1
          ? prev
          : { x: Math.round(a.x), y: Math.round(a.y), width: Math.round(a.width), height: Math.round(a.height) },
      );
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // The dock and the drawer slide rather than resize the stage, so their
    // transitions are what tell us the visible area moved.
    const onTransition = (e: TransitionEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.(".viz-dock, .context-drawer, .graph-toolbar, .status-bar, .viz-intro-chip")) measure();
    };
    document.addEventListener("transitionend", onTransition);
    window.addEventListener("resize", measure);
    // Mobile browsers resize the visual viewport (URL bar, keyboard) without
    // always resizing the layout one.
    window.visualViewport?.addEventListener("resize", measure);
    // The chrome mounts after the stage; measure again once it has settled.
    const late = window.setTimeout(measure, 600);
    const later = window.setTimeout(measure, 1600);
    return () => {
      ro.disconnect();
      document.removeEventListener("transitionend", onTransition);
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      window.clearTimeout(late);
      window.clearTimeout(later);
    };
  }, []);

  // A new size or view starts from the fit: pan offsets in px from another
  // layout would point at nothing.
  useEffect(() => {
    zoomRef.current = IDENTITY_ZOOM;
    liveRef.current = null;
    setZoom(IDENTITY_ZOOM);
  }, [size.w, size.h, view]);

  // ── Renderer ────────────────────────────────────────────────────────────
  useEffect(() => {
    const c = tickRef.current;
    if (!c) return;
    const r = createTickRenderer(c);
    rendererRef.current = r;
    setRendererKind(r?.kind ?? null);
    return () => {
      r?.dispose();
      rendererRef.current = null;
    };
  }, []);

  // ── Derived ─────────────────────────────────────────────────────────────
  const selection = useMemo(
    () => (payload ? selectConcordance(payload, rootIndices, meetIn) : null),
    [payload, rootIndices, meetIn],
  );
  const frame = useMemo(
    () => frameFor(size.w, size.h, area.width > 0 ? area : undefined),
    [size, area],
  );
  const layout = useMemo(
    () => (selection && size.w ? ringTargets(selection, view, order, frame) : null),
    [selection, view, order, frame, size.w],
  );
  // Rings too thin for one slot per root show only the first root — until a
  // zoom makes them thick enough to show all of them.
  const thin = layout ? layout.half * 2 * zoom.k < THIN_RING_PX : false;
  const shownFrame = useMemo(() => zoomFrame(frame, zoom), [frame, zoom]);
  const ticks = useMemo(
    () => (payload && selection ? buildTicks(payload, selection, thin) : null),
    [payload, selection, thin],
  );
  const ayahCounts = useMemo(() => new Map((selection?.surahs ?? []).map((s) => [s.n, s.ayahCount])), [selection]);
  const places = useMemo(
    () => new Map((selection?.surahs ?? []).map((s) => [s.n, s.revelationPlace === "madinah" ? 1 : 0])),
    [selection],
  );
  const histogram = useMemo(() => (selection && layout ? meetingHistogram(selection, layout.order) : []), [selection, layout]);
  const over = useMemo(() => {
    if (!selection || view !== "overlaid") return null;
    const o = buildOverlaid(selection);
    return { ...o, peak: overlaidPeak(o.bins) };
  }, [selection, view]);
  const selectedHit = useMemo(
    () => (selected && selection ? selection.surahs.find((s) => s.n === selected) ?? null : null),
    [selected, selection],
  );
  const wiring = useMemo(
    () => (selectedHit && selection ? wiringFor(selectedHit, selection.roots.length) : []),
    [selectedHit, selection],
  );

  // Drop a selection the new roots or view no longer show.
  useEffect(() => {
    if (selected && layout && !layout.order.includes(selected)) setSelected(null);
  }, [layout, selected]);

  const readInk = useCallback((): Ink => {
    const el = stageRef.current ?? document.body;
    const cs = getComputedStyle(el);
    const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
    return {
      ink: v("--ink", "#ece4d8"),
      muted: v("--ink-muted", "rgba(236,228,216,.55)"),
      line: v("--line", "rgba(198,222,230,.12)"),
      accent: v("--accent", "#e8924a"),
      roots: [v("--viz-root-1", "#e8924a"), v("--viz-root-2", "#56a697"), v("--viz-root-3", "#a78bfa")],
      meeting: v("--viz-meeting", "#f3e9d8"),
      makki: v("--viz-cat-makki", "#56a697"),
      madani: v("--viz-cat-madani", "#e8924a"),
    };
  }, []);

  // Everything a frame needs, in one ref, so the loop never reads stale state.
  const live = useRef({
    view, toggles, aligned, selected, wiring, histogram, over, layout, selection, frame, size, places,
    pointer, focus, ayahCounts, theme, ink: null as Ink | null,
  });
  live.current = {
    view, toggles, aligned, selected, wiring, histogram, over, layout, selection, frame, size, places,
    pointer, focus, ayahCounts, theme, ink: live.current.ink,
  };

  // ── Frame ───────────────────────────────────────────────────────────────
  const render = useCallback((now: number, mask: number) => {
    const L = live.current;
    const { w, h } = L.size;
    if (!w || !h || !L.selection) return;
    const z = zoomRef.current;
    const f = zoomFrame(L.frame, z);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const ink = L.ink ?? (L.ink = readInk());
    const motion = motionRef.current;
    const poses = zoomRings(motion.sample(now), z.k);
    const turning = motion.turning(now);

    // The centre label rides the zoom's pan, in the same frame as the rings.
    const centre = centreRef.current;
    if (centre) {
      centre.style.left = `${f.cx}px`;
      centre.style.top = `${f.cy}px`;
    }

    const back = mask & BACK && backRef.current ? prepare(backRef.current, w, h, dpr) : null;
    if (back) {
      drawScale(back, f, ink, L.aligned && !turning && L.view !== "overlaid");
      if (L.view === "overlaid" && L.over) {
        drawOverlaid(back, f, L.over.bins, L.over.chords, L.over.peak, ink);
      } else if (L.layout) {
        // Once turned, the histogram's positions describe unrotated rings.
        const histAlpha = L.toggles.histogram ? fadeRef.current * (L.aligned || turning ? 0.33 : 1) : 0;
        drawHistogram(back, f, L.histogram, ink, histAlpha);
        if (L.toggles.threads) drawThreads(back, f, threadsFor(L.layout.order, L.selection, poses), poses, ink, fadeRef.current);
        drawSurahNumbers(back, f, poses, ink);
      }
    }

    const r = mask & TICKS ? rendererRef.current : null;
    if (r) {
      // A selected ring stays bright; the rest step back.
      const rings = new Map<number, LiveRing & { place: number }>();
      if (L.view !== "overlaid") {
        for (const [n, p] of poses) {
          const dim = L.selected && n !== L.selected ? 0.22 : 1;
          rings.set(n, { ...p, alpha: p.alpha * dim, place: L.places.get(n) ?? 0 });
        }
      }
      r.draw({
        cx: f.cx,
        cy: f.cy,
        width: w,
        height: h,
        dpr,
        rings,
        palette: {
          slots: [
            parseColour(ink.ink, L.theme === "dark" ? 0.13 : 0.17),
            parseColour(ink.roots[0]),
            parseColour(ink.roots[1]),
            parseColour(ink.roots[2]),
            parseColour(ink.meeting),
          ],
          makki: parseColour(ink.makki),
          madani: parseColour(ink.madani),
        },
        tint: L.toggles.tint ? 1 : 0,
      });
    }

    const front = mask & FRONT && frontRef.current ? prepare(frontRef.current, w, h, dpr) : null;
    if (front && L.view !== "overlaid") {
      if (L.selected) {
        const ring = poses.get(L.selected);
        if (ring) drawSelection(front, f, ring, L.wiring, ink);
      }
      const target = L.pointer ?? L.focus;
      if (target) {
        const ring = poses.get(target.surah);
        const n = L.ayahCounts.get(target.surah) ?? 0;
        if (ring && n) drawFocus(front, f, ring, (target.ayah - 0.5) / n, (0.5 / n) * TICK_FILL, ink);
      }
    }
  }, [readInk]);

  const kick = useCallback(
    (mask: number = ALL) => {
      dirtyRef.current |= mask;
      if (rafRef.current) return;
      const loop = () => {
        rafRef.current = 0;
        const now = performance.now();
        const motion = motionRef.current;
        const moving = now < motion.endsAt() + 60;
        // Threads and the histogram depend on which rings are neighbours, so
        // they fade out while anything travels and return at rest.
        const fadeTarget = motion.travelling(now) ? 0 : 1;
        const before = fadeRef.current;
        fadeRef.current += (fadeTarget - fadeRef.current) * 0.22;
        if (Math.abs(fadeTarget - fadeRef.current) < 0.01) fadeRef.current = fadeTarget;
        const m = dirtyRef.current | (moving ? ALL : 0) | (fadeRef.current !== before ? BACK : 0);
        dirtyRef.current = 0;
        if (m) render(now, m);
        const fading = fadeRef.current > 0.005 && fadeRef.current < 0.995;
        if (moving || fading) rafRef.current = requestAnimationFrame(loop);
        else motion.settle(now);
      };
      rafRef.current = requestAnimationFrame(loop);
    },
    [render],
  );

  // Reset the handle too: StrictMode runs this cleanup and then remounts, and
  // a cancelled-but-remembered id makes every later kick() think a frame is
  // already queued — the loop would never run again.
  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    },
    [],
  );

  // Colours are CSS variables; re-read them when the theme flips.
  useEffect(() => {
    live.current.ink = null;
    kick();
  }, [theme, kick]);

  // Tick geometry changes only with the roots or ring thinness.
  useEffect(() => {
    if (ticks && rendererRef.current) {
      rendererRef.current.setTicks(ticks);
      kick(TICKS);
    }
  }, [ticks, kick, rendererKind]);

  const reduced = useCallback(() => prefersReducedMotion(), []);

  /** Rotation targets for the anchors: each ring's first meeting. */
  const anchorTargets = useCallback((): Map<number, number> => {
    const m = new Map<number, number>();
    for (const s of selection?.surahs ?? []) if (s.meetings.length) m.set(s.n, rotationToTop(s.meetings[0].pos));
    return m;
  }, [selection]);

  // TRAVEL — order, view, roots or size changed.
  const lastSize = useRef("");
  const alignedRef = useRef(aligned);
  alignedRef.current = aligned;
  useEffect(() => {
    if (!layout) return;
    const now = performance.now();
    const motion = motionRef.current;
    const sizeKey = `${size.w}x${size.h}@${area.x},${area.y},${area.width},${area.height}`;
    const resized = lastSize.current !== "" && lastSize.current !== sizeKey;
    lastSize.current = sizeKey;
    const instant = !placedRef.current || resized || reduced();
    motion.travelTo(layout.targets, now, instant);
    placedRef.current = true;
    // Sort first, then align: aligned rings re-anchor once they have landed.
    if (alignedRef.current) {
      const after = instant ? now : now + TRAVEL_MS + TRAVEL_STAGGER_MS;
      motion.turnTo(anchorTargets(), layout.order, after, instant ? "instant" : "calm");
    }
    kick();
  }, [layout, size, area, kick, reduced, anchorTargets]);

  // TURN — align at first meeting, or reset.
  const toggleAlign = useCallback(() => {
    if (!layout) return;
    const next = !aligned;
    // The expressive choreography suits a first demonstration; the direct
    // turn suits repeated use. Reduced motion jumps.
    let style: TurnStyle = "calm";
    if (reduced()) style = "instant";
    else if (next && !alignedOnceRef.current) style = "expressive";
    if (next) alignedOnceRef.current = true;
    motionRef.current.turnTo(next ? anchorTargets() : new Map(), layout.order, performance.now(), style);
    setAligned(next);
    kick();
  }, [aligned, anchorTargets, kick, layout, reduced]);

  // Changes that need a frame, not motion — and only the layers they touch.
  useEffect(() => {
    kick(FRONT);
  }, [pointer, focus, kick]);
  useEffect(() => {
    kick(TICKS | FRONT);
  }, [selected, wiring, kick]);
  useEffect(() => {
    kick(ALL);
  }, [toggles, view, kick]);

  // ── Zoom ────────────────────────────────────────────────────────────────
  /**
   * A live scale kept within the fit and the limit. Callers clamp BEFORE they
   * derive the translation from it: clamping afterwards left the translation
   * of the unclamped scale, and the view slid sideways at the limit.
   */
  const clampLive = useCallback((s: number) => {
    const k = zoomRef.current.k;
    return Math.min(MAX_ZOOM / k, Math.max(1 / k, s));
  }, []);

  /** Show a gesture's live transform on the layers without redrawing them. */
  const showLive = useCallback((live: Live, animate = false) => {
    liveRef.current = live;
    const el = layersRef.current;
    if (!el) return;
    el.style.transition = animate && !prefersReducedMotion() ? "transform 220ms cubic-bezier(0.2, 0.7, 0.2, 1)" : "";
    el.style.transform = `translate(${live.dx}px, ${live.dy}px) scale(${live.s})`;
  }, []);

  /**
   * Fold the live transform into the zoom and redraw at the new scale. The
   * redraw happens synchronously, in the same task that drops the CSS
   * transform, so the picture never flashes back to where it started.
   */
  const commitLive = useCallback(() => {
    const live = liveRef.current;
    liveRef.current = null;
    const el = layersRef.current;
    if (el) {
      el.style.transition = "";
      el.style.transform = "";
    }
    if (!live) return;
    const next = clampZoom(composeZoom(zoomRef.current, frame, live.s, live.dx, live.dy), frame);
    zoomRef.current = next;
    render(performance.now(), ALL);
    setZoom(next);
  }, [frame, render]);

  /** Animate to a zoom (double tap, the reset button, keys), then commit. */
  const zoomTo = useCallback(
    (to: ViewZoom) => {
      const target = clampZoom(to, frame);
      const t = transformBetween(zoomRef.current, target, frame);
      setPointer(null);
      showLive({ s: t.s, dx: t.dx, dy: t.dy }, true);
      window.setTimeout(commitLive, prefersReducedMotion() ? 0 : 230);
    },
    [commitLive, frame, showLive],
  );

  /** Zoom by a factor about a stage point, keeping that point still. */
  const zoomAt = useCallback(
    (factor: number, x: number, y: number) => {
      const z = zoomRef.current;
      // The unzoomed point under (x, y), then the zoom that keeps it there.
      const k = Math.min(MAX_ZOOM, Math.max(1, z.k * factor));
      const px = frame.cx + (x - frame.cx - z.x) / z.k;
      const py = frame.cy + (y - frame.cy - z.y) / z.k;
      zoomTo({ k, x: x - frame.cx - (px - frame.cx) * k, y: y - frame.cy - (py - frame.cy) * k });
    },
    [frame, zoomTo],
  );

  // Wheel and trackpad pinch (which arrives as a wheel with ctrlKey). A native
  // listener, because React's is passive and the page must not scroll.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const live = liveRef.current ?? { s: 1, dx: 0, dy: 0 };
      const s = clampLive(live.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
      const f = s / live.s;
      // Scale the live transform about the cursor.
      showLive({ s, dx: x - f * (x - live.dx), dy: y - f * (y - live.dy) });
      setPointer(null);
      window.clearTimeout(wheelTimerRef.current);
      wheelTimerRef.current = window.setTimeout(commitLive, 140);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      window.clearTimeout(wheelTimerRef.current);
    };
  }, [clampLive, commitLive, showLive]);

  // ── Pointer ─────────────────────────────────────────────────────────────
  const local = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = stageRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  /** The ring and ayah under a stage point, at the current zoom. */
  const hitAt = useCallback(
    (x: number, y: number) =>
      hitTest(x, y, zoomFrame(frame, zoomRef.current), zoomRings(motionRef.current.sample(performance.now()), zoomRef.current.k), ayahCounts),
    [frame, ayahCounts],
  );

  /** Hover, or a finger scrubbing across the rings: point at what's under it. */
  const pointAt = useCallback(
    (x: number, y: number) => {
      if (view === "overlaid") {
        const bin = over ? overlaidBinAt(zoomFrame(frame, zoomRef.current), x, y, over.bins.length) : -1;
        setOverBin(bin >= 0 && over && over.bins[bin].refs.length ? { bin, x, y } : null);
        return;
      }
      const hit = hitAt(x, y);
      setPointer(hit ? { ...hit, x, y } : null);
    },
    [view, over, frame, hitAt],
  );

  const selectRing = useCallback(
    (surah: number | null) => {
      setSelected((prev) => (surah === prev ? null : surah));
      if (surah) {
        setRightSidebarOpen(true);
        // The drawer shows mode content on its Explain tab; ask for it.
        window.dispatchEvent(new CustomEvent("viz:context-request"));
      }
    },
    [setRightSidebarOpen],
  );

  /**
   * A tap. With a mouse it selects the ring under it, as a click always has.
   * With a finger there is no hover, so the first tap shows the ayah under it,
   * a second tap on the same ring selects it, and a double tap zooms.
   */
  const onTap = useCallback(
    (x: number, y: number, type: string) => {
      if (type === "mouse") {
        if (view === "overlaid") return;
        const hit = hitAt(x, y);
        selectRing(hit ? hit.surah : null);
        return;
      }
      const now = performance.now();
      const last = lastTapRef.current;
      if (last && now - last.t < DOUBLE_TAP_MS && Math.hypot(x - last.x, y - last.y) < DOUBLE_TAP_PX) {
        lastTapRef.current = null;
        if (zoomRef.current.k > 1.05) zoomTo(IDENTITY_ZOOM);
        else zoomAt(TAP_ZOOM, x, y);
        return;
      }
      lastTapRef.current = { x, y, t: now };
      wantText();
      if (view === "overlaid") {
        pointAt(x, y);
        return;
      }
      const hit = hitAt(x, y);
      if (!hit) {
        // Tapping empty canvas dismisses the read-out first, then the selection.
        if (pointer) setPointer(null);
        else selectRing(null);
        return;
      }
      if (pointer && pointer.surah === hit.surah && selected !== hit.surah) selectRing(hit.surah);
      setPointer({ ...hit, x, y });
    },
    [hitAt, pointAt, pointer, selectRing, selected, view, wantText, zoomAt, zoomTo],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const p = local(e);
      const pointers = pointersRef.current;
      pointers.set(e.pointerId, p);
      stageRef.current?.setPointerCapture?.(e.pointerId);
      if (pointers.size === 1) {
        pressRef.current = { id: e.pointerId, type: e.pointerType, x: p.x, y: p.y, moved: false };
        return;
      }
      // A second finger: a pinch, which also pans with the fingers' midpoint.
      const [a, b] = [...pointers.values()];
      pinchRef.current = { d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      if (pressRef.current) pressRef.current.moved = true;
      setPointer(null);
      setOverBin(null);
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const p = local(e);
      const pointers = pointersRef.current;
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);

      const pinch = pinchRef.current;
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const s = clampLive(Math.hypot(a.x - b.x, a.y - b.y) / pinch.d0);
        const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        showLive({ s, dx: m.x - s * pinch.m0.x, dy: m.y - s * pinch.m0.y });
        return;
      }

      const press = pressRef.current;
      if (press && press.id === e.pointerId) {
        if (!press.moved && Math.hypot(p.x - press.x, p.y - press.y) > TAP_SLOP) press.moved = true;
        if (!press.moved) return;
        // Zoomed in, a drag pans. At the fit there is nothing to pan, so a
        // finger scrubs across the rings instead, reading out each ayah.
        if (zoomRef.current.k > 1) {
          showLive({ s: 1, dx: p.x - press.x, dy: p.y - press.y });
          setPointer(null);
          return;
        }
      }
      if (liveRef.current) return;
      pointAt(p.x, p.y);
    },
    [clampLive, pointAt, showLive],
  );

  const endPress = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
      const pointers = pointersRef.current;
      pointers.delete(e.pointerId);
      if (pinchRef.current) {
        // The pinch ends when a finger lifts; the remaining one does nothing
        // until it lifts too, so the view doesn't jump to follow it.
        if (pointers.size < 2) {
          pinchRef.current = null;
          commitLive();
        }
        if (pointers.size === 0) pressRef.current = null;
        return;
      }
      const press = pressRef.current;
      if (!press || press.id !== e.pointerId) return;
      pressRef.current = null;
      if (liveRef.current) {
        commitLive();
        return;
      }
      if (!cancelled && !press.moved) {
        const p = local(e);
        onTap(p.x, p.y, press.type);
      }
    },
    [commitLive, onTap],
  );

  // ── Keyboard: ↑↓ rings, ←→ ayahs, Enter selects, Esc clears ────────────
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!layout || !layout.order.length || view === "overlaid") return;
      const cur = focus ?? { surah: layout.order[0], ayah: 1 };
      const idx = Math.max(0, layout.order.indexOf(cur.surah));
      const n = ayahCounts.get(cur.surah) ?? 1;
      let next: { surah: number; ayah: number };
      switch (e.key) {
        case "ArrowUp":
          next = { surah: layout.order[Math.min(layout.order.length - 1, idx + 1)], ayah: 1 };
          break;
        case "ArrowDown":
          next = { surah: layout.order[Math.max(0, idx - 1)], ayah: 1 };
          break;
        case "ArrowRight":
          next = { surah: cur.surah, ayah: (cur.ayah % n) + 1 };
          break;
        case "ArrowLeft":
          next = { surah: cur.surah, ayah: ((cur.ayah - 2 + n) % n) + 1 };
          break;
        case "Home":
          next = { surah: cur.surah, ayah: 1 };
          break;
        case "End":
          next = { surah: cur.surah, ayah: n };
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          selectRing(cur.surah);
          return;
        case "Escape":
          setSelected(null);
          setFocus(null);
          return;
        default:
          return;
      }
      e.preventDefault();
      wantText();
      setFocus(next);
    },
    [ayahCounts, focus, layout, selectRing, view, wantText],
  );

  // + and − zoom about the centre of the view, 0 returns to the fit. Handled
  // before the ring keys, so they work in every view.
  const onZoomKey = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const cx = area.x + area.width / 2;
      const cy = area.y + area.height / 2;
      if (e.key === "+" || e.key === "=") zoomAt(1.6, cx, cy);
      else if (e.key === "-" || e.key === "_") zoomAt(1 / 1.6, cx, cy);
      else if (e.key === "0") zoomTo(IDENTITY_ZOOM);
      else return false;
      e.preventDefault();
      return true;
    },
    [area, zoomAt, zoomTo],
  );

  // ── Tooltip ─────────────────────────────────────────────────────────────
  const tipTarget = useMemo(() => {
    if (pointer) return pointer;
    if (!focus) return null;
    const pose = motionRef.current.pose(focus.surah, performance.now());
    const n = ayahCounts.get(focus.surah) ?? 0;
    if (!pose || !n) return null;
    const a = angleAt((focus.ayah - 0.5) / n, pose.rot);
    const r = pose.r * zoom.k;
    return { ...focus, x: shownFrame.cx + Math.cos(a) * r, y: shownFrame.cy + Math.sin(a) * r };
  }, [pointer, focus, ayahCounts, shownFrame, zoom.k]);

  const tip = useMemo(() => {
    if (!tipTarget || !selection || !payload) return null;
    const s = selection.surahs.find((x) => x.n === tipTarget.surah);
    if (!s) return null;
    return {
      s,
      hit: s.hits.find((hh) => hh.ayah === tipTarget.ayah) ?? null,
      words: text?.surahs[s.n - 1]?.[tipTarget.ayah - 1] ?? null,
      slots: rootWordSlots(payload, rootIndices, s.n, tipTarget.ayah),
    };
  }, [tipTarget, selection, payload, text, rootIndices]);

  // ── Controls ────────────────────────────────────────────────────────────
  const roots: ConcordanceRoot[] = selection?.roots ?? [];
  const addRoot = useCallback(
    (r: ConcordanceRoot) => {
      if (!payload) return;
      const i = findRootIndex(payload, r.bare);
      if (i < 0) return;
      setRootIndices((prev) => (prev.includes(i) || prev.length >= MAX_ROOTS ? prev : [...prev, i]));
      onRootSelect?.(r.bare);
    },
    [payload, onRootSelect],
  );
  const applyPreset = useCallback(
    (list: string[]) => {
      if (payload) setRootIndices(list.map((r) => findRootIndex(payload, r)).filter((i) => i >= 0));
    },
    [payload],
  );

  const nf = new Intl.NumberFormat(locale);
  const shownSurahs = selection?.qualifying.length ?? 0;
  const tipX = (x: number, half: number) => Math.min(Math.max(x, half), Math.max(half, size.w - half));

  return (
    <div
      ref={stageRef}
      className="cr-stage"
      tabIndex={0}
      role="group"
      aria-roledescription={t("roleDescription")}
      aria-label={t("stageLabel")}
      aria-describedby="cr-keys"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endPress(e, false)}
      onPointerCancel={(e) => endPress(e, true)}
      onPointerEnter={wantText}
      onPointerLeave={(e) => {
        // A finger lifting also "leaves"; only a mouse leaving ends hover, or
        // the read-out a tap just opened would vanish with the tap.
        if (e.pointerType !== "mouse") return;
        setPointer(null);
        setOverBin(null);
      }}
      onKeyDown={(e) => {
        if (!onZoomKey(e)) onKeyDown(e);
      }}
      onBlur={() => setFocus(null)}
      data-hot={pointer ? "true" : undefined}
      data-zoomed={zoom.k > 1 ? "true" : undefined}
      // Ticks handed to the renderer: a canvas mode's stand-in for counting SVG
      // marks, which scripts/build-graph-images.ts waits on before a capture.
      data-marks={ticks && rendererKind ? ticks.length / TICK_STRIDE : undefined}
    >
      {/* Everything a gesture moves, so a pinch can move it as one. */}
      <div ref={layersRef} className="cr-layers">
        <canvas ref={backRef} className="cr-layer" aria-hidden="true" />
        <canvas ref={tickRef} className="cr-layer" aria-hidden="true" />
        <canvas ref={frontRef} className="cr-layer" aria-hidden="true" />

        {roots.length ? (
          <div ref={centreRef} className="cr-centre" style={{ left: shownFrame.cx, top: shownFrame.cy }} aria-hidden="true">
            <p className="cr-centre-roots" dir="rtl" lang="ar">
              {roots.map((r, i) => (
                <span key={r.bare}>
                  {i ? <span className="cr-sep"> · </span> : null}
                  <span style={{ color: `var(--viz-root-${i + 1})` }}>{r.bare}</span>
                </span>
              ))}
            </p>
            <p className="cr-centre-gloss">{roots.map((r) => (r.gloss ?? r.bw).split(" / ")[0]).join(" · ")}</p>
            <p className="cr-centre-meta">
              <b>{nf.format(shownSurahs)}</b> {t("surahsWord")} · <b>{nf.format(selection?.totalMeetings ?? 0)}</b> {t("meetingsWord")}
            </p>
          </div>
        ) : null}
      </div>

      {zoom.k > 1 ? (
        <button
          type="button"
          className="cr-zoom-reset"
          style={{ top: area.y + 10, right: size.w - area.x - area.width + 10 }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => zoomTo(IDENTITY_ZOOM)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M8 11h6M20 20l-4-4" />
          </svg>
          {t("resetZoom")}
        </button>
      ) : null}

      {tip && tipTarget && view !== "overlaid" ? (
        <div
          className={`cr-tip ${tipTarget.y < size.h * 0.42 ? "is-below" : ""}`}
          style={{ left: tipX(tipTarget.x, 200), top: tipTarget.y }}
          aria-hidden="true"
        >
          <header>
            <span>
              <b className="cr-root" dir="rtl" lang="ar">{tip.s.arabic}</b> <span className="cr-tip-en">{tip.s.name}</span>
            </span>
            <span className="cr-tip-ref" dir="ltr">
              {tip.s.n}:{tipTarget.ayah}
            </span>
          </header>
          {tip.hit ? (
            <p className="cr-tip-chips">
              {tip.hit.meeting ? <span className="cr-tip-meeting">{t("meeting")}</span> : null}
              {roots.map((r, i) =>
                tip.hit!.mask & (1 << i) ? (
                  <span key={r.bare} className="cr-chip" dir="rtl" lang="ar" style={{ color: `var(--viz-root-${i + 1})` }}>
                    {r.bare}
                  </span>
                ) : null,
              )}
            </p>
          ) : null}
          <p className="cr-tip-text" dir="rtl" lang="ar">
            {tip.words
              ? tip.words.map((w, i) => (
                  <span key={i} style={tip.slots[i] >= 0 ? { color: `var(--viz-root-${tip.slots[i] + 1})` } : undefined}>
                    {w}{" "}
                  </span>
                ))
              : "…"}
          </p>
        </div>
      ) : null}

      {overBin && over && view === "overlaid" ? (
        <div
          className={`cr-tip ${overBin.y < size.h * 0.42 ? "is-below" : ""}`}
          style={{ left: tipX(overBin.x, 150), top: overBin.y }}
          aria-hidden="true"
        >
          <header>
            <span>{t("atPosition", { pos: Math.round(((overBin.bin + 0.5) / over.bins.length) * 100) })}</span>
            <span className="cr-tip-ref">{t("ayahCount", { n: over.bins[overBin.bin].refs.length })}</span>
          </header>
          <p className="cr-tip-refs" dir="ltr">
            {over.bins[overBin.bin].refs.slice(0, 12).map((r) => (
              <span key={`${r.surah}:${r.ayah}`} className={r.meeting ? "is-meeting" : undefined}>
                {r.surah}:{r.ayah}
              </span>
            ))}
            {over.bins[overBin.bin].refs.length > 12 ? (
              <span>{t("andMore", { n: over.bins[overBin.bin].refs.length - 12 })}</span>
            ) : null}
          </p>
        </div>
      ) : null}

      <p id="cr-keys" className="cr-sr">{t("keyboardHelp")}</p>
      <p className="cr-sr" aria-live="polite">
        {focus && tip ? `${tip.s.name} ${tip.s.n}:${focus.ayah}${tip.hit?.meeting ? `, ${t("meeting")}` : ""}` : ""}
      </p>

      {failed ? <p className="cr-note">{t("loadFailed")}</p> : null}
      {!payload && !failed ? <p className="cr-note">{t("loading")}</p> : null}
      {payload && !roots.length ? <p className="cr-note">{t("noRoots")}</p> : null}
      {payload && roots.length && layout && !layout.order.length && view !== "overlaid" ? (
        <p className="cr-note">{t("noMatches")}</p>
      ) : null}

      {sidebarEl
        ? createPortal(
            <ConcordanceControls
              payload={payload}
              roots={roots}
              meetIn={meetIn}
              view={view}
              order={order}
              toggles={toggles}
              aligned={aligned}
              onAddRoot={addRoot}
              onRemoveRoot={(i) => setRootIndices((prev) => prev.filter((_, k) => k !== i))}
              onPreset={applyPreset}
              onMeetIn={setMeetIn}
              onView={(v) => {
                setView(v);
                setPointer(null);
                setOverBin(null);
              }}
              onOrder={setOrder}
              onToggle={(key) => setToggles((p) => ({ ...p, [key]: !p[key] }))}
              onAlign={toggleAlign}
            />,
            sidebarEl,
          )
        : null}
      {drawerEl && selection
        ? createPortal(<ConcordanceDrawer selection={selection} selected={selectedHit} onSelect={selectRing} />, drawerEl)
        : null}
    </div>
  );
}
