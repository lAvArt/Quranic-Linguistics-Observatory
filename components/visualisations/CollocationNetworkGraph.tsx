"use client";

import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import * as d3 from "@/lib/viz/d3";
import { motion, AnimatePresence } from "framer-motion";
import type { CorpusToken, PartOfSpeech } from "@/lib/schema/types";
import type { ExperienceLevel } from "@/lib/schema/experience";
import { resolveVisualizationTheme } from "@/lib/schema/visualizationTypes";
import { useTranslations } from "next-intl";
import { getAyah } from "@/lib/corpus/corpusLoader";
import {
    calculateRootFrequencies,
    getCollocations,
    getPairCooccurrence,
    type CollocationOptions,
    type CollocationGroupKind,
    type CollocationTermKind,
    type RootFrequencyData,
} from "@/lib/search/collocation";
import { HelpIcon, VizExplainerDialog } from "@/components/ui/VizExplainerDialog";
import { fitGraphToView } from "@/lib/viz/fitToView";
import { motionSafeDuration, prefersReducedMotion } from "@/lib/viz/motionPrefs";

interface CollocationNetworkGraphProps {
    tokens: CorpusToken[];
    onTokenHover: (tokenId: string | null) => void;
    onTokenFocus: (tokenId: string) => void;
    onRootSelect?: (root: string | null) => void;
    experienceLevel?: ExperienceLevel;
    highlightRoot?: string | null;
    selectedSurahId?: number;
    theme?: "light" | "dark";
}

interface CollocationNode {
    id: string;
    label: string;
    type: "target" | "collocate" | "tendril";
    count: number;
    pmi: number;
    anchorAngle: number;
    anchorDistance: number;
    cluster: number;
    parentId?: string;
    x?: number;
    y?: number;
    fx?: number | null;
    fy?: number | null;
    radius: number;
    color: string;
    sampleLemmas: string[];
}

interface CollocationLink {
    source: string | CollocationNode;
    target: string | CollocationNode;
    pmi: number;
    weight: number;
    kind: "trunk" | "branch";
    color: string;
    intensity: number;
}

interface StarPoint {
    x: number;
    y: number;
    radius: number;
    opacity: number;
    color: string;
}

interface LemmaBloomItem {
    id: string;
    label: string;
    x: number;
    y: number;
    anchorX: number;
    anchorY: number;
    textAnchor: "start" | "end";
    color: string;
}

// The data spectrum (lib/schema/visualizationTypes.ts), not the old neon set.
const FALLBACK_NEON_PALETTE = ["#e8924a", "#56a697", "#8e84cc", "#9fd4c4", "#e6c24e", "#dd6a47"];
const POS_OPTIONS: Array<PartOfSpeech> = ["N", "V", "P", "ADJ", "PRON"];
const ARABIC_DIACRITICS_REGEX = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const TATWEEL_REGEX = /\u0640/g;

function normalizeArabicForMatch(value: string): string {
    if (!value) return "";
    return value
        .normalize("NFKC")
        .replace(TATWEEL_REGEX, "")
        .replace(ARABIC_DIACRITICS_REGEX, "")
        .trim();
}

function extractAyahRef(value: string): string | null {
    const match = value.match(/^(\d+):(\d+)(?::\d+)?$/);
    if (!match) return null;
    return `${match[1]}:${match[2]}`;
}

function parseAyahRef(value: string): { sura: number; ayah: number } | null {
    const match = value.match(/^(\d+):(\d+)(?::\d+)?$/);
    if (!match) return null;
    return { sura: Number(match[1]), ayah: Number(match[2]) };
}

function hashString(value: string): number {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
        hash = (hash << 5) - hash + value.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
}

