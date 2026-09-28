"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { VizErrorBoundary } from "@/components/ErrorBoundary";
import { VizControlProvider } from "@/lib/hooks/VizControlContext";
import { loadFullCorpus, loadSurahs } from "@/lib/corpus/corpusLoader";
import { buildRootWordFlows, uniqueRoots } from "@/lib/search/rootFlows";
import { SURAH_NAMES } from "@/lib/data/surahData";
import type { VisualizationMode } from "@/lib/schema/visualizationTypes";
import type { CorpusToken } from "@/lib/schema/types";

/* ------------------------------------------------------------------ */
/* Lazy-loaded visualization components                                */
/* ------------------------------------------------------------------ */
function VizFallback() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%" }}>
      <div style={{ width: 28, height: 28, border: "3px solid var(--line, rgba(148,163,184,0.3))", borderTopColor: "var(--accent, #56a697)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
    </div>
  );
}

function load<T>(loader: Parameters<typeof dynamic<T>>[0]) {
  return dynamic(loader, { loading: () => <VizFallback />, ssr: false });
}

const RadialSuraMap = load(() => import("@/components/visualisations/RadialSuraMap"));
const RootNetworkGraph = load(() => import("@/components/visualisations/RootNetworkGraph"));
const SurahDistributionGraph = load(() => import("@/components/visualisations/SurahDistributionGraph"));
const ArcFlowDiagram = load(() => import("@/components/visualisations/ArcFlowDiagram"));
const AyahDependencyGraph = load(() => import("@/components/visualisations/AyahDependencyGraph"));
const RootFlowSankey = load(() => import("@/components/visualisations/RootFlowSankey"));
const CorpusArchitectureMap = load(() => import("@/components/visualisations/CorpusArchitectureMap"));
const KnowledgeGraphViz = load(() => import("@/components/visualisations/KnowledgeGraphViz"));
const CollocationNetworkGraph = load(() => import("@/components/visualisations/CollocationNetworkGraph"));
const ConcordanceRings = load(() => import("@/components/visualisations/ConcordanceRings"));

/* ------------------------------------------------------------------ */
/* postMessage protocol                                                */
/* ------------------------------------------------------------------ */
interface QcvConfigMessage {
  type: "qcv:config";
  payload: {
    selectedRoot?: string | null;
    selectedSurah?: number;
    theme?: "light" | "dark";
  };
}

function isQcvConfigMessage(data: unknown): data is QcvConfigMessage {
  if (typeof data !== "object" || data === null) return false;
  const msg = data as Record<string, unknown>;
  return msg.type === "qcv:config" && typeof msg.payload === "object" && msg.payload !== null;
}

/* ------------------------------------------------------------------ */
/* Props                                                               */
/* ------------------------------------------------------------------ */
interface EmbedClientProps {
  vizMode: VisualizationMode;
  initialRoot: string | null;
  initialSurah: number;
  initialTheme: "light" | "dark";
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */
export default function EmbedClient({ vizMode, initialRoot, initialSurah, initialTheme }: EmbedClientProps) {
  const [allTokens, setAllTokens] = useState<CorpusToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRoot, setSelectedRoot] = useState<string | null>(initialRoot);
  const [selectedSurahId, setSelectedSurahId] = useState(initialSurah);
  const [theme, setTheme] = useState(initialTheme);
  const containerRef = useRef<HTMLDivElement>(null);

  /* ---- data loading ------------------------------------------------ */
  const needsFullCorpus = vizMode === "surah-distribution" || vizMode === "corpus-architecture" || vizMode === "knowledge-graph";
  // Concordance rings bring their own data (public/data/concordance.json) and
  // read no corpus tokens, so they neither wait for nor trigger a corpus load.
  const ownData = vizMode === "concordance-rings";

