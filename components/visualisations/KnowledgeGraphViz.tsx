"use client";

import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import * as d3 from "@/lib/viz/d3";
import { motion, AnimatePresence } from "framer-motion";
import type { CorpusToken } from "@/lib/schema/types";
import { resolveVisualizationTheme } from "@/lib/schema/visualizationTypes";
import { useKnowledge } from "@/lib/context/KnowledgeContext";
import { fitGraphToView } from "@/lib/viz/fitToView";
import { motionSafeDuration, motionSafeStagger, prefersReducedMotion } from "@/lib/viz/motionPrefs";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";

// ── Types ──────────────────────────────────────────────────────────

interface KnowledgeGraphVizProps {
    tokens: CorpusToken[];
    onRootSelect?: (root: string | null) => void;
    /** Shared selected root (survives mode switches, search, deep links). */
    highlightRoot?: string | null;
    theme?: "light" | "dark";
    /** Empty-state CTA: switches the observatory to the root-network view. */
    onExploreRoots?: () => void;
}

interface KGNode extends d3.SimulationNodeDatum {
    id: string;
    label: string;
    type: "tracked-root" | "ghost-root" | "lemma";
    state?: "learning" | "learned";
    frequency: number;
    radius: number;
    color: string;
    glowColor: string;
    notes?: string;
}

interface KGLink extends d3.SimulationLinkDatum<KGNode> {
    weight: number;
    color: string;
}

// ── Helpers ────────────────────────────────────────────────────────

/** Pick top-N ghost roots that share surahs with tracked roots for context. */
function pickGhostRoots(
    allRootMap: Map<string, { count: number; lemmas: Set<string> }>,
    trackedSet: Set<string>,
    limit: number
): string[] {
    return [...allRootMap.entries()]
        .filter(([r]) => !trackedSet.has(r))
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, limit)
        .map(([r]) => r);
}

// ── Component ──────────────────────────────────────────────────────

