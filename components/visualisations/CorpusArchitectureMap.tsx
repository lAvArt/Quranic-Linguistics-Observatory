"use client";

/**
 * Quran structure map: the 114 surahs as a ring, each with its length as an
 * inward bar and its roots outward. Three readings of one frame:
 *
 *   overview     every surah's five commonest roots, stacked on its spoke
 *   drill        one surah opens into a wide sector holding all its roots
 *   occurrence   a selected root's ayahs, stacked on every surah that holds it
 *
 * Built like the concordance rings (docs/VIZ_ARCHITECTURE.md, "Quran structure
 * map"): data from the static concordance payload, geometry in
 * lib/viz/structureMap, one memoised layer per concern, and nothing in React
 * state changes while a gesture runs. Hover is hit-tested in JS against the
 * geometry rather than through thousands of DOM targets; labels are placed
 * once the view settles, at a constant screen size, and never overlap.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useDeferredValue,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import type { CorpusToken } from "@/lib/schema/types";
import { useZoom } from "@/lib/hooks/useZoom";
import { SURAH_NAMES } from "@/lib/data/surahData";
import { getAyah } from "@/lib/corpus/corpusLoader";
import { findRootIndex, loadConcordance, rootKey, type ConcordancePayload } from "@/lib/corpus/concordanceClient";
import { VizExplainerDialog, HelpIcon } from "@/components/ui/VizExplainerDialog";
import { useVizControl } from "@/lib/hooks/VizControlContext";
import { usePortalTarget } from "@/lib/hooks/usePortalTarget";
import { useRestingHover } from "@/lib/hooks/useRestingHover";
import { getFrequencyColor, getIdentityColor, type LexicalColorMode } from "@/lib/theme/lexicalColoring";
import { motionSafeDuration, prefersReducedMotion } from "@/lib/viz/motionPrefs";
import {
  ARC_WIDTH,
  BAR_GAP,
  BAR_MAX,
  GRID_START,
  OCC_START,
  OVERVIEW_ROOTS,
  RING,
  ROOT_START,
  ROOT_STEP,
  angleDiff,
  angleOf,
  boundsOf,
  dotRadius,
  focusGrid,
  focusSpan,
  gridCell,
  interpolateSlots,
  occurrencePositions,
  pointAt,
  ringExtent,
  ringSlots,
  type Point,
  type Slot,
} from "@/lib/viz/structureMap/layout";
import { buildStructureModel, occurrencesOf, surahsWithRoot, type Occurrence } from "@/lib/viz/structureMap/model";
import { computeLabels, drillDotRadius, type MapMode, type View } from "@/lib/viz/structureMap/labels";
import { DrillLayer, LabelLayer, OccurrenceLayer, OverlayLayer, OverviewRootsLayer, RingLayer, type Mark } from "./structureMap/layers";

interface CorpusArchitectureMapProps {
  /** Only used to turn a clicked ayah into a real token id; the map itself draws from the concordance payload. */
  tokens: CorpusToken[];
  onNodeSelect?: (type: "surah" | "root" | "lemma", id: string | number) => void;
  highlightRoot?: string | null;
  selectedSurahId?: number;
  theme?: "light" | "dark";
  lexicalColorMode?: LexicalColorMode;
  /** Occurrence mode: focusing a word writes the selection back so the
   *  inspector shows that ayah — the map's own selected dot follows from
   *  `focusedSura`/`focusedAyah` coming back down. */
  onTokenFocus?: (tokenId: string) => void;
  onTokenHover?: (tokenId: string | null) => void;
  /** The globally focused token's position, so an ayah picked anywhere
   *  (the inspector's occurrence list, another view) lights its dot here. */
  focusedSura?: number | null;
  focusedAyah?: number | null;
}

type Hover =
  | { kind: "surah"; surah: number }
  | { kind: "root"; surah: number; root: number }
  | { kind: "occ"; surah: number; ayah: number }
  | { kind: "centre" };

const hoverKey = (h: Hover | null) =>
  !h ? "" : h.kind === "surah" ? `s${h.surah}` : h.kind === "root" ? `r${h.surah}:${h.root}` : h.kind === "occ" ? `o${h.surah}:${h.ayah}` : "c";

