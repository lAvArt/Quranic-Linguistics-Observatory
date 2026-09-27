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
  TICK_FILL,
  angleAt,
  buildTicks,
  frameFor,
  hitTest,
  meetingHistogram,
  overlaid as buildOverlaid,
  overlaidPeak,
  ringTargets,
  rootWordSlots,
  rotationToTop,
  threadsFor,
  wiringFor,
  type LiveRing,
  type View,
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

interface Pointer {
  surah: number;
  ayah: number;
  x: number;
  y: number;
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
  const [mounted, setMounted] = useState(false);
  const [rendererKind, setRendererKind] = useState<"webgl2" | "canvas2d" | null>(null);

  useEffect(() => setMounted(true), []);

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
      if (t?.closest?.(".viz-dock, .context-drawer, .graph-toolbar, .status-bar")) measure();
    };
    document.addEventListener("transitionend", onTransition);
    window.addEventListener("resize", measure);
    // The chrome mounts after the stage; measure again once it has settled.
    const late = window.setTimeout(measure, 600);
    return () => {
      ro.disconnect();
      document.removeEventListener("transitionend", onTransition);
      window.removeEventListener("resize", measure);
      window.clearTimeout(late);
    };
  }, []);

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
  const thin = layout?.thin ?? false;
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
  const render = useCallback((now: number) => {
    const L = live.current;
    const { w, h } = L.size;
    const f = L.frame;
    if (!w || !h || !L.selection) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const ink = L.ink ?? (L.ink = readInk());
    const motion = motionRef.current;
    const poses = motion.sample(now);
    const travelling = motion.travelling(now);
    const turning = motion.turning(now);

    // Threads and the histogram depend on which rings are neighbours, so they
    // fade out while anything travels and return at rest.
    const fadeTarget = travelling ? 0 : 1;
    fadeRef.current += (fadeTarget - fadeRef.current) * 0.22;
    if (Math.abs(fadeTarget - fadeRef.current) < 0.01) fadeRef.current = fadeTarget;

    const back = backRef.current && prepare(backRef.current, w, h, dpr);
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

    const r = rendererRef.current;
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

    const front = frontRef.current && prepare(frontRef.current, w, h, dpr);
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

  const kick = useCallback(() => {
    if (rafRef.current) return;
    const loop = () => {
      rafRef.current = 0;
      const now = performance.now();
      render(now);
      const motion = motionRef.current;
      const fading = fadeRef.current > 0.005 && fadeRef.current < 0.995;
      if (now < motion.endsAt() + 60 || fading) rafRef.current = requestAnimationFrame(loop);
      else motion.settle(now);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [render]);

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
      kick();
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

  // Front-layer and toggle changes need a frame, not motion.
  useEffect(() => {
    kick();
  }, [pointer, focus, selected, wiring, toggles, view, overBin, kick]);

  // ── Pointer ─────────────────────────────────────────────────────────────
  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = stageRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (view === "overlaid") {
        const bin = over ? overlaidBinAt(frame, x, y, over.bins.length) : -1;
        setOverBin(bin >= 0 && over && over.bins[bin].refs.length ? { bin, x, y } : null);
        return;
      }
      const hit = hitTest(x, y, frame, motionRef.current.sample(performance.now()), ayahCounts);
      setPointer(hit ? { ...hit, x, y } : null);
    },
    [view, over, frame, ayahCounts],
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

  const onClick = useCallback(() => {
    if (view === "overlaid") return;
    selectRing(pointer ? pointer.surah : null);
  }, [pointer, selectRing, view]);

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

  // ── Tooltip ─────────────────────────────────────────────────────────────
  const tipTarget = useMemo(() => {
    if (pointer) return pointer;
    if (!focus) return null;
    const pose = motionRef.current.pose(focus.surah, performance.now());
    const n = ayahCounts.get(focus.surah) ?? 0;
    if (!pose || !n) return null;
    const a = angleAt((focus.ayah - 0.5) / n, pose.rot);
    return { ...focus, x: frame.cx + Math.cos(a) * pose.r, y: frame.cy + Math.sin(a) * pose.r };
  }, [pointer, focus, ayahCounts, frame]);

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

  const sidebarEl = mounted ? document.getElementById("viz-sidebar-portal") : null;
  const drawerEl = mounted ? document.getElementById("viz-context-portal") : null;
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
      onPointerMove={onPointerMove}
      onPointerEnter={wantText}
      onPointerLeave={() => {
        setPointer(null);
        setOverBin(null);
      }}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onBlur={() => setFocus(null)}
      data-hot={pointer ? "true" : undefined}
    >
      <canvas ref={backRef} className="cr-layer" aria-hidden="true" />
      <canvas ref={tickRef} className="cr-layer" aria-hidden="true" />
      <canvas ref={frontRef} className="cr-layer" aria-hidden="true" />

      {roots.length ? (
        <div className="cr-centre" style={{ left: frame.cx, top: frame.cy }} aria-hidden="true">
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