  useEffect(() => {
    if (ownData) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const loader = needsFullCorpus
      ? loadFullCorpus()
      : loadSurahs([selectedSurahId]);

    loader.then((tokens) => {
      if (!cancelled) {
        setAllTokens(tokens);
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [needsFullCorpus, ownData, selectedSurahId]);

  const flows = useMemo(() => buildRootWordFlows(allTokens), [allTokens]);
  const roots = useMemo(() => uniqueRoots(allTokens), [allTokens]);
  const tokenById = useMemo(() => new Map(allTokens.map((t) => [t.id, t])), [allTokens]);

  /* ---- interaction stubs ------------------------------------------- */
  const noop = useCallback(() => {}, []);
  const handleRootSelect = useCallback((root: string | null) => {
    setSelectedRoot(root);
    if (window.parent !== window) {
      window.parent.postMessage({ type: "qcv:selection", payload: { root } }, "*");
    }
  }, []);
  const handleSurahSelect = useCallback((surahId: number) => {
    setSelectedSurahId(surahId);
    if (window.parent !== window) {
      window.parent.postMessage({ type: "qcv:selection", payload: { surahId } }, "*");
    }
  }, []);

  /* ---- postMessage: inbound ---------------------------------------- */
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!isQcvConfigMessage(event.data)) return;
      const { payload } = event.data;
      if (payload.selectedRoot !== undefined) setSelectedRoot(payload.selectedRoot);
      if (typeof payload.selectedSurah === "number") setSelectedSurahId(payload.selectedSurah);
      if (payload.theme === "light" || payload.theme === "dark") setTheme(payload.theme);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  /* ---- theme ------------------------------------------------------- */
  // <html> carries the visitor's site theme (dark by default), and the light
  // tokens live on :root, so a data-theme on the wrapper alone left a light
  // embed half dark. The embed is its own document: its theme is the page's.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  /* ---- postMessage: outbound ready --------------------------------- */
  useEffect(() => {
    if (!loading && window.parent !== window) {
      window.parent.postMessage({ type: "qcv:ready", payload: { vizMode } }, "*");
    }
  }, [loading, vizMode]);

  /* ---- render visualization ---------------------------------------- */
  const vizContent = useMemo(() => {
    if (vizMode === "concordance-rings") {
      return <ConcordanceRings theme={theme} highlightRoot={selectedRoot} />;
    }
    if (allTokens.length === 0) return null;
    switch (vizMode) {
      case "radial-sura":
        return (
          <RadialSuraMap
            tokens={allTokens}
            suraId={selectedSurahId}
            suraName={SURAH_NAMES[selectedSurahId]?.name || `Surah ${selectedSurahId}`}
            suraNameArabic={SURAH_NAMES[selectedSurahId]?.arabic || ""}
            onTokenHover={noop}
            onTokenFocus={noop}
            onRootSelect={handleRootSelect}
            highlightRoot={selectedRoot}
            theme={theme}
            lexicalColorMode="frequency"
          />
        );
      case "root-network":
        return (
          <RootNetworkGraph
            tokens={allTokens}
            onTokenHover={noop}
            onTokenFocus={noop}
            onRootSelect={handleRootSelect}
            highlightRoot={selectedRoot}
            selectedSurahId={selectedSurahId}
            theme={theme}
            showLabels={true}
            lexicalColorMode="frequency"
          />
        );
      case "surah-distribution":
        return (
          <SurahDistributionGraph
            tokens={allTokens}
            onTokenHover={noop}
            onTokenFocus={noop}
            onSurahSelect={handleSurahSelect}
            highlightRoot={selectedRoot}
            theme={theme}
            lexicalColorMode="frequency"
          />
        );
      case "corpus-architecture":
        return (
          <CorpusArchitectureMap
            tokens={allTokens}
            selectedSurahId={selectedSurahId}
            highlightRoot={selectedRoot}
            onNodeSelect={(type, id) => {
              if (type === "surah") handleSurahSelect(id as number);
              if (type === "root") handleRootSelect(id as string);
            }}
            theme={theme}
            lexicalColorMode="frequency"
          />
        );
      case "arc-flow":
        return (
          <ArcFlowDiagram
            tokens={allTokens}
            groupBy="root"
            onTokenHover={noop}
            onTokenFocus={noop}
            selectedSurahId={selectedSurahId}
            selectedAyah={null}
            selectedRoot={selectedRoot}
            selectedLemma={null}
            experienceLevel="beginner"
            theme={theme}
            lexicalColorMode="frequency"
          />
        );
      case "dependency-tree":
        return (
          <AyahDependencyGraph
            tokens={allTokens}
            selectedSurahId={selectedSurahId}
            selectedAyah={null}
            onTokenHover={noop}
            onTokenFocus={noop}
            onSurahChange={setSelectedSurahId}
            theme={theme}
            lexicalColorMode="frequency"
          />
        );
      case "knowledge-graph":
        return <KnowledgeGraphViz tokens={allTokens} onRootSelect={handleRootSelect} theme={theme} />;
      case "sankey-flow":
        return (
          <RootFlowSankey
            flows={flows}
            roots={roots}
            tokenById={tokenById}
            onTokenHover={noop}
            onTokenFocus={noop}
            selectedSurahId={selectedSurahId}
            experienceLevel="beginner"
            theme={theme}
            lexicalColorMode="frequency"
          />
        );
      case "collocation-network":
        return (
          <CollocationNetworkGraph
            tokens={allTokens}
            onTokenHover={noop}
            onTokenFocus={noop}
            onRootSelect={handleRootSelect}
            experienceLevel="beginner"
            highlightRoot={selectedRoot}
            selectedSurahId={selectedSurahId}
            theme={theme}
          />
        );
      default:
        return null;
    }
  }, [vizMode, allTokens, selectedSurahId, selectedRoot, theme, flows, roots, tokenById, noop, handleRootSelect, handleSurahSelect]);

  return (
    <VizControlProvider>
      <div ref={containerRef} className="embed-client" data-theme={theme}>
        {loading ? (
          <div className="embed-loading">
            <VizFallback />
          </div>
        ) : (
          <VizErrorBoundary name={vizMode}>
            {vizContent}
          </VizErrorBoundary>
        )}

        <a
          className="embed-watermark"
          href="https://quranobservatory.org"
          target="_blank"
          rel="noopener noreferrer"
        >
          Powered by QCV
        </a>

        <style jsx>{`
          .embed-client {
            position: relative;
            width: 100vw;
            height: 100vh;
            overflow: hidden;
            background: var(--bg-0, #fff);
          }
          .embed-loading {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            height: 100%;
          }
          .embed-watermark {
            position: absolute;
            bottom: 8px;
            right: 12px;
            font-size: 0.65rem;
            font-weight: 600;
            color: var(--ink-muted, #999);
            text-decoration: none;
            opacity: 0.7;
            z-index: 10;
            pointer-events: auto;
          }
          .embed-watermark:hover {
            opacity: 1;
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    </VizControlProvider>
  );
}
