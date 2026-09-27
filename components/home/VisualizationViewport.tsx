"use client";

import dynamic from "next/dynamic";
import { VizErrorBoundary } from "@/components/ErrorBoundary";
import { SURAH_NAMES } from "@/lib/data/surahData";
import type { ExperienceLevel } from "@/lib/schema/experience";
import type { VisualizationMode } from "@/lib/schema/visualizationTypes";
import type { CorpusToken, RootWordFlow } from "@/lib/schema/types";
import type { LexicalColorMode } from "@/lib/theme/lexicalColoring";

function VizFallback({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", minHeight: 200 }}>
      <div style={{ textAlign: "center", color: "var(--ink-muted)" }}>
        <div style={{ width: 32, height: 32, border: "3px solid var(--line)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 0.5rem" }} />
        <span style={{ fontSize: "0.85rem" }}>{label}</span>
      </div>
    </div>
  );
}

const VIZ_FALLBACK_LABEL = "Loading visualization...";

function buildVizComponent<T>(loader: Parameters<typeof dynamic<T>>[0]) {
  return dynamic(loader, { loading: () => <VizFallback label={VIZ_FALLBACK_LABEL} />, ssr: false });
}

const RadialSuraMap = buildVizComponent(() => import("@/components/visualisations/RadialSuraMap"));
const RootNetworkGraph = buildVizComponent(() => import("@/components/visualisations/RootNetworkGraph"));
const SurahDistributionGraph = buildVizComponent(() => import("@/components/visualisations/SurahDistributionGraph"));
const ArcFlowDiagram = buildVizComponent(() => import("@/components/visualisations/ArcFlowDiagram"));
const AyahDependencyGraph = buildVizComponent(() => import("@/components/visualisations/AyahDependencyGraph"));
const RootFlowSankey = buildVizComponent(() => import("@/components/visualisations/RootFlowSankey"));
const CorpusArchitectureMap = buildVizComponent(() => import("@/components/visualisations/CorpusArchitectureMap"));
const KnowledgeGraphViz = buildVizComponent(() => import("@/components/visualisations/KnowledgeGraphViz"));
const CollocationNetworkGraph = buildVizComponent(() => import("@/components/visualisations/CollocationNetworkGraph"));
const ConcordanceRings = buildVizComponent(() => import("@/components/visualisations/ConcordanceRings"));

interface VisualizationViewportProps {
  vizMode: VisualizationMode;
  allTokens: CorpusToken[];
  experienceLevel: ExperienceLevel;
  selectedSurahId: number;
  selectedAyahInSurah: number | null;
  /** The globally focused token — the structure map lights its occurrence
   *  wire from this, wherever the ayah was picked. */
  focusedToken: CorpusToken | null;
  selectedRoot: string | null;
  selectedRootValue: string | null;
  selectedLemmaValue: string | null;
  flows: RootWordFlow[];
  roots: string[];
  tokenById: Map<string, CorpusToken>;
  theme: "light" | "dark";
  lexicalColorMode: LexicalColorMode;
  setHoverTokenId: (tokenId: string | null) => void;
  setFocusedTokenId: (tokenId: string | null) => void;
  setSelectedSurahId: (surahId: number) => void;
  handleRootSelect: (root: string | null) => void;
  handleSurahSelect: (surahId: number, nextMode?: "radial-sura" | "root-network") => void;
  /** Knowledge graph empty state: "Browse roots" CTA switches to root-network. */
  onExploreRoots?: () => void;
}