function mulberry32(seed: number) {
    let t = seed;
    return () => {
        t += 0x6d2b79f5;
        let x = Math.imul(t ^ (t >>> 15), 1 | t);
        x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
}

function withAlpha(colorValue: string, alpha: number): string {
    const color = d3.color(colorValue);
    if (!color) return colorValue;
    color.opacity = Math.max(0, Math.min(1, alpha));
    return color.formatRgb();
}

function brighten(colorValue: string, amount: number): string {
    const color = d3.hsl(colorValue);
    color.l = Math.min(0.92, color.l + amount * 0.35);
    color.s = Math.min(1, color.s + amount * 0.2);
    return color.formatHex();
}

function tuneForTheme(colorValue: string, theme: "light" | "dark", lift: number): string {
    const color = d3.hsl(colorValue);
    if (theme === "dark") {
        color.l = Math.min(0.88, color.l + lift);
        color.s = Math.min(1, color.s + 0.08);
    } else {
        color.l = Math.max(0.25, color.l - lift * 0.35);
        color.s = Math.min(1, color.s + 0.05);
    }
    return color.formatHex();
}

function buildCurvedPath(source: CollocationNode, target: CollocationNode, bendScale: number): string {
    const sx = source.x ?? 0;
    const sy = source.y ?? 0;
    const tx = target.x ?? 0;
    const ty = target.y ?? 0;
    const dx = tx - sx;
    const dy = ty - sy;
    const dist = Math.max(Math.hypot(dx, dy), 1);
    const nx = -dy / dist;
    const ny = dx / dist;
    const direction = hashString(`${source.id}:${target.id}`) % 2 === 0 ? 1 : -1;
    const bend = Math.min(120, dist * bendScale) * direction;
    const cx = (sx + tx) / 2 + nx * bend;
    const cy = (sy + ty) / 2 + ny * bend;
    return `M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}`;
}

// Rendered collocate slots per neighborhood (~40 nodes) — keeps the force graph
// legible and performant. Pre-existing cap; now surfaced via nodeCapDisclosure
// instead of truncating silently.
const COLLOCATE_NODE_CAP = 34;

// Root used to seed a neighborhood preview when nothing is selected yet
// (e.g. the bare `?viz=collocation-network` deep link). رحم ("mercy/womb")
// is chosen for thematic resonance (Ar-Rahman/Ar-Raheem) and is reliably
// dense in co-occurrences.
const SEEDED_EXAMPLE_ROOT = "رحم";

/**
 * Picks the root used for the seeded "no selection yet" example neighborhood.
 * Prefers SEEDED_EXAMPLE_ROOT when it is actually present in the loaded
 * corpus; otherwise falls back to the most frequent root present so the
 * example never renders empty.
 */
function pickSeededExampleRoot(freqData: RootFrequencyData): string {
    const normalizedSeed = normalizeArabicForMatch(SEEDED_EXAMPLE_ROOT);
    let seedPresent = false;
    let fallbackKey = "";
    let fallbackCount = -1;

    for (const [key, count] of freqData.rootFrequencies.entries()) {
        if (normalizeArabicForMatch(key) === normalizedSeed) {
            seedPresent = true;
        }
        if (count > fallbackCount) {
            fallbackCount = count;
            fallbackKey = key;
        }
    }

    return seedPresent ? SEEDED_EXAMPLE_ROOT : fallbackKey;
}

// Fixed semantic amber for the "heuristic estimate" honesty badge — kept
// independent of the user's selected accent theme (accent/accent-2 shift
// per color theme, see lib/theme/colorThemes.ts) so the caution signal
// stays recognizable no matter which palette is active.
const HEURISTIC_AMBER = {
    dark: { fg: "#f0b074", border: "rgba(232, 146, 74, 0.55)", bg: "rgba(232, 146, 74, 0.12)" },
    light: { fg: "#92400e", border: "rgba(180, 83, 9, 0.5)", bg: "rgba(180, 83, 9, 0.1)" },
} as const;

export default function CollocationNetworkGraph({
    tokens,
    onTokenHover: _onTokenHover,
    onTokenFocus: _onTokenFocus,
    onRootSelect,
    experienceLevel = "advanced",
    highlightRoot,
    selectedSurahId: _selectedSurahId,
    theme = "dark",
}: CollocationNetworkGraphProps) {
    const t = useTranslations("Visualizations.CollocationNetwork");
    const ts = useTranslations("Visualizations.Shared");
    const svgRef = useRef<SVGSVGElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const simulationRef = useRef<d3.Simulation<CollocationNode, CollocationLink> | null>(null);
    const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
    const gRef = useRef<SVGGElement>(null);

    const [dimensions, setDimensions] = useState({ width: 900, height: 650 });
    const [hoveredNode, setHoveredNode] = useState<string | null>(null);
    const [selectedNode, setSelectedNode] = useState<string | null>(null);
    const [nodes, setNodes] = useState<CollocationNode[]>([]);
    const [links, setLinks] = useState<CollocationLink[]>([]);
    const [isMounted, setIsMounted] = useState(false);
    const [isTouchPrimaryInput, setIsTouchPrimaryInput] = useState(false);
    const liveNodesRef = useRef<CollocationNode[]>([]);

    // Controls
    const [windowType, setWindowType] = useState<CollocationOptions["windowType"]>("ayah");
    const [distance, setDistance] = useState<number>(3);
    const [minFrequency, setMinFrequency] = useState<number>(2);
    const [targetKind, setTargetKind] = useState<CollocationTermKind>("root");
    const [targetValue, setTargetValue] = useState<string>(highlightRoot ?? "");
    const [groupBy, setGroupBy] = useState<CollocationGroupKind>("root");
    const [filterPos, setFilterPos] = useState<PartOfSpeech | "">("");
    const [pairKind, setPairKind] = useState<CollocationTermKind>("lemma");
    const [pairValue, setPairValue] = useState<string>("");
    const [showHelp, setShowHelp] = useState(false);
    const [sidebarAyahText, setSidebarAyahText] = useState<string | null>(null);
    const isBeginner = experienceLevel === "beginner";

    const themeColors = resolveVisualizationTheme(theme);
    // Framer-motion pulse/reveal animations below are JS-driven and bypass
    // the global CSS prefers-reduced-motion rule (globals.css) — gate them
    // manually. Read once per render; matchMedia-backed, SSR-safe.
    const reduceMotion = prefersReducedMotion();
    const neonPalette = useMemo(() => {
        const source = [
            themeColors.accent,
            themeColors.accentSecondary,
            themeColors.glowColors.accent,
            themeColors.glowColors.secondary,
            themeColors.nodeColors.default,
            themeColors.nodeColors.selected,
        ].filter(Boolean);
        const base = source.length >= 4 ? source : FALLBACK_NEON_PALETTE;
        return base.map((color, index) => tuneForTheme(color, theme, 0.1 + index * 0.03));
    }, [
        theme,
        themeColors.accent,
        themeColors.accentSecondary,
        themeColors.glowColors.accent,
        themeColors.glowColors.secondary,
        themeColors.nodeColors.default,
        themeColors.nodeColors.selected,
    ]);
    const starPalette = useMemo(
        () => neonPalette.map((color, index) => tuneForTheme(color, theme, 0.18 + index * 0.02)),
        [neonPalette, theme]
    );
    const canvasSurface = useMemo(() => {
        const base = d3.hsl(themeColors.background);
        // Barely lifted at the centre: a 16% lift read as a teal glow behind
        // the whole graph, the old design's.
        const inner = base.copy();
        inner.l = Math.min(0.96, base.l + (theme === "dark" ? 0.035 : 0.02));
        const mid = base.copy();
        mid.l = Math.min(0.92, base.l + (theme === "dark" ? 0.015 : 0.01));
        const outer = base.copy();
        outer.l = Math.max(0.03, base.l - (theme === "dark" ? 0.03 : 0.01));
        outer.s = Math.max(0.05, base.s - 0.03);
        return {
            inner: inner.formatHex(),
            mid: mid.formatHex(),
            outer: outer.formatHex(),
            section: `radial-gradient(circle at 50% 45%, ${inner.formatHex()} 0%, ${mid.formatHex()} 42%, ${outer.formatHex()} 100%)`,
        };
    }, [theme, themeColors.background]);
    const panelBg = useMemo(
        () => (theme === "dark" ? "var(--panel)" : "rgba(247, 251, 255, 0.9)"),
        [theme]
    );
    const panelBorder = useMemo(
        () => (theme === "dark" ? "var(--line)" : "rgba(35, 74, 133, 0.24)"),
        [theme]
    );
    const labelStroke = theme === "dark" ? "var(--bg-0)" : "rgba(255, 255, 255, 0.95)";
    const targetNodeFill = theme === "dark" ? "var(--ink)" : tuneForTheme(themeColors.nodeColors.default, theme, 0.04);
    const legendStrong = withAlpha(themeColors.accentSecondary, theme === "dark" ? 0.88 : 0.8);
    const legendSoft = withAlpha(themeColors.edgeColors.default, theme === "dark" ? 0.75 : 0.6);
    const lemmaBloomColor = useMemo(
        () => tuneForTheme(themeColors.accentSecondary, theme, theme === "dark" ? 0.24 : 0.1),
        [theme, themeColors.accentSecondary]
    );
    const controlRowSurface = theme === "dark" ? "var(--bg-1)" : "rgba(236, 244, 255, 0.9)";
    const controlFieldStyle = {
        background: theme === "dark" ? "var(--bg-2)" : "rgba(255,255,255,0.98)",
        color: theme === "dark" ? "var(--ink)" : "#10284b",
        border: `1px solid ${theme === "dark" ? "var(--line)" : "rgba(53, 94, 162, 0.35)"}`,
        borderRadius: 7,
        padding: "4px 8px",
        fontSize: "0.76rem",
        lineHeight: 1.25,
        minHeight: 28,
    } as const;
    const controlLabelStyle = {
        fontSize: "0.72rem",
        color: theme === "dark" ? "var(--ink-secondary)" : "#335785",
        letterSpacing: "0.01em",
        minWidth: 82,
    } as const;

    const freqData = useMemo(() => calculateRootFrequencies(tokens), [tokens]);
    const seededExampleRoot = useMemo(() => pickSeededExampleRoot(freqData), [freqData]);

    const normalizedTargetValue = useMemo(() => targetValue.trim(), [targetValue]);
    const normalizedPairValue = useMemo(() => pairValue.trim(), [pairValue]);
    // No root selected yet (no manual input, no highlighted root): seed the
    // view with a real neighborhood instead of the empty state, framed as an
    // "Example" — see isSeededExample usage below.
    const isSeededExample = targetKind === "root" && !normalizedTargetValue && !highlightRoot && Boolean(seededExampleRoot);
    const activeTargetValue = normalizedTargetValue
        || (targetKind === "root" ? (highlightRoot || (isSeededExample ? seededExampleRoot : "")) : "");
    const activePairValue = normalizedPairValue;
    const targetTerm = useMemo(
        () => (activeTargetValue ? { kind: targetKind, value: activeTargetValue } : null),
        [activeTargetValue, targetKind]
    );
    const pairTerm = useMemo(
        () => (activePairValue ? { kind: pairKind, value: activePairValue } : null),
        [activePairValue, pairKind]
    );

    const vizId = useMemo(
        () => `colloc-neural-${hashString(`${targetKind}:${activeTargetValue || "none"}:${groupBy}`)}`,
        [targetKind, activeTargetValue, groupBy]
    );

    // Adopt an incoming shared-root change (another graph, search, or a deep
    // link) into the target field. Tracks the previous prop value in a ref so
    // a genuine prop CHANGE always wins over a stale local edit — the old
    // `current.trim() ? current : highlightRoot` guard only ever adopted
    // before the field had any text (i.e. once, near mount); later prop
    // changes were silently ignored while the field stayed non-empty. This
    // never calls `onRootSelect` itself (see `commitTargetRoot` below for the
    // write-back direction), so the two can't loop.
    const prevHighlightRootRef = useRef(highlightRoot);
    useEffect(() => {
        const previous = prevHighlightRootRef.current;
        prevHighlightRootRef.current = highlightRoot;
        if (targetKind !== "root") return;
        if (!highlightRoot || highlightRoot === previous) return;
        setTargetValue(highlightRoot);
    }, [highlightRoot, targetKind]);

    useEffect(() => {
        if (!isBeginner) return;

        setTargetKind("root");
        setWindowType("ayah");
        setDistance(3);
        setMinFrequency(2);
        setGroupBy("root");
        setFilterPos("");
        setPairKind("lemma");
        setPairValue("");
        if (highlightRoot) {
            setTargetValue(highlightRoot);
        }
    }, [highlightRoot, isBeginner]);

    // Write-back: tell the shared selection about a root the user explicitly
    // commits to in THIS graph by typing into the target field (wired to the
    // input's blur/Enter below — not every keystroke, so mid-typing values
    // never round-trip out). Node clicks (handleNodeClick below) call
    // `onRootSelect` directly at the click site. Guarded against firing for a
    // value that already matches the shared root, so adopting an incoming
    // prop change (the effect above) can never echo back out as a write.
    const commitTargetRoot = useCallback(() => {
        if (targetKind !== "root" || !onRootSelect) return;
        const trimmed = targetValue.trim();
        if (!trimmed || trimmed === highlightRoot) return;
        onRootSelect(trimmed);
    }, [targetKind, targetValue, onRootSelect, highlightRoot]);

    const targetCount = useMemo(() => {
        if (!targetTerm) return 0;
        const normalized = normalizeArabicForMatch(targetTerm.value);
        if (!normalized) return 0;

        if (windowType === "ayah") {
            const windowSet = new Set<string>();
            for (const token of tokens) {
                const tokenValue = targetTerm.kind === "lemma" ? token.lemma : token.root;
                if (normalizeArabicForMatch(tokenValue) === normalized) {
                    windowSet.add(`${token.sura}:${token.ayah}`);
                }
            }
            return windowSet.size;
        }

        let total = 0;
        for (const token of tokens) {
            const tokenValue = targetTerm.kind === "lemma" ? token.lemma : token.root;
            if (normalizeArabicForMatch(tokenValue) === normalized) {
                total++;
            }
        }
        return total;
    }, [targetTerm, windowType, tokens]);

    const pairMetrics = useMemo(() => {
        if (!targetTerm || !pairTerm) return null;
        return getPairCooccurrence(targetTerm, pairTerm, tokens, { windowType, distance });
    }, [targetTerm, pairTerm, tokens, windowType, distance]);

    const { initialNodes, initialLinks, totalCollocateCount } = useMemo(() => {
        if (!targetTerm) return { initialNodes: [], initialLinks: [], totalCollocateCount: 0 };

        const results = getCollocations(targetTerm, tokens, freqData, {
            windowType,
            distance,
            minFrequency,
            groupBy,
            filter: {
                pos: filterPos ? [filterPos] : undefined,
            },
            pairTerm,
        });
        if (results.length === 0) return { initialNodes: [], initialLinks: [], totalCollocateCount: 0 };

        const topResults = results.slice(0, COLLOCATE_NODE_CAP);
        const [rawMinPmi = 0, rawMaxPmi = 1] = d3.extent(topResults, (d) => d.pmi);
        const minPmi = Number.isFinite(rawMinPmi) ? rawMinPmi : 0;
        const maxPmi = Number.isFinite(rawMaxPmi) ? rawMaxPmi : 1;
        const pmiDomain: [number, number] = minPmi === maxPmi ? [minPmi - 1, maxPmi + 1] : [minPmi, maxPmi];
        const maxCount = Math.max(...topResults.map((d) => d.count), 1);

        const pmiNorm = d3.scaleLinear().domain(pmiDomain).range([0, 1]).clamp(true);
        const radiusScale = d3.scaleSqrt().domain(pmiDomain).range([6, 16]).clamp(true);
        const distanceScale = d3.scaleLinear().domain([pmiDomain[1], pmiDomain[0]]).range([140, 370]).clamp(true);
        const tendrilScale = d3.scaleLinear().domain([1, maxCount]).range([2, 10]).clamp(true);

        const nodesResult: CollocationNode[] = [];
        const linksResult: CollocationLink[] = [];

        const sectorCount = Math.min(7, Math.max(4, Math.ceil(Math.sqrt(topResults.length))));
        const sectorAngles = d3
            .range(sectorCount)
            .map((idx) => (-Math.PI * 0.95) + (idx * Math.PI * 1.9) / Math.max(1, sectorCount - 1));

        nodesResult.push({
            id: `root-${targetTerm.value}`,
            label: targetTerm.value,
            type: "target",
            count: targetCount,
            pmi: pmiDomain[1],
            radius: 13,
            color: themeColors.accent,
            sampleLemmas: [],
            cluster: -1,
            anchorAngle: 0,
            anchorDistance: 0,
        });

        for (let index = 0; index < topResults.length; index++) {
            const res = topResults[index];
            const collocateLabel = res.label;
            const rng = mulberry32(hashString(`${targetTerm.value}:${collocateLabel}:${index}`));
            const cluster = hashString(collocateLabel) % sectorCount;
            const angle = sectorAngles[cluster] + (rng() - 0.5) * 0.52;
            const anchorDistance = distanceScale(res.pmi) + rng() * 40;
            const baseColor = neonPalette[(hashString(collocateLabel + targetTerm.value) + index) % neonPalette.length];
            const intensity = pmiNorm(res.pmi);
            const nodeColor = brighten(baseColor, 0.2 + intensity * 0.45);

            nodesResult.push({
                id: `root-${collocateLabel}`,
                label: collocateLabel,
                type: "collocate",
                count: res.count,
                pmi: res.pmi,
                radius: radiusScale(res.pmi),
                color: nodeColor,
                sampleLemmas: res.sampleLemmas,
                cluster,
                anchorAngle: angle,
                anchorDistance,
            });

            linksResult.push({
                source: `root-${targetTerm.value}`,
                target: `root-${collocateLabel}`,
                pmi: res.pmi,
                weight: res.count,
                kind: "trunk",
                color: baseColor,
                intensity,
            });

            const branchLabels = Array.from(new Set(res.sampleWindows.length > 0 ? res.sampleWindows : res.sampleLemmas));
            const baseTendrilCount = Math.max(2, Math.round(tendrilScale(res.count) + intensity * 2));
            const tendrilCount = Math.max(1, Math.min(baseTendrilCount, branchLabels.length || 1));
            for (let i = 0; i < tendrilCount; i++) {
                const tendrilAngle = angle + (rng() - 0.5) * 1.1;
                const tendrilDistance = anchorDistance + 28 + rng() * 110;
                const tendrilRadius = 1.2 + rng() * 1.9 + intensity * 0.8;
                const tendrilColor = brighten(baseColor, 0.35 + rng() * 0.4);
                const tendrilId = `tendril-${collocateLabel}-${i}`;
                const tendrilLabel = branchLabels[i] ?? `${collocateLabel}:${i + 1}`;

                nodesResult.push({
                    id: tendrilId,
                    label: tendrilLabel,
                    type: "tendril",
                    count: 1,
                    pmi: res.pmi,
                    radius: tendrilRadius,
                    color: tendrilColor,
                    sampleLemmas: [],
                    cluster,
                    anchorAngle: tendrilAngle,
                    anchorDistance: tendrilDistance,
                    parentId: `root-${collocateLabel}`,
                });

                linksResult.push({
                    source: `root-${collocateLabel}`,
                    target: tendrilId,
                    pmi: res.pmi,
                    weight: 1 + rng(),
                    kind: "branch",
                    color: tendrilColor,
                    intensity,
                });
            }
        }

        return { initialNodes: nodesResult, initialLinks: linksResult, totalCollocateCount: results.length };
    }, [targetTerm, tokens, freqData, windowType, distance, minFrequency, themeColors.accent, neonPalette, groupBy, filterPos, pairTerm, targetCount]);

    // Node cap is pre-existing (COLLOCATE_NODE_CAP); this only makes the
    // truncation visible instead of silent when more collocates exist than
    // are rendered.
    const isNodeCapped = totalCollocateCount > COLLOCATE_NODE_CAP;

    const stars = useMemo(() => {
        const seed = hashString(`${activeTargetValue || "none"}:${dimensions.width}:${dimensions.height}`);
        const rng = mulberry32(seed);
        const count = Math.max(120, Math.round((dimensions.width * dimensions.height) / 13000));
        const points: StarPoint[] = [];

        for (let i = 0; i < count; i++) {
            points.push({
                x: rng() * dimensions.width,
                y: rng() * dimensions.height,
                radius: 0.3 + rng() * 1.35,
                opacity: 0.12 + rng() * 0.55,
                color: starPalette[Math.floor(rng() * starPalette.length)],
            });
        }

        return points;
    }, [activeTargetValue, dimensions.width, dimensions.height, starPalette]);

    useEffect(() => {
        if (typeof window === "undefined") return;

        const hoverPrimaryMedia = window.matchMedia("(hover: hover)");
        const hoverAnyMedia = window.matchMedia("(any-hover: hover)");
        const coarsePrimaryMedia = window.matchMedia("(pointer: coarse)");
        const updateInputMode = () => {
            // Keep desktop hover whenever any hover-capable pointer exists (mouse/trackpad),
            // even on hybrid devices that also have touch input.
            const hasAnyHover = hoverPrimaryMedia.matches || hoverAnyMedia.matches;
            const isCoarsePrimary = coarsePrimaryMedia.matches;
            setIsTouchPrimaryInput(!hasAnyHover && isCoarsePrimary);
        };

        updateInputMode();
        hoverPrimaryMedia.addEventListener("change", updateInputMode);
        hoverAnyMedia.addEventListener("change", updateInputMode);
        coarsePrimaryMedia.addEventListener("change", updateInputMode);
        return () => {
            hoverPrimaryMedia.removeEventListener("change", updateInputMode);
            hoverAnyMedia.removeEventListener("change", updateInputMode);
            coarsePrimaryMedia.removeEventListener("change", updateInputMode);
        };
    }, []);

    useEffect(() => {
        if (!isTouchPrimaryInput) return;
        // Hover does not apply on touch-first devices; keep panel state selection-driven.
        setHoveredNode(null);
    }, [isTouchPrimaryInput]);

    // Handle Resize
    useEffect(() => {
        setIsMounted(true);
        if (!containerRef.current) return;

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setDimensions({
                    width: Math.max(entry.contentRect.width, 900),
                    height: Math.max(entry.contentRect.height, 800),
                });
            }
        });

        observer.observe(containerRef.current);
        const rect = containerRef.current.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            setDimensions({ width: Math.max(rect.width, 600), height: Math.max(rect.height, 500) });
        }
        return () => observer.disconnect();
    }, []);

    // Initialize D3 force simulation
    useEffect(() => {
        if (!svgRef.current || initialNodes.length === 0) {
            setNodes([]);
            setLinks([]);
            return;
        }

        const centerX = dimensions.width / 2;
        const centerY = dimensions.height / 2;
        const nodesCopy = initialNodes.map((node) => ({ ...node }));
        const linksCopy = initialLinks.map((link) => ({ ...link }));

        for (const node of nodesCopy) {
            const rng = mulberry32(hashString(`${activeTargetValue || "none"}:${node.id}`));
            const anchorX = centerX + Math.cos(node.anchorAngle) * node.anchorDistance;
            const anchorY = centerY + Math.sin(node.anchorAngle) * node.anchorDistance;
            node.x = anchorX + (rng() - 0.5) * 18;
            node.y = anchorY + (rng() - 0.5) * 18;
            node.fx = null;
            node.fy = null;
        }

        const targetNode = nodesCopy.find((node) => node.type === "target");
        if (targetNode) {
            targetNode.fx = centerX;
            targetNode.fy = centerY;
            targetNode.x = centerX;
            targetNode.y = centerY;
        }

        const simulation = d3
            .forceSimulation<CollocationNode>(nodesCopy)
            .force(
                "link",
                d3
                    .forceLink<CollocationNode, CollocationLink>(linksCopy)
                    .id((d) => d.id)
                    .distance((d) => {
                        if (d.kind === "trunk") {
                            const target = typeof d.target === "string"
                                ? nodesCopy.find((n) => n.id === d.target)
                                : d.target;
                            return Math.max(95, (target?.anchorDistance ?? 160) * 0.55);
                        }
                        return 22 + d.weight * 26;
                    })
                    .strength((d) => (d.kind === "trunk" ? 0.12 : 0.52))
            )
            .force(
                "charge",
                d3
                    .forceManyBody<CollocationNode>()
                    .strength((d) => {
                        if (d.type === "target") return -320;
                        if (d.type === "collocate") return -60;
                        return -8;
                    })
                    .distanceMax(320)
            )
            .force(
                "collision",
                d3.forceCollide<CollocationNode>().radius((d) => (d.type === "tendril" ? d.radius + 1.1 : d.radius + 4))
            )
            .force(
                "x",
                d3
                    .forceX<CollocationNode>((d) => centerX + Math.cos(d.anchorAngle) * d.anchorDistance)
                    .strength((d) => (d.type === "target" ? 1 : d.type === "collocate" ? 0.06 : 0.01))
            )
            .force(
                "y",
                d3
                    .forceY<CollocationNode>((d) => centerY + Math.sin(d.anchorAngle) * d.anchorDistance)
                    .strength((d) => (d.type === "target" ? 1 : d.type === "collocate" ? 0.06 : 0.01))
            )
            .alphaDecay(0.028);

        simulationRef.current = simulation;
        liveNodesRef.current = nodesCopy;

        simulation.on("tick", () => {
            setNodes([...nodesCopy]);
            setLinks([...linksCopy]);
        });

        simulation.alpha(1).restart();
        return () => {
            simulation.stop();
        };
    }, [initialNodes, initialLinks, dimensions, activeTargetValue]);

    // Setup Zoom/Pan
    useEffect(() => {
        if (!svgRef.current || !gRef.current) return;
        const svg = d3.select(svgRef.current);
        const g = d3.select(gRef.current);

        const zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
            .scaleExtent([0.25, 9])
            .on("zoom", (event) => {
                g.attr("transform", event.transform.toString());
            });

        zoomBehaviorRef.current = zoomBehavior;
        svg.call(zoomBehavior);

        const initialTransform = d3.zoomIdentity
            .translate(dimensions.width / 2, dimensions.height / 2)
            .scale(0.92)
            .translate(-dimensions.width / 2, -dimensions.height / 2);
        svg.call(zoomBehavior.transform, initialTransform);

        return () => { svg.on(".zoom", null); };
    }, [isMounted, dimensions]);

    // Drag behavior
    useEffect(() => {
        if (!gRef.current || !simulationRef.current) return;
        const simulation = simulationRef.current;
        const g = d3.select(gRef.current);

        const dragBehavior = d3.drag<SVGGElement, unknown, { id?: string }>()
            .subject((event) => {
                const el = (event.sourceEvent?.target as Element)?.closest?.(".cn-draggable");
                const id = el?.getAttribute("data-node-id");
                return { id: id ?? undefined };
            })
            .clickDistance(isTouchPrimaryInput ? 10 : 2)
            .on("start", (event) => {
                if (!event.active) simulation.alphaTarget(0.35).restart();
                const nodeId = event.subject?.id;
                if (!nodeId) return;
                const node = liveNodesRef.current.find((n) => n.id === nodeId);
                if (node) { node.fx = node.x; node.fy = node.y; }
            })
            .on("drag", (event) => {
                const nodeId = event.subject?.id;
                if (!nodeId) return;
                const node = liveNodesRef.current.find((n) => n.id === nodeId);
                if (node) { node.fx = event.x; node.fy = event.y; }
            })
            .on("end", (event) => {
                if (!event.active) simulation.alphaTarget(0);
                const nodeId = event.subject?.id;
                if (!nodeId) return;
                const node = liveNodesRef.current.find((n) => n.id === nodeId);
                if (node && node.type === "collocate") {
                    // Keep dragged collocates where the user drops them.
                    node.fx = event.x;
                    node.fy = event.y;
                }
            });

        g.selectAll<SVGGElement, unknown>(".cn-draggable").call(dragBehavior);
        return () => { g.selectAll<SVGGElement, unknown>(".cn-draggable").on(".drag", null); };
    }, [nodes, isTouchPrimaryInput]);

    const handleNodeMouseEnter = useCallback(
        (nodeId: string) => {
            if (isTouchPrimaryInput) return;
            setHoveredNode(nodeId);
        },
        [isTouchPrimaryInput]
    );

    const handleNodeMouseLeave = useCallback(
        (nodeId: string) => {
            if (isTouchPrimaryInput) return;
            setHoveredNode((current) => (current === nodeId ? null : current));
        },
        [isTouchPrimaryInput]
    );

    const handleNodeClick = useCallback(
        (node: CollocationNode) => {
            if (node.type === "tendril") return;
            if (node.type === "collocate") {
                // First click/tap selects the collocate (details + lemma bloom),
                // second click/tap pivots the graph root to that collocate.
                if (selectedNode !== node.id) {
                    setSelectedNode(node.id);
                    return;
                }
                if (onRootSelect && groupBy === "root") onRootSelect(node.label);
                return;
            }

            const next = selectedNode === node.id ? null : node.id;
            setSelectedNode(next);
            if (onRootSelect && targetKind === "root") onRootSelect(next ? node.label : null);
        },
        [selectedNode, onRootSelect, groupBy, targetKind]
    );

    const sidebarNode = useMemo(() => {
        const targetId = targetTerm ? `root-${targetTerm.value}` : null;
        const currentId = isTouchPrimaryInput
            ? (selectedNode ?? targetId)
            : (hoveredNode ?? selectedNode ?? targetId);
        if (!currentId) return null;

        const current = nodes.find((n) => n.id === currentId);
        if (!current) {
            if (!targetTerm) return null;
            return {
                id: targetId!,
                label: targetTerm.value,
                type: "target",
                count: targetCount,
                pmi: 0,
                anchorAngle: 0,
                anchorDistance: 0,
                cluster: -1,
                radius: 13,
                color: themeColors.accent,
                sampleLemmas: [],
            } satisfies CollocationNode;
        }

        return current;
    }, [nodes, hoveredNode, selectedNode, targetTerm, targetCount, themeColors.accent, isTouchPrimaryInput]);
    const sidebarParentNode = useMemo(() => {
        if (!sidebarNode || sidebarNode.type !== "tendril" || !sidebarNode.parentId) return null;
        return nodes.find((n) => n.id === sidebarNode.parentId) ?? null;
    }, [sidebarNode, nodes]);
    useEffect(() => {
        let cancelled = false;

        const loadAyah = async () => {
            if (!sidebarNode || sidebarNode.type !== "tendril") {
                setSidebarAyahText(null);
                return;
            }

            const parsed = parseAyahRef(sidebarNode.label);
            if (!parsed) {
                setSidebarAyahText(null);
                return;
            }

            const ayahRecord = await getAyah(parsed.sura, parsed.ayah);
            if (cancelled) return;
            setSidebarAyahText(ayahRecord?.textUthmani || ayahRecord?.textSimple || null);
        };

        void loadAyah();
        return () => {
            cancelled = true;
        };
    }, [sidebarNode]);
    const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
    const lemmaBloomItems = useMemo(() => {
        const getActiveCollocateId = () => {
            if (isTouchPrimaryInput) {
                if (!selectedNode) return null;
                const node = nodeById.get(selectedNode);
                return node?.type === "collocate" ? node.id : null;
            }

            const hoverNode = hoveredNode ? nodeById.get(hoveredNode) : null;
            if (hoverNode?.type === "collocate") return hoverNode.id;

            const selected = selectedNode ? nodeById.get(selectedNode) : null;
            return selected?.type === "collocate" ? selected.id : null;
        };

        const collocateId = getActiveCollocateId();
        if (!collocateId) return [] as LemmaBloomItem[];

        const parent = nodeById.get(collocateId);
        if (!parent || parent.type !== "collocate" || parent.x === undefined || parent.y === undefined) {
            return [] as LemmaBloomItem[];
        }

        const uniqueLemmas = Array.from(new Set(parent.sampleLemmas.filter(Boolean)));
        if (uniqueLemmas.length === 0) return [] as LemmaBloomItem[];

        const maxVisible = 5;
        const labels = uniqueLemmas.slice(0, maxVisible);
        if (uniqueLemmas.length > maxVisible) {
            labels.push(`+${uniqueLemmas.length - maxVisible}`);
        }

        const centerX = dimensions.width / 2;
        const centerY = dimensions.height / 2;
        const baseAngle = Math.atan2(parent.y - centerY, parent.x - centerX);
        const spread = Math.min(Math.PI * 0.86, Math.PI * 0.32 + labels.length * 0.2);
        const start = baseAngle - spread / 2;
        const step = labels.length <= 1 ? 0 : spread / (labels.length - 1);

        return labels.map((label, index) => {
            const angle = labels.length <= 1 ? baseAngle : start + index * step;
            const branchDist = parent.radius + 8;
            const labelDist = parent.radius + 28 + (index % 2) * 6;
            const anchorX = parent.x! + Math.cos(angle) * branchDist;
            const anchorY = parent.y! + Math.sin(angle) * branchDist;
            const x = parent.x! + Math.cos(angle) * labelDist;
            const y = parent.y! + Math.sin(angle) * labelDist;
            return {
                id: `lemma-bloom-${parent.id}-${index}`,
                label,
                x,
                y,
                anchorX,
                anchorY,
                textAnchor: Math.cos(angle) >= 0 ? "start" : "end",
                color: d3.interpolateRgb(parent.color, lemmaBloomColor)(0.72),
            } satisfies LemmaBloomItem;
        });
    }, [dimensions.height, dimensions.width, hoveredNode, isTouchPrimaryInput, lemmaBloomColor, nodeById, selectedNode]);

    return (
        <section
            className="immersive-viz"
            data-theme={theme}
            style={{
                width: "100%",
                height: "100%",
                position: "relative",
                overflow: "hidden",
                background: canvasSurface.section,
            }}
        >
            <VizExplainerDialog
                isOpen={showHelp}
                onClose={() => setShowHelp(false)}
                content={{
                    title: t("Help.title"),
                    description: t("Help.description"),
                    sections: [
                        { label: t("Help.graphLabel"), text: t("Help.graphText") },
                        { label: t("Help.pmiLabel"), text: t("Help.pmiText") },
                        { label: t("Help.windowLabel"), text: t("Help.windowText") },
                    ],
                }}
                theme={theme}
            />

            <div ref={containerRef} className="viz-container" style={{ width: '100vw', height: '100vh', position: 'absolute', top: 0, left: 0 }}>
                {!isMounted ? null : (
                    <svg
                        ref={svgRef}
                        viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
                        className="viz-canvas"
                        style={{ width: "100%", height: "100%", cursor: "grab" }}
                    >
                        <defs>
                            <radialGradient id={`${vizId}-canvasGlow`} cx="52%" cy="44%" r="64%">
                                <stop offset="0%" stopColor={canvasSurface.inner} stopOpacity="0.96" />
                                <stop offset="42%" stopColor={canvasSurface.mid} stopOpacity="0.9" />
                                <stop offset="100%" stopColor={canvasSurface.outer} stopOpacity="1" />
                            </radialGradient>

                            <radialGradient id={`${vizId}-hubGlow`} cx="50%" cy="50%" r="50%">
                                <stop offset="0%" stopColor={withAlpha(themeColors.accent, 0.35)} />
                                <stop offset="35%" stopColor={withAlpha(themeColors.accentSecondary, 0.14)} />
                                <stop offset="100%" stopColor="transparent" />
                            </radialGradient>

                            <filter id={`${vizId}-softGlow`} x="-90%" y="-90%" width="280%" height="280%">
                                <feGaussianBlur stdDeviation="1.4" result="blurred" />
                                <feMerge>
                                    <feMergeNode in="blurred" />
                                    <feMergeNode in="SourceGraphic" />
                                </feMerge>
                            </filter>

                            <filter id={`${vizId}-nodeGlow`} x="-120%" y="-120%" width="340%" height="340%">
                                <feGaussianBlur stdDeviation="2" result="blurred" />
                                <feMerge>
                                    <feMergeNode in="blurred" />
                                    <feMergeNode in="SourceGraphic" />
                                </feMerge>
                            </filter>
                        </defs>

                        <rect x={0} y={0} width={dimensions.width} height={dimensions.height} fill={`url(#${vizId}-canvasGlow)`} />

                        <g>
                            {stars.map((star, index) => (
                                <circle
                                    key={`star-${index}`}
                                    cx={star.x}
                                    cy={star.y}
                                    r={star.radius}
                                    fill={withAlpha(star.color, star.opacity)}
                                />
                            ))}
                        </g>

                        <g ref={gRef}>
                            <circle
                                cx={dimensions.width / 2}
                                cy={dimensions.height / 2}
                                r={118}
                                fill={`url(#${vizId}-hubGlow)`}
                            />

                            {/* Links */}
                            <g className="links">
                                {links.map((link, idx) => {
                                    const source = typeof link.source === "string" ? nodeById.get(link.source) : link.source;
                                    const target = typeof link.target === "string" ? nodeById.get(link.target) : link.target;
                                    if (!source || !target) return null;
                                    if (source.x === undefined || source.y === undefined || target.x === undefined || target.y === undefined) return null;

                                    const path = buildCurvedPath(source, target, link.kind === "trunk" ? 0.22 : 0.35);
                                    const outerOpacity = link.kind === "trunk" ? 0.05 + link.intensity * 0.12 : 0.04 + link.intensity * 0.08;
                                    const coreOpacity = link.kind === "trunk" ? 0.18 + link.intensity * 0.22 : 0.12 + link.intensity * 0.14;
                                    const outerWidth = link.kind === "trunk" ? Math.min(3.2, 1 + link.weight * 0.2) : 1.1;
                                    const coreWidth = link.kind === "trunk" ? Math.min(1.8, 0.5 + link.weight * 0.1) : 0.7;

                                    return (
                                        <g key={`link-${idx}`} style={{ pointerEvents: "none" }}>
                                            <path
                                                d={path}
                                                stroke={withAlpha(link.color, outerOpacity)}
                                                fill="none"
                                                strokeWidth={outerWidth}
                                                filter={`url(#${vizId}-softGlow)`}
                                                strokeLinecap="round"
                                            />
                                            <path
                                                d={path}
                                                stroke={withAlpha(link.color, coreOpacity)}
                                                fill="none"
                                                strokeWidth={coreWidth}
                                                strokeLinecap="round"
                                            />
                                        </g>
                                    );
                                })}
                            </g>

                            {/* Nodes */}
                            <g className="nodes">
                                {nodes.map((node) => {
                                    if (node.x === undefined || node.y === undefined) return null;

                                    const isHovered = hoveredNode === node.id;
                                    const isSelected = selectedNode === node.id;
                                    const isHighlighted = isHovered || isSelected;

                                    if (node.type === "tendril") {
                                        return (
                                            <g
                                                key={node.id}
                                                transform={`translate(${node.x},${node.y})`}
                                                style={{ cursor: "pointer" }}
                                                onMouseEnter={() => handleNodeMouseEnter(node.id)}
                                                onMouseLeave={() => handleNodeMouseLeave(node.id)}
                                                onClick={() => {
                                                    setSelectedNode((current) => (current === node.id ? null : node.id));
                                                }}
                                            >
                                                <circle
                                                    r={node.radius}
                                                    fill={withAlpha(node.color, isHighlighted ? 0.85 : 0.62)}
                                                    filter={`url(#${vizId}-softGlow)`}
                                                />
                                                {isHighlighted && node.label && (
                                                    <text
                                                        y={-8}
                                                        textAnchor="middle"
                                                        paintOrder="stroke"
                                                        stroke={labelStroke}
                                                        strokeWidth={3}
                                                        strokeLinejoin="round"
                                                        style={{
                                                            fontSize: "10px",
                                                            fontWeight: 600,
                                                            fill: themeColors.textColors.primary,
                                                            pointerEvents: "none",
                                                        }}
                                                    >
                                                        {node.label}
                                                    </text>
                                                )}
                                            </g>
                                        );
                                    }

                                    const showLabel = true;
                                    const isCollocate = node.type === "collocate";

                                    return (
                                        <g
                                            key={node.id}
                                            className={isCollocate ? "cn-draggable" : undefined}
                                            data-node-id={node.id}
                                            transform={`translate(${node.x},${node.y})`}
                                            style={{ cursor: isCollocate ? "grab" : "pointer" }}
                                            onMouseEnter={() => handleNodeMouseEnter(node.id)}
                                            onMouseLeave={() => handleNodeMouseLeave(node.id)}
                                            onClick={() => handleNodeClick(node)}
                                        >
                                            {node.type === "target" && (
                                                <motion.circle
                                                    r={node.radius + 6}
                                                    fill="none"
                                                    stroke={withAlpha(themeColors.accent, 0.28)}
                                                    strokeWidth={1.1}
                                                    animate={{ opacity: [0.06, 0.2, 0.06], scale: [0.98, 1.06, 0.98] }}
                                                    transition={
                                                        reduceMotion
                                                            ? { duration: 0 }
                                                            : { repeat: Infinity, duration: 2.8, ease: "easeInOut" }
                                                    }
                                                />
                                            )}

                                            <circle
                                                r={node.radius}
                                                fill={node.type === "target" ? targetNodeFill : withAlpha(node.color, isHighlighted ? 1 : 0.92)}
                                                stroke={node.type === "target" ? withAlpha(themeColors.accent, 0.55) : withAlpha(themeColors.foreground, 0.3)}
                                                strokeWidth={node.type === "target" ? 1.8 : 0.9}
                                                filter={node.type === "target" || isHighlighted ? `url(#${vizId}-nodeGlow)` : undefined}
                                            />

                                            {node.type === "target" && (
                                                <circle
                                                    r={node.radius * 0.34}
                                                    fill={withAlpha(themeColors.accentSecondary, 0.18)}
                                                    style={{ pointerEvents: "none" }}
                                                />
                                            )}

                                            {showLabel && (
                                                <text
                                                    y={node.type === "target" ? node.radius + 20 : node.radius + 14}
                                                    textAnchor="middle"
                                                    paintOrder="stroke"
                                                    stroke={labelStroke}
                                                    strokeWidth={4}
                                                    strokeLinejoin="round"
                                                    style={{
                                                        fontSize: node.type === "target" ? "22px" : "14px",
                                                        fontWeight: node.type === "target" ? 700 : 500,
                                                        fill: themeColors.textColors.primary,
                                                        pointerEvents: "none",
                                                        letterSpacing: "0.04em",
                                                    }}
                                                    className="arabic-text"
                                                >
                                                    {node.label}
                                                </text>
                                            )}
                                        </g>
                                    );
                                })}
                            </g>

                            {/* Lemma overlays (always on top of nodes/links) */}
                            <g className="lemma-bloom" style={{ pointerEvents: "none" }}>
                                {lemmaBloomItems.map((item) => {
                                    const controlX = (item.anchorX + item.x) / 2;
                                    const controlY = (item.anchorY + item.y) / 2;
                                    const textX = item.textAnchor === "start" ? item.x + 6 : item.x - 6;
                                    return (
                                        <g key={item.id}>
                                            <path
                                                d={`M ${item.anchorX} ${item.anchorY} Q ${controlX} ${controlY} ${item.x} ${item.y}`}
                                                stroke={withAlpha(item.color, 0.44)}
                                                strokeWidth={1}
                                                fill="none"
                                                strokeLinecap="round"
                                            />
                                            <circle
                                                cx={item.x}
                                                cy={item.y}
                                                r={2.2}
                                                fill={withAlpha(item.color, 0.9)}
                                                stroke={withAlpha(themeColors.background, theme === "dark" ? 0.75 : 0.6)}
                                                strokeWidth={0.8}
                                            />
                                            <text
                                                x={textX}
                                                y={item.y + 3}
                                                textAnchor={item.textAnchor}
                                                paintOrder="stroke"
                                                stroke={labelStroke}
                                                strokeWidth={2.6}
                                                strokeLinejoin="round"
                                                style={{
                                                    fontSize: "10px",
                                                    fontWeight: 600,
                                                    fill: item.color,
                                                    letterSpacing: "0.02em",
                                                }}
                                                className="arabic-text"
                                            >
                                                {item.label}
                                            </text>
                                        </g>
                                    );
                                })}
                            </g>
                        </g>
                    </svg>
                )}
            </div>

            {targetTerm && (
                <>
                    {/*
                      Honesty signal, calmed: a small muted warning-tint tag,
                      top-center (not a bright, all-caps pill spanning the
                      top) — present but no longer competing with the graph
                      for attention. Top-center rather than the canvas's top
                      inline-end corner: the right drawer floats OVER that
                      corner whenever it's open, hiding the badge entirely.
                      Centered the same way the "How to read this view" chip
                      is (left: 50% + translateX(-50%) — direction-agnostic,
                      so this is RTL-safe without any dir-specific branching),
                      and offset far enough below that chip's own row
                      (top: header-clearance + 58px, 36px tall) that the two
                      never collide. The `top` offset lives in the
                      .collocation-heuristic-badge CSS class (not inline)
                      so it can be pushed down at <=980px, below the intro
                      chip's own mobile position (header-clearance + 108px,
                      ~36px tall) instead of hiding behind it.
                    */}
                    <span
                        className="collocation-heuristic-badge"
                        title={t("HeuristicBadge.tooltip", { n: minFrequency })}
                        aria-label={`${t("HeuristicBadge.label")} — ${t("HeuristicBadge.tooltip", { n: minFrequency })}`}
                        tabIndex={0}
                        style={{
                            position: "absolute",
                            left: "50%",
                            transform: "translateX(-50%)",
                            zIndex: 25,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "3px 10px",
                            borderRadius: 999,
                            fontSize: "0.68rem",
                            fontWeight: 600,
                            letterSpacing: "0.02em",
                            whiteSpace: "nowrap",
                            color: theme === "dark" ? HEURISTIC_AMBER.dark.fg : HEURISTIC_AMBER.light.fg,
                            background: theme === "dark" ? HEURISTIC_AMBER.dark.bg : HEURISTIC_AMBER.light.bg,
                            border: `1px solid ${theme === "dark" ? HEURISTIC_AMBER.dark.border : HEURISTIC_AMBER.light.border}`,
                            cursor: "help",
                        }}
                    >
                        {t("HeuristicBadge.label")}
                    </span>

                    {isSeededExample && (
                        <div
                            style={{
                                position: "absolute",
                                insetInlineStart: 0,
                                insetInlineEnd: 0,
                                // Sits below the top-center badge's own row (badge
                                // top offset + its height + the same stacking gap
                                // the two used before) so they don't overlap.
                                top: "calc(var(--header-clearance) + 136px)",
                                zIndex: 24,
                                display: "flex",
                                justifyContent: "center",
                                paddingInline: 16,
                                pointerEvents: "none",
                            }}
                        >
                            <div style={{ maxWidth: 460, textAlign: "center" }}>
                                <p
                                    style={{
                                        margin: 0,
                                        fontSize: "0.92rem",
                                        fontWeight: 600,
                                        color: themeColors.textColors.primary,
                                        textShadow: theme === "dark" ? "0 1px 6px rgba(0,0,0,0.55)" : "none",
                                    }}
                                >
                                    {t("SeededExample.title", { root: targetTerm.value })}
                                </p>
                                <p
                                    style={{
                                        margin: "2px 0 0",
                                        fontSize: "0.74rem",
                                        color: themeColors.textColors.secondary,
                                        textShadow: theme === "dark" ? "0 1px 6px rgba(0,0,0,0.55)" : "none",
                                    }}
                                >
                                    {t("SeededExample.subtitle")}
                                </p>
                            </div>
                        </div>
                    )}
                </>
            )}

            {!targetTerm && (
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        pointerEvents: "none",
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
                        <div style={{ fontSize: "2.6rem", opacity: 0.2, color: "var(--ink-secondary)" }}>0</div>
                        <p style={{ color: "var(--ink-muted)", textAlign: "center", maxWidth: 420 }}>{t("noData")}</p>
                    </div>
                </div>
            )}

            {isMounted && typeof document !== 'undefined' && document.getElementById('viz-sidebar-portal') && createPortal(
                <div className="viz-left-stack">
                    <div className="viz-left-panel viz-zoom-panel">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span className="eyebrow" style={{ fontSize: "0.7em" }}>{ts("zoom")}</span>
                      </div>
                      <div className="viz-zoom-row">
                        <button type="button" className="viz-zoom-reset-btn" onClick={() => {
                                    fitGraphToView(svgRef.current, gRef.current, zoomBehaviorRef.current, {
                                        duration: motionSafeDuration(750),
                                    });
                                }}>
                          {ts("focus")}
                        </button>
                      </div>
                    </div>
                    <div className="viz-left-panel" style={{ background: panelBg, borderColor: panelBorder }}>
                        {sidebarNode ? (
                            <>
                                <div className="viz-tooltip-title arabic-text">{sidebarNode.label}</div>
                                <div className="viz-tooltip-subtitle">
                                    {sidebarNode.type === "target"
                                        ? t("targetNode")
                                        : sidebarNode.type === "collocate"
                                            ? t("collocateNode")
                                            : t("tertiaryNode")}
                                </div>
                                {sidebarNode.type !== "tendril" && (
                                    <div className="viz-tooltip-row">
                                        <span className="viz-tooltip-label">{t("rawCount")}</span>
                                        <span className="viz-tooltip-value">{sidebarNode.count}</span>
                                    </div>
                                )}
                            {sidebarNode.type === "tendril" && (
                                <>
                                    <div className="viz-tooltip-row">
                                        <span className="viz-tooltip-label">{t("contextWindowRef")}</span>
                                        <span className="viz-tooltip-value">{sidebarNode.label}</span>
                                        </div>
                                        <div className="viz-tooltip-row">
                                            <span className="viz-tooltip-label">{t("contextWindowRefFormat")}</span>
                                            <span className="viz-tooltip-value">
                                                {windowType === "ayah"
                                                    ? t("contextWindowRefFormatAyah")
                                                    : windowType === "surah"
                                                        ? t("contextWindowRefFormatSurah")
                                                        : t("contextWindowRefFormatDistance")}
                                            </span>
                                        </div>
                                    <div
                                        style={{
                                            marginTop: 6,
                                            fontSize: "0.8rem",
                                                lineHeight: 1.45,
                                                color: themeColors.textColors.secondary,
                                            }}
                                    >
                                        {windowType === "ayah"
                                            ? t("contextWindowRefHelpAyah")
                                            : windowType === "surah"
                                                ? t("contextWindowRefHelpSurah")
                                                : t("contextWindowRefHelpDistance")}
                                    </div>
                                    {extractAyahRef(sidebarNode.label) && sidebarAyahText && (
                                        <div style={{ marginTop: 8 }}>
                                            <div className="viz-tooltip-label" style={{ marginBottom: 4 }}>
                                                {t("ayahText")}
                                            </div>
                                            <div
                                                className="arabic-text"
                                                lang="ar"
                                                dir="rtl"
                                                style={{
                                                    fontSize: "1rem",
                                                    lineHeight: 1.65,
                                                    color: themeColors.textColors.primary,
                                                    background: "var(--bg-2)",
                                                    border: "1px solid var(--line)",
                                                    borderRadius: 6,
                                                    padding: "8px 10px",
                                                }}
                                            >
                                                {sidebarAyahText}
                                            </div>
                                        </div>
                                    )}
                                    {sidebarParentNode && (
                                        <div className="viz-tooltip-row">
                                            <span className="viz-tooltip-label">{t("collocateNode")}</span>
                                            <span className="viz-tooltip-value arabic-text">{sidebarParentNode.label}</span>
                                        </div>
                                        )}
                                    </>
                                )}
                                {sidebarNode.type === "collocate" && (
                                    <>
                                        <div className="viz-tooltip-row">
                                            <span className="viz-tooltip-label">{t("Help.pmiLabel")}</span>
                                            <span className="viz-tooltip-value">{sidebarNode.pmi.toFixed(2)}</span>
                                        </div>
                                        {sidebarNode.sampleLemmas.length > 0 && (
                                            <div className="viz-tooltip-row" style={{ marginTop: 8 }}>
                                                <span className="viz-tooltip-label" style={{ display: "block", marginBottom: 4 }}>{t("lemmasLabel")}</span>
                                                <span className="viz-tooltip-value arabic-text" style={{ fontSize: "1rem", display: "flex", gap: 6, flexWrap: "wrap" }}>
                                                    {sidebarNode.sampleLemmas.map((lemma) => (
                                                        <span
                                                            key={lemma}
                                                            style={{
                                                                background: "var(--bg-2)",
                                                                padding: "2px 6px",
                                                                borderRadius: 4,
                                                                border: "1px solid var(--line)",
                                                                letterSpacing: "0.06em",
                                                            }}
                                                        >
                                                            {lemma}
                                                        </span>
                                                    ))}
                                                </span>
                                            </div>
                                        )}
                                    </>
                                )}
                            </>
                        ) : (
                            <>
                                <div className="viz-tooltip-title">{t("title")}</div>
                                <div className="viz-tooltip-subtitle">{t("noData")}</div>
                            </>
                        )}
                    </div>

                    <div className="viz-left-panel" style={{ background: panelBg, borderColor: panelBorder }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                            <div style={{ fontSize: "0.75rem", color: themeColors.textColors.secondary, letterSpacing: "0.03em", textTransform: "uppercase" }}>
                                {t("proximityControls")}
                            </div>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                            <div
                                data-testid="collocation-target-control"
                                style={{ padding: "7px 8px", borderRadius: 8, background: controlRowSurface, border: `1px solid ${withAlpha(themeColors.accent, 0.2)}` }}
                            >
                                <div style={{ ...controlLabelStyle, marginBottom: 6 }}>{t("targetTerm")}</div>
                                <div style={{ display: "flex", gap: 8 }}>
                                    <select
                                        data-testid="collocation-target-kind"
                                        value={targetKind}
                                        onChange={e => setTargetKind(e.target.value as CollocationTermKind)}
                                        style={{ ...controlFieldStyle, flexShrink: 0, width: 86 }}
                                    >
                                        <option value="root">{t("groupByRoot")}</option>
                                        <option value="lemma">{t("groupByLemma")}</option>
                                    </select>
                                    <input
                                        data-testid="collocation-target-input"
                                        value={targetValue}
                                        onChange={(e) => setTargetValue(e.target.value)}
                                        onBlur={commitTargetRoot}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") e.currentTarget.blur();
                                        }}
                                        placeholder={targetKind === "root" ? t("targetRootPlaceholder") : t("targetLemmaPlaceholder")}
                                        style={{ ...controlFieldStyle, flex: 1, minWidth: 0 }}
                                    />
                                </div>
                            </div>
                            {!isBeginner ? (
                            <div
                                data-testid="collocation-pair-control"
                                style={{ padding: "7px 8px", borderRadius: 8, background: controlRowSurface, border: `1px solid ${withAlpha(themeColors.accent, 0.2)}` }}
                            >
                                <div style={{ ...controlLabelStyle, marginBottom: 6 }}>{t("pairTerm")}</div>
                                <div style={{ display: "flex", gap: 8 }}>
                                    <select
                                        value={pairKind}
                                        onChange={e => setPairKind(e.target.value as CollocationTermKind)}
                                        style={{ ...controlFieldStyle, flexShrink: 0, width: 86 }}
                                    >
                                        <option value="root">{t("groupByRoot")}</option>
                                        <option value="lemma">{t("groupByLemma")}</option>
                                    </select>
                                    <input
                                        value={pairValue}
                                        onChange={(e) => setPairValue(e.target.value)}
                                        placeholder={pairKind === "root" ? t("pairRootPlaceholder") : t("pairLemmaPlaceholder")}
                                        style={{ ...controlFieldStyle, flex: 1, minWidth: 0 }}
                                    />
                                </div>
                            </div>
                            ) : null}
                            {!isBeginner ? (
                            <div
                                data-testid="collocation-group-filter-control"
                                style={{ padding: "7px 8px", borderRadius: 8, background: controlRowSurface, border: `1px solid ${withAlpha(themeColors.accent, 0.2)}` }}
                            >
                                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 8, alignItems: "start" }}>
                                    <div>
                                        <div style={{ ...controlLabelStyle, marginBottom: 6, minHeight: 34, display: "flex", alignItems: "flex-end" }}>{t("groupBy")}</div>
                                        <select
                                            value={groupBy}
                                            onChange={e => setGroupBy(e.target.value as CollocationGroupKind)}
                                            style={{ ...controlFieldStyle, width: "100%" }}
                                        >
                                            <option value="root">{t("groupByRoot")}</option>
                                            <option value="lemma">{t("groupByLemma")}</option>
                                        </select>
                                    </div>
                                    <div>
                                        <div style={{ ...controlLabelStyle, marginBottom: 6, minHeight: 34, display: "flex", alignItems: "flex-end" }}>{t("posFilter")}</div>
                                        <select
                                            value={filterPos}
                                            onChange={e => setFilterPos(e.target.value as PartOfSpeech | "")}
                                            style={{ ...controlFieldStyle, width: "100%" }}
                                        >
                                            <option value="">{t("posAll")}</option>
                                            {POS_OPTIONS.map((pos) => (
                                                <option key={pos} value={pos}>{pos}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            </div>
                            ) : null}
                            {!isBeginner ? (
                            <div
                                data-testid="collocation-window-type-control"
                                style={{ padding: "7px 8px", borderRadius: 8, background: controlRowSurface, border: `1px solid ${withAlpha(themeColors.accent, 0.2)}` }}
                            >
                                <div style={{ ...controlLabelStyle, marginBottom: 6 }}>{t("windowType")}</div>
                                <select
                                    value={windowType}
                                    onChange={e => setWindowType(e.target.value as "ayah" | "distance" | "surah")}
                                    style={{ ...controlFieldStyle, width: "100%" }}
                                >
                                    <option value="ayah">{t("ayahWindow")}</option>
                                    <option value="surah">{t("surahWindow")}</option>
                                    <option value="distance">{t("distanceWindow")}</option>
                                </select>
                            </div>
                            ) : null}
                            {!isBeginner ? (
                            <div
                                data-testid="collocation-window-hint"
                                style={{ fontSize: "0.73rem", color: "var(--ink-muted)", lineHeight: 1.35, padding: "0 3px", marginTop: -2 }}
                            >
                                {windowType === "ayah"
                                    ? t("windowTypeHintAyah")
                                    : windowType === "surah"
                                        ? t("windowTypeHintSurah")
                                        : t("windowTypeHintDistance")}
                            </div>
                            ) : null}
                            <AnimatePresence>
                                {!isBeginner && windowType === "distance" && (
                                    <motion.div
                                        data-testid="collocation-distance-control"
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: "auto", opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        transition={reduceMotion ? { duration: 0 } : undefined}
                                        style={{ overflow: "hidden", display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", borderRadius: 8, background: controlRowSurface, border: `1px solid ${withAlpha(themeColors.accent, 0.2)}` }}
                                    >
                                        <span style={{ ...controlLabelStyle, minWidth: "auto" }}>
                                            {t("distanceRange", { distance })}
                                        </span>
                                        <input type="range" min={1} max={50} value={distance} onChange={e => setDistance(parseInt(e.target.value, 10))} style={{ flex: 1, accentColor: themeColors.accentSecondary }} />
                                    </motion.div>
                                )}
                            </AnimatePresence>
                            {!isBeginner ? (
                            <div
                                data-testid="collocation-min-frequency-control"
                                style={{ marginTop: 2, padding: "7px 8px", borderRadius: 8, background: controlRowSurface, border: `1px solid ${withAlpha(themeColors.accent, 0.2)}` }}
                            >
                                <div style={{ ...controlLabelStyle, marginBottom: 6 }}>{t("minFrequency")} ({minFrequency})</div>
                                <input type="range" min={1} max={20} value={minFrequency} onChange={e => setMinFrequency(parseInt(e.target.value, 10))} style={{ width: "100%", accentColor: themeColors.accentSecondary }} />
                            </div>
                            ) : null}
                            {!isBeginner && pairMetrics && (
                                <div data-testid="collocation-pair-metrics" style={{ marginTop: 4, display: "grid", gridTemplateColumns: "1fr", gap: 6 }}>
                                    <div style={{ background: controlRowSurface, border: `1px solid ${withAlpha(themeColors.accent, 0.2)}`, borderRadius: 8, padding: "6px 8px", fontSize: "0.73rem", color: "var(--ink-muted)" }}>
                                        {t("pairWindowsA", { count: pairMetrics.countA })}
                                    </div>
                                    <div style={{ background: controlRowSurface, border: `1px solid ${withAlpha(themeColors.accent, 0.2)}`, borderRadius: 8, padding: "6px 8px", fontSize: "0.73rem", color: "var(--ink-muted)" }}>
                                        {t("pairWindowsB", { count: pairMetrics.countB })}
                                    </div>
                                    <div style={{ background: controlRowSurface, border: `1px solid ${withAlpha(themeColors.accentSecondary, 0.35)}`, borderRadius: 8, padding: "6px 8px", fontSize: "0.74rem", fontWeight: 600, color: themeColors.textColors.primary }}>
                                        {t("pairSharedWindows", { count: pairMetrics.cooccurrenceCount })}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="viz-legend" style={{ background: panelBg, borderColor: panelBorder }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                            <span style={{ fontSize: "0.75rem", color: themeColors.textColors.secondary, letterSpacing: "0.03em", textTransform: "uppercase" }}>
                                {t("legendTitle")}
                            </span>
                            <HelpIcon onClick={() => setShowHelp(true)} />
                        </div>
                        <div className="viz-legend-item">
                            <div className="viz-legend-dot" style={{ background: targetNodeFill, width: 14, height: 14, boxShadow: `0 0 4px ${withAlpha(themeColors.accent, 0.28)}` }} />
                            <span>{t("targetNode")}</span>
                        </div>
                        <div className="viz-legend-item">
                            <div className="viz-legend-line" style={{ background: legendStrong, height: 3 }} />
                            <span>{t("pmiHigher")}</span>
                        </div>
                        <div className="viz-legend-item">
                            <div className="viz-legend-line" style={{ background: legendSoft, height: 2 }} />
                            <span>{t("pmiLower")}</span>
                        </div>
                        {isNodeCapped && (
                            <div
                                data-testid="collocation-node-cap-disclosure"
                                style={{
                                    marginTop: 8,
                                    paddingTop: 8,
                                    borderTop: `1px solid ${panelBorder}`,
                                    fontSize: "0.7rem",
                                    color: "var(--ink-muted)",
                                    lineHeight: 1.4,
                                }}
                            >
                                {t("nodeCapDisclosure", { n: COLLOCATE_NODE_CAP })}
                            </div>
                        )}
                    </div>
                </div>,
                document.getElementById('viz-sidebar-portal')!
            )}
        </section>
    );
}
