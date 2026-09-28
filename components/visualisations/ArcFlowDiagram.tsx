"use client";

import { useRef, useMemo, useState, useCallback, useEffect, useDeferredValue, type ChangeEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { createPortal } from "react-dom";
import * as d3 from "@/lib/viz/d3";
import type { CorpusToken } from "@/lib/schema/types";
import { getAyah } from "@/lib/corpus/corpusLoader";
import { getNodeColor, GRADIENT_PALETTES, resolveVisualizationTheme } from "@/lib/schema/visualizationTypes";
import { getFrequencyColor, getIdentityColor, type LexicalColorMode } from "@/lib/theme/lexicalColoring";
import { useLocale, useTranslations } from "next-intl";
import { useVizControl } from "@/lib/hooks/VizControlContext";
import { VizExplainerDialog, HelpIcon } from "@/components/ui/VizExplainerDialog";
import type { ExperienceLevel } from "@/lib/schema/experience";
import { fitGraphToView } from "@/lib/viz/fitToView";
import { motionSafeDuration, motionSafeStagger, prefersReducedMotion } from "@/lib/viz/motionPrefs";
import { SURAH_NAMES } from "@/lib/data/surahData";
import { FULL_CORPUS_TOKEN_FLOOR } from "@/lib/corpus/corpusExpectations";

/**
 * Root arcs in the default colouring, rare → frequent: the data spectrum's
 * violet, teal and amber (deepened for parchment in light). This was a
 * magenta → violet → blue → cyan ramp blended with a rainbow, the old design's.
 */
const ROOT_ARC_RAMP: Record<"light" | "dark", string[]> = {
  dark: ["#8e84cc", "#56a697", "#e8924a"],
  light: ["#6d28d9", "#0f766e", "#b45309"],
};

interface ArcFlowDiagramProps {
  tokens: CorpusToken[];
  groupBy: "root" | "pos" | "ayah";
  onTokenHover: (tokenId: string | null) => void;
  onTokenFocus: (tokenId: string) => void;
  selectedSurahId?: number | null;
  selectedAyah?: number | null;
  selectedRoot?: string | null;
  selectedLemma?: string | null;
  experienceLevel?: ExperienceLevel;
  theme?: "light" | "dark";
  lexicalColorMode?: LexicalColorMode;
}

interface FlowNode {
  id: string;
  label: string;
  category: string;
  count: number;
  position: number;
  barHeight: number;
  color: string;
  sampleToken?: CorpusToken;
  matchCount: number;
  isContextMatch: boolean;
}

interface FlowConnection {
  id: string;
  sourceId: string;
  targetId: string;
  weight: number;
  color: string;
  isContextMatch: boolean;
}

const POS_LABELS: Record<string, string> = {
  N: "noun",
  V: "verb",
  ADJ: "adjective",
  PRON: "pronoun",
  P: "preposition",
  PART: "particle",
  CONJ: "conjunction",
};

function getPosLabel(pos: string, ts: (key: string) => string): string {
  const key = POS_LABELS[pos];
  return key ? ts(key) : pos;
}

export default function ArcFlowDiagram({
  tokens,
  groupBy = "root",
  onTokenHover,
  onTokenFocus,
  selectedSurahId,
  selectedAyah,
  selectedRoot,
  selectedLemma,
  experienceLevel = "advanced",
  theme = "dark",
  lexicalColorMode = "theme",
}: ArcFlowDiagramProps) {
  const t = useTranslations("Visualizations.ArcFlow");
  const ts = useTranslations("Visualizations.Shared");
  const locale = useLocale();
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  // Entry auto-fit bookkeeping (see the effects below, after `nodes`/
  // `connections` are computed). `userInteractedRef` flips true the moment a
  // real wheel/drag/touch gesture reaches the zoom behavior — never for a
  // programmatic `.transform()` call like the auto-fit itself — so a user
  // who starts exploring before the corpus finishes streaming never gets the
  // camera yanked back. `autoFittedRef` marks the current scope (surah +
  // groupBy) as already framed so the fit only ever runs once per scope;
  // both reset whenever that scope changes.
  const userInteractedRef = useRef(false);
  const autoFittedRef = useRef(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const { isLeftSidebarOpen } = useVizControl();

  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  // Distinct from `hoveredNode` (a bar/node id): tracks direct hover/focus of
  // an arc itself, so a connection's own weight is discoverable even when
  // neither of its endpoint bars is being hovered.
  const [hoveredConnectionId, setHoveredConnectionId] = useState<string | null>(null);
  const [activeGroupBy, setActiveGroupBy] = useState(groupBy);
  const [dimensions, setDimensions] = useState({ width: 1400, height: 900 });

  const [isMounted, setIsMounted] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [fullAyahText, setFullAyahText] = useState<string | null>(null);
  const [rootSearchQuery, setRootSearchQuery] = useState("");
  const deferredRootSearch = useDeferredValue(rootSearchQuery);
  const [internalSelectedRoot, setInternalSelectedRoot] = useState<string | null>(null);
  const isBeginner = experienceLevel === "beginner";

  // The local root-search override (`internalSelectedRoot`) lets a user pick
  // a root from this diagram's own search without touching the app-wide
  // selection. But once the SHARED `selectedRoot` prop changes elsewhere
  // (another graph, search, a deep link), that override must not keep
  // pinning a now-unrelated root here — track the previous prop value in a
  // ref so a genuine change resets the override and lets the incoming prop
  // win. The override remains available again until the next prop change.
  const prevSelectedRootPropRef = useRef(selectedRoot);
  useEffect(() => {
    const previous = prevSelectedRootPropRef.current;
    prevSelectedRootPropRef.current = selectedRoot;
    if (selectedRoot === previous) return;
    setInternalSelectedRoot(null);
  }, [selectedRoot]);

  useEffect(() => {
    if (selectedSurahId && selectedAyah) {
      getAyah(selectedSurahId, selectedAyah).then((record) => {
        setFullAyahText(record ? record.textUthmani : null);
      });
    } else {
      setFullAyahText(null);
    }
  }, [selectedSurahId, selectedAyah]);

  useEffect(() => {
    setActiveGroupBy(groupBy);
  }, [groupBy]);

  useEffect(() => {
    if (!isBeginner) return;
    setActiveGroupBy(groupBy);
    setInternalSelectedRoot(null);
    setRootSearchQuery("");
  }, [groupBy, isBeginner]);

  useEffect(() => {
    setIsMounted(true);
    if (!containerRef.current) return;

    // Floors guard against measuring a mid-layout zero/tiny rect, but they
    // must stay BELOW real phone sizes: a 900px floor on a 390px viewport
    // meant the whole layout was drawn for a 900-wide canvas and then
    // squeezed to 43% by the viewBox, squashing the fan on mobile.
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: Math.max(entry.contentRect.width, 320),
          height: Math.max(entry.contentRect.height, 480),
        });
      }
    });

    observer.observe(containerRef.current);

    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setDimensions({
        width: Math.max(rect.width, 320),
        height: Math.max(rect.height, 480),
      });
    }

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const sidebarPortal = document.getElementById("viz-sidebar-portal");
    if (!sidebarPortal) return;

    sidebarPortal.classList.add("arcflow-scrollless");
    return () => {
      sidebarPortal.classList.remove("arcflow-scrollless");
    };
  }, []);

  useEffect(() => {
    if (!svgRef.current || !gRef.current) return;

    const svgSelection = d3.select(svgRef.current);
    const gSelection = d3.select(gRef.current);
    const zoomBehavior = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 8])
      .on("zoom", (event) => {
        gSelection.attr("transform", event.transform.toString());
        // See userInteractedRef above: only a real gesture carries a
        // sourceEvent, so this can't be tripped by the entry auto-fit or the
        // sidebar's +/-/Focus buttons calling `.transform()`/`.scaleBy()`.
        if (event.sourceEvent) userInteractedRef.current = true;
        setZoomLevel((prev) => {
          const next = Math.round(event.transform.k * 20) / 20;
          return prev === next ? prev : next;
        });
      });

    zoomBehaviorRef.current = zoomBehavior;
    svgSelection.call(zoomBehavior);
    svgSelection.on("dblclick.zoom", null);

    return () => {
      svgSelection.on(".zoom", null);
      zoomBehaviorRef.current = null;
    };
  }, [dimensions.width, dimensions.height]);

  const themeColors = resolveVisualizationTheme(theme);
  // Framer-motion entrance staggers and D3 zoom transitions below are
  // JS-driven and bypass the global CSS prefers-reduced-motion rule
  // (globals.css) — gate them manually. Read once per render;
  // matchMedia-backed, SSR-safe.
  const reduceMotion = prefersReducedMotion();

  const scopedTokens = useMemo(() => {
    if (!selectedSurahId) return tokens;
    return tokens.filter((token) => token.sura === selectedSurahId);
  }, [tokens, selectedSurahId]);

  // All available roots with counts for root search
  const allRootsSorted = useMemo(() => {
    const rootMap = new Map<string, { total: number; gloss: string }>();
    scopedTokens.forEach(t => {
      if (!t.root) return;
      if (!rootMap.has(t.root)) {
        rootMap.set(t.root, { total: 0, gloss: t.morphology?.gloss ?? "" });
      }
      const entry = rootMap.get(t.root)!;
      entry.total++;
    });
    return Array.from(rootMap.entries())
      .map(([root, stats]) => ({ root, total: stats.total, gloss: stats.gloss }))
      .sort((a, b) => b.total - a.total);
  }, [scopedTokens]);

  const filteredRoots = useMemo(() => {
    if (!deferredRootSearch.trim()) return [];
    const q = deferredRootSearch.trim();
    return allRootsSorted
      .filter(r => r.root.includes(q) || r.gloss.toLowerCase().includes(q.toLowerCase()))
      .slice(0, 20);
  }, [deferredRootSearch, allRootsSorted]);

  // The effective root for highlighting: user search selection OR prop
  const effectiveSelectedRoot = internalSelectedRoot || selectedRoot;

  const hasContextSelection = Boolean(selectedAyah || selectedRoot || selectedLemma);

  const tokenMatchesContext = useCallback(
    (token: CorpusToken) => {
      if (!hasContextSelection) return false;
      const ayahMatch = selectedAyah ? token.ayah === selectedAyah : false;
      const rootMatch = selectedRoot ? token.root === selectedRoot : false;
      const lemmaMatch = selectedLemma ? token.lemma === selectedLemma : false;
      return ayahMatch || rootMatch || lemmaMatch;
    },
    [hasContextSelection, selectedAyah, selectedRoot, selectedLemma]
  );

  const { width, height } = dimensions;
  const isCompact = width < 1100;
  const leftRailOffset = width >= 980 ? 340 : 64;
  const rightPadding = 36;
  const maxBarHeightForLayout = isCompact ? 150 : 190;
  const angleSpread = width >= 1400 ? 0.64 : width >= 1100 ? 0.58 : 0.5;
  const horizontalRadiusLimit = Math.max(
    240,
    width - leftRailOffset - rightPadding - maxBarHeightForLayout
  );
  const verticalRadiusLimit = Math.max(220, height * (isCompact ? 0.34 : 0.4));
  const arcCenterX = leftRailOffset + 26;
  const arcCenterY = height * 0.5;
  const arcRadius = Math.min(horizontalRadiusLimit, verticalRadiusLimit);
  const arcStartAngle = -Math.PI * angleSpread;
  const arcEndAngle = Math.PI * angleSpread;

  const { nodes, connections, maxCount } = useMemo(() => {
    const maxGroups =
      activeGroupBy === "pos"
        ? 12
        : activeGroupBy === "ayah"
          ? zoomLevel > 1.35
            ? 130
            : zoomLevel > 0.95
              ? 90
              : 60
          : zoomLevel > 1.35
            ? 95
            : zoomLevel > 0.95
              ? 70
              : 50;

    const maxConnections =
      activeGroupBy === "pos"
        ? zoomLevel > 1.2
          ? 46
          : 30
        : zoomLevel > 1.2
          ? 70
          : 45;

    const groups = new Map<
      string,
      {
        count: number;
        sampleToken?: CorpusToken;
        category: string;
        matchCount: number;
      }
    >();

    for (const token of scopedTokens) {
      let key: string;
      let category: string;

      switch (activeGroupBy) {
        case "root":
          key = token.root || "unknown";
          category = token.pos;
          break;
        case "pos":
          key = token.pos;
          category = token.pos;
          break;
        case "ayah":
          key = `${token.sura}:${token.ayah}`;
          category = "ayah";
          break;
        default:
          key = token.root || "unknown";
          category = token.pos;
      }

      let group = groups.get(key);
      if (!group) {
        group = {
          count: 0,
          sampleToken: undefined,
          category,
          matchCount: 0,
        };
        groups.set(key, group);
      }

      group.count += 1;
      if (!group.sampleToken) group.sampleToken = token;
      if (tokenMatchesContext(token)) {
        group.matchCount += 1;
      }
    }

    let sortedGroups = [...groups.entries()]
      .filter(([key]) => (activeGroupBy === "root" ? key !== "unknown" && key !== "" : true))
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, maxGroups);

    if (activeGroupBy === "root" && effectiveSelectedRoot && groups.has(effectiveSelectedRoot)) {
      const isIncluded = sortedGroups.some(([key]) => key === effectiveSelectedRoot);
      if (!isIncluded) {
        const selectedEntry: [string, (typeof sortedGroups)[number][1]] = [
          effectiveSelectedRoot,
          groups.get(effectiveSelectedRoot)!,
        ];
        sortedGroups = [...sortedGroups.slice(0, Math.max(maxGroups - 1, 0)), selectedEntry]
          .sort((a, b) => b[1].count - a[1].count);
      }
    }

    if (
      activeGroupBy === "ayah" &&
      selectedSurahId &&
      selectedAyah &&
      groups.has(`${selectedSurahId}:${selectedAyah}`)
    ) {
      const selectedAyahKey = `${selectedSurahId}:${selectedAyah}`;
      const isIncluded = sortedGroups.some(([key]) => key === selectedAyahKey);
      if (!isIncluded) {
        const selectedEntry: [string, (typeof sortedGroups)[number][1]] = [
          selectedAyahKey,
          groups.get(selectedAyahKey)!,
        ];
        sortedGroups = [...sortedGroups.slice(0, Math.max(maxGroups - 1, 0)), selectedEntry]
          .sort((a, b) => b[1].count - a[1].count);
      }
    }

    const maxGroupCount = Math.max(...sortedGroups.map(([, g]) => g.count), 1);

    const nodesResult: FlowNode[] = sortedGroups.map(([key, data], idx) => {
      const position = idx / (sortedGroups.length - 1 || 1);
      const barHeight = 34 + (data.count / maxGroupCount) * maxBarHeightForLayout;
      const frequencyRatio = Math.log1p(data.count) / Math.log1p(maxGroupCount || 1);
      const identityRatio = sortedGroups.length > 1 ? idx / (sortedGroups.length - 1) : 0.5;
      const rootFrequencyColor = d3.interpolateRgbBasis(ROOT_ARC_RAMP[theme])(frequencyRatio);

      const isContextMatch =
        data.matchCount > 0 ||
        (activeGroupBy === "root" && Boolean(selectedRoot && key === selectedRoot)) ||
        (activeGroupBy === "ayah" &&
          Boolean(selectedSurahId && selectedAyah && key === `${selectedSurahId}:${selectedAyah}`));

      return {
        id: key,
        label: key,
        category: data.category,
        count: data.count,
        position,
        barHeight,
        color: activeGroupBy === "pos"
          ? getNodeColor(key)
          : activeGroupBy === "root"
            ? lexicalColorMode === "frequency"
              ? getFrequencyColor(frequencyRatio, theme)
              : lexicalColorMode === "identity"
                ? getIdentityColor(key, theme)
                : rootFrequencyColor
            : d3.interpolateRgbBasis(GRADIENT_PALETTES.vibrant)(identityRatio),
        sampleToken: data.sampleToken,
        matchCount: data.matchCount,
        isContextMatch,
      };
    });

    const nodeById = new Map(nodesResult.map((node) => [node.id, node]));
    const nodeIds = new Set(nodesResult.map((node) => node.id));
    const connectionsResult: FlowConnection[] = [];

    if (activeGroupBy === "root") {
      // Root pairs come from AYAH CO-OCCURRENCE, not shared lemmas: in this
      // corpus every lemma maps to exactly one root (see the hamza-
      // normalization note in lib/corpus), so a shared-lemma test can never
      // find two distinct roots for a pair — that's why this used to produce
      // zero connections regardless of scope. Two rendered root-groups are
      // linked when they both occur in the same ayah; the weight is the
      // number of ayahs where that co-occurrence happens.
      const ayahToGroupIds = new Map<string, Set<string>>();
      for (const token of scopedTokens) {
        const rootKey = token.root || "unknown";
        if (!nodeIds.has(rootKey)) continue; // only pair roots actually rendered (top maxGroups)
        const ayahKey = `${token.sura}:${token.ayah}`;
        let groupIds = ayahToGroupIds.get(ayahKey);
        if (!groupIds) {
          groupIds = new Set<string>();
          ayahToGroupIds.set(ayahKey, groupIds);
        }
        groupIds.add(rootKey);
      }

      const pairWeights = new Map<string, number>();
      ayahToGroupIds.forEach((groupIds) => {
        if (groupIds.size < 2) return;
        const idList = Array.from(groupIds);
        for (let i = 0; i < idList.length; i++) {
          for (let j = i + 1; j < idList.length; j++) {
            const a = idList[i];
            const b = idList[j];
            const pairKey = a < b ? `${a}|${b}` : `${b}|${a}`;
            pairWeights.set(pairKey, (pairWeights.get(pairKey) ?? 0) + 1);
          }
        }
      });

      [...pairWeights.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxConnections)
        .forEach(([pairKey, weight]) => {
          const [sourceId, targetId] = pairKey.split("|");
          const sourceNode = nodeById.get(sourceId);
          const targetNode = nodeById.get(targetId);
          connectionsResult.push({
            id: pairKey,
            sourceId,
            targetId,
            weight,
            color: sourceNode?.color ?? themeColors.accent,
            isContextMatch:
              Boolean(selectedRoot && (sourceId === selectedRoot || targetId === selectedRoot)) ||
              Boolean(sourceNode?.isContextMatch || targetNode?.isContextMatch),
          });
        });
    }

    if (activeGroupBy === "pos") {
      const sortedTokens = [...scopedTokens].sort(
        (a, b) => a.sura - b.sura || a.ayah - b.ayah || a.position - b.position
      );
      const pairWeights = new Map<string, number>();
      const pairContextHits = new Map<string, number>();

      for (let i = 0; i < sortedTokens.length - 1; i++) {
        const current = sortedTokens[i];
        const next = sortedTokens[i + 1];

        if (current.sura !== next.sura || current.ayah !== next.ayah) continue;
        if (Math.abs(current.position - next.position) !== 1) continue;
        if (current.pos === next.pos) continue;
        if (!nodeIds.has(current.pos) || !nodeIds.has(next.pos)) continue;

        const pairKey =
          current.pos < next.pos ? `${current.pos}|${next.pos}` : `${next.pos}|${current.pos}`;
        pairWeights.set(pairKey, (pairWeights.get(pairKey) ?? 0) + 1);

        if (tokenMatchesContext(current) || tokenMatchesContext(next)) {
          pairContextHits.set(pairKey, (pairContextHits.get(pairKey) ?? 0) + 1);
        }
      }

      [...pairWeights.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxConnections)
        .forEach(([pairKey, weight]) => {
          const [sourceId, targetId] = pairKey.split("|");
          const sourceNode = nodeById.get(sourceId);
          const targetNode = nodeById.get(targetId);
          connectionsResult.push({
            id: pairKey,
            sourceId,
            targetId,
            weight,
            color: sourceNode?.color ?? themeColors.accent,
            isContextMatch:
              (pairContextHits.get(pairKey) ?? 0) > 0 ||
              Boolean(sourceNode?.isContextMatch || targetNode?.isContextMatch),
          });
        });
    }

    if (activeGroupBy === "ayah" && hasContextSelection) {
      const sortedContextTokens = scopedTokens
        .filter((token) => tokenMatchesContext(token))
        .sort((a, b) => a.sura - b.sura || a.ayah - b.ayah || a.position - b.position);

      const pairWeights = new Map<string, number>();

      for (let i = 0; i < sortedContextTokens.length - 1; i++) {
        const current = sortedContextTokens[i];
        const next = sortedContextTokens[i + 1];
        if (current.sura !== next.sura) continue;
        if (current.ayah === next.ayah) continue;

        const currentKey = `${current.sura}:${current.ayah}`;
        const nextKey = `${next.sura}:${next.ayah}`;
        if (!nodeIds.has(currentKey) || !nodeIds.has(nextKey)) continue;

        const pairKey = currentKey < nextKey ? `${currentKey}|${nextKey}` : `${nextKey}|${currentKey}`;
        pairWeights.set(pairKey, (pairWeights.get(pairKey) ?? 0) + 1);
      }

      [...pairWeights.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxConnections)
        .forEach(([pairKey, weight]) => {
          const [sourceId, targetId] = pairKey.split("|");
          const sourceNode = nodeById.get(sourceId);
          connectionsResult.push({
            id: pairKey,
            sourceId,
            targetId,
            weight,
            color: sourceNode?.color ?? themeColors.accentSecondary,
            isContextMatch: true,
          });
        });
    }

    return {
      nodes: nodesResult,
      connections: connectionsResult,
      maxCount: maxGroupCount,
    };
  }, [
    scopedTokens,
    activeGroupBy,
    zoomLevel,
    themeColors.accent,
    themeColors.accentSecondary,
    selectedRoot,
    effectiveSelectedRoot,
    selectedAyah,
    selectedSurahId,
    hasContextSelection,
    tokenMatchesContext,
    maxBarHeightForLayout,
    themeColors.nodeColors.default,
    lexicalColorMode,
    theme,
  ]);

  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  const contextNodeIds = useMemo(() => {
    return new Set(nodes.filter((node) => node.isContextMatch).map((node) => node.id));
  }, [nodes]);

  // Scope-normalized stroke width (see the arc render below): weight alone
  // isn't comparable across scopes (a "15" means something different for one
  // surah vs. the whole corpus), so width is always relative to the busiest
  // connection actually on screen right now.
  const maxConnectionWeight = useMemo(
    () => connections.reduce((max, conn) => Math.max(max, conn.weight), 1),
    [connections]
  );

  // Data completeness for the CURRENT scope — mirrors `isSurahDataComplete`
  // in RadialSuraMap (see docs/VIZ_ARCHITECTURE.md, "Corpus data streams
  // in"): `tokens`/`scopedTokens` can still be a small stub (shell payload,
  // or a single surah streamed in ahead of the rest) when this first mounts,
  // and fitting to that stub's geometry would lock the camera onto a couple
  // of stray bars instead of the real layout once the rest lands. A surah
  // scope is complete once every one of its ayahs has appeared; the global
  // scope (no surah selected) has no per-ayah signal to check, so it falls
  // back to the same full-corpus token floor `useCorpusData` itself uses to
  // call a load "full".
  const isScopeDataComplete = useMemo(() => {
    if (selectedSurahId) {
      const expectedAyahCount = SURAH_NAMES[selectedSurahId]?.verses ?? 0;
      if (expectedAyahCount === 0) return true;
      const ayahsSeen = new Set(scopedTokens.map((token) => token.ayah)).size;
      return ayahsSeen >= expectedAyahCount;
    }
    // No surah scoped: `scopedTokens` IS `tokens` here (see the memo above),
    // so the full-corpus floor doubles as the completeness signal.
    return scopedTokens.length >= FULL_CORPUS_TOKEN_FLOOR;
  }, [selectedSurahId, scopedTokens]);

  // A new scope (surah or groupBy change) is a completely different layout
  // and deserves its own framing, regardless of whether the user had already
  // taken control of the camera in the previous one.
  useEffect(() => {
    userInteractedRef.current = false;
    autoFittedRef.current = false;
  }, [selectedSurahId, activeGroupBy]);

  // One-time panel-aware fit per scope, replacing the old fixed 0.92 initial
  // zoom. That fixed scale never accounted for bar length: bar tips at the
  // fan's extreme angles (near +/-90 deg) extend past the arc's own radius
  // bound, so a flat identity-ish transform always clipped them — the
  // "clipped diagonal stripes" framing. Measuring the real rendered bbox via
  // fitGraphToView sidesteps that regardless. Runs as soon as this scope's
  // data is complete and stands down for good once it has fired for this
  // scope or the user pans/zooms.
  useEffect(() => {
    if (userInteractedRef.current || autoFittedRef.current) return;
    if (!isMounted || nodes.length === 0) return;
    if (!isScopeDataComplete) return;

    autoFittedRef.current = true;
    fitGraphToView(svgRef.current, gRef.current, zoomBehaviorRef.current, {
      duration: motionSafeDuration(600),
    });
  }, [
    isMounted,
    nodes.length,
    isScopeDataComplete,
    selectedSurahId,
    activeGroupBy,
    dimensions.width,
    dimensions.height,
  ]);

  const getNodePosition = useCallback(
    (position: number) => {
      const angle = arcStartAngle + position * (arcEndAngle - arcStartAngle);
      const x = arcCenterX + Math.cos(angle) * arcRadius;
      const y = arcCenterY + Math.sin(angle) * arcRadius;
      return { x, y, angle };
    },
    [arcCenterX, arcCenterY, arcRadius, arcStartAngle, arcEndAngle]
  );

  const generateConnectionPath = useCallback(
    (sourceNode: FlowNode, targetNode: FlowNode) => {
      const source = getNodePosition(sourceNode.position);
      const target = getNodePosition(targetNode.position);

      const sourceEndX = source.x + Math.cos(source.angle) * sourceNode.barHeight;
      const sourceEndY = source.y + Math.sin(source.angle) * sourceNode.barHeight;
      const targetEndX = target.x + Math.cos(target.angle) * targetNode.barHeight;
      const targetEndY = target.y + Math.sin(target.angle) * targetNode.barHeight;

      const controlOffset = Math.max(52, Math.min(96, width * 0.065));
      const midX = Math.min(width - 24, (sourceEndX + targetEndX) / 2 + controlOffset);
      const midY = (sourceEndY + targetEndY) / 2;

      return `M ${sourceEndX} ${sourceEndY} Q ${midX} ${midY} ${targetEndX} ${targetEndY}`;
    },
    [getNodePosition, width]
  );

  const handleNodeHover = useCallback(
    (node: FlowNode | null) => {
      setHoveredNode(node?.id ?? null);
      if (node?.sampleToken) {
        onTokenHover(node.sampleToken.id);
      } else {
        onTokenHover(null);
      }
    },
    [onTokenHover]
  );

  const handleNodeClick = useCallback(
    (node: FlowNode) => {
      if (node.sampleToken) {
        onTokenFocus(node.sampleToken.id);
      }
    },
    [onTokenFocus]
  );

  // Mouse AND keyboard share this: the arc's onFocus/onBlur call the same
  // setter as onMouseEnter/onMouseLeave, so Tab-ing to a connection gets the
  // identical highlight + tooltip a mouse hover would.
  const handleConnectionHover = useCallback((connectionId: string | null) => {
    setHoveredConnectionId(connectionId);
  }, []);

  const hoveredNodeData = useMemo(
    () => (hoveredNode ? nodeById.get(hoveredNode) ?? null : null),
    [hoveredNode, nodeById]
  );

  const hoveredConnectionData = useMemo(
    () => (hoveredConnectionId ? connections.find((conn) => conn.id === hoveredConnectionId) ?? null : null),
    [hoveredConnectionId, connections]
  );

  const handleZoomIn = useCallback(() => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    d3.select(svgRef.current)
      .transition()
      .duration(motionSafeDuration(180))
      .call(zoomBehaviorRef.current.scaleBy, 1.2);
  }, []);

  const handleZoomOut = useCallback(() => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    d3.select(svgRef.current)
      .transition()
      .duration(motionSafeDuration(180))
      .call(zoomBehaviorRef.current.scaleBy, 0.85);
  }, []);

  const handleResetZoom = useCallback(() => {
    fitGraphToView(svgRef.current, gRef.current, zoomBehaviorRef.current, {
      duration: motionSafeDuration(750),
    });
  }, []);

  const selectedSummary = useMemo(() => {
    const items: Array<{ kind: "surah" | "ayah" | "root" | "lemma"; label: string; value: string }> = [];
    if (selectedSurahId) items.push({ kind: "surah", label: ts("surah"), value: String(selectedSurahId) });
    if (selectedAyah) items.push({ kind: "ayah", label: ts("ayah"), value: String(selectedAyah) });
    if (selectedRoot) items.push({ kind: "root", label: ts("root"), value: selectedRoot });
    if (selectedLemma) items.push({ kind: "lemma", label: ts("lemma"), value: selectedLemma });
    return items;
  }, [selectedSurahId, selectedAyah, selectedRoot, selectedLemma, ts]);

  const activeGroupLabel =
    activeGroupBy === "root" ? ts("root") : activeGroupBy === "pos" ? ts("pos") : ts("ayah");

  const sidebarCards = (
    <div className={`viz-left-stack arcflow-sidebar-stack ${!isLeftSidebarOpen ? 'collapsed' : ''}`}>

      <div className="viz-left-panel" style={{ display: "grid", gap: "10px" }} data-testid="arc-flow-control-card">
        <h2 style={{ margin: 0 }}>{t("title")}</h2>

        <div style={{ fontSize: "0.83rem", color: "var(--ink-secondary)" }}>
          {t("groups", { count: nodes.length, linkCount: connections.length })}
        </div>

        {isBeginner ? null : (
          <div className="mode-switcher" data-testid="arc-flow-group-controls">
            <button
              className={`mode-switcher-btn ${activeGroupBy === "root" ? "active" : ""}`}
              onClick={() => setActiveGroupBy("root")}
            >
              {t("byRoot")}
            </button>
            <button
              className={`mode-switcher-btn ${activeGroupBy === "pos" ? "active" : ""}`}
              onClick={() => setActiveGroupBy("pos")}
            >
              {t("byPOS")}
            </button>
            <button
              className={`mode-switcher-btn ${activeGroupBy === "ayah" ? "active" : ""}`}
              onClick={() => setActiveGroupBy("ayah")}
            >
              {t("byAyah")}
            </button>
          </div>
        )}

        <div style={{ display: "grid", gap: "6px", fontSize: "0.78rem", color: "var(--ink-muted)" }}>
          <span>{t("groupedBy", { value: activeGroupLabel })}</span>
          {selectedAyah ? <span>{t("ayahContext", { value: selectedAyah })}</span> : null}
          {activeGroupBy === "pos" ? (
            <span style={{ lineHeight: 1.35 }}>
              {t("posMapping")}
            </span>
          ) : null}
        </div>

        <div style={{ display: "grid", gap: "8px" }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="clear-focus" onClick={handleZoomOut}>
              -
            </button>
            <button type="button" className="clear-focus" onClick={handleZoomIn}>
              +
            </button>
            <button type="button" className="clear-focus" onClick={handleResetZoom}>
              {ts("focus")}
            </button>
          </div>
          <span style={{ fontSize: "0.74rem", color: "var(--ink-muted)" }}>
            {t("modeDescription")}
          </span>
        </div>
      </div>

      {/* Root Search - only in root mode */}
      {!isBeginner && activeGroupBy === "root" && (
        <div className="viz-left-panel" style={{ display: "grid", gap: "8px" }} data-testid="arc-flow-root-search">
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
                {filteredRoots.map(r => (
                  <button
                    key={r.root}
                    className={`viz-root-search-item ${internalSelectedRoot === r.root ? 'active' : ''}`}
                    role="option"
                    aria-selected={internalSelectedRoot === r.root}
                    onClick={() => {
                      setInternalSelectedRoot(prev => prev === r.root ? null : r.root);
                      setRootSearchQuery("");
                    }}
                  >
                    <span className="root-name">{r.root}</span>
                    <span className="root-count">{r.total.toLocaleString(locale)}{r.gloss ? ` · ${r.gloss}` : ''}</span>
                  </button>
                ))}
              </div>
            )}
            {rootSearchQuery.trim() && filteredRoots.length === 0 && (
              <span className="viz-root-search-hint">{t("noRootFound")}</span>
            )}
            {!rootSearchQuery.trim() && (
              <span className="viz-root-search-hint">
                {t("searchRootHint", { count: allRootsSorted.length })}
              </span>
            )}
            {internalSelectedRoot && (
              <button
                className="viz-root-search-item active"
                style={{ marginTop: 4 }}
                onClick={() => setInternalSelectedRoot(null)}
              >
                <span className="root-name">{internalSelectedRoot}</span>
                <span className="root-count">{ts("clear")}</span>
              </button>
            )}
          </div>
        </div>
      )}

      <div className="viz-left-panel" style={{ display: "grid", gap: "8px" }}>
        <div className="viz-tooltip-title" style={{ fontSize: "0.92rem" }}>{t("linkedSelection")}</div>
        {selectedSummary.length > 0 ? (
          <div style={{ display: "grid", gap: "6px" }}>
            {selectedSummary.map((item) => (
              <div key={item.label} className="viz-tooltip-row" style={{ borderTop: "none", padding: 0 }}>
                <span className="viz-tooltip-label">{item.label}</span>
                <span
                  className="viz-tooltip-value arabic-text"
                  data-testid={`arc-flow-summary-${item.kind}`}
                >
                  {item.value}
                </span>
              </div>
            ))}

            {fullAyahText && (
              <div className="viz-tooltip-subtitle arabic-text" style={{
                marginTop: '0.5rem',
                fontSize: '1.3rem',
                lineHeight: '1.6',
                textAlign: 'right',
                direction: 'rtl',
                width: '100%',
                color: 'var(--ink-primary)',
                paddingTop: '0.5rem',
                borderTop: '1px solid var(--line)',
              }}>
                {fullAyahText}
              </div>
            )}
          </div>
        ) : (
          <div style={{ fontSize: "0.8rem", color: "var(--ink-muted)" }}>
            {t("noSelection")}
          </div>
        )}
      </div>

      <div className="viz-legend">
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', justifyContent: 'space-between', width: '100%' }}>
          <span className="eyebrow" style={{ fontSize: '0.7em' }}>{ts("legend")}</span>
          <HelpIcon onClick={() => setShowHelp(true)} />
        </div>
        <div className="viz-legend-item">
          <div
            className="viz-legend-line"
            style={{
              background: activeGroupBy === "root"
                ? lexicalColorMode === "frequency"
                  ? `linear-gradient(90deg, ${getFrequencyColor(0.05, theme)}, ${getFrequencyColor(0.45, theme)}, ${getFrequencyColor(0.95, theme)})`
                  : lexicalColorMode === "identity"
                    ? `linear-gradient(90deg, ${getIdentityColor("root-a", theme)}, ${getIdentityColor("root-b", theme)}, ${getIdentityColor("root-c", theme)})`
                    : `linear-gradient(90deg, ${ROOT_ARC_RAMP[theme].join(", ")})`
                : `linear-gradient(90deg, ${GRADIENT_PALETTES.vibrant.join(", ")})`,
            }}
          />
          <span>
            {activeGroupBy === "root"
              ? t("rootLegend")
              : t("posLegend")}
          </span>
        </div>
        <div className="viz-legend-item">
          <div className="viz-legend-line" style={{ background: themeColors.accentSecondary }} />
          <span>{t("contextLinks")}</span>
        </div>
        <div className="viz-legend-item">
          <div
            className="viz-legend-line"
            style={{
              background: "var(--line)",
              height: 2,
            }}
          />
          <span>
            {activeGroupBy === "root"
              ? t("linksRoot")
              : activeGroupBy === "pos"
                ? t("linksPOS")
                : t("linksAyah")}
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <section className="immersive-viz" data-theme={theme} style={{ width: "100%", height: "100%", position: "relative" }}>
      {isMounted && typeof document !== "undefined" && document.getElementById("viz-sidebar-portal")
        ? createPortal(sidebarCards, document.getElementById("viz-sidebar-portal")!)
        : null}

      <VizExplainerDialog
        isOpen={showHelp}
        onClose={() => setShowHelp(false)}
        content={{
          title: t("Help.title"),
          description: t("Help.description"),
          sections: [
            { label: t("Help.rootLabel"), text: t("Help.rootText") },
            { label: t("Help.posLabel"), text: t("Help.posText") },
            { label: t("Help.ayahLabel"), text: t("Help.ayahText") },
            { label: t("Help.tipsLabel"), text: t("Help.tipsText") },
          ]
        }}
        theme={theme}
      />

      <div
        ref={containerRef}
        className="viz-container"
        style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0 }}
      >
        {!isMounted ? null : (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${width} ${height}`}
            className="radial-arc viz-canvas"
            style={{ width: "100%", height: "100%", cursor: "grab", touchAction: "none" }}
          >
            <g ref={gRef}>
              <defs>
                {connections.map((conn, idx) => (
                  <linearGradient key={conn.id} id={`grad-${idx}`} x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor={conn.isContextMatch ? themeColors.accentSecondary : conn.color} stopOpacity="0.8" />
                    <stop offset="50%" stopColor={themeColors.accentSecondary} stopOpacity="0.45" />
                    <stop offset="100%" stopColor={conn.isContextMatch ? themeColors.accentSecondary : conn.color} stopOpacity="0.8" />
                  </linearGradient>
                ))}

                <filter id="barGlow" x="-60%" y="-60%" width="220%" height="220%">
                  <feGaussianBlur stdDeviation="4" result="coloredBlur" />
                  <feMerge>
                    <feMergeNode in="coloredBlur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              <g className="connections">
                {connections.map((conn, idx) => {
                  const sourceNode = nodeById.get(conn.sourceId);
                  const targetNode = nodeById.get(conn.targetId);
                  if (!sourceNode || !targetNode) return null;

                  const isHoverHit =
                    hoveredNode === conn.sourceId ||
                    hoveredNode === conn.targetId ||
                    hoveredConnectionId === conn.id;
                  const isContextHit =
                    conn.isContextMatch ||
                    contextNodeIds.has(conn.sourceId) ||
                    contextNodeIds.has(conn.targetId);

                  // Scope-normalized: sqrt keeps low-weight arcs visible
                  // while still clearly differentiating the heaviest ones —
                  // no fixed cap, so a busy scope's top pairs can't all
                  // saturate to the same width (the old `Math.min(7, ...)`
                  // did exactly that above weight ~10.5). The hover boost is
                  // additive on top of that base, so a hovered thin arc
                  // still thickens but a hovered thick arc never gets
                  // thinner than it already was.
                  const baseStrokeWidth = 1 + 5.5 * Math.sqrt(conn.weight / maxConnectionWeight);
                  const strokeWidth = isHoverHit ? baseStrokeWidth + 2.5 : baseStrokeWidth;
                  const connectionLabel = `${sourceNode.label} ↔ ${targetNode.label} · ${t("sharedVerses", { count: conn.weight })}`;

                  return (
                    <motion.path
                      key={conn.id}
                      d={generateConnectionPath(sourceNode, targetNode)}
                      className={`connection ${isHoverHit ? "highlighted" : ""}`}
                      fill="none"
                      stroke={`url(#grad-${idx})`}
                      strokeWidth={strokeWidth}
                      strokeLinecap="round"
                      role="img"
                      aria-label={connectionLabel}
                      tabIndex={0}
                      style={{ cursor: "help" }}
                      onMouseEnter={() => handleConnectionHover(conn.id)}
                      onMouseLeave={() => handleConnectionHover(null)}
                      onFocus={() => handleConnectionHover(conn.id)}
                      onBlur={() => handleConnectionHover(null)}
                      initial={{ pathLength: 0, opacity: 0 }}
                      animate={{
                        pathLength: 1,
                        opacity: isHoverHit ? 0.95 : isContextHit ? 0.7 : 0.42,
                      }}
                      transition={{
                        duration: motionSafeDuration(1500) / 1000,
                        delay: motionSafeStagger(idx, 20, 600) / 1000,
                      }}
                      filter={isHoverHit || isContextHit ? "url(#barGlow)" : undefined}
                    />
                  );
                })}
              </g>

              <g className="nodes">
                {nodes.map((node, idx) => {
                  const pos = getNodePosition(node.position);
                  const isHovered = hoveredNode === node.id;
                  const isContextNode = node.isContextMatch;

                  const barEndX = pos.x + Math.cos(pos.angle) * node.barHeight;
                  const barEndY = pos.y + Math.sin(pos.angle) * node.barHeight;

                  const showLabel =
                    isHovered ||
                    isContextNode ||
                    (activeGroupBy === "pos") ||
                    (activeGroupBy === "root"
                      ? (idx < 18 || zoomLevel > 1 || node.count > maxCount * 0.18)
                      : node.count > maxCount * 0.45);
                  const labelOffset = activeGroupBy === "root" ? 16 : 14;
                  const labelX = barEndX + Math.cos(pos.angle) * labelOffset;
                  const labelY = barEndY + Math.sin(pos.angle) * labelOffset;
                  const labelOnLeft = pos.angle > Math.PI / 2 || pos.angle < -Math.PI / 2;

                  return (
                    <motion.g
                      key={node.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{
                        duration: motionSafeDuration(300) / 1000,
                        delay: motionSafeStagger(idx, 12, 600) / 1000,
                      }}
                      style={{ cursor: "pointer" }}
                      onMouseEnter={() => handleNodeHover(node)}
                      onMouseLeave={() => handleNodeHover(null)}
                      onClick={() => handleNodeClick(node)}
                    >
                      <motion.line
                        x1={pos.x}
                        y1={pos.y}
                        x2={barEndX}
                        y2={barEndY}
                        stroke={isHovered ? themeColors.accent : isContextNode ? themeColors.accentSecondary : node.color}
                        strokeWidth={isHovered ? 4.4 : isContextNode ? 3.4 : 2.6}
                        strokeLinecap="round"
                        filter={isHovered || isContextNode ? "url(#barGlow)" : undefined}
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{
                          duration: motionSafeDuration(700) / 1000,
                          delay: motionSafeStagger(idx, 10, 600) / 1000,
                        }}
                      />

                      <circle
                        cx={barEndX}
                        cy={barEndY}
                        r={isHovered ? 5 : isContextNode ? 4.2 : 3}
                        fill={isHovered ? themeColors.accent : isContextNode ? themeColors.accentSecondary : node.color}
                        filter={isHovered || isContextNode ? "url(#barGlow)" : undefined}
                      />

                      {isContextNode && !isHovered && (
                        <circle
                          cx={barEndX}
                          cy={barEndY}
                          r={7}
                          fill="none"
                          stroke="var(--line)"
                          strokeWidth={1.2}
                        />
                      )}

                      {showLabel && (
                        <motion.text
                          x={labelX}
                          y={labelY}
                          fill={themeColors.textColors.secondary}
                          fontSize={isHovered || isContextNode ? 12 : activeGroupBy === "root" ? 11 : 10}
                          fontWeight={isHovered || isContextNode ? 600 : 400}
                          textAnchor={labelOnLeft ? "end" : "start"}
                          className="arabic-text"
                          style={{
                            paintOrder: "stroke",
                            stroke: "var(--bg-1)",
                            strokeWidth: 2.4,
                          }}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={reduceMotion ? { duration: 0 } : undefined}
                        >
                          {node.label}
                        </motion.text>
                      )}
                    </motion.g>
                  );
                })}
              </g>

            </g>
          </svg>
        )}

        <AnimatePresence>
          {(hoveredNodeData || hoveredConnectionData) && (
            <motion.div
              className="viz-tooltip"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={reduceMotion ? { duration: 0 } : undefined}
              style={{
                position: "absolute",
                bottom: 20,
                right: 20,
                transform: "none",
              }}
            >
              {hoveredNodeData ? (
                <>
                  <div className="viz-tooltip-title arabic-text">{hoveredNodeData.label}</div>
                  <div className="viz-tooltip-subtitle">
                    {activeGroupBy === "root" ? ts("root") : activeGroupBy === "pos" ? ts("pos") : ts("ayah")}
                  </div>
                  {activeGroupBy === "pos" ? (
                    <div className="viz-tooltip-row">
                      <span className="viz-tooltip-label">{t("posMeaning")}</span>
                      <span className="viz-tooltip-value">{getPosLabel(hoveredNodeData.label, ts)}</span>
                    </div>
                  ) : null}
                  <div className="viz-tooltip-row">
                    <span className="viz-tooltip-label">{ts("occurrences")}</span>
                    <span className="viz-tooltip-value">{hoveredNodeData.count}</span>
                  </div>
                  {hoveredNodeData.matchCount > 0 && (
                    <div className="viz-tooltip-row">
                      <span className="viz-tooltip-label">{t("contextMatches")}</span>
                      <span className="viz-tooltip-value">{hoveredNodeData.matchCount}</span>
                    </div>
                  )}
                  {hoveredNodeData.sampleToken && (
                    <>
                      <div className="viz-tooltip-row">
                        <span className="viz-tooltip-label">{ts("lemma")}</span>
                        <span className="viz-tooltip-value arabic-text">{hoveredNodeData.sampleToken.text}</span>
                      </div>
                      <div className="viz-tooltip-row">
                        <span className="viz-tooltip-label">{ts("ref")}</span>
                        <span className="viz-tooltip-value">
                          {hoveredNodeData.sampleToken.sura}:{hoveredNodeData.sampleToken.ayah}
                        </span>
                      </div>
                    </>
                  )}
                </>
              ) : hoveredConnectionData ? (
                <>
                  <div className="viz-tooltip-title arabic-text">
                    {(nodeById.get(hoveredConnectionData.sourceId)?.label ?? hoveredConnectionData.sourceId)}
                    {" ↔ "}
                    {(nodeById.get(hoveredConnectionData.targetId)?.label ?? hoveredConnectionData.targetId)}
                  </div>
                  <div className="viz-tooltip-subtitle">
                    {t("sharedVerses", { count: hoveredConnectionData.weight })}
                  </div>
                </>
              ) : null}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <style jsx global>{`
        .viz-sidebar-stack.arcflow-scrollless {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }

        .viz-sidebar-stack.arcflow-scrollless::-webkit-scrollbar {
          width: 0;
          height: 0;
          display: none;
        }

        /* Keyboard focus on an arc already gets a strong visible signal from
           its own highlight state (thicker stroke, higher opacity, glow —
           see isHoverHit above, true on focus same as hover), which reads
           far better on a thin curved path than the browser's default
           bounding-box outline. Suppress that default and let the highlight
           carry it, same pattern as .dialog-close-btn's focus-visible rule. */
        .connection:focus-visible {
          outline: none;
        }
      `}</style>
    </section>
  );
}