export default function VisualizationViewport({
  vizMode,
  allTokens,
  experienceLevel,
  selectedSurahId,
  selectedAyahInSurah,
  focusedToken,
  selectedRoot,
  selectedRootValue,
  selectedLemmaValue,
  flows,
  roots,
  tokenById,
  theme,
  lexicalColorMode,
  setHoverTokenId,
  setFocusedTokenId,
  setSelectedSurahId,
  handleRootSelect,
  handleSurahSelect,
  onExploreRoots,
}: VisualizationViewportProps) {
  const vizContent = (() => {
    switch (vizMode) {
      case "radial-sura":
        return (
          <RadialSuraMap
            tokens={allTokens}
            suraId={selectedSurahId}
            suraName={SURAH_NAMES[selectedSurahId]?.name || `Surah ${selectedSurahId}`}
            suraNameArabic={SURAH_NAMES[selectedSurahId]?.arabic || ""}
            onTokenHover={setHoverTokenId}
            onTokenFocus={setFocusedTokenId}
            onRootSelect={handleRootSelect}
            highlightRoot={selectedRoot}
            focusAyah={selectedAyahInSurah}
            theme={theme}
            lexicalColorMode={lexicalColorMode}
          />
        );
      case "root-network":
        return (
          <RootNetworkGraph
            tokens={allTokens}
            onTokenHover={setHoverTokenId}
            onTokenFocus={setFocusedTokenId}
            onRootSelect={handleRootSelect}
            highlightRoot={selectedRoot}
            selectedSurahId={selectedSurahId}
            theme={theme}
            showLabels={true}
            lexicalColorMode={lexicalColorMode}
          />
        );
      case "surah-distribution":
        return (
          <SurahDistributionGraph
            tokens={allTokens}
            onTokenHover={setHoverTokenId}
            onTokenFocus={setFocusedTokenId}
            onSurahSelect={(surahId) => handleSurahSelect(surahId, "radial-sura")}
            highlightRoot={selectedRoot}
            theme={theme}
            lexicalColorMode={lexicalColorMode}
          />
        );
      case "corpus-architecture":
        return (
          <CorpusArchitectureMap
            tokens={allTokens}
            selectedSurahId={selectedSurahId}
            highlightRoot={selectedRoot}
            onNodeSelect={(type, id) => {
              if (type === "surah") setSelectedSurahId(id as number);
              if (type === "root") handleRootSelect(id as string);
            }}
            onTokenFocus={setFocusedTokenId}
            onTokenHover={setHoverTokenId}
            focusedSura={focusedToken?.sura ?? null}
            focusedAyah={focusedToken?.ayah ?? null}
            theme={theme}
            lexicalColorMode={lexicalColorMode}
          />
        );
      case "arc-flow":
        return (
          <ArcFlowDiagram
            tokens={allTokens}
            groupBy="root"
            onTokenHover={setHoverTokenId}
            onTokenFocus={setFocusedTokenId}
            selectedSurahId={selectedSurahId}
            selectedAyah={selectedAyahInSurah}
            selectedRoot={selectedRootValue}
            selectedLemma={selectedLemmaValue}
            experienceLevel={experienceLevel}
            theme={theme}
            lexicalColorMode={lexicalColorMode}
          />
        );
      case "dependency-tree":
        return (
          <AyahDependencyGraph
            tokens={allTokens}
            selectedSurahId={selectedSurahId}
            selectedAyah={selectedAyahInSurah}
            onTokenHover={setHoverTokenId}
            onTokenFocus={setFocusedTokenId}
            onSurahChange={setSelectedSurahId}
            theme={theme}
            lexicalColorMode={lexicalColorMode}
          />
        );
      case "knowledge-graph":
        return (
          <KnowledgeGraphViz
            tokens={allTokens}
            onRootSelect={handleRootSelect}
            highlightRoot={selectedRoot}
            theme={theme}
            onExploreRoots={onExploreRoots}
          />
        );
      case "sankey-flow":
        return (
          <RootFlowSankey
            flows={flows}
            roots={roots}
            tokenById={tokenById}
            onTokenHover={setHoverTokenId}
            onTokenFocus={setFocusedTokenId}
            selectedSurahId={selectedSurahId}
            experienceLevel={experienceLevel}
            theme={theme}
            lexicalColorMode={lexicalColorMode}
            highlightRoot={selectedRoot}
            onRootSelect={handleRootSelect}
          />
        );
      case "collocation-network":
        return (
          <CollocationNetworkGraph
            tokens={allTokens}
            onTokenHover={setHoverTokenId}
            onTokenFocus={setFocusedTokenId}
            onRootSelect={handleRootSelect}
            experienceLevel={experienceLevel}
            highlightRoot={selectedRoot}
            selectedSurahId={selectedSurahId}
            theme={theme}
          />
        );
      case "concordance-rings":
        return (
          <ConcordanceRings
            theme={theme}
            highlightRoot={selectedRoot}
            onRootSelect={handleRootSelect}
          />
        );
      default:
        return null;
    }
  })();

  const surahLabel = SURAH_NAMES[selectedSurahId]?.name || `Surah ${selectedSurahId}`;
  const ariaLabel = `${vizMode.replace(/-/g, " ")} visualization${selectedRoot ? ` — root: ${selectedRoot}` : ""} — ${surahLabel}`;

  return (
    <div aria-label={ariaLabel} role="img" style={{ width: "100%", height: "100%" }}>
      <VizErrorBoundary name={vizMode}>{vizContent ?? <VizFallback label={VIZ_FALLBACK_LABEL} />}</VizErrorBoundary>
    </div>
  );
}