/** The ring opening onto a surah, and the camera moving to frame it, take the same time. */
const FAN_MS = 700;
/** Pointer slop for hitting a dot, in screen px. */
const HIT_PX = 7;
const INNER = RING - BAR_GAP - BAR_MAX - 6;
const NAMES_R = ROOT_START + (OVERVIEW_ROOTS - 1) * ROOT_STEP + 10;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export default function CorpusArchitectureMap({
  tokens,
  onNodeSelect,
  highlightRoot,
  selectedSurahId,
  theme = "dark",
  lexicalColorMode = "theme",
  onTokenFocus,
  onTokenHover,
  focusedSura,
  focusedAyah,
}: CorpusArchitectureMapProps) {
  const locale = useLocale();
  const isArabicLocale = locale.startsWith("ar");
  const t = useTranslations("Visualizations.CorpusArchitecture");
  const ts = useTranslations("Visualizations.Shared");
  const nf = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const fmt = useCallback((n: number) => nf.format(n), [nf]);
  const reduceMotion = prefersReducedMotion();
  const portalTarget = usePortalTarget("viz-sidebar-portal");
  const { isLeftSidebarOpen } = useVizControl();

  /* ── data ── */
  const [payload, setPayload] = useState<ConcordancePayload | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    let live = true;
    loadConcordance()
      .then((p) => live && setPayload(p))
      .catch(() => live && setLoadFailed(true));
    return () => {
      live = false;
    };
  }, []);
  const model = useMemo(() => (payload ? buildStructureModel(payload) : null), [payload]);
  const tokensRef = useRef(tokens);
  useEffect(() => {
    tokensRef.current = tokens;
  }, [tokens]);

  /* ── selection ── */
  const [focusedSurahId, setFocusedSurahId] = useState<number | null>(null);
  const [internalSelectedRoot, setInternalSelectedRoot] = useState<string | null>(null);
  const [selectedRootInfo, setSelectedRootInfo] = useState<{ root: string; count: number; surahId: number | null } | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  // Adopting the shared surah as a drill target is right when this map is the
  // thing being navigated, and wrong the moment a root is selected: arriving
  // with a root means the cross-corpus view. So adoption is skipped while a
  // root is active, and a new root clears any drill — adopt-the-prop, never
  // write back (docs/VIZ_ARCHITECTURE.md, "Selection is global").
  //
  // The shell has no "no surah": surah 1 is its default and what the "Entire
  // Quran" breadcrumb sets, so an adopted 1 means the whole ring, not a drill
  // into Al-Fatihah (clicking Al-Fatihah on the ring still opens it). The
  // echo of this map's own surah click is ignored, so it can't undo the click.
  const ownSurahPickRef = useRef<number | null>(null);
  const prevHighlightRootRef = useRef<string | null | undefined>(highlightRoot);
  useEffect(() => {
    const prev = prevHighlightRootRef.current;
    prevHighlightRootRef.current = highlightRoot;
    if (highlightRoot && highlightRoot !== prev) {
      setFocusedSurahId(null);
      return;
    }
    if (highlightRoot || !selectedSurahId || selectedSurahId === ownSurahPickRef.current) return;
    setFocusedSurahId(selectedSurahId === 1 ? null : selectedSurahId);
  }, [selectedSurahId, highlightRoot]);

  const activeRootKey = highlightRoot || internalSelectedRoot;
  const activeRoot = useMemo(() => (payload && activeRootKey ? findRootIndex(payload, activeRootKey) : -1), [payload, activeRootKey]);
  const occurrences = useMemo(() => (payload ? occurrencesOf(payload, activeRoot) : new Map<number, Occurrence[]>()), [payload, activeRoot]);
  const occurrenceMode = activeRoot >= 0 && !focusedSurahId && occurrences.size > 0;
  const mode: MapMode = occurrenceMode ? "occurrence" : focusedSurahId ? "drill" : "overview";
  const focusProfile = model && focusedSurahId ? model.surahs[focusedSurahId - 1] ?? null : null;
  const activeRootInfo = model && activeRoot >= 0 ? model.roots[activeRoot] : null;

  const litSurahs = useMemo(() => (occurrenceMode ? new Set(occurrences.keys()) : null), [occurrenceMode, occurrences]);

  const occurrenceStats = useMemo(() => {
    let total = 0;
    let ayahs = 0;
    occurrences.forEach((list) => {
      ayahs += list.length;
      for (const o of list) total += o.count;
    });
    return { total, ayahs, surahs: occurrences.size };
  }, [occurrences]);

  /* ── ring layout, and the ring opening onto a surah ── */
  const slotFocus = mode === "drill" ? focusedSurahId : null;
  const slotSpan = mode === "drill" && focusProfile ? focusSpan(focusProfile.roots.length) : 0;
  const targetSlots = useMemo(() => ringSlots(slotFocus, slotSpan), [slotFocus, slotSpan]);
  const [shownSlots, setShownSlots] = useState(targetSlots);
  const [settled, setSettled] = useState(true);
  const shownRef = useRef(targetSlots);
  useEffect(() => {
    const from = shownRef.current;
    const to = targetSlots;
    if (from === to) return;
    const duration = motionSafeDuration(FAN_MS);
    if (duration <= 0) {
      shownRef.current = to;
      setShownSlots(to);
      setSettled(true);
      return;
    }
    setSettled(false);
    const t0 = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const p = Math.min(1, (now - t0) / duration);
      const next = p >= 1 ? to : interpolateSlots(from, to, easeInOut(p));
      shownRef.current = next;
      setShownSlots(next);
      if (p < 1) raf = requestAnimationFrame(tick);
      else setSettled(true);
    });
    return () => cancelAnimationFrame(raf);
  }, [targetSlots]);

  const drillCells = useMemo(() => {
    if (mode !== "drill" || !focusProfile || !focusedSurahId) return [];
    const slot = targetSlots.get(focusedSurahId);
    return slot ? focusGrid(slot, focusProfile.roots.length) : [];
  }, [mode, focusProfile, focusedSurahId, targetSlots]);

  /* ── colour ── */
  const colorFor = useMemo(() => {
    if (!model) return () => "var(--ink)";
    if (lexicalColorMode === "frequency") {
      const max = Math.log1p(model.maxRootCount);
      return (r: number) => getFrequencyColor(Math.log1p(model.roots[r]?.count ?? 0) / max, theme);
    }
    if (lexicalColorMode === "identity") return (r: number) => getIdentityColor(model.roots[r]?.bare ?? String(r), theme);
    return () => "color-mix(in srgb, var(--ink) 74%, transparent)";
  }, [model, lexicalColorMode, theme]);
  const overviewMax = useMemo(() => (model ? Math.max(1, ...model.surahs.map((s) => s.roots[0]?.count ?? 0)) : 1), [model]);

  /* ── zoom ── */
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      const h = Math.round(entry.contentRect.height);
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const viewRef = useRef({ k: 1, x: 0, y: 0 });
  const [view, setView] = useState<{ k: number; x: number; y: number } | null>(null);
  const labelsRef = useRef<SVGGElement>(null);
  const centreRef = useRef<SVGGElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const varFrame = useRef(0);
  const { svgRef, gRef, fitBounds } = useZoom<SVGSVGElement>({
    minScale: 0.2,
    maxScale: 14,
    initialScale: 1,
    doubleClickZoom: false,
    onZoom: (tr) => {
      viewRef.current = { k: tr.k, x: tr.x, y: tr.y };
      // Text keeps its screen size: a custom-property write per frame.
      if (!varFrame.current) {
        varFrame.current = requestAnimationFrame(() => {
          varFrame.current = 0;
          const u = String(1 / viewRef.current.k);
          labelsRef.current?.style.setProperty("--sm-u", u);
          centreRef.current?.style.setProperty("--sm-u", u);
        });
      }
      if (tipRef.current) tipRef.current.style.opacity = "0";
    },
    onZoomEnd: (tr) => {
      viewRef.current = { k: tr.k, x: tr.x, y: tr.y };
      setView((prev) => (prev && prev.k === tr.k && prev.x === tr.x && prev.y === tr.y ? prev : { k: tr.k, x: tr.x, y: tr.y }));
    },
  });

  const contentBounds = useCallback(() => {
    const pts: Point[] = [];
    if (mode === "drill" && focusedSurahId) {
      pts.push(...ringExtent(RING + ARC_WIDTH + 30), ...drillCells);
      return boundsOf(pts, 40);
    }
    if (mode === "occurrence") {
      pts.push(...ringExtent(RING + ARC_WIDTH + 30));
      occurrences.forEach((list, n) => {
        const slot = targetSlots.get(n);
        if (!slot) return;
        const p = occurrencePositions(slot, list.length);
        pts.push(pointAt(slot.mid, Math.hypot(p[p.length - 1].x, p[p.length - 1].y) + 150));
      });
      return boundsOf(pts, 30);
    }
    // Room for the names only where the screen is wide enough to show them.
    const room = Math.min(size.w, size.h) >= 600 ? 105 : 70;
    return boundsOf(ringExtent(NAMES_R + room), 0);
  }, [mode, focusedSurahId, drillCells, occurrences, targetSlots, size.w, size.h]);

  const fitContent = useCallback((duration: number) => fitBounds(contentBounds(), { padding: 0.95, duration }), [fitBounds, contentBounds]);

  // Frame each reading once, when it first appears (and the first time the
  // element has a size). A pan or zoom in between is the reader's.
  const modeKey = `${mode}:${mode === "drill" ? focusedSurahId : mode === "occurrence" ? activeRoot : ""}`;
  const fittedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!model || !size.w || !size.h) return;
    if (fittedKeyRef.current === modeKey) return;
    const first = fittedKeyRef.current === null;
    fittedKeyRef.current = modeKey;
    fitContent(first ? 0 : FAN_MS);
  }, [model, size.w, size.h, modeKey, fitContent]);

  /* ── labels, placed once the view settles ── */
  const surahName = useCallback((n: number) => (isArabicLocale ? `${SURAH_NAMES[n]?.arabic ?? n} ${fmt(n)}` : `${n} ${SURAH_NAMES[n]?.name ?? ""}`), [isArabicLocale, fmt]);
  const surahShort = useCallback((n: number) => (isArabicLocale ? SURAH_NAMES[n]?.arabic ?? String(n) : SURAH_NAMES[n]?.name ?? String(n)), [isArabicLocale]);
  const selectedOccurrence = useMemo(() => {
    if (!occurrenceMode || focusedSura == null || focusedAyah == null) return null;
    return occurrences.get(focusedSura)?.some((o) => o.ayah === focusedAyah) ? { sura: focusedSura, ayah: focusedAyah } : null;
  }, [occurrenceMode, focusedSura, focusedAyah, occurrences]);

  const labelResult = useMemo(() => {
    if (!model || !view || !settled || !size.w) return { labels: [], rootsLabelled: 0 };
    const v: View = { ...view, w: size.w, h: size.h };
    return computeLabels({
      mode,
      slots: targetSlots,
      model,
      focusId: focusedSurahId,
      occurrences,
      view: v,
      surahName: mode === "occurrence" ? surahShort : surahName,
      arabicNames: isArabicLocale,
      rootText: (r) => model.roots[r]?.bare ?? "",
      formatCount: fmt,
      prioritySurah: selectedOccurrence?.sura ?? null,
      priorityRoot: activeRoot >= 0 ? activeRoot : null,
    });
  }, [model, view, settled, size.w, size.h, mode, targetSlots, focusedSurahId, occurrences, surahShort, surahName, isArabicLocale, fmt, selectedOccurrence, activeRoot]);

  /* ── hover: hit-tested against the geometry ── */
  const [hover, setHover] = useState<Hover | null>(null);
  const hoverRef = useRef<Hover | null>(null);

  const hitAt = useCallback(
    (wx: number, wy: number, k: number): Hover | null => {
      if (!model) return null;
      const r = Math.hypot(wx, wy);
      if (r < INNER) return mode === "drill" ? { kind: "centre" } : null;
      const a = angleOf(wx, wy);
      let slot: Slot | undefined;
      for (const s of shownSlots.values()) {
        if (Math.abs(angleDiff(a, s.mid)) <= s.half) {
          slot = s;
          break;
        }
      }
      if (!slot) return null;
      const n = slot.id;
      if (r <= RING + ARC_WIDTH + 4) return { kind: "surah", surah: n };
      if (!settled) return null;
      const tol = HIT_PX / k;
      const labelZone = 110 / k;
      if (mode === "overview") {
        const top = model.surahs[n - 1]?.roots.slice(0, OVERVIEW_ROOTS) ?? [];
        const i = Math.round((r - ROOT_START) / ROOT_STEP);
        if (i >= 0 && i < top.length) {
          const p = pointAt(slot.mid, ROOT_START + i * ROOT_STEP);
          if (Math.hypot(wx - p.x, wy - p.y) <= Math.max(dotRadius(top[i].count, overviewMax, 2.2, 8.2), tol, ROOT_STEP / 2)) {
            return { kind: "root", surah: n, root: top[i].root };
          }
        }
        return r <= NAMES_R + labelZone ? { kind: "surah", surah: n } : null;
      }
      if (mode === "drill") {
        if (n === focusedSurahId && focusProfile) {
          const cell = gridCell(focusProfile.roots.length);
          let best = -1;
          let bestD = Math.max(cell / 2, tol);
          drillCells.forEach((c, i) => {
            const d = Math.hypot(wx - c.x, wy - c.y);
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          });
          if (best >= 0) return { kind: "root", surah: n, root: focusProfile.roots[best].root };
          return r < GRID_START - cell / 2 ? { kind: "surah", surah: n } : null;
        }
        return r <= RING + ARC_WIDTH + 6 + labelZone ? { kind: "surah", surah: n } : null;
      }
      const list = occurrences.get(n);
      if (list?.length) {
        const pts = occurrencePositions(slot, list.length);
        const step = list.length > 1 ? Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) : 10;
        const i = Math.max(0, Math.min(list.length - 1, Math.round((r - OCC_START) / Math.max(step, 1e-6))));
        if (Math.hypot(wx - pts[i].x, wy - pts[i].y) <= Math.max(step / 2, tol)) return { kind: "occ", surah: n, ayah: list[i].ayah };
      }
      return r <= RING + ARC_WIDTH + 14 ? { kind: "surah", surah: n } : null;
    },
    [model, mode, shownSlots, settled, overviewMax, focusedSurahId, focusProfile, drillCells, occurrences],
  );

  const worldAt = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      const v = viewRef.current;
      return {
        wx: (clientX - rect.left - rect.width / 2 - v.x) / v.k,
        wy: (clientY - rect.top - rect.height / 2 - v.y) / v.k,
        k: v.k,
        px: clientX - rect.left,
        py: clientY - rect.top,
        w: rect.width,
      };
    },
    [svgRef],
  );

  const tokenIdFor = useCallback(
    (sura: number, ayah: number) => {
      const occ = occurrences.get(sura)?.find((o) => o.ayah === ayah);
      if (!occ) return null;
      // Prefer the real token carrying the root; a synthesised id resolves as
      // soon as that ayah streams in (useHomePageController).
      const key = activeRootKey ? rootKey(activeRootKey) : null;
      const tk = key ? tokensRef.current.find((x) => x.sura === sura && x.ayah === ayah && x.root && rootKey(x.root) === key) : undefined;
      return tk?.id ?? `${sura}:${ayah}:${occ.word}`;
    },
    [occurrences, activeRootKey],
  );

  const emitTokenHover = useRestingHover(onTokenHover);
  const updateHover = useCallback(
    (next: Hover | null) => {
      const prev = hoverRef.current;
      if (hoverKey(prev) === hoverKey(next)) return;
      hoverRef.current = next;
      setHover(next);
      if (next?.kind === "occ") emitTokenHover(tokenIdFor(next.surah, next.ayah));
      else if (prev?.kind === "occ") emitTokenHover(null);
      const svg = svgRef.current;
      if (svg) svg.style.cursor = next ? "pointer" : "grab";
      if (!next && tipRef.current) tipRef.current.style.opacity = "0";
    },
    [emitTokenHover, tokenIdFor, svgRef],
  );

  const pointerRef = useRef<{ px: number; py: number; w: number } | null>(null);
  const placeTip = useCallback(() => {
    const tip = tipRef.current;
    const p = pointerRef.current;
    if (!tip || !p || !hoverRef.current) return;
    // Flip below the pointer when above would run under the status pill.
    const below = p.py - tip.offsetHeight - 14 < 72;
    const x = Math.max(150, Math.min(p.w - 150, p.px));
    tip.style.transform = `translate(${x}px, ${p.py}px) translate(-50%, ${below ? "22px" : "calc(-100% - 14px)"})`;
    tip.style.opacity = "1";
  }, []);
  // New content changes the tooltip's height; place it again once it's in.
  useLayoutEffect(placeTip, [hover, placeTip]);

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.pointerType !== "mouse" || e.buttons) return;
    const p = worldAt(e.clientX, e.clientY);
    if (!p) return;
    pointerRef.current = { px: p.px, py: p.py, w: p.w };
    updateHover(hitAt(p.wx, p.wy, p.k));
    placeTip();
  };

  const onPointerLeave = () => updateHover(null);

  // A new reading moves everything under the pointer; the next move re-tests.
  useEffect(() => {
    updateHover(null);
  }, [modeKey]);

  const selectRoot = useCallback(
    (bare: string, surahId: number | null, count: number) => {
      const isDeselect = internalSelectedRoot === bare;
      setInternalSelectedRoot(isDeselect ? null : bare);
      setSelectedRootInfo(isDeselect ? null : { root: bare, count, surahId });
      onNodeSelect?.("root", bare);
    },
    [internalSelectedRoot, onNodeSelect],
  );

  const onClick = (e: ReactMouseEvent<SVGSVGElement>) => {
    const p = worldAt(e.clientX, e.clientY);
    if (!p || !model) return;
    const hit = hitAt(p.wx, p.wy, p.k);
    if (!hit) return;
    if (hit.kind === "centre") {
      setFocusedSurahId(null);
      return;
    }
    if (hit.kind === "surah") {
      setFocusedSurahId((prev) => (prev === hit.surah ? null : hit.surah));
      ownSurahPickRef.current = hit.surah;
      onNodeSelect?.("surah", hit.surah);
      setSelectedRootInfo(null);
      setInternalSelectedRoot(null);
      return;
    }
    if (hit.kind === "occ") {
      const id = tokenIdFor(hit.surah, hit.ayah);
      if (id) onTokenFocus?.(id);
      return;
    }
    const bare = model.roots[hit.root]?.bare;
    if (bare) selectRoot(bare, hit.surah, model.surahs[hit.surah - 1]?.countByRoot.get(hit.root) ?? 0);
  };

  const onKeyDown = (e: ReactKeyboardEvent<SVGSVGElement>) => {
    if (e.key !== "Escape") return;
    if (focusedSurahId) setFocusedSurahId(null);
    else if (internalSelectedRoot) {
      setInternalSelectedRoot(null);
      setSelectedRootInfo(null);
    }
  };

  /* ── overlay: hover and selection ── */
  const overlay = useMemo(() => {
    const outline: { n: number; tone: "hover" | "selection" }[] = [];
    const marks: Mark[] = [];
    let ticks: { counts: Map<number, number>; max: number; tone: "hover" | "selection" } | null = null;
    if (!model) return { outline, marks, ticks };
    const slots = shownSlots;
    const tickFor = (root: number, tone: "hover" | "selection") => {
      const counts = surahsWithRoot(model, root);
      let max = 1;
      counts.forEach((c) => (max = Math.max(max, c)));
      return { counts, max, tone };
    };
    if (hover?.kind === "surah") outline.push({ n: hover.surah, tone: "hover" });
    if (mode === "overview" && hover?.kind === "root") {
      ticks = tickFor(hover.root, "hover");
      for (const s of model.surahs) {
        const i = s.roots.slice(0, OVERVIEW_ROOTS).findIndex((r) => r.root === hover.root);
        const slot = slots.get(s.n);
        if (i < 0 || !slot) continue;
        const p = pointAt(slot.mid, ROOT_START + i * ROOT_STEP);
        marks.push({ ...p, r: dotRadius(s.roots[i].count, overviewMax, 2.2, 8.2) + 2.5, tone: "hover" });
      }
    }
    if (mode === "drill" && settled && focusProfile) {
      const max = focusProfile.roots[0]?.count ?? 1;
      const markRoot = (root: number, tone: "hover" | "selection") => {
        const i = focusProfile.roots.findIndex((r) => r.root === root);
        if (i >= 0 && drillCells[i]) marks.push({ ...drillCells[i], r: drillDotRadius(focusProfile.roots[i].count, max, gridCell(focusProfile.roots.length)) + 3, tone });
      };
      if (activeRoot >= 0) {
        ticks = tickFor(activeRoot, "selection");
        markRoot(activeRoot, "selection");
      }
      if (hover?.kind === "root") {
        ticks = tickFor(hover.root, "hover");
        markRoot(hover.root, "hover");
      }
    }
    if (mode === "occurrence" && settled) {
      const markOcc = (sura: number, ayah: number, tone: "hover" | "selection") => {
        const list = occurrences.get(sura);
        const slot = slots.get(sura);
        const i = list?.findIndex((o) => o.ayah === ayah) ?? -1;
        if (!list || !slot || i < 0) return;
        marks.push({ ...occurrencePositions(slot, list.length)[i], r: 7, tone });
      };
      if (selectedOccurrence) {
        markOcc(selectedOccurrence.sura, selectedOccurrence.ayah, "selection");
        outline.push({ n: selectedOccurrence.sura, tone: "selection" });
      }
      if (hover?.kind === "occ") markOcc(hover.surah, hover.ayah, "hover");
    }
    return { outline, marks, ticks };
  }, [model, shownSlots, hover, mode, settled, focusProfile, drillCells, activeRoot, occurrences, selectedOccurrence, overviewMax]);

  /* ── occurrence preview card (hover previews, a click pins) ── */
  const hoveredOccurrence = hover?.kind === "occ" ? { sura: hover.surah, ayah: hover.ayah } : null;
  const previewOccurrence = occurrenceMode ? hoveredOccurrence ?? selectedOccurrence : null;
  const isPreviewPinned = !hoveredOccurrence && !!selectedOccurrence;
  const previewSura = previewOccurrence?.sura ?? null;
  const previewAyah = previewOccurrence?.ayah ?? null;
  const [previewAyahText, setPreviewAyahText] = useState<string | null>(null);
  useEffect(() => {
    if (previewSura == null || previewAyah == null) {
      setPreviewAyahText(null);
      return;
    }
    let cancelled = false;
    // Debounced: sweeping across a stack must not fetch a verse per dot.
    const timer = window.setTimeout(() => {
      getAyah(previewSura, previewAyah).then((record) => {
        if (!cancelled) setPreviewAyahText(record?.textUthmani ?? null);
      });
    }, 90);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [previewSura, previewAyah]);
  const previewCount = previewOccurrence ? occurrences.get(previewOccurrence.sura)?.find((o) => o.ayah === previewOccurrence.ayah)?.count ?? 0 : 0;

  /* ── root search ── */
  const [rootSearchQuery, setRootSearchQuery] = useState("");
  const deferredRootSearch = useDeferredValue(rootSearchQuery);
  const filteredRoots = useMemo(() => {
    const q = deferredRootSearch.trim();
    if (!q || !model) return [];
    const key = rootKey(q);
    const lower = q.toLowerCase();
    const out: { bare: string; count: number; gloss: string }[] = [];
    // The table is ordered by frequency already.
    for (const r of model.roots) {
      if (rootKey(r.bare).includes(key) || r.bw.toLowerCase().startsWith(lower) || (r.gloss ?? "").toLowerCase().includes(lower)) {
        out.push({ bare: r.bare, count: r.count, gloss: r.gloss ?? "" });
        if (out.length >= 20) break;
      }
    }
    return out;
  }, [deferredRootSearch, model]);

  const handleRootSearchSelect = useCallback(
    (bare: string) => {
      const total = model?.roots.find((r) => r.bare === bare)?.count ?? 0;
      setInternalSelectedRoot((prev) => (prev === bare ? null : bare));
      setSelectedRootInfo({ root: bare, count: total, surahId: null });
      onNodeSelect?.("root", bare);
      setRootSearchQuery("");
    },
    [model, onNodeSelect],
  );

  /* ── sidebar summary ── */
  const overviewShown = useMemo(() => {
    if (!model) return 0;
    const ids = new Set<number>();
    for (const s of model.surahs) for (const r of s.roots.slice(0, OVERVIEW_ROOTS)) ids.add(r.root);
    return ids.size;
  }, [model]);

  const rootTotalFor = (bare: string) => model?.roots.find((r) => r.bare === bare)?.count ?? 0;

  /* ── tooltip content ── */
  const tooltip = (() => {
    if (!model || !hover) return null;
    if (hover.kind === "centre") return <div className="viz-tooltip-subtitle" style={{ margin: 0 }}>{t("tipBack")}</div>;
    if (hover.kind === "surah") {
      const meta = SURAH_NAMES[hover.surah];
      const p = model.surahs[hover.surah - 1];
      const inRoot = activeRoot >= 0 ? p?.countByRoot.get(activeRoot) ?? 0 : null;
      return (
        <>
          <div className="viz-tooltip-title">
            {fmt(hover.surah)}. {isArabicLocale ? meta?.arabic : meta?.name} <span className="arabic-text sm-tip-ar">{isArabicLocale ? "" : meta?.arabic}</span>
          </div>
          <div className="viz-tooltip-subtitle">
            {meta?.revelationPlace === "madinah" ? ts("madani") : ts("makki")} · {fmt(p?.ayahs ?? 0)} {ts("ayahs")}
          </div>
          <div className="viz-tooltip-row">
            <span className="viz-tooltip-label">{t("words")}</span>
            <span className="viz-tooltip-value">{fmt(p?.words ?? 0)}</span>
          </div>
          <div className="viz-tooltip-row">
            <span className="viz-tooltip-label">{ts("roots")}</span>
            <span className="viz-tooltip-value">{fmt(p?.roots.length ?? 0)}</span>
          </div>
          {inRoot != null && activeRootInfo && (
            <div className="viz-tooltip-row">
              <span className="viz-tooltip-label arabic-text">{activeRootInfo.bare}</span>
              <span className="viz-tooltip-value">{fmt(inRoot)}</span>
            </div>
          )}
          {hover.surah !== focusedSurahId && <div className="sm-tip-hint">{t("tipOpenSurah")}</div>}
        </>
      );
    }
    if (hover.kind === "root") {
      const r = model.roots[hover.root];
      const inSurah = model.surahs[hover.surah - 1]?.countByRoot.get(hover.root) ?? 0;
      return (
        <>
          <div className="viz-tooltip-title arabic-text sm-tip-root">{r?.bare}</div>
          {r?.gloss && <div className="viz-tooltip-subtitle">{r.gloss}</div>}
          <div className="viz-tooltip-row">
            <span className="viz-tooltip-label">
              {ts("inThisSurah")} ({surahShort(hover.surah)})
            </span>
            <span className="viz-tooltip-value">{fmt(inSurah)}</span>
          </div>
          <div className="viz-tooltip-row">
            <span className="viz-tooltip-label">{ts("totalInQuran")}</span>
            <span className="viz-tooltip-value">{fmt(r?.count ?? 0)}</span>
          </div>
          <div className="sm-tip-hint">{t("tipSelectRoot")}</div>
        </>
      );
    }
    const count = occurrences.get(hover.surah)?.find((o) => o.ayah === hover.ayah)?.count ?? 0;
    return (
      <>
        <div className="viz-tooltip-title">
          {ts("ayahCaps")} {fmt(hover.surah)}:{fmt(hover.ayah)}
        </div>
        <div className="viz-tooltip-subtitle">{surahShort(hover.surah)}</div>
        <div className="viz-tooltip-row">
          <span className="viz-tooltip-label arabic-text">{activeRootInfo?.bare}</span>
          <span className="viz-tooltip-value">{fmt(count)}</span>
        </div>
        <div className="sm-tip-hint">{t("ayahHoverHint")}</div>
      </>
    );
  })();

  /* ── centre ── */
  const centre = (() => {
    if (!model) {
      return (
        <text className="sm-centre-sub" textAnchor="middle" y={8}>
          {loadFailed ? t("loadError") : t("loading")}
        </text>
      );
    }
    if (mode === "drill" && focusedSurahId && focusProfile) {
      const meta = SURAH_NAMES[focusedSurahId];
      return (
        <>
          <text className="sm-centre-eyebrow" textAnchor="middle" y={-92}>
            {ts("surahCaps")} {fmt(focusedSurahId)}
          </text>
          <text className={`sm-centre-title${isArabicLocale ? " arabic-text" : ""}`} textAnchor="middle" y={-30}>
            {isArabicLocale ? meta?.arabic : meta?.name}
          </text>
          {!isArabicLocale && (
            <text className="sm-centre-arabic arabic-text" textAnchor="middle" y={34}>
              {meta?.arabic}
            </text>
          )}
          <text className="sm-centre-sub" textAnchor="middle" y={isArabicLocale ? 34 : 88}>
            {t("stats", { rootCount: fmt(focusProfile.roots.length), ayahCount: fmt(focusProfile.ayahs) })}
          </text>
          <text className="sm-centre-hint" textAnchor="middle" y={isArabicLocale ? 84 : 132}>
            {t("tipBack")}
          </text>
        </>
      );
    }
    if (mode === "occurrence" && activeRootInfo) {
      return (
        <>
          <text className="sm-centre-eyebrow" textAnchor="middle" y={-122}>
            {ts("selectedRoot")}
          </text>
          <text className="sm-centre-root arabic-text" textAnchor="middle" y={-26}>
            {activeRootInfo.bare}
          </text>
          {activeRootInfo.gloss && (
            <text className="sm-centre-sub" textAnchor="middle" y={82} direction="ltr">
              {activeRootInfo.gloss}
            </text>
          )}
          <text className="sm-centre-hint" textAnchor="middle" y={activeRootInfo.gloss ? 124 : 84}>
            {t("occurrenceCentre", { count: fmt(occurrenceStats.total), surahCount: fmt(occurrenceStats.surahs) })}
          </text>
        </>
      );
    }
    return (
      <>
        <text className="sm-centre-eyebrow" textAnchor="middle" y={-62}>
          {t("corpus")}
        </text>
        <text className="sm-centre-title" textAnchor="middle" y={4}>
          {t("centreSurahs", { count: fmt(model.surahs.length) })}
        </text>
        <text className="sm-centre-sub" textAnchor="middle" y={58}>
          {t("centreTotals", { words: fmt(model.totals.words), roots: fmt(model.totals.roots) })}
        </text>
      </>
    );
  })();

  const drillSlot = mode === "drill" && focusedSurahId ? targetSlots.get(focusedSurahId) : undefined;
  const viewBox = size.w && size.h ? `${-size.w / 2} ${-size.h / 2} ${size.w} ${size.h}` : "-500 -400 1000 800";
  const labelStyle = { "--sm-u": String(1 / (view?.k ?? 1)) } as CSSProperties;

  return (
    <section className="immersive-viz viz-fullwidth structure-map" data-theme={theme}>
      {portalTarget &&
        createPortal(
          <div className={`viz-left-stack ${!isLeftSidebarOpen ? "collapsed" : ""}`}>
            <div className="viz-left-panel viz-zoom-panel">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="eyebrow" style={{ fontSize: "0.7em" }}>
                  {ts("zoom")}
                </span>
              </div>
              <div className="viz-zoom-row">
                <button type="button" className="viz-zoom-reset-btn" onClick={() => fitContent(FAN_MS)}>
                  {ts("focus")}
                </button>
              </div>
            </div>

            <div className="viz-left-panel">
              <strong style={{ fontSize: "0.95em" }}>{t("title")}</strong>
              <div className="sm-panel-note">
                {!model ? (
                  t("loading")
                ) : mode === "occurrence" ? (
                  t("occurrenceSummary", {
                    root: activeRootInfo?.bare ?? "",
                    count: fmt(occurrenceStats.total),
                    ayahCount: fmt(occurrenceStats.ayahs),
                    surahCount: fmt(occurrenceStats.surahs),
                  })
                ) : mode === "drill" && focusProfile ? (
                  <>
                    {t("rootsLabelled", { shown: fmt(labelResult.rootsLabelled), total: fmt(focusProfile.roots.length) })}
                    {labelResult.rootsLabelled < focusProfile.roots.length && <span className="sm-panel-more">{t("zoomToSeeMore")}</span>}
                  </>
                ) : (
                  t("rootsShown", { shown: fmt(overviewShown), total: fmt(model.totals.roots) })
                )}
              </div>
            </div>

            {/* Occurrence card — hover previews the ayah, a click pins it.
                Same contract as the radial map's ayah card. */}
            <AnimatePresence>
              {previewOccurrence && (
                <motion.div
                  className="viz-left-panel"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  transition={reduceMotion ? { duration: 0 } : undefined}
                >
                  <div className="viz-tooltip-title">
                    {ts("ayahCaps")} {fmt(previewOccurrence.ayah)}
                  </div>
                  <div className="viz-tooltip-subtitle">
                    {fmt(previewOccurrence.sura)}. {surahShort(previewOccurrence.sura)} · {fmt(previewOccurrence.sura)}:{fmt(previewOccurrence.ayah)}
                  </div>
                  <div className="viz-tooltip-subtitle" style={{ opacity: 0.7, fontSize: "0.72rem" }}>
                    {isPreviewPinned ? t("ayahPinned") : t("ayahHoverHint")}
                  </div>
                  {previewAyahText && <div className="viz-tooltip-subtitle arabic-text sm-ayah-text">{previewAyahText}</div>}
                  <div className="viz-tooltip-row" style={{ marginTop: 8 }}>
                    <span className="viz-tooltip-label arabic-text">{activeRootInfo?.bare}</span>
                    <span className="viz-tooltip-value">{fmt(previewCount)}</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {!occurrenceMode && selectedRootInfo && (
                <motion.div
                  className="viz-left-panel"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={reduceMotion ? { duration: 0 } : undefined}
                >
                  <div className="viz-tooltip-title arabic-text" style={{ fontSize: "1.3em" }}>
                    {selectedRootInfo.root}
                  </div>
                  <div className="viz-tooltip-subtitle" style={{ fontSize: "0.8em", marginTop: 4 }}>
                    {selectedRootInfo.surahId ? `${surahShort(selectedRootInfo.surahId)}${isArabicLocale ? "" : ` | ${SURAH_NAMES[selectedRootInfo.surahId]?.arabic ?? ""}`}` : ts("root")}
                  </div>
                  {selectedRootInfo.surahId != null && (
                    <div className="viz-tooltip-row" style={{ marginTop: 8 }}>
                      <span className="viz-tooltip-label">{ts("inThisSurah")}</span>
                      <span className="viz-tooltip-value">{fmt(selectedRootInfo.count)}</span>
                    </div>
                  )}
                  <div className="viz-tooltip-row">
                    <span className="viz-tooltip-label">{ts("totalInQuran")}</span>
                    <span className="viz-tooltip-value">{fmt(rootTotalFor(selectedRootInfo.root))}</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="viz-left-panel">
              <div className="viz-root-search">
                <span className="viz-root-search-label">{t("searchRoot")}</span>
                <input
                  type="text"
                  className="viz-root-search-input"
                  placeholder={t("searchRootPlaceholder")}
                  value={rootSearchQuery}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setRootSearchQuery(e.target.value)}
                  aria-label={t("searchRoot")}
                />
                {filteredRoots.length > 0 && (
                  <div className="viz-root-search-results" role="listbox" aria-label={t("searchRoot")}>
                    {filteredRoots.map((r) => (
                      <button
                        key={r.bare}
                        type="button"
                        className={`viz-root-search-item ${internalSelectedRoot === r.bare ? "active" : ""}`}
                        role="option"
                        aria-selected={internalSelectedRoot === r.bare}
                        onClick={() => handleRootSearchSelect(r.bare)}
                      >
                        <span className="root-name">{r.bare}</span>
                        <span className="root-count">
                          {fmt(r.count)}
                          {r.gloss ? ` · ${r.gloss}` : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {rootSearchQuery.trim() && filteredRoots.length === 0 && <span className="viz-root-search-hint">{t("noRootFound")}</span>}
                {!rootSearchQuery.trim() && <span className="viz-root-search-hint">{t("searchRootHint", { count: fmt(model?.totals.roots ?? 0) })}</span>}
                {internalSelectedRoot && (
                  <button
                    type="button"
                    className="viz-root-search-item active"
                    style={{ marginTop: 4 }}
                    onClick={() => {
                      setInternalSelectedRoot(null);
                      setSelectedRootInfo(null);
                    }}
                  >
                    <span className="root-name">{internalSelectedRoot}</span>
                    <span className="root-count">{ts("clear")}</span>
                  </button>
                )}
              </div>
            </div>

            <div className="viz-legend" style={{ marginTop: "auto" }}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: "8px", justifyContent: "space-between" }}>
                <span className="eyebrow" style={{ fontSize: "0.7em" }}>
                  {ts("legend")}
                </span>
                <HelpIcon onClick={() => setShowHelp(true)} />
              </div>
              <div className="viz-legend-item sm-legend-row">
                <span className="sm-legend-arc" style={{ background: "var(--viz-cat-makki)" }} />
                <span>{ts("makki")}</span>
                <span className="sm-legend-arc" style={{ background: "var(--viz-cat-madani)" }} />
                <span>{ts("madani")}</span>
              </div>
              <div className="viz-legend-item sm-legend-row">
                <span className="sm-legend-bar" />
                <span>{t("legendBar")}</span>
              </div>
              <div className="viz-legend-item sm-legend-row">
                <span className="viz-legend-dot" style={{ background: mode === "occurrence" ? "var(--viz-cat-makki)" : colorFor(0), width: 8, height: 8 }} />
                <span>{mode === "occurrence" ? t("occurrenceLegend") : t("legendRootDot")}</span>
              </div>
              {mode === "occurrence" ? (
                <div className="viz-legend-item sm-legend-row">
                  <span className="viz-legend-dot" style={{ background: "transparent", border: "2px solid var(--selection)", width: 10, height: 10 }} />
                  <span>{t("selectedOccurrenceLegend")}</span>
                </div>
              ) : (
                <div className="viz-legend-item sm-legend-row">
                  <span className="sm-legend-tick" />
                  <span>{t("legendPresence")}</span>
                </div>
              )}
            </div>
          </div>,
          portalTarget,
        )}

      <VizExplainerDialog
        isOpen={showHelp}
        onClose={() => setShowHelp(false)}
        content={{
          title: t("Help.title"),
          description: t("Help.description"),
          sections: [
            { label: t("Help.hierarchyLabel"), text: t("Help.hierarchyText") },
            { label: t("Help.nodesLabel"), text: t("Help.nodesText") },
            { label: t("Help.interactLabel"), text: t("Help.interactText") },
            { label: t("Help.tipsLabel"), text: t("Help.tipsText") },
          ],
        }}
      />

      <div ref={containerRef} className="viz-container-full">
        <svg
          ref={svgRef}
          viewBox={viewBox}
          className="viz-canvas"
          role="img"
          aria-label={t("ariaLabel")}
          tabIndex={0}
          onPointerMove={onPointerMove}
          onPointerLeave={onPointerLeave}
          onClick={onClick}
          onKeyDown={onKeyDown}
        >
          <g ref={gRef}>
            {model && (
              <>
                <RingLayer slots={shownSlots} model={model} focusId={mode === "drill" ? focusedSurahId : null} lit={litSurahs} />
                {settled && mode === "overview" && <OverviewRootsLayer slots={targetSlots} model={model} colorFor={colorFor} maxCount={overviewMax} />}
                {settled && drillSlot && focusProfile && <DrillLayer key={focusedSurahId} slot={drillSlot} profile={focusProfile} colorFor={colorFor} />}
                {settled && mode === "occurrence" && <OccurrenceLayer key={activeRoot} slots={targetSlots} occurrences={occurrences} />}
                <OverlayLayer slots={shownSlots} outline={overlay.outline} ticks={overlay.ticks} marks={overlay.marks} />
                <g ref={labelsRef} className="sm-labels" style={labelStyle} pointerEvents="none">
                  <LabelLayer labels={labelResult.labels} />
                </g>
              </>
            )}
            <g ref={centreRef} className={`sm-centre${mode === "drill" ? " is-link" : ""}`} style={labelStyle} pointerEvents="none">
              {centre}
            </g>
          </g>
        </svg>
        <div ref={tipRef} className="viz-tooltip sm-tooltip" aria-hidden="true">
          {tooltip}
        </div>
      </div>
    </section>
  );
}

