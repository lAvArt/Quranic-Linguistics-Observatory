"use client";

import { useEffect, useRef, useMemo, useState, useCallback, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import * as d3 from "@/lib/viz/d3";
import { motion, AnimatePresence } from "framer-motion";
import type { CorpusToken } from "@/lib/schema/types";
import { getAyah } from "@/lib/corpus/corpusLoader";
import { SURAH_NAMES } from "@/lib/data/surahData";
import { getNodeColor, resolveVisualizationTheme, SELECTION_RING } from "@/lib/schema/visualizationTypes";
import { getFrequencyColor, getIdentityColor, type LexicalColorMode } from "@/lib/theme/lexicalColoring";
import { useZoom } from "@/lib/hooks/useZoom";
import { useLocale, useTranslations } from "next-intl";
import { VizExplainerDialog, HelpIcon } from "@/components/ui/VizExplainerDialog";
import { useVizControl } from "@/lib/hooks/VizControlContext";
import { motionSafeDuration, motionSafeStagger } from "@/lib/viz/motionPrefs";

interface RadialSuraMapProps {
  tokens: CorpusToken[];
  suraId: number;
  suraName: string;
  suraNameArabic: string;
  onTokenHover: (tokenId: string | null) => void;
  onTokenFocus: (tokenId: string) => void;
  onRootSelect?: (root: string | null) => void;
  highlightRoot?: string | null;
  /**
   * Deep-linked ayah to highlight + frame on entry (e.g. from a home-search
   * verse-carousel click). One-shot: applied once when this surah's geometry
   * lands, then it never fights manual zoom/pan or later selections. Does NOT
   * move the inspector — the caller sets the focused token separately so the
   * SEARCHED word stays inspected, not the ayah's first proclitic.
   */
  focusAyah?: number | null;
  theme?: "light" | "dark";
  lexicalColorMode?: LexicalColorMode;
}



interface AyahBar {
  ayah: number;
  tokenCount: number;
  angle: number;
  barHeight: number;
  dominantPOS: string;
  color: string;
}

interface RootConnection {
  sourceAyah: number;
  targetAyah: number;
  root: string;
  count: number;
  color: string;
}

interface AyahRootEntry {
  root: string;
  count: number;
  globalCount: number;
  lemmas: string[];
}

interface AyahRootNode extends AyahRootEntry {
  x: number;
  y: number;
  r: number;
  labelX: number;
  labelY: number;
  baseColor: string;
}

// Non-matching elements, while a root is highlighted, must stay legible as
// *that POS/root's own hue* — just quieter — rather than flattening to grey.
// Grey would make the legend a lie (on-canvas colors no longer match what the
// legend documents); a desaturated, lower-opacity version of the true hue
// keeps every bar/node reading as "still that part of speech / root" while
// clearly signalling "not the current match".
const DIM_OPACITY = 0.38;
const DIM_SATURATION_RETAIN = 0.4; // keep 40% saturation => ~60% reduction

function dimTone(color: string, opacity: number = DIM_OPACITY): string {
  const hsl = d3.hsl(color);
  hsl.s *= DIM_SATURATION_RETAIN;
  hsl.opacity = opacity;
  return hsl.toString();
}

// ---------------------------------------------------------------------------
// Level of detail: large surahs render one hairline tick per ayah at rest
// instead of the full per-word bars/root-dots/connections. Al-Baqarah's 6,116
// words otherwise produce 10,000+ SVG nodes — slow first paint, sluggish
// hover/zoom, and an illegible hairball of root-connection curves. Detail
// mode (today's full per-word rendering, unchanged) still applies to every
// small surah always, and to ANY surah once the user has deliberately zoomed
// in past the threshold — so nothing changes for Al-Fatihah-sized surahs and
// zooming in on a big surah still reaches the exact same word-level view.
const OVERVIEW_WORD_THRESHOLD = 800;
// Detail (per-ayah bars + root dots + numbers + the full connection web) is
// what makes the graph legible and beautiful, so reach it with a light zoom
// rather than gating it behind a deep dive — earlier feedback was that you had
// to zoom in far just to read ayah numbers/roots and see the wires. Entry
// still fits the ring well below this (~0.3× base for a 286-ayah surah), so
// large surahs open in the cheap overview and only cross into detail on a
// deliberate zoom.
const DETAIL_ZOOM_THRESHOLD = 1.3;
// The connection mesh is NOT zoom-gated: it draws at every zoom level
// (deduped by ayah pair, dominant roots first, capped) so the surah's root
// web is the first thing the overview shows rather than something earned by
// zooming. Only the per-word bars/root dots stay behind DETAIL_ZOOM_THRESHOLD
// — they are the expensive part (10,000+ nodes for Al-Baqarah); a capped
// path mesh is not. Hover/selection emphasis is drawn from the FULL
// connection set on top, so the response is identical at every zoom.
const OVERVIEW_MESH_ARC_CAP = 900;

// Overview shares detail mode's ring geometry (same innerRadius, same per-
// ayah angles) so crossing the zoom threshold swaps tick <-> bar IN PLACE —
// no radial jump, and the content under the cursor stays put. Because that
// density-scaled radius can be several times the canvas for a 286-ayah
// surah, overview is framed by a one-shot fit on entry, and tick geometry is
// expressed as fractions of the ring radius rather than absolute pixels
// (absolute lengths would be invisible at the fitted-out zoom).
const OVERVIEW_TICK_MIN_RATIO = 0.03;
const OVERVIEW_TICK_MAX_RATIO = 0.11;
const OVERVIEW_TICK_MATCH_BONUS_RATIO = 0.03;

// How many neighboring ayahs to frame (in detail geometry) when a single
// overview tick is clicked, so the zoomed-in result reads as "a sector of
// the surah" rather than one isolated bar adrift with no context. Wider =
// gentler landing zoom (the framed box is bigger, so fitBounds picks a
// smaller scale) — tuned per user feedback that the click zoomed too deep.
const OVERVIEW_CLICK_NEIGHBORS = 9;

// Clicking a tick (or a deep-link) must LAND in detail mode: fitBounds derives
// its scale from the framed box, so the box is clamped small enough to force
// the landing past DETAIL_ZOOM_THRESHOLD. NOTE this is a box-sizing knob, not
// the literal landing scale — fitBounds frames within the panel-inset-reduced
// canvas, so the ACTUAL landing settles around ~0.6× of this value (≈1.6× at
// 3.0). Tuned so the sector lands gently into detail — legible numbers/roots/
// wires — without the deep dive that earlier read as overkill.
const OVERVIEW_CLICK_MIN_LANDING_SCALE = 3.0;

export default function RadialSuraMap({
  tokens,
  suraId,
  suraName,
  suraNameArabic,
  onTokenHover,
  onTokenFocus,
  onRootSelect,
  highlightRoot,
  focusAyah,
  theme = "dark",
  lexicalColorMode = "theme",
}: RadialSuraMapProps) {
  const t = useTranslations("Visualizations.RadialSura");
  const ts = useTranslations("Visualizations.Shared");
  const locale = useLocale();
  // Tracking (letter-spacing) visually tears Arabic cursive joins apart, so
  // the eyebrow-style treatment of the center annotation is Latin-only.
  const centerAnnotationSpacing = locale === "ar" ? undefined : "1.5px";
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoomScale, setZoomScale] = useState(1);
  const [isMounted, setIsMounted] = useState(false);
  const { svgRef, gRef, fitToView, fitBounds, zoomBy } = useZoom<SVGSVGElement>({
    minScale: 0.3,
    maxScale: 6,
    ready: isMounted,
    onZoomEnd: (transform) => setZoomScale(transform.k),
  });
  const [showHelp, setShowHelp] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 800, height: 700 });
  const [dimensionsReady, setDimensionsReady] = useState(false);
  const [hoveredRoot, setHoveredRoot] = useState<string | null>(null);
  const [hoveredAyah, setHoveredAyah] = useState<number | null>(null);
  const [selectedAyah, setSelectedAyah] = useState<number | null>(null);
  const [selectedConnection, setSelectedConnection] = useState<RootConnection | null>(null);
  const [hoveredConnection, setHoveredConnection] = useState<RootConnection | null>(null);
  const [fullAyahText, setFullAyahText] = useState<string | null>(null);
  // Hover preview text — the ayah card shows the hovered ayah in full, as if
  // it were clicked; clicking pins it (fullAyahText). Debounced so sweeping
  // the pointer across hundreds of ticks doesn't fire a fetch per tick.
  const [hoverAyahText, setHoverAyahText] = useState<string | null>(null);
  const prevSuraIdRef = useRef<number | null>(null);
  const shouldAnimateConnections = prevSuraIdRef.current === null || prevSuraIdRef.current !== suraId;
  const shouldAnimateBars = shouldAnimateConnections;
  // Captures whether a root was already selected the moment this map first
  // mounted (e.g. a deep link) — see the initial-focus effect below.
  const initialHighlightRootRef = useRef<string | null>(highlightRoot ?? null);
  const hasAppliedInitialFocusRef = useRef(false);



  const { isLeftSidebarOpen } = useVizControl();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    setSelectedConnection(null);
    setSelectedAyah(null);
    setHoveredAyah(null);
    setHoveredRoot(null);
    setHoveredConnection(null);
  }, [suraId]);

  useEffect(() => {
    prevSuraIdRef.current = suraId;
  }, [suraId]);

  useEffect(() => {
    if (selectedAyah) {
      getAyah(suraId, selectedAyah).then(record => {
        if (record) {
          setFullAyahText(record.textUthmani);
        } else {
          setFullAyahText(null);
        }
      });
    } else {
      setFullAyahText(null);
    }
  }, [selectedAyah, suraId]);

  useEffect(() => {
    if (!hoveredAyah || hoveredAyah === selectedAyah) {
      setHoverAyahText(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      getAyah(suraId, hoveredAyah).then((record) => {
        if (!cancelled) setHoverAyahText(record?.textUthmani ?? null);
      });
    }, 90);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hoveredAyah, selectedAyah, suraId]);

  const themeColors = resolveVisualizationTheme(theme);

  // ... displayArabicName useMemo ...

  const displayArabicName = useMemo(() => {
    if (!suraNameArabic) return "";
    if (suraNameArabic.includes("\\u")) {
      return suraNameArabic.replace(/\\u([0-9a-fA-F]{4})/g, (_, code) =>
        String.fromCharCode(parseInt(code, 16))
      );
    }
    return suraNameArabic;
  }, [suraNameArabic]);

  // Process tokens into visualization data
  const {
    ayahBars,
    rootConnections,
    ayahCount,
    rootOccurrences,
    ayahRootCounts,
    ayahRootEntriesByAyah,
    ayahRootMax,
    maxRootsPerAyah,
    rootTokenTotals,
    maxRootTokenCount,
  } = useMemo(() => {
    const ayahTokens = new Map<number, CorpusToken[]>();
    const rootOccurrences = new Map<string, number[]>(); // root -> list of ayahs
    const rootCountsByAyah = new Map<number, Map<string, number>>();
    const rootLemmasByAyah = new Map<number, Map<string, Set<string>>>();
    const rootTokenTotals = new Map<string, number>();

    // Group tokens by ayah
    for (const token of tokens) {
      if (token.sura !== suraId) continue;
      if (!ayahTokens.has(token.ayah)) {
        ayahTokens.set(token.ayah, []);
      }
      ayahTokens.get(token.ayah)!.push(token);

      // Track root occurrences across ayahs
      if (token.root) {
        if (!rootOccurrences.has(token.root)) {
          rootOccurrences.set(token.root, []);
        }
        rootTokenTotals.set(token.root, (rootTokenTotals.get(token.root) ?? 0) + 1);
        const ayahs = rootOccurrences.get(token.root)!;
        if (!ayahs.includes(token.ayah)) {
          ayahs.push(token.ayah);
        }
        if (!rootCountsByAyah.has(token.ayah)) {
          rootCountsByAyah.set(token.ayah, new Map<string, number>());
        }
        const rootCounts = rootCountsByAyah.get(token.ayah)!;
        rootCounts.set(token.root, (rootCounts.get(token.root) ?? 0) + 1);

        if (!rootLemmasByAyah.has(token.ayah)) {
          rootLemmasByAyah.set(token.ayah, new Map<string, Set<string>>());
        }
        const lemmasByRoot = rootLemmasByAyah.get(token.ayah)!;
        if (!lemmasByRoot.has(token.root)) {
          lemmasByRoot.set(token.root, new Set<string>());
        }
        if (token.lemma) {
          lemmasByRoot.get(token.root)!.add(token.lemma);
        }
      }
    }

    const ayahCount = ayahTokens.size || 1;
    const maxTokens = Math.max(...Array.from(ayahTokens.values()).map((t) => t.length), 1);
    const maxRootTokenCount = Math.max(1, ...Array.from(rootTokenTotals.values()));
    const maxByAyah = new Map<number, number>();
    const rootEntriesByAyah = new Map<number, AyahRootEntry[]>();
    let maxRootsPerAyah = 1;
    rootCountsByAyah.forEach((counts, ayahNum) => {
      let max = 1;
      counts.forEach((count) => {
        if (count > max) max = count;
      });
      maxByAyah.set(ayahNum, max);

      const entries = [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([root, count]) => ({
          root,
          count,
          globalCount: rootTokenTotals.get(root) ?? count,
          lemmas: Array.from(rootLemmasByAyah.get(ayahNum)?.get(root) ?? []).sort((a, b) => a.localeCompare(b)),
        }));
      rootEntriesByAyah.set(ayahNum, entries);
      if (entries.length > maxRootsPerAyah) {
        maxRootsPerAyah = entries.length;
      }
    });

    // Create ayah bars
    const bars: AyahBar[] = [];
    ayahTokens.forEach((ayahTokensList, ayahNum) => {
      // Find dominant POS
      const posCount = new Map<string, number>();
      for (const t of ayahTokensList) {
        posCount.set(t.pos, (posCount.get(t.pos) ?? 0) + 1);
      }
      const dominantPOS = [...posCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "N";

      const angle = ((ayahNum - 1) / ayahCount) * 360 - 90; // Start from top
      const rootCountsForAyah = rootCountsByAyah.get(ayahNum);
      const rootVariantCount = rootCountsForAyah?.size ?? 0;

      // Calculate token height based on length relative to max tokens in sura
      const tokenHeight = 60 + (ayahTokensList.length / maxTokens) * 220;

      // Calculate absolute minimum height required to strictly prevent nodes from squashing together
      const minRequiredForRoots = 45 + (rootVariantCount * 24);

      const barHeight = Math.min(450, Math.max(tokenHeight, minRequiredForRoots));

      // Determine if ayah contains the highlighted root
      const containsRoot = highlightRoot
        ? ayahTokensList.some(t => t.root === highlightRoot)
        : false;

      // Adjust color if we are highlighting a root
      let barColor = getNodeColor(dominantPOS);
      let dominantRoot: string | null = null;
      let dominantRootCount = 0;
      if (rootCountsForAyah) {
        rootCountsForAyah.forEach((count, root) => {
          if (count > dominantRootCount) {
            dominantRootCount = count;
            dominantRoot = root;
          }
        });
      }

      if (!highlightRoot && dominantRoot && lexicalColorMode !== "theme") {
        const rootGlobalCount = rootTokenTotals.get(dominantRoot) ?? dominantRootCount;
        const rootRatio = Math.log1p(rootGlobalCount) / Math.log1p(maxRootTokenCount);
        barColor =
          lexicalColorMode === "frequency"
            ? getFrequencyColor(rootRatio, theme)
            : getIdentityColor(dominantRoot, theme);
      }

      if (highlightRoot) {
        barColor = containsRoot
          ? themeColors.accent
          : dimTone(getNodeColor(dominantPOS));
      }

      bars.push({
        ayah: ayahNum,
        tokenCount: ayahTokensList.length,
        angle,
        barHeight,
        dominantPOS,
        color: barColor,
      });
    });

    // Create root connections (when same root appears in multiple ayahs)
    const connections: RootConnection[] = [];
    const processedPairs = new Set<string>();

    rootOccurrences.forEach((ayahs, root) => {
      if (ayahs.length < 2) return;

      // Create connections between consecutive occurrences
      for (let i = 0; i < ayahs.length - 1; i++) {
        const source = ayahs[i];
        const target = ayahs[i + 1];
        const pairKey = `${source}-${target}-${root}`;

        if (!processedPairs.has(pairKey)) {
          processedPairs.add(pairKey);
          const rootGlobalCount = rootTokenTotals.get(root) ?? 1;
          const rootRatio = Math.log1p(rootGlobalCount) / Math.log1p(maxRootTokenCount);
          const connectionColor =
            lexicalColorMode === "frequency"
              ? getFrequencyColor(rootRatio, theme)
              : lexicalColorMode === "identity"
                ? getIdentityColor(root, theme)
                : getNodeColor("N");
          connections.push({
            sourceAyah: source,
            targetAyah: target,
            root,
            count: 1,
            color: connectionColor,
          });
        }
      }
    });

    return {
      ayahBars: bars,
      rootConnections: connections,
      ayahCount,
      uniqueRoots: [...rootOccurrences.keys()],
      rootOccurrences,
      ayahRootCounts: rootCountsByAyah,
      ayahRootEntriesByAyah: rootEntriesByAyah,
      ayahRootMax: maxByAyah,
      maxRootsPerAyah,
      rootTokenTotals,
      maxRootTokenCount,
    };
  }, [tokens, suraId, highlightRoot, themeColors.accent, theme, lexicalColorMode]);

  // Level-of-detail switch: word count decides whether this surah is even a
  // candidate for overview mode; zoom scale decides whether the user has
  // asked to see word-level detail anyway. Re-derived from `ayahBars`
  // (already computed above) rather than threading another value out of the
  // token-processing memo, to keep that memo's shape untouched.
  const totalWordCount = useMemo(
    () => ayahBars.reduce((sum, bar) => sum + bar.tokenCount, 0),
    [ayahBars]
  );
  const isLargeSurah = totalWordCount > OVERVIEW_WORD_THRESHOLD;
  const isOverviewMode = isLargeSurah && zoomScale < DETAIL_ZOOM_THRESHOLD;

  // `tokens` can still be the tiny hardcoded shell sample (a handful of
  // tokens kept around so every surah "looks populated" before its real data
  // arrives) when this surah first mounts — `loadSurahContext` resolves the
  // complete per-surah token set in one atomic update, not progressively,
  // but until that resolves, `ayahBars`/`totalWordCount` reflect only the
  // stub. A large surah whose stub fragment happens to be a couple of short
  // ayahs reads as "small" (`isLargeSurah` false) purely because its real
  // bulk hasn't landed yet. Anything below that commits to `isLargeSurah`'s
  // branch and then locks itself via a ref (the entry-fit and deep-link-
  // focus effects) must wait for this to be true first, or it stays
  // permanently framed for a couple of stray tokens instead of the real,
  // often much larger ring — see the large-surah entry-fit regression this
  // guards against.
  const expectedAyahCount = SURAH_NAMES[suraId]?.verses ?? 0;
  const isSurahDataComplete = expectedAyahCount === 0 || ayahCount >= expectedAyahCount;

  const highlightAyahs = useMemo(() => {
    if (!highlightRoot) return [];
    const list = rootOccurrences.get(highlightRoot) ?? [];
    return [...list].sort((a, b) => a - b);
  }, [highlightRoot, rootOccurrences]);

  const highlightAyahSet = useMemo(() => new Set(highlightAyahs), [highlightAyahs]);
  const activeAyah = selectedAyah ?? hoveredAyah;
  const activeAyahRootCounts = useMemo(() => {
    if (!activeAyah) return null;
    return ayahRootCounts.get(activeAyah) ?? null;
  }, [activeAyah, ayahRootCounts]);
  const activeAyahMaxCount = useMemo(() => {
    if (!activeAyah) return 1;
    return ayahRootMax.get(activeAyah) ?? 1;
  }, [activeAyah, ayahRootMax]);
  const activeRootColorMap = useMemo(() => {
    if (!activeAyahRootCounts) return null;
    const map = new Map<string, string>();
    activeAyahRootCounts.forEach((count, root) => {
      const ratio = activeAyahMaxCount > 0 ? count / activeAyahMaxCount : 0;
      const color =
        lexicalColorMode === "theme"
          ? d3.interpolateTurbo(Math.min(1, Math.max(0.15, ratio)))
          : lexicalColorMode === "frequency"
            ? getFrequencyColor(Math.log1p(rootTokenTotals.get(root) ?? count) / Math.log1p(maxRootTokenCount), theme)
            : getIdentityColor(root, theme);
      map.set(root, color);
    });
    return map;
  }, [activeAyahRootCounts, activeAyahMaxCount, lexicalColorMode, rootTokenTotals, maxRootTokenCount, theme]);

  const { ayahTokenIdByAyah, ayahTokenIdByAyahRoot } = useMemo(() => {
    const byAyah = new Map<number, string>();
    const byAyahRoot = new Map<string, string>();

    for (const token of tokens) {
      if (token.sura !== suraId) continue;
      if (!byAyah.has(token.ayah)) {
        byAyah.set(token.ayah, token.id);
      }
      if (token.root) {
        const key = `${token.ayah}::${token.root}`;
        if (!byAyahRoot.has(key)) {
          byAyahRoot.set(key, token.id);
        }
      }
    }

    return {
      ayahTokenIdByAyah: byAyah,
      ayahTokenIdByAyahRoot: byAyahRoot,
    };
  }, [tokens, suraId]);

  const getRootBaseColor = useCallback((root: string, globalCount: number) => {
    if (lexicalColorMode === "frequency") {
      const ratio = Math.log1p(globalCount) / Math.log1p(maxRootTokenCount);
      return getFrequencyColor(ratio, theme);
    }
    return getIdentityColor(root, theme);
  }, [lexicalColorMode, maxRootTokenCount, theme]);

  // Update dimensions on resize
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setDimensions({
          width: Math.max(width, 600),
          height: Math.max(height, 600),
        });
        setDimensionsReady(true);
      }
    });

    observer.observe(containerRef.current);

    // Initial check
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setDimensions({
        width: Math.max(rect.width, 600),
        height: Math.max(rect.height, 600),
      });
      setDimensionsReady(true);
    }

    return () => observer.disconnect();
  }, []);

  const centerX = dimensions.width / 2;
  const centerY = dimensions.height / 2;
  const minDimension = Math.min(dimensions.width, dimensions.height);
  const maxBarHeight = useMemo(
    () => Math.max(24, ...ayahBars.map((bar) => bar.barHeight)),
    [ayahBars]
  );
  const desiredArcSpacing = 16.0 + Math.min(6.0, maxRootsPerAyah * 0.4);
  const radiusForAyahDensity = (ayahCount * desiredArcSpacing) / (2 * Math.PI);
  const outerPadding = 80;
  const maxInnerFromCanvas = Math.max(100, minDimension / 2 - maxBarHeight - outerPadding);
  const baseInnerRadius = minDimension * 0.35;
  const desiredInnerRadius = Math.max(baseInnerRadius, radiusForAyahDensity);

  // By omitting the maxInnerFromCanvas clamp, we allow dense suras to scale up past screen boundaries, using zoom map layout
  const innerRadius = Math.max(maxInnerFromCanvas, desiredInnerRadius);
  const radiansPerAyah = (2 * Math.PI) / Math.max(ayahCount, 1);
  const arcSpacing = innerRadius * radiansPerAyah;
  const compactLayout = arcSpacing < 10.0;
  const barStrokeWidth = compactLayout ? 2.4 : arcSpacing < 14 ? 3.0 : 3.6;
  const endpointRadius = compactLayout ? 3.6 : 5.0;
  const rootDetailLevel = zoomScale >= 2.0 ? 3 : zoomScale >= 1.0 ? 2 : 1;
  const maxRootsPerAyahVisible =
    rootDetailLevel === 1
      ? compactLayout
        ? 2
        : 3
      : rootDetailLevel === 2
        ? compactLayout
          ? 4
          : 6
        : Number.POSITIVE_INFINITY;
  const showContextRootLabels = rootDetailLevel >= 2;
  const showAllRootLabels = rootDetailLevel >= 3;

  // Generate arc path for connections
  const generateConnectionPath = useCallback(
    (source: number, target: number) => {
      const sourceAngle = ((source - 1) / ayahCount) * 2 * Math.PI - Math.PI / 2;
      const targetAngle = ((target - 1) / ayahCount) * 2 * Math.PI - Math.PI / 2;

      const sourceX = centerX + Math.cos(sourceAngle) * innerRadius;
      const sourceY = centerY + Math.sin(sourceAngle) * innerRadius;
      const targetX = centerX + Math.cos(targetAngle) * innerRadius;
      const targetY = centerY + Math.sin(targetAngle) * innerRadius;

      // Calculate control point for bezier curve (inside the circle)
      const midAngle = (sourceAngle + targetAngle) / 2;
      const angleDiff = Math.abs(targetAngle - sourceAngle);
      const curveDepth = innerRadius * (0.3 + angleDiff * 0.15);

      const controlX = centerX + Math.cos(midAngle) * (innerRadius - curveDepth);
      const controlY = centerY + Math.sin(midAngle) * (innerRadius - curveDepth);

      return `M ${sourceX} ${sourceY} Q ${controlX} ${controlY} ${targetX} ${targetY}`;
    },
    [centerX, centerY, innerRadius, ayahCount]
  );

  // Every ayah pair's arc geometry, shared by the detail mesh and the
  // overview layers. Deduped by pair — one curve serves every root that
  // links those two ayahs.
  const connectionPaths = useMemo(() => {
    const map = new Map<string, string>();
    rootConnections.forEach((conn) => {
      const key = `${conn.sourceAyah}-${conn.targetAyah}`;
      if (!map.has(key)) {
        map.set(key, generateConnectionPath(conn.sourceAyah, conn.targetAyah));
      }
    });
    return map;
  }, [rootConnections, generateConnectionPath]);

  // Overview highlight arcs — the highlighted root's ayah-to-ayah web, drawn
  // even at the zoomed-out level (deduped by ayah pair; plain paths, no
  // hover/animation, so a 200-arc worst case stays cheap).
  const overviewHighlightConnections = useMemo(() => {
    if (!isOverviewMode || !highlightRoot) return [];
    const seen = new Set<string>();
    // Carry a representative connection per ayah-pair so the overview arcs are
    // clickable (select/hover) exactly like the detail-mode ones.
    const out: { key: string; d: string; conn: RootConnection }[] = [];
    rootConnections.forEach((conn) => {
      if (conn.root !== highlightRoot) return;
      const key = `${conn.sourceAyah}-${conn.targetAyah}`;
      if (seen.has(key)) return;
      seen.add(key);
      const d = connectionPaths.get(key);
      if (d) out.push({ key, d, conn });
    });
    return out;
  }, [isOverviewMode, highlightRoot, rootConnections, connectionPaths]);

  // Overview mesh for every other root, at EVERY zoom level (no stage
  // gating): deduped by ayah pair, dominant roots first so the cap keeps the
  // arcs that matter, capped so the densest surahs can't flood the
  // fitted-out view with thousands of paths.
  const overviewMeshConnections = useMemo(() => {
    if (!isOverviewMode) return [];
    const ordered = [...rootConnections].sort(
      (a, b) => (rootTokenTotals.get(b.root) ?? 0) - (rootTokenTotals.get(a.root) ?? 0)
    );
    const seen = new Set<string>();
    const out: { key: string; d: string; conn: RootConnection }[] = [];
    for (const conn of ordered) {
      if (conn.root === highlightRoot) continue;
      const key = `${conn.sourceAyah}-${conn.targetAyah}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const d = connectionPaths.get(key);
      if (d) {
        out.push({ key, d, conn });
        if (out.length >= OVERVIEW_MESH_ARC_CAP) break;
      }
    }
    return out;
  }, [isOverviewMode, rootConnections, rootTokenTotals, highlightRoot, connectionPaths]);

  // Overview hover/selection emphasis: the hovered root's arcs and the
  // active (hovered or selected) ayah's arcs, drawn on top of the mesh from
  // the FULL connection set — an arc the cap dropped still lights up when
  // its root or ayah is pointed at, so hovering behaves the same zoomed out
  // as in detail. Small by construction (one root, one ayah).
  const overviewEmphasisConnections = useMemo(() => {
    if (!isOverviewMode || (!hoveredRoot && !activeAyah)) return [];
    const seen = new Set<string>();
    const out: { key: string; d: string; conn: RootConnection; byRoot: boolean }[] = [];
    for (const conn of rootConnections) {
      const byRoot = !!hoveredRoot && conn.root === hoveredRoot;
      const byAyah =
        !!activeAyah && (conn.sourceAyah === activeAyah || conn.targetAyah === activeAyah);
      if (!byRoot && !byAyah) continue;
      const key = `${conn.sourceAyah}-${conn.targetAyah}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const d = connectionPaths.get(key);
      if (d) out.push({ key, d, conn, byRoot });
    }
    return out;
  }, [isOverviewMode, hoveredRoot, activeAyah, rootConnections, connectionPaths]);

  const barsWithGeometry = useMemo(() => {
    return ayahBars.map((bar) => {
      const angleRad = (bar.angle * Math.PI) / 180;
      const startX = centerX + Math.cos(angleRad) * innerRadius;
      const startY = centerY + Math.sin(angleRad) * innerRadius;
      const endX = centerX + Math.cos(angleRad) * (innerRadius + bar.barHeight);
      const endY = centerY + Math.sin(angleRad) * (innerRadius + bar.barHeight);
      const rootEntries = ayahRootEntriesByAyah.get(bar.ayah) ?? [];
      const maxCountForAyah = ayahRootMax.get(bar.ayah) ?? 1;
      const minNodeRadius = compactLayout ? 2.8 : 3.8;
      const maxNodeRadius = compactLayout ? 6.0 : 8.5;
      const rootRadiusScale = d3
        .scaleSqrt<number, number>()
        .domain([1, Math.max(1, maxCountForAyah)])
        .range([minNodeRadius, maxNodeRadius]);

      const rootStartPadding = Math.min(32, Math.max(16, bar.barHeight * 0.20));
      const rootEndPadding = Math.min(24, Math.max(14, bar.barHeight * 0.15));
      const rootBandLength = Math.max(15, bar.barHeight - rootStartPadding - rootEndPadding);
      const rootNodes: AyahRootNode[] = rootEntries.map((entry, index) => {
        const positionRatio =
          rootEntries.length <= 1 ? 0.6 : (index + 1) / (rootEntries.length + 1);
        const distance = rootStartPadding + rootBandLength * positionRatio;
        const x = startX + Math.cos(angleRad) * distance;
        const y = startY + Math.sin(angleRad) * distance;
        const r = rootRadiusScale(entry.count);
        const labelOffset = r + 3;

        // Alternate perpendicular offset so texts don't stack directly on top of each other
        const flip = index % 2 === 0 ? 1 : -1;
        const perpOffset = rootEntries.length > 1 ? flip * (r + 4.5) : 0;
        const pX = Math.cos(angleRad + Math.PI / 2);
        const pY = Math.sin(angleRad + Math.PI / 2);

        return {
          ...entry,
          x,
          y,
          r,
          labelX: x + Math.cos(angleRad) * labelOffset + pX * perpOffset,
          labelY: y + Math.sin(angleRad) * (labelOffset + 0.5) + pY * perpOffset,
          baseColor: getRootBaseColor(entry.root, entry.globalCount),
        };
      });

      return { bar, angleRad, startX, startY, endX, endY, rootNodes };
    });
  }, [ayahBars, centerX, centerY, innerRadius, ayahRootEntriesByAyah, ayahRootMax, compactLayout, getRootBaseColor]);

  const barsGeometryByAyah = useMemo(() => {
    const map = new Map<number, (typeof barsWithGeometry)[number]>();
    barsWithGeometry.forEach((entry) => map.set(entry.bar.ayah, entry));
    return map;
  }, [barsWithGeometry]);

  // Overview-mode geometry: one short radial tick per ayah, anchored at the
  // exact same (startX, startY, angleRad) as that ayah's detail-mode bar so
  // the ring's size/position never jumps when a mode swap is triggered by
  // crossing the zoom threshold — only the per-ayah marker changes. Tick
  // length encodes word count; color reuses `bar.color`, which already
  // resolves POS / dominant-root / highlighted-root-accent exactly as detail
  // mode does, so the two modes can never disagree about what a color means.
  const overviewTicks = useMemo(() => {
    if (barsWithGeometry.length === 0) return [];
    const maxTokensInSurah = Math.max(1, ...ayahBars.map((bar) => bar.tokenCount));
    const tickMin = innerRadius * OVERVIEW_TICK_MIN_RATIO;
    const tickMax = innerRadius * OVERVIEW_TICK_MAX_RATIO;
    const matchBonus = innerRadius * OVERVIEW_TICK_MATCH_BONUS_RATIO;
    // Match ticks scale with how OFTEN the highlighted root occurs in that
    // ayah (not a flat bonus) so overview already answers "where is it
    // dense?" without zooming.
    let maxMatchCount = 1;
    if (highlightRoot) {
      for (const ayah of highlightAyahSet) {
        maxMatchCount = Math.max(maxMatchCount, ayahRootCounts.get(ayah)?.get(highlightRoot) ?? 0);
      }
    }
    return barsWithGeometry.map(({ bar, angleRad, startX, startY }) => {
      const ratio = bar.tokenCount / maxTokensInSurah;
      const isMatch = highlightAyahSet.has(bar.ayah);
      const matchCount = isMatch && highlightRoot
        ? ayahRootCounts.get(bar.ayah)?.get(highlightRoot) ?? 1
        : 0;
      const matchScale = isMatch ? 0.45 + 0.55 * (matchCount / maxMatchCount) : 0;
      const length = tickMin + ratio * (tickMax - tickMin) + matchBonus * matchScale;
      return {
        ayah: bar.ayah,
        tokenCount: bar.tokenCount,
        angleRad,
        startX,
        startY,
        endX: startX + Math.cos(angleRad) * length,
        endY: startY + Math.sin(angleRad) * length,
        color: bar.color,
        isMatch,
      };
    });
  }, [barsWithGeometry, ayahBars, highlightAyahSet, innerRadius, highlightRoot, ayahRootCounts]);

  const overviewTicksByAyah = useMemo(() => {
    const map = new Map<number, (typeof overviewTicks)[number]>();
    overviewTicks.forEach((tick) => map.set(tick.ayah, tick));
    return map;
  }, [overviewTicks]);

  // Deep-linked entry can mount with `highlightRoot` already set — hydrated
  // from the URL before this surah's tokens (and their root/morphology data,
  // which streams in *after* the base token structure) have fully landed.
  // The ring's geometry is correct as soon as real positions exist, but the
  // camera is left at its default transform; when a highlighted root only
  // touches one or two ayahs (as in a small surah), that can leave the one
  // thing worth seeing pinned near — or past — the viewport edge, while
  // every other ayah is dimmed to near invisibility.
  //
  // Once the highlighted root actually resolves to real ayah positions, snap
  // the camera to frame the full ring plus whichever ayahs contain it — but
  // only once, so it never fights the Focus button or manual zoom/pan
  // afterwards, and normal entry (no initial highlight) never moves the
  // camera at all. Until the root resolves to at least one ayah, keep
  // retrying on each data update rather than committing early — root data
  // can still be streaming in even after the ayah bars themselves exist.
  useEffect(() => {
    if (hasAppliedInitialFocusRef.current) return;
    if (!dimensionsReady || !isMounted) return;

    const initialRoot = initialHighlightRootRef.current;
    if (!initialRoot) {
      hasAppliedInitialFocusRef.current = true;
      return;
    }

    const currentRoot = highlightRoot ?? null;
    if (currentRoot !== initialRoot) {
      // Selection already moved on from the deep-linked root — abandon the
      // one-time correction rather than act on stale intent.
      hasAppliedInitialFocusRef.current = true;
      return;
    }

    if (barsWithGeometry.length === 0) return; // this surah's tokens haven't landed yet
    if (!isSurahDataComplete) return; // stub/shell data — isLargeSurah below isn't trustworthy yet

    const targetAyahs = highlightAyahSet.size > 0 ? highlightAyahSet : null;
    if (!targetAyahs) return; // root hasn't resolved to an ayah yet — keep waiting, don't mark handled

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    // Large surahs sit in overview mode at this point (zoomScale is still at
    // its initial value), so frame the short TICK geometry that's actually
    // on screen — the full detail-bar extents (up to hundreds of px longer)
    // would fit a much looser, emptier shot around ticks that aren't drawn.
    // Small surahs keep the exact original bar+root-node bounds untouched.
    if (isLargeSurah) {
      for (const ayah of targetAyahs) {
        const tick = overviewTicksByAyah.get(ayah);
        if (!tick) continue;
        minX = Math.min(minX, tick.startX, tick.endX);
        maxX = Math.max(maxX, tick.startX, tick.endX);
        minY = Math.min(minY, tick.startY, tick.endY);
        maxY = Math.max(maxY, tick.startY, tick.endY);
      }
    } else {
      for (const entry of barsWithGeometry) {
        if (!targetAyahs.has(entry.bar.ayah)) continue;
        minX = Math.min(minX, entry.startX, entry.endX);
        maxX = Math.max(maxX, entry.startX, entry.endX);
        minY = Math.min(minY, entry.startY, entry.endY);
        maxY = Math.max(maxY, entry.startY, entry.endY);
        for (const node of entry.rootNodes) {
          minX = Math.min(minX, node.x - node.r);
          maxX = Math.max(maxX, node.x + node.r);
          minY = Math.min(minY, node.y - node.r);
          maxY = Math.max(maxY, node.y + node.r);
        }
      }
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      return;
    }

    // Keep the whole orbit ring in frame too, so this reads as "the ring,
    // with the match highlighted" rather than an isolated fragment adrift
    // with no context.
    minX = Math.min(minX, centerX - innerRadius);
    minY = Math.min(minY, centerY - innerRadius);
    maxX = Math.max(maxX, centerX + innerRadius);
    maxY = Math.max(maxY, centerY + innerRadius);

    hasAppliedInitialFocusRef.current = true;
    fitBounds(
      { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) },
      // More breathing room than the manual Focus button's default (0.88):
      // this fires automatically, with no user-driven feedback loop to
      // correct it, and the canvas's own bottom edge sits partly behind the
      // app's fixed viz toolbar/footer chrome — a tighter fit can still land
      // the highlighted node right underneath it.
      { padding: 0.6, duration: 0 }
    );
  }, [dimensionsReady, isMounted, barsWithGeometry, highlightAyahSet, highlightRoot, centerX, centerY, innerRadius, fitBounds, isLargeSurah, isSurahDataComplete, overviewTicksByAyah]);

  // Every surah needs a one-shot "frame the ring" on entry, because the
  // default camera (scale 1, translate 0,0 — see useZoom's initial
  // transform) has no idea how big this surah's geometry actually is:
  // - Large surahs' density-scaled innerRadius intentionally overflows the
  //   canvas (detail mode is a zoom-map), so at the default transform the
  //   whole tick ring sits off-screen and overview mode would show nothing
  //   but the center label.
  // - Every other surah renders full detail geometry (bars + outer
  //   ayah-number labels) from the start, and that combined extent commonly
  //   exceeds the canvas too — e.g. even Al-Fatihah's ring, at scale 1,
  //   overflowed on every edge (cropped on all sides) before this ran for
  //   small surahs too.
  // Runs once per surah, as soon as geometry exists — i.e. before the user
  // could meaningfully interact. Declared AFTER the deep-link focus effect
  // above so that when a deep-linked root has already resolved and framed
  // its own (tighter, ring-inclusive) shot in the same commit, this effect
  // sees that and stands down instead of overriding it.
  const entryFitSuraRef = useRef<number | null>(null);
  useEffect(() => {
    if (!dimensionsReady || !isMounted) return;
    if (entryFitSuraRef.current === suraId) return;
    if (barsWithGeometry.length === 0) return; // tokens haven't landed yet

    if (initialHighlightRootRef.current && hasAppliedInitialFocusRef.current) {
      // The deep-link fit already framed ring + matching ticks; keep it.
      entryFitSuraRef.current = suraId;
      return;
    }

    // Stub/shell data (see isSurahDataComplete above) makes `isLargeSurah`
    // unreliable — wait for this surah's real token set before committing to
    // (and locking, via entryFitSuraRef) a branch, or a large surah whose
    // shell fragment reads as tiny gets permanently framed for that tiny
    // fragment once its real ~thousands-of-words geometry lands.
    if (!isSurahDataComplete) return;

    entryFitSuraRef.current = suraId;

    if (isLargeSurah) {
      // Unchanged from before small-surah support: overview mode's short
      // ticks are the only thing outside the ring at this zoom, so frame
      // ring + max tick length exactly as before.
      const tickExtent =
        innerRadius * (1 + OVERVIEW_TICK_MAX_RATIO + OVERVIEW_TICK_MATCH_BONUS_RATIO);
      fitBounds(
        {
          x: centerX - tickExtent,
          y: centerY - tickExtent,
          width: tickExtent * 2,
          height: tickExtent * 2,
        },
        { padding: 0.85, duration: 0 }
      );
      return;
    }

    // Detail-mode geometry (every non-large surah, always): frame ring +
    // longest bar + the outer ayah-number label band — the same radial
    // offset the label render uses below (innerRadius + barHeight + 14/18) —
    // with a tighter ~10% margin, so the whole ring reliably lands inside
    // the canvas instead of at the previous default scale-1 transform.
    const labelBand = compactLayout ? 14 : 18;
    const detailExtent = innerRadius + maxBarHeight + labelBand;
    fitBounds(
      {
        x: centerX - detailExtent,
        y: centerY - detailExtent,
        width: detailExtent * 2,
        height: detailExtent * 2,
      },
      { padding: 0.9, duration: 0 }
    );
  }, [dimensionsReady, isMounted, isLargeSurah, isSurahDataComplete, suraId, barsWithGeometry, innerRadius, centerX, centerY, fitBounds, maxBarHeight, compactLayout]);

  // The ayah card previews whatever is under the pointer and falls back to
  // the pinned (clicked) ayah when the pointer leaves — hover shows the ayah
  // exactly as a click would, the click only makes it stick.
  const previewAyah = hoveredAyah ?? selectedAyah;
  const isPreviewPinned = previewAyah !== null && previewAyah === selectedAyah;
  const previewAyahData = useMemo(
    () => (previewAyah ? ayahBars.find((bar) => bar.ayah === previewAyah) ?? null : null),
    [previewAyah, ayahBars]
  );
  const previewAyahRootEntries = useMemo(() => {
    if (!previewAyah) return [];
    return ayahRootEntriesByAyah.get(previewAyah) ?? [];
  }, [previewAyah, ayahRootEntriesByAyah]);
  const previewAyahText = isPreviewPinned ? fullAyahText : hoverAyahText;

  const renderedConnections = useMemo(() => {
    // Keep every root's connections in view even while a root is highlighted —
    // dimming (not hiding) the non-matching ones so the surah's overall
    // connective structure stays legible instead of vanishing behind a single
    // isolated arc. See the per-connection opacity logic in the render loop.
    return rootConnections.filter((conn) => {
      if (selectedAyah && conn.sourceAyah !== selectedAyah && conn.targetAyah !== selectedAyah) return false;
      return true;
    });
  }, [rootConnections, selectedAyah]);

  const barsForRender = useMemo(() => {
    return barsWithGeometry.map((entry) => {
      const isFocusedAyah =
        entry.bar.ayah === selectedAyah ||
        entry.bar.ayah === hoveredAyah ||
        highlightAyahSet.has(entry.bar.ayah);

      let visibleRootNodes = entry.rootNodes;
      if (!isFocusedAyah && Number.isFinite(maxRootsPerAyahVisible)) {
        visibleRootNodes = entry.rootNodes.slice(0, maxRootsPerAyahVisible);
      }

      if (highlightRoot) {
        const highlightedNode = entry.rootNodes.find((node) => node.root === highlightRoot);
        if (highlightedNode && !visibleRootNodes.some((node) => node.root === highlightRoot)) {
          visibleRootNodes = [...visibleRootNodes, highlightedNode];
        }
      }

      return {
        ...entry,
        isFocusedAyah,
        visibleRootNodes,
      };
    });
  }, [barsWithGeometry, selectedAyah, hoveredAyah, highlightAyahSet, maxRootsPerAyahVisible, highlightRoot]);

  const handleAyahSelect = useCallback((ayah: number, preferredRoot?: string) => {
    setSelectedAyah(ayah);
    // Focus a word so the inspector has content: the explicitly chosen root
    // first, else the PINNED root's word in this ayah (so pinning اذن and
    // clicking an ayah that contains it inspects that occurrence, not the
    // ayah's first proclitic), else the ayah's first word. The pinned root
    // itself never changes here — see useSelectionState.selectedRootValue.
    const root = preferredRoot ?? highlightRoot ?? null;
    const tokenId =
      (root ? ayahTokenIdByAyahRoot.get(`${ayah}::${root}`) : undefined) ??
      ayahTokenIdByAyah.get(ayah);
    if (tokenId) onTokenFocus(tokenId);
  }, [ayahTokenIdByAyahRoot, ayahTokenIdByAyah, onTokenFocus, highlightRoot]);

  // Zoom the camera into an ayah's neighborhood in DETAIL geometry (a handful
  // of neighboring ayahs, not one isolated bar) — reused by both the overview
  // tick-click and the deep-link one-shot focus. Pure camera move: no
  // selection/inspector side effects, so a deep link can drive it without
  // clobbering the caller's focused token.
  const zoomToAyah = useCallback((ayah: number, duration: number) => {
    if (ayahCount <= 0) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let offset = -OVERVIEW_CLICK_NEIGHBORS; offset <= OVERVIEW_CLICK_NEIGHBORS; offset++) {
      const neighborAyah = (((ayah - 1 + offset) % ayahCount) + ayahCount) % ayahCount + 1;
      const entry = barsGeometryByAyah.get(neighborAyah);
      if (!entry) continue;
      minX = Math.min(minX, entry.startX, entry.endX);
      maxX = Math.max(maxX, entry.startX, entry.endX);
      minY = Math.min(minY, entry.startY, entry.endY);
      maxY = Math.max(maxY, entry.startY, entry.endY);
      for (const node of entry.rootNodes) {
        minX = Math.min(minX, node.x - node.r);
        maxX = Math.max(maxX, node.x + node.r);
        minY = Math.min(minY, node.y - node.r);
        maxY = Math.max(maxY, node.y + node.r);
      }
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return;

    // fitBounds picks scale = padding * min(vw/boxW, vh/boxH); clamp the box
    // (shrinking symmetrically around the clicked sector's center) so the
    // landing scale can't fall short of the detail threshold and strand the
    // user in overview after an explicit "zoom into this ayah" gesture. The
    // longest bars may crop at the landing zoom; one wheel notch reveals them.
    const clickPadding = 0.7;
    let boxW = Math.max(1, maxX - minX);
    let boxH = Math.max(1, maxY - minY);
    const maxW = (clickPadding * dimensions.width) / OVERVIEW_CLICK_MIN_LANDING_SCALE;
    const maxH = (clickPadding * dimensions.height) / OVERVIEW_CLICK_MIN_LANDING_SCALE;
    if (boxW > maxW) {
      const cx = (minX + maxX) / 2;
      minX = cx - maxW / 2;
      boxW = maxW;
    }
    if (boxH > maxH) {
      const cy = (minY + maxY) / 2;
      minY = cy - maxH / 2;
      boxH = maxH;
    }

    fitBounds(
      { x: minX, y: minY, width: boxW, height: boxH },
      { padding: clickPadding, duration }
    );
  }, [ayahCount, barsGeometryByAyah, fitBounds, dimensions.width, dimensions.height]);

  // Clicking an overview tick both selects that ayah (same as clicking a
  // detail-mode bar) and zooms into its neighborhood so the landing scale
  // reliably clears DETAIL_ZOOM_THRESHOLD.
  const handleOverviewTickSelect = useCallback((ayah: number) => {
    handleAyahSelect(ayah);
    zoomToAyah(ayah, motionSafeDuration(750));
  }, [handleAyahSelect, zoomToAyah]);

  // Deep-link one-shot: a `focusAyah` (e.g. a home-search verse-carousel click
  // routed as ?surah=&ayah=&token=) highlights that ayah in the graph AND
  // frames the camera on it. Runs once, when this surah's real geometry lands.
  // Deliberately does NOT call onTokenFocus: the deep link already set the
  // focused token to the SEARCHED word, and re-focusing here would replace it
  // with the ayah's representative token (back to an irrelevant proclitic).
  const hasAppliedInitialAyahFocusRef = useRef(false);
  useEffect(() => {
    if (hasAppliedInitialAyahFocusRef.current) return;
    if (!dimensionsReady || !isMounted) return;
    if (focusAyah == null) return; // nothing to focus (or not yet resolved)
    if (barsWithGeometry.length === 0) return; // this surah's tokens haven't landed
    if (!isSurahDataComplete) return; // stub/shell data — isLargeSurah not trustworthy
    if (!barsGeometryByAyah.has(focusAyah)) return; // target ayah's geometry not built yet

    hasAppliedInitialAyahFocusRef.current = true;
    // Stand down BOTH entry-focus effects: this ayah owns the camera. Setting
    // hasAppliedInitialFocusRef blocks the root-focus effect; setting
    // entryFitSuraRef to this surah blocks the "frame the whole ring" entry
    // fit — otherwise, depending on which commit each fires in as the corpus
    // streams, that ring fit can land AFTER this and clobber the ayah zoom
    // (the landing scale was flaky between runs for exactly this reason).
    hasAppliedInitialFocusRef.current = true;
    entryFitSuraRef.current = suraId;
    setSelectedAyah(focusAyah);
    // Large surahs sit in overview at entry — zoom in so the highlighted ayah
    // is actually legible. Small surahs already render the full detail ring
    // (framed by the entry-fit effect), so the selection highlight alone reads.
    if (isLargeSurah) zoomToAyah(focusAyah, 0);
  }, [
    focusAyah,
    dimensionsReady,
    isMounted,
    barsWithGeometry,
    isSurahDataComplete,
    isLargeSurah,
    barsGeometryByAyah,
    zoomToAyah,
  ]);

  // Overview hover/click hit-testing happens on ONE invisible annulus over
  // the tick band (rather than 286 separate fattened hit targets): the
  // pointer's angle around the ring identifies the ayah directly, and
  // `d3.pointer` inverts the live zoom transform for us. Cheaper to render,
  // and a far more forgiving target than 1-2px hairlines.
  const lastPointerAyahRef = useRef<number | null>(null);
  const ayahFromPointerEvent = useCallback((event: MouseEvent<SVGCircleElement>): number | null => {
    const g = gRef.current;
    if (!g || ayahCount <= 0) return null;
    const [x, y] = d3.pointer(event.nativeEvent, g);
    const angle = Math.atan2(y - centerY, x - centerX); // ayah 1 sits at -PI/2
    const normalized = (angle + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
    const index = Math.round(normalized / ((Math.PI * 2) / ayahCount)) % ayahCount;
    const ayah = index + 1;
    return overviewTicksByAyah.has(ayah) ? ayah : null;
  }, [gRef, ayahCount, centerX, centerY, overviewTicksByAyah]);

  const handleBarHover = useCallback((ayah: number | null) => {
    setHoveredAyah((prev) => (prev === ayah ? prev : ayah));
    if (ayah) {
      const tokenId = ayahTokenIdByAyah.get(ayah);
      if (tokenId) onTokenHover(tokenId);
    } else {
      onTokenHover(null);
    }
  }, [ayahTokenIdByAyah, onTokenHover]);

  // The overview hit ring unmounts on the tick -> bar swap (and vice versa)
  // without firing pointerleave, which left the hovered ayah stuck on the
  // card after a click-to-zoom. Reset hover on every LOD change; the new
  // layer's own enter events take over as soon as the pointer moves.
  useEffect(() => {
    lastPointerAyahRef.current = null;
    setHoveredAyah(null);
    setHoveredRoot(null);
    onTokenHover(null);
  }, [isOverviewMode, onTokenHover]);

  const handleRootNodeHover = useCallback((ayah: number | null, root: string | null) => {
    setHoveredRoot((prev) => (prev === root ? prev : root));
    handleBarHover(ayah);
  }, [handleBarHover]);

  const handleConnectionHover = (connection: RootConnection | null) => {
    setHoveredConnection(connection);
    setHoveredRoot(connection?.root ?? null);
  };

  const handleConnectionSelect = (event: MouseEvent<SVGPathElement>, connection: RootConnection) => {
    event.preventDefault();
    event.stopPropagation();
    const isSameSelection =
      selectedConnection?.root === connection.root &&
      selectedConnection?.sourceAyah === connection.sourceAyah &&
      selectedConnection?.targetAyah === connection.targetAyah;

    if (isSameSelection) {
      // Toggle the wire off; the root stays pinned (see the canvas onClick).
      setSelectedConnection(null);
      return;
    }

    setSelectedConnection(connection);
    if (onRootSelect) onRootSelect(connection.root);
  };

  const handleRootNodeSelect = (
    event: MouseEvent<SVGCircleElement | SVGTextElement>,
    ayah: number,
    root: string
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedConnection(null);
    setHoveredConnection(null);
    setHoveredRoot(root);
    if (onRootSelect) onRootSelect(root);
    handleAyahSelect(ayah, root);
  };

  const handleZoomStep = useCallback((factor: number) => {
    zoomBy(factor);
  }, [zoomBy]);

  const formatLemmaLabel = useCallback((lemmas: string[]) => {
    if (lemmas.length === 0) return "";
    const preview = lemmas.slice(0, 3);
    const remainder = lemmas.length - preview.length;
    return remainder > 0 ? `${preview.join(" · ")} +${remainder}` : preview.join(" · ");
  }, []);

  const allowConnectionAnimation = shouldAnimateConnections && renderedConnections.length <= 280;
  const allowBarAnimation = shouldAnimateBars && ayahCount <= 120;

  return (
    <section className="panel" data-theme={theme} style={{ width: "100%", height: "100%", position: "relative" }}>
      {isMounted && document.getElementById('viz-sidebar-portal') && createPortal(
        <>


          <div className={`viz-left-stack ${!isLeftSidebarOpen ? 'collapsed' : ''}`}>
            {/* Zoom controls */}
            <div className="viz-left-panel viz-zoom-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="eyebrow" style={{ fontSize: '0.7em' }}>{ts('zoom')}</span>
                <span style={{ fontSize: '0.72em', opacity: 0.6, fontVariantNumeric: 'tabular-nums' }}>{Math.round(zoomScale * 100)}%</span>
              </div>
              <div className="viz-zoom-row">
                <button
                  type="button"
                  className="viz-zoom-btn"
                  onClick={() => handleZoomStep(1.3)}
                  aria-label={t('zoomIn')}
                >
                  +
                </button>
                <button
                  type="button"
                  className="viz-zoom-btn"
                  onClick={() => handleZoomStep(0.75)}
                  aria-label={t('zoomOut')}
                >
                  &minus;
                </button>
                <button type="button" className="viz-zoom-reset-btn" onClick={() => fitToView()}>
                  {ts('focus')}
                </button>
              </div>
              <span style={{ fontSize: '0.65em', opacity: 0.45, marginTop: 4, display: 'block' }}>
                {t('dragPan')}
              </span>
            </div>

            {/* Ayah card (hover preview / pinned) sits ABOVE Selected Root:
                the ayah is the more specific thing under the pointer, so it
                leads the stack. */}
            <AnimatePresence>
              {previewAyahData && (
                <motion.div
                  className="viz-left-panel"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  transition={{ duration: motionSafeDuration(200) / 1000 }}
                >
                  <div className="viz-tooltip-title">{ts("ayahCaps")} {previewAyah}</div>
                  <div className="viz-tooltip-subtitle">{suraName}:{previewAyah}</div>
                  <div className="viz-tooltip-subtitle" style={{ opacity: 0.7, fontSize: "0.72rem" }}>
                    {isPreviewPinned ? t("ayahPinned") : t("ayahHoverHint")}
                  </div>

                  {previewAyahText && (
                    <div className="viz-tooltip-subtitle arabic-text" style={{
                      marginTop: '0.5rem',
                      fontSize: '1.4rem',
                      lineHeight: '1.6',
                      textAlign: 'right',
                      direction: 'rtl',
                      width: '100%',
                      color: 'var(--ink)',
                      paddingBottom: '0.5rem',
                      borderBottom: '1px solid var(--line)'
                    }}>
                      {previewAyahText}
                    </div>
                  )}
                  <div className="viz-tooltip-row">
                    <span className="viz-tooltip-label">{ts("occurrences")}</span>
                    <span className="viz-tooltip-value">{previewAyahData.tokenCount}</span>
                  </div>
                  <div className="viz-tooltip-row">
                    <span className="viz-tooltip-label">{ts("dominantPOS")}</span>
                    <span className="viz-tooltip-value">{previewAyahData.dominantPOS}</span>
                  </div>
                  {highlightRoot && previewAyah && (
                    <div className="viz-tooltip-row">
                      <span className="viz-tooltip-label">{t("matchesLabel")}</span>
                      <span className="viz-tooltip-value">{ayahRootCounts.get(previewAyah)?.get(highlightRoot) ?? 0}</span>
                    </div>
                  )}
                  {previewAyahRootEntries.length > 0 && (
                    <div style={{ marginTop: "0.7rem", display: "grid", gap: "0.45rem" }}>
                      <span
                        className="viz-tooltip-label"
                        style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}
                      >
                        {ts("roots")}
                      </span>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                        {previewAyahRootEntries.map((entry) => {
                          const chipColor = getRootBaseColor(entry.root, entry.globalCount);
                          const isDimmed = !!highlightRoot && entry.root !== highlightRoot;
                          return (
                            <button
                              type="button"
                              key={`${previewAyah}-${entry.root}`}
                              onClick={() => {
                                if (!previewAyah) return;
                                setSelectedConnection(null);
                                setHoveredConnection(null);
                                setHoveredRoot(entry.root);
                                if (onRootSelect) onRootSelect(entry.root);
                                handleAyahSelect(previewAyah, entry.root);
                              }}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "0.28rem",
                                borderRadius: 999,
                                border: "1px solid var(--line)",
                                background: "color-mix(in srgb, var(--surface), transparent 18%)",
                                color: "var(--ink-secondary)",
                                padding: "0.12rem 0.44rem",
                                fontSize: "0.75rem",
                                cursor: "pointer",
                                opacity: isDimmed ? 0.45 : 1,
                              }}
                            >
                              <span
                                aria-hidden
                                style={{
                                  width: 8,
                                  height: 8,
                                  borderRadius: "50%",
                                  background: isDimmed
                                    ? (theme === "dark" ? "rgba(255,255,255,0.2)" : "rgba(31, 28, 25, 0.2)")
                                    : chipColor,
                                }}
                              />
                              <span className="arabic-text">{entry.root}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {highlightRoot && (
              <div className="viz-left-panel">
                <div className="viz-tooltip-title">{ts("selectedRoot")}</div>
                <div className="viz-tooltip-subtitle arabic-text">{highlightRoot}</div>
                {highlightAyahs.length > 0 && (
                  <div className="viz-tooltip-row viz-tooltip-row--stacked">
                    <span className="viz-tooltip-label">
                      {ts("occursInAyahs", { count: highlightAyahs.length })}
                    </span>
                    <div className="viz-ayah-chip-row">
                      {highlightAyahs.map((ayahNum) => (
                        <span
                          key={ayahNum}
                          className="viz-ayah-chip"
                          aria-label={`${ts("surah")} ${suraId}, ${ts("ayah")} ${ayahNum}`}
                        >
                          {suraId}:{ayahNum}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <AnimatePresence>
              {(selectedConnection || hoveredConnection) && (
                <motion.div
                  className="viz-left-panel"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  transition={{ duration: motionSafeDuration(200) / 1000 }}
                >
                  <div className="viz-tooltip-title">{t("rootConnection")}</div>
                  <div className="viz-tooltip-subtitle arabic-text">
                    {(selectedConnection ?? hoveredConnection)?.root}
                  </div>
                  <div className="viz-tooltip-row">
                    <span className="viz-tooltip-label">{t("from")}</span>
                    <span className="viz-tooltip-value">
                      {ts("ayah")} {(selectedConnection ?? hoveredConnection)?.sourceAyah}
                    </span>
                  </div>
                  <div className="viz-tooltip-row">
                    <span className="viz-tooltip-label">{t("to")}</span>
                    <span className="viz-tooltip-value">
                      {ts("ayah")} {(selectedConnection ?? hoveredConnection)?.targetAyah}
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="viz-legend" style={{ marginTop: 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', justifyContent: 'space-between' }}>
                <span className="eyebrow" style={{ fontSize: '0.7em' }}>{ts("legend")}</span>
                <HelpIcon onClick={() => setShowHelp(true)} />
              </div>
              {lexicalColorMode === "theme" ? (
                <>
                  <div className="viz-legend-item">
                    <div className="viz-legend-dot" style={{ background: getNodeColor("N") }} />
                    <span>{ts("noun")}</span>
                  </div>
                  <div className="viz-legend-item">
                    <div className="viz-legend-dot" style={{ background: getNodeColor("V") }} />
                    <span>{ts("verb")}</span>
                  </div>
                  <div className="viz-legend-item">
                    <div className="viz-legend-dot" style={{ background: getNodeColor("ADJ") }} />
                    <span>{ts("adjective")}</span>
                  </div>
                  <div className="viz-legend-item">
                    <div className="viz-legend-dot" style={{ background: getNodeColor("P") }} />
                    <span>{ts("preposition")}</span>
                  </div>
                </>
              ) : lexicalColorMode === "frequency" ? (
                <>
                  <div className="viz-legend-item">
                    <div className="viz-legend-dot" style={{ background: getFrequencyColor(0.2, theme) }} />
                    <span>{ts("lowerFrequency")}</span>
                  </div>
                  <div className="viz-legend-item">
                    <div className="viz-legend-dot" style={{ background: getFrequencyColor(0.9, theme) }} />
                    <span>{ts("higherFrequency")}</span>
                  </div>
                </>
              ) : (
                <div className="viz-legend-item">
                  <div className="viz-legend-dot" style={{ background: getIdentityColor("radial-identity", theme) }} />
                  <span>{ts("rootIdentity")}</span>
                </div>
              )}
              <div className="viz-legend-item">
                <div
                  className="viz-legend-line"
                  style={{
                    background:
                      lexicalColorMode === "theme"
                        ? "url(#connectionGrad)"
                        : lexicalColorMode === "frequency"
                          ? `linear-gradient(90deg, ${getFrequencyColor(0.2, theme)}, ${getFrequencyColor(0.9, theme)})`
                          : `linear-gradient(90deg, ${getIdentityColor("radial-a", theme)}, ${getIdentityColor("radial-b", theme)})`,
                  }}
                />
                <span>{t("rootConnection")}</span>
              </div>
              <div className="viz-legend-item">
                <div className="viz-legend-line" style={{ background: themeColors.accent, height: 6 }} />
                <span>{t("ayahBar")}</span>
              </div>
            </div>
          </div>
        </>,
        document.getElementById('viz-sidebar-portal')!
      )}

      {/* B) Floating "selected" pill — V2 Observatory design */}
      {(() => {
        const pillArabic: string | null = highlightRoot ?? fullAyahText ?? null;
        const isVisible = pillArabic !== null && (!!highlightRoot || !!selectedAyah);
        if (!isVisible || !pillArabic) return null;
        return (
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: "46%",
              left: "60%",
              transform: "translateY(-50%)",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 11px",
              borderRadius: 999,
              background: "rgba(13,13,17,0.9)",
              border: "1px solid rgba(251,234,210,0.4)",
              boxShadow: "0 0 18px rgba(251,234,210,0.25)",
              pointerEvents: "none",
              zIndex: 20,
              maxWidth: "38%",
              overflow: "hidden",
            }}
          >
            <span
              lang="ar"
              dir="rtl"
              style={{
                fontFamily: "Amiri, serif",
                fontSize: 18,
                color: "#ECE4D8",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: "22ch",
              }}
            >
              {pillArabic}
            </span>
            <span
              aria-hidden
              style={{
                width: 1,
                height: 14,
                background: "rgba(237,225,209,0.15)",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontFamily: "'Space Grotesk', sans-serif",
                fontWeight: 500,
                fontSize: 11,
                color: "#f0b074",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              selected
            </span>
          </div>
        );
      })()}

      <div ref={containerRef} className="viz-container" style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0 }}>
        {!isMounted ? null : (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
            className="radial-sura-map viz-canvas"
            style={{ width: "100%", height: "100%", cursor: "grab" }}
            onClick={(event) => {
              if (event.target !== event.currentTarget) return;
              // Empty-canvas click clears the LOCAL ayah/wire selection only.
              // The shared root stays pinned: a searched or clicked root is
              // released only by an explicit pick of another root (or the
              // breadcrumb), never by a stray click on nothing.
              setSelectedAyah(null);
              setSelectedConnection(null);
              setHoveredRoot(null);
              setHoveredConnection(null);
              setHoveredAyah(null);
            }}
          >
            <g ref={gRef}>
              <defs>
                {/* Gradient for connections */}
                <linearGradient id="connectionGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor={themeColors.accent} stopOpacity="0.6" />
                  <stop offset="50%" stopColor={themeColors.accentSecondary} stopOpacity="0.4" />
                  <stop offset="100%" stopColor={themeColors.accent} stopOpacity="0.6" />
                </linearGradient>

                <radialGradient id="centerGlow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor={themeColors.glowColors.primary} stopOpacity="0.2" />
                  <stop offset="100%" stopColor="transparent" />
                </radialGradient>

                {/* Glow filter */}
                <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="4" result="coloredBlur" />
                  <feMerge>
                    <feMergeNode in="coloredBlur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>

                <filter id="strongGlow" x="-100%" y="-100%" width="300%" height="300%">
                  <feGaussianBlur stdDeviation="8" result="coloredBlur" />
                  <feMerge>
                    <feMergeNode in="coloredBlur" />
                    <feMergeNode in="coloredBlur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>

                {/* V2 selection ring glow — rgba(251,234,210,0.6) */}
                <filter id="selectionGlow" x="-80%" y="-80%" width="260%" height="260%">
                  <feGaussianBlur stdDeviation="3.5" result="blur" in="SourceGraphic" />
                  <feFlood floodColor="rgba(251,234,210,0.6)" result="glowColor" />
                  <feComposite in="glowColor" in2="blur" operator="in" result="coloredBlur" />
                  <feMerge>
                    <feMergeNode in="coloredBlur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <VizExplainerDialog
                isOpen={showHelp}
                onClose={() => setShowHelp(false)}
                content={{
                  title: t("Help.title"),
                  description: t("Help.description"),
                  sections: [
                    { label: t("Help.ringsLabel"), text: t("Help.ringsText") },
                    { label: t("Help.dotsLabel"), text: t("Help.dotsText") },
                    { label: t("Help.navLabel"), text: t("Help.navText") },
                  ]
                }}
              />

              {/* Background orbital rings */}
              {[0.6, 0.75, 0.9, 1.05].map((scale, i) => (
                <circle
                  key={i}
                  cx={centerX}
                  cy={centerY}
                  r={innerRadius * scale}
                  fill="none"
                  stroke={theme === "dark" ? "rgba(255, 255, 255, 0.03)" : "rgba(31, 28, 25, 0.08)"}
                  strokeWidth={1}
                />
              ))}

              {/* Main arc (the black band) */}
              <circle
                cx={centerX}
                cy={centerY}
                r={innerRadius}
                className="main-arc"
                fill="none"
                stroke={theme === "dark" ? "rgba(255, 255, 255, 0.15)" : "rgba(31, 28, 25, 0.24)"}
                strokeWidth={3}
              />

              {/* Center Title. In overview mode the camera sits fitted OUT
                  (scale ~0.3 for a 286-ayah ring), which would shrink this
                  label to a ~10px smudge — counter-scale it by the inverse
                  zoom so it keeps its familiar on-screen size. zoomScale only
                  updates on zoom END, so this is a discrete snap, not a new
                  continuous animation. Detail mode (and every small surah,
                  which never enters overview) renders exactly as before. */}
              <g
                className="center-title"
                transform={`translate(${centerX}, ${centerY})${
                  isOverviewMode ? ` scale(${Math.min(3.4, 1 / Math.max(0.15, zoomScale)).toFixed(4)})` : ""
                }`}
              >
                <circle r={80} fill="url(#centerGlow)" />
                <text
                  y={-10}
                  textAnchor="middle"
                  className="arabic-text"
                  fill={themeColors.textColors.primary}
                  fontSize="32"
                  fontWeight="bold"
                >
                  {displayArabicName}
                </text>
                <text
                  y={25}
                  textAnchor="middle"
                  fill={themeColors.textColors.secondary}
                  fontSize="14"
                  letterSpacing="2px"
                >
                  {suraName}
                </text>
                <text
                  y={45}
                  textAnchor="middle"
                  fill={themeColors.textColors.muted}
                  fontSize="12"
                >
                  {ayahCount} {ts("ayah")}
                </text>
                {highlightRoot && highlightAyahs.length > 0 && (
                  <text
                    y={64}
                    textAnchor="middle"
                    fill={themeColors.textColors.muted}
                    fontSize="11"
                    fontWeight={600}
                    letterSpacing={centerAnnotationSpacing}
                    style={{ textTransform: "uppercase" }}
                  >
                    {t("matchSummary", {
                      matchCount: rootTokenTotals.get(highlightRoot) ?? highlightAyahs.length,
                      matchAyahCount: highlightAyahs.length,
                    })}
                  </text>
                )}
                {isOverviewMode && (
                  <text
                    y={highlightRoot && highlightAyahs.length > 0 ? 84 : 64}
                    textAnchor="middle"
                    fill={themeColors.textColors.muted}
                    fontSize="10.5"
                  >
                    {t("overviewLine", { count: ayahCount })}
                  </text>
                )}
              </g>

              {/* Root connections (flowing curves inside the circle), detail
                  mode: every connection with hover/selection emphasis. In
                  overview the same web is drawn by the capped mesh +
                  emphasis layers below, so nothing is zoom-gated but the
                  per-word bars. */}
              {!isOverviewMode && (
              <g className="connections">
                {renderedConnections.map((conn, idx) => {
                  const isActiveAyah =
                    !!activeAyah && (conn.sourceAyah === activeAyah || conn.targetAyah === activeAyah);
                  const countColor = isActiveAyah ? activeRootColorMap?.get(conn.root) ?? null : null;
                  const isHighlighted = highlightRoot
                    ? (conn.root === highlightRoot || hoveredRoot === conn.root)
                    : (hoveredRoot === conn.root || isActiveAyah);
                  // With a root highlighted, other roots' connections dim further
                  // (0.2) than the default unfiltered view (0.3) — the highlighted
                  // root's own arcs read as the clear signal, while the rest of the
                  // surah's root web stays faintly present instead of disappearing.
                  const dimmedOpacity = highlightRoot ? 0.2 : 0.3;
                  const pathKey = `${conn.sourceAyah}-${conn.targetAyah}`;
                  const pathD = connectionPaths.get(pathKey) ?? "";

                  const strokeColor = countColor ??
                    (isHighlighted
                      ? themeColors.accent
                      : lexicalColorMode === "theme"
                        ? "url(#connectionGrad)"
                        : conn.color);

                  return (
                    <g key={`${conn.sourceAyah}-${conn.targetAyah}-${conn.root}`}>
                      {allowConnectionAnimation ? (
                        <motion.path
                          d={pathD}
                          className={`connection ${isHighlighted ? "highlighted" : ""}`}
                          stroke={strokeColor}
                          strokeWidth={isHighlighted ? 2.5 : 1.5}
                          fill="none"
                          pointerEvents="none"
                          initial={{ pathLength: 0, opacity: 0 }}
                          animate={{ pathLength: 1, opacity: isHighlighted ? 1 : dimmedOpacity }}
                          transition={{ duration: motionSafeDuration(1100) / 1000, delay: motionSafeStagger(idx, 12) / 1000 }}
                          filter={isHighlighted ? "url(#glow)" : undefined}
                          onMouseEnter={() => handleConnectionHover(conn)}
                          onMouseLeave={() => handleConnectionHover(null)}
                        />
                      ) : (
                        <path
                          d={pathD}
                          className={`connection ${isHighlighted ? "highlighted" : ""}`}
                          stroke={strokeColor}
                          strokeWidth={isHighlighted ? 2.5 : 1.5}
                          style={{ opacity: isHighlighted ? 1 : dimmedOpacity }}
                          fill="none"
                          pointerEvents="none"
                          filter={isHighlighted ? "url(#glow)" : undefined}
                          onMouseEnter={() => handleConnectionHover(conn)}
                          onMouseLeave={() => handleConnectionHover(null)}
                        />
                      )}
                      <path
                        d={pathD}
                        stroke="transparent"
                        strokeWidth={12}
                        fill="none"
                        pointerEvents="stroke"
                        style={{ cursor: "pointer" }}
                        onPointerDown={(event) => event.stopPropagation()}
                        onMouseEnter={() => handleConnectionHover(conn)}
                        onMouseLeave={() => handleConnectionHover(null)}
                        onClick={(event) => handleConnectionSelect(event, conn)}
                      />
                    </g>
                  );
                })}
              </g>
              )}

              {/* Overview mesh: the faint root web at every zoom level (no
                  stage cliff) — see OVERVIEW_MESH_ARC_CAP. */}
              {isOverviewMode && overviewMeshConnections.length > 0 && (
                <g className="overview-connections overview-mesh">
                  {overviewMeshConnections.map(({ key, d, conn }) => (
                    <g key={key}>
                      <path
                        d={d}
                        className="connection"
                        stroke={lexicalColorMode === "theme" ? "url(#connectionGrad)" : conn.color}
                        strokeWidth={Math.max(0.8, innerRadius * 0.0016)}
                        fill="none"
                        pointerEvents="none"
                        style={{ opacity: hoveredRoot || activeAyah ? 0.12 : 0.3 }}
                      />
                      {/* Invisible hit target — non-scaling so it stays a
                          comfortable ~14 screen-px whatever the zoom, making the
                          hairline arcs clickable even at the fitted-out overview. */}
                      <path
                        d={d}
                        stroke="transparent"
                        strokeWidth={14}
                        vectorEffect="non-scaling-stroke"
                        fill="none"
                        pointerEvents="stroke"
                        style={{ cursor: "pointer" }}
                        onPointerDown={(event) => event.stopPropagation()}
                        onMouseEnter={() => handleConnectionHover(conn)}
                        onMouseLeave={() => handleConnectionHover(null)}
                        onClick={(event) => handleConnectionSelect(event, conn)}
                      />
                    </g>
                  ))}
                </g>
              )}

              {/* Overview highlight web: the searched root's arcs stay
                  visible at the zoomed-out level — this is the one signal
                  the overview was hiding entirely. */}
              {isOverviewMode && overviewHighlightConnections.length > 0 && (
                <g className="overview-connections">
                  {overviewHighlightConnections.map(({ key, d, conn }) => (
                    <g key={key}>
                      <path
                        d={d}
                        className="connection"
                        stroke={themeColors.accent}
                        strokeWidth={Math.max(1, innerRadius * 0.002)}
                        fill="none"
                        pointerEvents="none"
                        style={{ opacity: 0.45 }}
                      />
                      <path
                        d={d}
                        stroke="transparent"
                        strokeWidth={14}
                        vectorEffect="non-scaling-stroke"
                        fill="none"
                        pointerEvents="stroke"
                        style={{ cursor: "pointer" }}
                        onPointerDown={(event) => event.stopPropagation()}
                        onMouseEnter={() => handleConnectionHover(conn)}
                        onMouseLeave={() => handleConnectionHover(null)}
                        onClick={(event) => handleConnectionSelect(event, conn)}
                      />
                    </g>
                  ))}
                </g>
              )}

              {/* Overview emphasis: hovered root / active ayah arcs, on top of
                  the mesh, from the full connection set. No filter — a glow on
                  a hundred paths is what made hover jank in the first place. */}
              {isOverviewMode && overviewEmphasisConnections.length > 0 && (
                <g className="overview-connections overview-emphasis" pointerEvents="none">
                  {overviewEmphasisConnections.map(({ key, d, conn, byRoot }) => (
                    <path
                      key={key}
                      d={d}
                      className="connection highlighted"
                      stroke={byRoot ? themeColors.accent : activeRootColorMap?.get(conn.root) ?? conn.color}
                      strokeWidth={Math.max(1.2, innerRadius * 0.0024)}
                      fill="none"
                      style={{ opacity: 0.85 }}
                    />
                  ))}
                </g>
              )}

              {/* Ayah bars radiating outward (detail mode), or one hairline
                  tick per ayah (overview mode) — see isOverviewMode above. */}
              {isOverviewMode ? (
                <g className="ayah-ticks">
                  {(() => {
                    // Stroke widths scale with the ring like tick lengths do,
                    // landing at ~1-2 screen px at the fitted-out overview
                    // zoom — the mood-board hairline. Hover/emphasis states
                    // widen relative to that same base.
                    const tickStrokeBase = Math.max(1.6, innerRadius * 0.0035);
                    const bandOuter = innerRadius * (OVERVIEW_TICK_MAX_RATIO + OVERVIEW_TICK_MATCH_BONUS_RATIO);
                    return (
                      <>
                        {overviewTicks.map((tick) => {
                          const isSelected = selectedAyah === tick.ayah;
                          const isHovered = hoveredAyah === tick.ayah;
                          return (
                            <line
                              key={tick.ayah}
                              x1={tick.startX}
                              y1={tick.startY}
                              x2={tick.endX}
                              y2={tick.endY}
                              stroke={isSelected ? themeColors.accent : tick.color}
                              strokeWidth={
                                isSelected || isHovered
                                  ? tickStrokeBase * 2
                                  : tick.isMatch
                                    ? tickStrokeBase * 1.6
                                    : tickStrokeBase
                              }
                              strokeLinecap="round"
                              filter={isSelected ? "url(#glow)" : undefined}
                              pointerEvents="none"
                            />
                          );
                        })}
                        {/* Ayah-number milestones just inside the ring so the
                            overview carries scale/orientation (which part of
                            the surah am I looking at?) without any zoom. */}
                        {(() => {
                          const step = ayahCount > 200 ? 25 : ayahCount > 80 ? 20 : 10;
                          const milestones: number[] = [1];
                          for (let a = step; a <= ayahCount; a += step) milestones.push(a);
                          const labelRadius = innerRadius * 0.94;
                          const fontSize = Math.max(9, innerRadius * 0.02);
                          return milestones.map((ayah) => {
                            const tick = overviewTicksByAyah.get(ayah);
                            if (!tick) return null;
                            return (
                              <text
                                key={`ayah-label-${ayah}`}
                                x={centerX + Math.cos(tick.angleRad) * labelRadius}
                                y={centerY + Math.sin(tick.angleRad) * labelRadius}
                                textAnchor="middle"
                                dominantBaseline="central"
                                fill={themeColors.textColors.muted}
                                fontSize={fontSize}
                                pointerEvents="none"
                                style={{ opacity: 0.75, fontVariantNumeric: "tabular-nums" }}
                              >
                                {ayah}
                              </text>
                            );
                          });
                        })()}
                        {/* Single invisible hit band over the whole tick ring
                            (see ayahFromPointerEvent). pointerdown is NOT
                            stopped, so d3-zoom drag-panning still starts here. */}
                        <circle
                          className="ayah-tick-hit"
                          cx={centerX}
                          cy={centerY}
                          r={innerRadius + bandOuter / 2}
                          fill="none"
                          stroke="transparent"
                          strokeWidth={bandOuter + innerRadius * 0.08}
                          pointerEvents="stroke"
                          style={{ cursor: "pointer" }}
                          onPointerMove={(event) => {
                            const ayah = ayahFromPointerEvent(event);
                            if (lastPointerAyahRef.current !== ayah) {
                              lastPointerAyahRef.current = ayah;
                              handleBarHover(ayah);
                            }
                          }}
                          onPointerLeave={() => {
                            lastPointerAyahRef.current = null;
                            handleBarHover(null);
                          }}
                          onClick={(event) => {
                            const ayah = ayahFromPointerEvent(event);
                            if (!ayah) return;
                            event.stopPropagation();
                            setSelectedConnection(null);
                            setHoveredConnection(null);
                            handleOverviewTickSelect(ayah);
                          }}
                        />
                      </>
                    );
                  })()}
                </g>
              ) : (
              <g className="ayah-bars">
                {barsForRender.map(({ bar, angleRad, startX, startY, endX, endY, visibleRootNodes, isFocusedAyah }, barIndex) => {
                  const isSelected = selectedAyah === bar.ayah;
                  const labelAnchor = angleRad > Math.PI / 2 && angleRad < (3 * Math.PI) / 2 ? "end" : "start";

                  const barContent = (
                    <>
                      <line
                        x1={startX}
                        y1={startY}
                        x2={endX}
                        y2={endY}
                        className="bar colored"
                        stroke={isSelected ? themeColors.accent : bar.color}
                        strokeWidth={isSelected ? barStrokeWidth + 1.4 : barStrokeWidth}
                        strokeLinecap="round"
                        filter={isSelected ? "url(#strongGlow)" : undefined}
                        style={{ cursor: "pointer" }}
                        onMouseEnter={() => handleBarHover(bar.ayah)}
                        onMouseLeave={() => handleBarHover(null)}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedConnection(null);
                          setHoveredConnection(null);
                          handleAyahSelect(bar.ayah);
                        }}
                      />
                      {visibleRootNodes.map((node, nodeIndex) => {
                        const isRootHighlighted = hoveredRoot === node.root || highlightRoot === node.root;
                        const isDimmed = !!highlightRoot && node.root !== highlightRoot;
                        const displayRadius = isRootHighlighted ? node.r + 0.7 : node.r;
                        const tintColor = isDimmed ? dimTone(node.baseColor, 1) : node.baseColor;
                        // The reserved selection colour, not a yellow that read as
                        // the particle hue from the part-of-speech spectrum.
                        const highlightedRootColor = theme === "dark" ? SELECTION_RING : "#1f1c19";

                        const shouldShowRootLabel =
                          isRootHighlighted ||
                          (showAllRootLabels && displayRadius >= 1.75) ||
                          (showContextRootLabels && isFocusedAyah && displayRadius >= 1.55);
                        const isSelectedLemmaLabel =
                          Boolean(highlightRoot) && node.root === highlightRoot && node.lemmas.length > 0;
                        const rootLabelText =
                          isSelectedLemmaLabel
                            ? formatLemmaLabel(node.lemmas)
                            : node.root;
                        const selectedPerpDirection = nodeIndex % 2 === 0 ? 1 : -1;
                        const selectedCirclePerpNudge = isSelectedLemmaLabel ? (compactLayout ? 6.5 : 8.5) : 0;
                        const selectedCircleRadialNudge = isSelectedLemmaLabel ? (compactLayout ? 2.6 : 3.4) : 0;
                        const circleX =
                          node.x +
                          Math.cos(angleRad) * selectedCircleRadialNudge +
                          Math.cos(angleRad + Math.PI / 2) * selectedPerpDirection * selectedCirclePerpNudge;
                        const circleY =
                          node.y +
                          Math.sin(angleRad) * selectedCircleRadialNudge +
                          Math.sin(angleRad + Math.PI / 2) * selectedPerpDirection * selectedCirclePerpNudge;
                        const labelYOffset = showAllRootLabels ? (nodeIndex % 2 === 0 ? -0.75 : 0.75) : 0;
                        const baseRootLabelFontSize = showAllRootLabels
                          ? (compactLayout ? 7.6 : 8.2)
                          : (compactLayout ? 6.8 : 7.2);
                        const rootLabelFontSize = isSelectedLemmaLabel
                          ? baseRootLabelFontSize + (compactLayout ? 12.8 : 16.4)
                          : baseRootLabelFontSize;
                        const selectedLabelPerpNudge = isSelectedLemmaLabel ? (compactLayout ? 5.5 : 7.2) : 0;
                        const selectedLabelX = isSelectedLemmaLabel
                          ? circleX +
                          Math.cos(angleRad) * (displayRadius + 4) +
                          Math.cos(angleRad + Math.PI / 2) * selectedPerpDirection * selectedLabelPerpNudge
                          : node.labelX;
                        const selectedLabelY = isSelectedLemmaLabel
                          ? circleY +
                          Math.sin(angleRad) * (displayRadius + 4) +
                          Math.sin(angleRad + Math.PI / 2) * selectedPerpDirection * selectedLabelPerpNudge
                          : node.labelY;

                        return (
                          <g key={`${bar.ayah}-${node.root}`}>
                            <circle
                              cx={circleX}
                              cy={circleY}
                              r={displayRadius}
                              fill="transparent"
                              stroke={isRootHighlighted ? highlightedRootColor : tintColor}
                              strokeWidth={isRootHighlighted ? 2.5 : 1.8}
                              opacity={isDimmed ? 0.38 : 0.9}
                              filter={isRootHighlighted ? "url(#glow)" : undefined}
                              style={{ cursor: "pointer" }}
                              onMouseEnter={() => handleRootNodeHover(bar.ayah, node.root)}
                              onMouseLeave={() => handleRootNodeHover(null, null)}
                              onClick={(event) => handleRootNodeSelect(event, bar.ayah, node.root)}
                            />
                            {isRootHighlighted && (
                              <circle
                                cx={circleX}
                                cy={circleY}
                                r={displayRadius + 6}
                                fill="none"
                                stroke={SELECTION_RING}
                                strokeWidth={1.6}
                                opacity={0.95}
                                filter="url(#selectionGlow)"
                                pointerEvents="none"
                              />
                            )}
                            {shouldShowRootLabel && (
                              <text
                                x={selectedLabelX}
                                y={selectedLabelY + labelYOffset}
                                textAnchor={labelAnchor}
                                className="arabic-text"
                                fill={
                                  isRootHighlighted
                                    ? highlightedRootColor
                                    : isDimmed
                                      ? (theme === "dark" ? "rgba(255,255,255,0.32)" : "rgba(31, 28, 25, 0.32)")
                                      : theme === "dark"
                                        ? "rgba(255,255,255,0.78)"
                                        : "rgba(31, 28, 25, 0.78)"
                                }
                                fontSize={rootLabelFontSize}
                                fontWeight={isRootHighlighted ? 600 : 500}
                                stroke={isSelectedLemmaLabel ? (theme === "dark" ? "rgba(6, 9, 18, 0.9)" : "rgba(248, 246, 238, 0.92)") : "transparent"}
                                strokeWidth={isSelectedLemmaLabel ? 1.8 : 0}
                                paintOrder="stroke fill"
                                pointerEvents="none"
                              >
                                {rootLabelText}
                              </text>
                            )}
                          </g>
                        );
                      })}
                      {/* Small circle at the end of bar */}
                      <circle
                        cx={endX}
                        cy={endY}
                        r={isSelected ? endpointRadius + 1.5 : endpointRadius}
                        fill={isSelected ? themeColors.accent : bar.color}
                        filter={isSelected ? "url(#glow)" : undefined}
                      />
                      {/* V2 selection ring on selected ayah endpoint */}
                      {isSelected && (
                        <circle
                          cx={endX}
                          cy={endY}
                          r={endpointRadius + 7}
                          fill="none"
                          stroke={SELECTION_RING}
                          strokeWidth={1.6}
                          opacity={0.95}
                          filter="url(#selectionGlow)"
                          pointerEvents="none"
                        />
                      )}
                      <circle
                        cx={endX}
                        cy={endY}
                        r={12}
                        fill="transparent"
                        style={{ cursor: "pointer" }}
                        onMouseEnter={() => handleBarHover(bar.ayah)}
                        onMouseLeave={() => handleBarHover(null)}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedConnection(null);
                          setHoveredConnection(null);
                          handleAyahSelect(bar.ayah);
                        }}
                      />
                      {(() => {
                        const labelRadius = innerRadius + bar.barHeight + (compactLayout ? 14 : 18);
                        const labelX = centerX + Math.cos(angleRad) * labelRadius;
                        const labelY = centerY + Math.sin(angleRad) * labelRadius;
                        const isEmphasized =
                          highlightAyahSet.has(bar.ayah) ||
                          bar.ayah === selectedAyah ||
                          bar.ayah === hoveredAyah;
                        const isSelectedAyahLabel = bar.ayah === selectedAyah;
                        const sparseInterval =
                          ayahCount > 180 ? 8 :
                            ayahCount > 120 ? 6 :
                              ayahCount > 80 ? 4 :
                                ayahCount > 50 ? 3 : 2;
                        const passesSparseFilter = barIndex % sparseInterval === 0;
                        // Numbers are the graph's orientation cue, so surface
                        // them the moment detail appears (sparse), and show the
                        // full set with just a nudge more zoom — not a deep dive.
                        const shouldShowAyahLabel =
                          isEmphasized ||
                          zoomScale >= 1.9 ||
                          (zoomScale >= DETAIL_ZOOM_THRESHOLD && passesSparseFilter);
                        if (!shouldShowAyahLabel) return null;
                        return (
                          <text
                            x={labelX}
                            y={labelY}
                            textAnchor={labelAnchor}
                            fill={
                              isEmphasized
                                ? theme === "dark"
                                  ? "rgba(255,255,255,0.95)"
                                  : "rgba(31, 28, 25, 0.95)"
                                : theme === "dark"
                                  ? "rgba(255,255,255,0.22)"
                                  : "rgba(31, 28, 25, 0.36)"
                            }
                            fontSize={
                              isSelectedAyahLabel
                                ? (compactLayout ? "14.5" : "18.5")
                                : isEmphasized
                                  ? (compactLayout ? "9.5" : "11.5")
                                  : (compactLayout ? "8.5" : "10")
                            }
                            fontWeight={isEmphasized ? 600 : 400}
                            style={{ pointerEvents: "none" }}
                          >
                            {bar.ayah}
                          </text>
                        );
                      })()}
                    </>
                  );

                  return allowBarAnimation ? (
                    <motion.g
                      key={bar.ayah}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: motionSafeStagger(bar.ayah, 12) / 1000 }}
                    >
                      {barContent}
                    </motion.g>
                  ) : (
                    <g key={bar.ayah}>
                      {barContent}
                    </g>
                  );
                })}
              </g>
              )}
            </g>
          </svg>
        )}

      </div>
    </section >
  );
}