export default function KnowledgeGraphViz({
    tokens,
    onRootSelect,
    highlightRoot,
    theme = "dark",
    onExploreRoots,
}: KnowledgeGraphVizProps) {
    const { roots: trackedRoots, stats, trackRoot, loading: knowledgeLoading } = useKnowledge();
    const ts = useTranslations("Visualizations.Shared");
    const tk = useTranslations("CurrentSelectionPanel.knowledge");
    const tkg = useTranslations("Visualizations.KnowledgeGraph");
    const themeColors = resolveVisualizationTheme(theme);
    // Framer-motion entrance/pulse animations below are JS-driven and bypass
    // the global CSS prefers-reduced-motion rule (globals.css) — gate them
    // manually. Read once per render; matchMedia-backed, SSR-safe.
    const reduceMotion = prefersReducedMotion();

    const svgRef = useRef<SVGSVGElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const gRef = useRef<SVGGElement>(null);

    const [dimensions, setDimensions] = useState({ width: 1200, height: 800 });
    const [hoveredNode, setHoveredNode] = useState<string | null>(null);
    const [selectedNode, setSelectedNode] = useState<string | null>(null);
    const [nodes, setNodes] = useState<KGNode[]>([]);
    const [links, setLinks] = useState<KGLink[]>([]);
    const [isMounted, setIsMounted] = useState(false);
    const [viewMode, setViewMode] = useState<"neural" | "flow">("neural");
    const viewModeRef = useRef<"neural" | "flow">("neural");
    const simulationRef = useRef<d3.Simulation<KGNode, KGLink> | null>(null);
    const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
    const liveNodesRef = useRef<KGNode[]>([]);

    // ── Palette derived from theme ───────────────────────────────────

    const palette = useMemo(() => {
        const isDark = theme === "dark";
        return {
            // Learning = violet, learned = teal: the data spectrum's, and clear
            // of the amber lemma nodes. (Stock cyan and green before.)
            learningNode: isDark ? "#8e84cc" : "#6d28d9",
            learningGlow: isDark ? "rgba(142,132,204,0.5)" : "rgba(109,40,217,0.35)",
            learnedNode: isDark ? "#56a697" : "#0f766e",
            learnedGlow: isDark ? "rgba(86,166,151,0.5)" : "rgba(15,118,110,0.35)",
            ghostNode: "rgba(28,42,49,0.7)",
            ghostStroke: "var(--line)",
            lemmaNode: themeColors.accent,
            linkLearning: isDark ? "rgba(142,132,204,0.25)" : "rgba(109,40,217,0.16)",
            linkLearned: isDark ? "rgba(86,166,151,0.25)" : "rgba(15,118,110,0.18)",
            linkGhost: "var(--line)",
            coreGlow: isDark
                ? "radial-gradient(circle, rgba(142,132,204,0.12) 0%, transparent 70%)"
                : "radial-gradient(circle, rgba(109,40,217,0.06) 0%, transparent 70%)",
        };
    }, [theme, themeColors.accent]);

    // ── Build graph data ─────────────────────────────────────────────

    const { initialNodes, initialLinks } = useMemo(() => {
        // Aggregate roots and their lemmas
        const rootMap = new Map<string, { count: number; lemmas: Set<string> }>();
        const lemmaMap = new Map<string, { count: number; roots: Set<string> }>();

        for (const token of tokens) {
            if (!token.root) continue;
            if (!rootMap.has(token.root)) rootMap.set(token.root, { count: 0, lemmas: new Set() });
            const rd = rootMap.get(token.root)!;
            rd.count++;
            rd.lemmas.add(token.lemma);

            if (!lemmaMap.has(token.lemma)) lemmaMap.set(token.lemma, { count: 0, roots: new Set() });
            const ld = lemmaMap.get(token.lemma)!;
            ld.count++;
            ld.roots.add(token.root);
        }

        const trackedSet = new Set(trackedRoots.keys());
        const hasTracked = trackedSet.size > 0;

        // Pick ghost roots for context (only if there are tracked roots)
        const ghostLimit = hasTracked ? Math.min(20, Math.max(8, 40 - trackedSet.size * 3)) : 30;
        const ghosts = pickGhostRoots(rootMap, trackedSet, ghostLimit);

        const activeRoots = hasTracked
            ? [...trackedSet, ...ghosts].filter((r) => rootMap.has(r))
            : ghosts; // Show top roots as preview when nothing is tracked

        const maxFreq = Math.max(...activeRoots.map((r) => rootMap.get(r)?.count ?? 0), 1);

        const nodesResult: KGNode[] = [];
        const linksResult: KGLink[] = [];
        const includedLemmas = new Set<string>();

        for (const root of activeRoots) {
            const data = rootMap.get(root);
            if (!data) continue;

            const tracked = trackedRoots.get(root);
            const isTracked = !!tracked;
            const state = tracked?.state ?? "learning";
            const freqRatio = data.count / maxFreq;
            const baseRadius = isTracked ? 12 + freqRatio * 18 : 4 + freqRatio * 6;

            const nodeColor = isTracked
                ? state === "learned" ? palette.learnedNode : palette.learningNode
                : palette.ghostNode;
            const glowColor = isTracked
                ? state === "learned" ? palette.learnedGlow : palette.learningGlow
                : "transparent";

            nodesResult.push({
                id: `root-${root}`,
                label: root,
                type: isTracked ? "tracked-root" : "ghost-root",
                state: isTracked ? state : undefined,
                frequency: data.count,
                radius: baseRadius,
                color: nodeColor,
                glowColor,
                notes: tracked?.notes,
            });

            // Add lemma branches (top 4 per root for tracked, top 2 for ghosts)
            const lemmaLimit = isTracked ? 4 : 2;
            const rootLemmas = [...data.lemmas]
                .map((l) => ({ lemma: l, data: lemmaMap.get(l)! }))
                .sort((a, b) => b.data.count - a.data.count)
                .slice(0, lemmaLimit);

            for (const { lemma, data: ld } of rootLemmas) {
                if (!includedLemmas.has(lemma)) {
                    includedLemmas.add(lemma);
                    const lemmaFreq = ld.count / maxFreq;
                    nodesResult.push({
                        id: `lemma-${lemma}`,
                        label: lemma,
                        type: "lemma",
                        frequency: ld.count,
                        radius: 3 + lemmaFreq * 6,
                        color: isTracked ? palette.lemmaNode : palette.ghostNode,
                        glowColor: "transparent",
                    });
                }

                const linkColor = isTracked
                    ? state === "learned" ? palette.linkLearned : palette.linkLearning
                    : palette.linkGhost;

                linksResult.push({
                    source: `root-${root}`,
                    target: `lemma-${lemma}`,
                    weight: ld.count,
                    color: linkColor,
                });
            }
        }

        return { initialNodes: nodesResult, initialLinks: linksResult };
    }, [tokens, trackedRoots, palette]);

    // ── Resize observer ──────────────────────────────────────────────

    useEffect(() => {
        setIsMounted(true);
        if (!containerRef.current) return;

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setDimensions({
                    width: Math.max(entry.contentRect.width, 600),
                    height: Math.max(entry.contentRect.height, 500),
                });
            }
        });

        observer.observe(containerRef.current);
        const rect = containerRef.current.getBoundingClientRect();
        if (rect.width > 0) {
            setDimensions({ width: Math.max(rect.width, 600), height: Math.max(rect.height, 500) });
        }

        return () => observer.disconnect();
    }, []);

    // ── D3 Force simulation ──────────────────────────────────────────

    useEffect(() => {
        if (!svgRef.current || initialNodes.length === 0) return;

        const cx = dimensions.width / 2;
        const cy = dimensions.height / 2;
        const nodeCount = initialNodes.length;
        const spread = Math.sqrt(nodeCount) * 22;

        const nodesCopy = initialNodes.map((n) => ({ ...n }));
        const linksCopy = initialLinks.map((l) => ({ ...l }));

        const simulation = d3
            .forceSimulation<KGNode>(nodesCopy)
            .force(
                "link",
                d3
                    .forceLink<KGNode, KGLink>(linksCopy)
                    .id((d) => d.id)
                    .distance((d) => 30 + Math.min((d.weight ?? 1) * 1.2, 25))
                    .strength(0.5)
            )
            .force("charge", d3.forceManyBody().strength(-60 - nodeCount * 0.4).distanceMax(spread * 1.6))
            .force("center", d3.forceCenter(cx, cy))
            .force("collision", d3.forceCollide<KGNode>().radius((d) => d.radius + 3))
            .force(
                "radial",
                d3
                    .forceRadial<KGNode>(
                        (d) => {
                            if (d.type === "tracked-root") return spread * 0.3;
                            if (d.type === "ghost-root") return spread * 0.7;
                            return spread * 0.55;
                        },
                        cx,
                        cy
                    )
                    .strength(0.35)
            );

        simulationRef.current = simulation;
        liveNodesRef.current = nodesCopy;

        simulation.on("tick", () => {
            setNodes([...nodesCopy]);
            setLinks([...linksCopy]);
        });

        simulation.alpha(1).restart();

        // Apply flow layout if already in flow mode when simulation starts
        if (viewMode === "flow") {
            applyFlowLayout(nodesCopy, dimensions);
            simulation.alpha(0.5).restart();
        }

        return () => { simulation.stop(); };
    }, [initialNodes, initialLinks, dimensions]);

    // ── Flow/Neural layout toggle ────────────────────────────────────

    function applyFlowLayout(nodeList: KGNode[], dims: { width: number; height: number }) {
        const rootNodes = nodeList.filter(n => n.type === "tracked-root" || n.type === "ghost-root");
        const lemmaNodes = nodeList.filter(n => n.type === "lemma");

        const rowTopY = dims.height * 0.22;
        const rowBotY = dims.height * 0.78;
        const margin = 60;

        // Sort roots: tracked first, then by frequency
        rootNodes.sort((a, b) => {
            if (a.type !== b.type) return a.type === "tracked-root" ? -1 : 1;
            return b.frequency - a.frequency;
        });

        // Distribute roots evenly across top row
        const rootSpacing = Math.max((dims.width - margin * 2) / Math.max(rootNodes.length - 1, 1), 30);
        rootNodes.forEach((n, i) => {
            n.fx = margin + i * rootSpacing;
            n.fy = rowTopY;
        });

        // Sort lemmas by frequency
        lemmaNodes.sort((a, b) => b.frequency - a.frequency);
        const lemmaSpacing = Math.max((dims.width - margin * 2) / Math.max(lemmaNodes.length - 1, 1), 20);
        lemmaNodes.forEach((n, i) => {
            n.fx = margin + i * lemmaSpacing;
            n.fy = rowBotY;
        });
    }

    function releaseFlowLayout(nodeList: KGNode[]) {
        nodeList.forEach(n => { n.fx = null; n.fy = null; });
    }

    useEffect(() => {
        viewModeRef.current = viewMode;
        if (!simulationRef.current || liveNodesRef.current.length === 0) return;
        const sim = simulationRef.current;
        const nodeList = liveNodesRef.current;

        if (viewMode === "flow") {
            applyFlowLayout(nodeList, dimensions);
            sim.alpha(0.5).restart();
        } else {
            releaseFlowLayout(nodeList);
            sim.alpha(0.8).restart();
        }
    }, [viewMode, dimensions]);

    // ── Zoom/Pan ─────────────────────────────────────────────────────

    useEffect(() => {
        if (!svgRef.current || !gRef.current) return;

        const svg = d3.select(svgRef.current);
        const g = d3.select(gRef.current);

        const zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
            .scaleExtent([0.15, 6])
            .on("zoom", (event) => { g.attr("transform", event.transform.toString()); });

        zoomBehaviorRef.current = zoomBehavior;
        svg.call(zoomBehavior);

        return () => { svg.on(".zoom", null); };
    }, [isMounted, dimensions]);

    // ── D3 Drag ──────────────────────────────────────────────────────

    useEffect(() => {
        if (!gRef.current || !simulationRef.current) return;

        const simulation = simulationRef.current;
        const g = d3.select(gRef.current);

        let draggedNode: KGNode | null = null;

        const dragBehavior = d3.drag<SVGGElement, unknown>()
            .on("start", (event) => {
                if (!event.active) simulation.alphaTarget(0.3).restart();
                const el = (event.sourceEvent?.target as Element)?.closest?.(".kg-node") as SVGGElement | null;
                const nodeId = el?.getAttribute("data-node-id");
                draggedNode = liveNodesRef.current.find((n) => n.id === nodeId) ?? null;
                if (draggedNode) { draggedNode.fx = draggedNode.x; draggedNode.fy = draggedNode.y; }
            })
            .on("drag", (event) => {
                if (draggedNode) { draggedNode.fx = event.x; draggedNode.fy = event.y; }
            })
            .on("end", (event) => {
                if (!event.active) simulation.alphaTarget(0);
                if (draggedNode) {
                    if (viewModeRef.current === "flow") {
                        draggedNode.fx = event.x;
                        draggedNode.fy = event.y;
                    } else {
                        draggedNode.fx = null;
                        draggedNode.fy = null;
                    }
                }
                draggedNode = null;
            });

        g.selectAll<SVGGElement, unknown>(".kg-node").call(dragBehavior);

        return () => {
            g.selectAll<SVGGElement, unknown>(".kg-node").on(".drag", null);
        };
    }, [nodes]);

    // ── Interaction handlers ─────────────────────────────────────────

    const handleNodeClick = useCallback(
        (node: KGNode) => {
            setSelectedNode(node.id === selectedNode ? null : node.id);
            if (node.type !== "lemma" && onRootSelect) {
                onRootSelect(node.label);
            }
        },
        [selectedNode, onRootSelect]
    );

    const isLinkHighlighted = useCallback(
        (link: KGLink) => {
            const highlightId = hoveredNode ?? selectedNode;
            if (!highlightId) return false;
            const sid = typeof link.source === "string" ? link.source : (link.source as KGNode).id;
            const tid = typeof link.target === "string" ? link.target : (link.target as KGNode).id;
            return sid === highlightId || tid === highlightId;
        },
        [hoveredNode, selectedNode]
    );

    // ── Empty state ──────────────────────────────────────────────────

    const hasTracked = stats.total > 0;
    // The knowledge context hydrates asynchronously (IndexedDB or a Supabase
    // round-trip) — `stats.total` reads 0 for that first beat even for a
    // signed-in user with tracked roots. Gate the "start tracking" CTA and
    // the legend's tracked/learned/untracked key (which only make sense once
    // we actually know the answer) on `!knowledgeLoading` too, so hydration
    // renders as the ambient ghost network rather than flashing the empty
    // state. `hasTracked` itself stays ungated — it also drives the
    // decorative core glow, which is fine to key off live data.
    const showEmptyState = !knowledgeLoading && !hasTracked;
    const showLegend = !knowledgeLoading && hasTracked;

    // ── Render ───────────────────────────────────────────────────────

    return (
        <section className="immersive-viz" data-theme={theme}>
            {/* Graph switch toggle */}
            <div className="kg-view-switch" data-tour-id="kg-view-switch">
                <button
                    className={`kg-switch-btn ${viewMode === "neural" ? "active" : ""}`}
                    onClick={() => setViewMode("neural")}
                    title={tkg("viewToggle.neuralTitle")}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="3" />
                        <circle cx="4" cy="6" r="2" />
                        <circle cx="20" cy="6" r="2" />
                        <circle cx="4" cy="18" r="2" />
                        <circle cx="20" cy="18" r="2" />
                        <line x1="9.5" y1="10" x2="5.5" y2="7.5" />
                        <line x1="14.5" y1="10" x2="18.5" y2="7.5" />
                        <line x1="9.5" y1="14" x2="5.5" y2="16.5" />
                        <line x1="14.5" y1="14" x2="18.5" y2="16.5" />
                    </svg>
                    {tkg("viewToggle.neural")}
                </button>
                <button
                    className={`kg-switch-btn ${viewMode === "flow" ? "active" : ""}`}
                    onClick={() => setViewMode("flow")}
                    title={tkg("viewToggle.flowTitle")}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="6" cy="4" r="2" />
                        <circle cx="12" cy="4" r="2" />
                        <circle cx="18" cy="4" r="2" />
                        <circle cx="8" cy="20" r="2" />
                        <circle cx="16" cy="20" r="2" />
                        <path d="M6 6 C6 12, 8 14, 8 18" />
                        <path d="M12 6 C12 12, 8 14, 8 18" />
                        <path d="M12 6 C12 12, 16 14, 16 18" />
                        <path d="M18 6 C18 12, 16 14, 16 18" />
                    </svg>
                    {tkg("viewToggle.flow")}
                </button>
            </div>

            <div
                ref={containerRef}
                className="viz-container"
                style={{ width: "100vw", height: "100vh", position: "absolute", top: 0, left: 0 }}
            >
                {/* Empty-state overlay — the outer wrapper stays click-through
                    (pointerEvents: none) so the ghost network underneath is
                    still explorable; only the card itself captures clicks,
                    keeping the "click a ghost root, then Start Learning" path
                    alive alongside the two CTAs below. */}
                {showEmptyState && isMounted && (
                    <div className="kg-empty-overlay">
                        <div className="kg-empty-card">
                            <span className="kg-empty-icon" aria-hidden="true">🌱</span>
                            <p className="kg-empty-title">{tkg("empty.title")}</p>
                            <p className="kg-empty-body">{tkg("empty.body")}</p>
                            {/* onExploreRoots is only wired up by the observatory shell —
                                embeds (components/embed/EmbedClient.tsx) render this viz
                                standalone with no such handler and no /study route to send
                                visitors to (it would hijack the host page from inside an
                                iframe). Show the explanatory copy above either way, but only
                                render actionable CTAs when there's somewhere for them to go. */}
                            {onExploreRoots && (
                                <div className="kg-empty-actions">
                                    <button
                                        type="button"
                                        className="kg-empty-btn-primary"
                                        onClick={() => onExploreRoots()}
                                    >
                                        {tkg("empty.exploreRoots")}
                                    </button>
                                    <Link href="/study" className="kg-empty-btn-secondary">
                                        {tkg("empty.openStudy")}
                                    </Link>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {!isMounted ? null : (
                    <svg
                        ref={svgRef}
                        viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
                        className="viz-canvas"
                        style={{ width: "100%", height: "100%", cursor: "grab" }}
                    >
                        <g ref={gRef}>
                            <defs>
                                {/* Core glow gradient */}
                                <radialGradient id="kg-coreGlow" cx="50%" cy="50%" r="50%">
                                    <stop offset="0%" stopColor={palette.learningGlow} />
                                    <stop offset="60%" stopColor="transparent" />
                                </radialGradient>

                                {/* Node glow filter */}
                                <filter id="kg-glow" x="-100%" y="-100%" width="300%" height="300%">
                                    <feGaussianBlur stdDeviation="8" result="blur" />
                                    <feMerge>
                                        <feMergeNode in="blur" />
                                        <feMergeNode in="blur" />
                                        <feMergeNode in="SourceGraphic" />
                                    </feMerge>
                                </filter>

                                <filter id="kg-subtleGlow" x="-50%" y="-50%" width="200%" height="200%">
                                    <feGaussianBlur stdDeviation="4" result="blur" />
                                    <feMerge>
                                        <feMergeNode in="blur" />
                                        <feMergeNode in="SourceGraphic" />
                                    </feMerge>
                                </filter>
                            </defs>

                            {/* Background core glow */}
                            {hasTracked && (
                                <circle
                                    cx={dimensions.width / 2}
                                    cy={dimensions.height / 2}
                                    r={Math.min(dimensions.width, dimensions.height) * 0.25}
                                    fill="url(#kg-coreGlow)"
                                    opacity={0.6}
                                />
                            )}

                            {/* Links — curved Bezier (quadratic in neural, cubic in flow) */}
                            <g className="links">
                                {links.map((link, idx) => {
                                    const source = link.source as KGNode;
                                    const target = link.target as KGNode;
                                    if (!source.x || !source.y || !target.x || !target.y) return null;

                                    const highlighted = isLinkHighlighted(link);

                                    let pathD: string;
                                    if (viewMode === "flow") {
                                        // Vertical cubic Bezier (Sankey-style)
                                        const cy1 = source.y + (target.y - source.y) * 0.4;
                                        const cy2 = source.y + (target.y - source.y) * 0.6;
                                        pathD = `M ${source.x} ${source.y} C ${source.x} ${cy1}, ${target.x} ${cy2}, ${target.x} ${target.y}`;
                                    } else {
                                        // Sideways quadratic Bezier (neural-style)
                                        const midX = (source.x + target.x) / 2;
                                        const midY = (source.y + target.y) / 2;
                                        const dx = target.x - source.x;
                                        const dy = target.y - source.y;
                                        const nx = -dy * 0.2;
                                        const ny = dx * 0.2;
                                        pathD = `M ${source.x} ${source.y} Q ${midX + nx} ${midY + ny} ${target.x} ${target.y}`;
                                    }

                                    return (
                                        <motion.path
                                            key={idx}
                                            d={pathD}
                                            fill="none"
                                            stroke={highlighted ? themeColors.accent : link.color}
                                            strokeWidth={highlighted ? 2.5 : 1}
                                            initial={{ pathLength: 0, opacity: 0 }}
                                            animate={{ pathLength: 1, opacity: highlighted ? 0.85 : 0.5 }}
                                            transition={{
                                                duration: motionSafeDuration(1200) / 1000,
                                                delay: motionSafeStagger(idx, 4, 600) / 1000,
                                            }}
                                            filter={highlighted ? "url(#kg-subtleGlow)" : undefined}
                                        />
                                    );
                                })}
                            </g>

                            {/* Nodes */}
                            <g className="nodes">
                                {nodes.map((node) => {
                                    if (!node.x || !node.y) return null;

                                    const isHovered = hoveredNode === node.id;
                                    const isSelected = selectedNode === node.id;
                                    const isHighlighted = isHovered || isSelected;
                                    const isTrackedRoot = node.type === "tracked-root";
                                    const isGhost = node.type === "ghost-root";
                                    // The app-wide shared root, when it happens to be one of
                                    // this learner's own tracked roots — same accent ring
                                    // convention RootNetworkGraph uses for its search/deep-
                                    // link highlight. Ghost roots intentionally don't get
                                    // this (nothing to track yet), so an untracked shared
                                    // root causes no visual change here.
                                    const isSharedRootMatch = isTrackedRoot && Boolean(highlightRoot) && node.label === highlightRoot;

                                    return (
                                        <g
                                            key={node.id}
                                            className="kg-node"
                                            data-node-id={node.id}
                                            transform={`translate(${node.x},${node.y})`}
                                            style={{ cursor: "grab" }}
                                            onMouseEnter={() => setHoveredNode(node.id)}
                                            onMouseLeave={() => setHoveredNode(null)}
                                            onClick={() => handleNodeClick(node)}
                                        >
                                            {/* Pulsing ring for tracked roots */}
                                            {isTrackedRoot && (
                                                <motion.circle
                                                    r={node.radius + 10}
                                                    fill="none"
                                                    stroke={node.color}
                                                    strokeWidth={1.5}
                                                    opacity={0.4}
                                                    initial={{ scale: 0.9, opacity: 0 }}
                                                    animate={{
                                                        scale: node.state === "learning" ? [1, 1.3, 1] : 1.15,
                                                        opacity: node.state === "learning" ? [0.4, 0.1, 0.4] : 0.3,
                                                    }}
                                                    transition={
                                                        reduceMotion
                                                            ? { duration: 0 }
                                                            : node.state === "learning"
                                                                ? { repeat: Infinity, duration: 2.5, ease: "easeInOut" }
                                                                : { duration: 0.5 }
                                                    }
                                                />
                                            )}

                                            {/* Accent ring for the app-wide shared root (distinct
                                                from the per-state ring above: accent color, sits
                                                just outside it) */}
                                            {isSharedRootMatch && (
                                                <motion.circle
                                                    r={node.radius + 15}
                                                    fill="none"
                                                    stroke={themeColors.accent}
                                                    strokeWidth={2}
                                                    opacity={0.5}
                                                    initial={{ scale: 0.8, opacity: 0 }}
                                                    animate={{ scale: 1.1, opacity: 0.5 }}
                                                    transition={
                                                        reduceMotion
                                                            ? { duration: 0 }
                                                            : { repeat: Infinity, repeatType: "reverse", duration: 1 }
                                                    }
                                                />
                                            )}

                                            {/* Main node circle */}
                                            <circle
                                                r={node.radius}
                                                fill={isHighlighted ? themeColors.accent : node.color}
                                                stroke={
                                                    isTrackedRoot
                                                        ? node.color
                                                        : isGhost
                                                            ? palette.ghostStroke
                                                            : "var(--line)"
                                                }
                                                strokeWidth={isTrackedRoot ? 2 : 0.5}
                                                filter={isTrackedRoot || isHighlighted ? "url(#kg-glow)" : undefined}
                                            />

                                            {/* Inner bright dot for tracked roots */}
                                            {isTrackedRoot && (
                                                <circle r={node.radius * 0.25} fill="var(--ink-secondary)" />
                                            )}

                                            {/* Label */}
                                            {(isHighlighted || isTrackedRoot) && (
                                                <text
                                                    className="node-label arabic-text"
                                                    y={node.radius + 16}
                                                    style={{
                                                        opacity: isHighlighted ? 1 : 0.75,
                                                        fontSize: isTrackedRoot ? "13px" : "10px",
                                                        fontWeight: isTrackedRoot ? 600 : 400,
                                                        fill: themeColors.textColors.primary,
                                                        textAnchor: "middle",
                                                    }}
                                                >
                                                    {node.label}
                                                </text>
                                            )}
                                        </g>
                                    );
                                })}
                            </g>
                        </g>
                    </svg>
                )}

                {/* Info card */}
                <AnimatePresence>
                    {(hoveredNode || selectedNode) && (
                        <motion.div
                            className="kg-info-card"
                            initial={{ opacity: 0, y: 8, x: "-50%" }}
                            animate={{ opacity: 1, y: 0, x: "-50%" }}
                            exit={{ opacity: 0, y: 8, x: "-50%" }}
                            transition={{ duration: motionSafeDuration(180) / 1000 }}
                        >
                            {(() => {
                                const node = nodes.find((n) => n.id === (hoveredNode ?? selectedNode));
                                if (!node) return null;
                                const isGhost = node.type === "ghost-root";
                                const statusLabel = node.type === "tracked-root"
                                    ? node.state === "learned" ? ts("learned") : ts("learning")
                                    : isGhost ? ts("untracked") : ts("lemma");
                                return (
                                    <>
                                        <span className="kg-info-word arabic-text">{node.label}</span>
                                        <span className="kg-info-divider">·</span>
                                        <span className="kg-info-meta">{statusLabel}</span>
                                        <span className="kg-info-divider">·</span>
                                        <span className="kg-info-meta">{node.frequency}x</span>
                                        {isGhost && (
                                            <button
                                                className="kg-info-track-btn"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    trackRoot(node.label);
                                                    setSelectedNode(null);
                                                    setHoveredNode(null);
                                                }}
                                            >
                                                {tk("markLearning")}
                                            </button>
                                        )}
                                    </>
                                );
                            })()}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Legend portal */}
            {isMounted &&
                typeof document !== "undefined" &&
                document.getElementById("viz-sidebar-portal") &&
                createPortal(
                    <div className="viz-left-stack">
                        {/* Zoom controls */}
                        <div className="viz-left-panel viz-zoom-panel">
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span className="eyebrow" style={{ fontSize: "0.7em" }}>{ts("zoom")}</span>
                            </div>
                            <div className="viz-zoom-row">
                                <button
                                    type="button"
                                    className="viz-zoom-reset-btn"
                                    onClick={() => {
                                        fitGraphToView(svgRef.current, gRef.current, zoomBehaviorRef.current, {
                                            duration: motionSafeDuration(750),
                                        });
                                    }}
                                >
                                    {ts("focus")}
                                </button>
                            </div>
                        </div>

                        {/* The legend explains tracked-root states (learning/
                            learned), which don't exist yet with nothing
                            tracked — suppress it until there's something to
                            key. Also gated on !knowledgeLoading (see
                            showLegend above): a signed-in user's roots
                            haven't loaded yet during that first render, and
                            the ghost-preview graph shouldn't flash a legend
                            that's about to become wrong. The zoom panel
                            above stays: it's functional even over the ghost
                            preview. */}
                        {showLegend && (
                            <div className="viz-legend" data-tour-id="viz-legend">
                                <div className="viz-legend-item">
                                    <div
                                        className="viz-legend-dot"
                                        style={{ background: palette.learningNode, width: 14, height: 14, borderRadius: "50%", boxShadow: `0 0 8px ${palette.learningGlow}` }}
                                    />
                                    <span>{ts("learning")}</span>
                                </div>
                                <div className="viz-legend-item">
                                    <div
                                        className="viz-legend-dot"
                                        style={{ background: palette.learnedNode, width: 14, height: 14, borderRadius: "50%", boxShadow: `0 0 8px ${palette.learnedGlow}` }}
                                    />
                                    <span>{ts("learned")}</span>
                                </div>
                                <div className="viz-legend-item">
                                    <div
                                        className="viz-legend-dot"
                                        style={{ background: palette.ghostNode, width: 10, height: 10, borderRadius: "50%", border: `1px solid ${palette.ghostStroke}` }}
                                    />
                                    <span>{ts("untracked")}</span>
                                </div>
                                <div className="viz-legend-item">
                                    <div
                                        className="viz-legend-dot"
                                        style={{ background: palette.lemmaNode, width: 8, height: 8, borderRadius: "50%" }}
                                    />
                                    <span>{ts("lemma")}</span>
                                </div>
                            </div>
                        )}
                    </div>,
                    document.getElementById("viz-sidebar-portal")!
                )}
        </section>
    );
}
