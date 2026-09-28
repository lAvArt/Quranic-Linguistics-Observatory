import { notFound } from "next/navigation";
import type { VisualizationMode } from "@/lib/schema/visualizationTypes";
import EmbedClient from "@/components/embed/EmbedClient";

const VALID_MODES: Set<string> = new Set<VisualizationMode>([
  "radial-sura",
  "root-network",
  "arc-flow",
  "dependency-tree",
  "sankey-flow",
  "surah-distribution",
  "corpus-architecture",
  "knowledge-graph",
  "collocation-network",
  "concordance-rings",
  "heatmap",
]);

interface EmbedPageProps {
  params: Promise<{ vizMode: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function EmbedPage({ params, searchParams }: EmbedPageProps) {
  const { vizMode } = await params;
  if (!VALID_MODES.has(vizMode)) notFound();

  const sp = await searchParams;

  const root = typeof sp.root === "string" ? sp.root : null;
  const surah = typeof sp.surah === "string" ? Number(sp.surah) : 1;
  const theme = sp.theme === "dark" ? "dark" : "light";

  return (
    <EmbedClient
      vizMode={vizMode as VisualizationMode}
      initialRoot={root}
      initialSurah={Number.isFinite(surah) && surah >= 1 ? surah : 1}
      initialTheme={theme}
    />
  );
}
