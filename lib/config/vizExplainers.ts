import { CATEGORY_COLORS } from "@/lib/schema/visualizationTypes";
import type { VisualizationMode } from "@/lib/schema/visualizationTypes";

export interface LegendItem {
  color: string;
  shape: "circle" | "line" | "rect" | "arc";
  /** i18n key under `VizExplainer.<mode>.legend` */
  labelKey: string;
}

export interface VizExplainer {
  /** One-sentence summary of what the user is seeing */
  summaryKey: string;
  /** Color/shape legend items (labels are i18n keys) */
  legend: LegendItem[];
  /** Interaction hints (i18n keys) */
  hintKeys: string[];
  /** Why this view is useful (i18n key) */
  purposeKey: string;
  /**
   * One-line "claim" — what this view lets you discover. Powers the
   * first-open intro card (`VizIntroCard`), distinct from the persistent
   * "What am I seeing?" panel above.
   */
  claimKey: string;
  /** Exactly 3 short "how to read it" steps for the intro card (i18n keys). */
  howToReadKeys: readonly [string, string, string];
  /**
   * Optional notes on reading the picture itself — its geometry, scale and
   * marks — for views a colour legend can't explain alone. When present the
   * panel heads them "How to read it" and the hints "How to use it", and the
   * gallery page lists them too (i18n keys).
   */
  readKeys?: readonly string[];
  /** Optional annotated diagram drawn above the reading notes. */
  figure?: "concordance-anatomy";
}

/**
 * Static explainer content for each visualization mode.
 * All text fields are i18n keys under `VizExplainer.<mode>`.
 *
 * Legend colors are sourced to match what each canvas ACTUALLY renders so the
 * legend can never disagree with the graph:
 *   - Part-of-speech nodes derive from `CATEGORY_COLORS` (same as `getNodeColor`).
 *   - Theme-driven elements (edges, arcs, structural nodes) use the live CSS
 *     accent variables (`var(--accent)` / `var(--accent-2)`) the canvases read,
 *     so the swatch follows the user's chosen accent.
 *   - Categorical encodings (Makki/Madani) use the theme-stable `--viz-cat-*`
 *     tokens, never `--accent`/`--accent-2` (those swap hues between themes).
 *   - Neutral structure stays slate (`CATEGORY_COLORS.other`).
 */
const NEUTRAL = CATEGORY_COLORS.other; // slate #94a3b8

export const VIZ_EXPLAINERS: Record<VisualizationMode, VizExplainer> = {
  "surah-distribution": {
    summaryKey: "surah-distribution.summary",
    legend: [
      { color: "var(--viz-cat-makki)", shape: "arc", labelKey: "surah-distribution.legend.makki" },
      { color: "var(--viz-cat-madani)", shape: "arc", labelKey: "surah-distribution.legend.madani" },
      { color: CATEGORY_COLORS.pronoun, shape: "circle", labelKey: "surah-distribution.legend.rootFrequency" },
    ],
    hintKeys: [
      "surah-distribution.hint.hover",
      "surah-distribution.hint.click",
      "surah-distribution.hint.zoom",
    ],
    purposeKey: "surah-distribution.purpose",
    claimKey: "surah-distribution.claim",
    howToReadKeys: [
      "surah-distribution.hint.hover",
      "surah-distribution.hint.click",
      "surah-distribution.hint.zoom",
    ],
  },

  "corpus-architecture": {
    summaryKey: "corpus-architecture.summary",
    legend: [
      { color: "var(--viz-cat-makki)", shape: "arc", labelKey: "corpus-architecture.legend.makki" },
      { color: "var(--viz-cat-madani)", shape: "arc", labelKey: "corpus-architecture.legend.madani" },
      { color: "var(--ink)", shape: "circle", labelKey: "corpus-architecture.legend.root" },
    ],
    hintKeys: [
      "corpus-architecture.hint.expand",
      "corpus-architecture.hint.click",
    ],
    purposeKey: "corpus-architecture.purpose",
    claimKey: "corpus-architecture.claim",
    howToReadKeys: [
      "corpus-architecture.hint.expand",
      "corpus-architecture.hint.click",
      "corpus-architecture.hint.zoom",
    ],
  },

  // Canvas colours POS dots via getNodeColor() — matches the on-canvas legend exactly.
  "radial-sura": {
    summaryKey: "radial-sura.summary",
    legend: [
      { color: CATEGORY_COLORS.noun, shape: "circle", labelKey: "radial-sura.legend.noun" },
      { color: CATEGORY_COLORS.verb, shape: "circle", labelKey: "radial-sura.legend.verb" },
      { color: CATEGORY_COLORS.adjective, shape: "circle", labelKey: "radial-sura.legend.adjective" },
      { color: CATEGORY_COLORS.preposition, shape: "circle", labelKey: "radial-sura.legend.preposition" },
      { color: NEUTRAL, shape: "line", labelKey: "radial-sura.legend.ayahBoundary" },
    ],
    hintKeys: [
      "radial-sura.hint.hover",
      "radial-sura.hint.click",
      "radial-sura.hint.drag",
      "radial-sura.hint.zoom",
    ],
    purposeKey: "radial-sura.purpose",
    claimKey: "radial-sura.claim",
    howToReadKeys: [
      "radial-sura.hint.hover",
      "radial-sura.hint.click",
      "radial-sura.hint.zoom",
    ],
  },

  // Tokens coloured by getNodeColor(pos); edges use var(--accent).
  "dependency-tree": {
    summaryKey: "dependency-tree.summary",
    legend: [
      { color: CATEGORY_COLORS.noun, shape: "circle", labelKey: "dependency-tree.legend.token" },
      { color: "var(--accent)", shape: "line", labelKey: "dependency-tree.legend.edge" },
    ],
    hintKeys: [
      "dependency-tree.hint.hover",
      "dependency-tree.hint.click",
    ],
    purposeKey: "dependency-tree.purpose",
    claimKey: "dependency-tree.claim",
    howToReadKeys: [
      "dependency-tree.hint.hover",
      "dependency-tree.hint.click",
      "dependency-tree.hint.zoom",
    ],
  },

  // Tokens coloured by getNodeColor(pos); arcs use the theme accent gradient.
  "arc-flow": {
    summaryKey: "arc-flow.summary",
    legend: [
      { color: CATEGORY_COLORS.noun, shape: "circle", labelKey: "arc-flow.legend.token" },
      { color: "var(--accent)", shape: "arc", labelKey: "arc-flow.legend.arc" },
    ],
    hintKeys: [
      "arc-flow.hint.hover",
      "arc-flow.hint.click",
    ],
    purposeKey: "arc-flow.purpose",
    claimKey: "arc-flow.claim",
    howToReadKeys: [
      "arc-flow.hint.hover",
      "arc-flow.hint.click",
      "arc-flow.hint.pan",
    ],
  },

  // Root nodes use the theme accent; lemma nodes use getNodeColor(pos).
  "root-network": {
    summaryKey: "root-network.summary",
    legend: [
      { color: "var(--accent)", shape: "circle", labelKey: "root-network.legend.root" },
      { color: CATEGORY_COLORS.noun, shape: "circle", labelKey: "root-network.legend.lemma" },
      { color: NEUTRAL, shape: "line", labelKey: "root-network.legend.link" },
    ],
    hintKeys: [
      "root-network.hint.hover",
      "root-network.hint.click",
      "root-network.hint.drag",
    ],
    purposeKey: "root-network.purpose",
    claimKey: "root-network.claim",
    howToReadKeys: [
      "root-network.hint.hover",
      "root-network.hint.click",
      "root-network.hint.drag",
    ],
  },

  "sankey-flow": {
    summaryKey: "sankey-flow.summary",
    legend: [
      { color: "var(--accent)", shape: "rect", labelKey: "sankey-flow.legend.root" },
      { color: "var(--accent-2)", shape: "rect", labelKey: "sankey-flow.legend.lemma" },
      { color: NEUTRAL, shape: "line", labelKey: "sankey-flow.legend.flow" },
    ],
    hintKeys: [
      "sankey-flow.hint.hover",
      "sankey-flow.hint.click",
    ],
    purposeKey: "sankey-flow.purpose",
    claimKey: "sankey-flow.claim",
    howToReadKeys: [
      "sankey-flow.hint.hover",
      "sankey-flow.hint.click",
      "sankey-flow.hint.path",
    ],
  },

  "collocation-network": {
    summaryKey: "collocation-network.summary",
    legend: [
      { color: "var(--accent)", shape: "circle", labelKey: "collocation-network.legend.root" },
      { color: "var(--accent-2)", shape: "circle", labelKey: "collocation-network.legend.collocate" },
      { color: CATEGORY_COLORS.preposition, shape: "line", labelKey: "collocation-network.legend.pmi" },
    ],
    hintKeys: [
      "collocation-network.hint.hover",
      "collocation-network.hint.click",
      "collocation-network.hint.drag",
    ],
    purposeKey: "collocation-network.purpose",
    claimKey: "collocation-network.claim",
    howToReadKeys: [
      "collocation-network.hint.hover",
      "collocation-network.hint.click",
      "collocation-network.hint.drag",
    ],
  },

  // Root colours come from the theme-stable --viz-root-* tokens, not --accent,
  // so a root keeps its colour when the theme changes.
  "concordance-rings": {
    summaryKey: "concordance-rings.summary",
    legend: [
      { color: "var(--ink-muted)", shape: "rect", labelKey: "concordance-rings.legend.ayah" },
      { color: "var(--viz-root-1)", shape: "rect", labelKey: "concordance-rings.legend.root1" },
      { color: "var(--viz-root-2)", shape: "rect", labelKey: "concordance-rings.legend.root2" },
      { color: "var(--viz-root-3)", shape: "rect", labelKey: "concordance-rings.legend.root3" },
      { color: "var(--viz-meeting)", shape: "rect", labelKey: "concordance-rings.legend.meeting" },
      { color: "var(--ink-muted)", shape: "line", labelKey: "concordance-rings.legend.thread" },
      { color: "var(--ink-muted)", shape: "rect", labelKey: "concordance-rings.legend.histogram" },
    ],
    hintKeys: [
      "concordance-rings.hint.roots",
      "concordance-rings.hint.hover",
      "concordance-rings.hint.meetIn",
      "concordance-rings.hint.view",
      "concordance-rings.hint.order",
      "concordance-rings.hint.align",
      "concordance-rings.hint.toggles",
      "concordance-rings.hint.zoom",
      "concordance-rings.hint.keys",
    ],
    purposeKey: "concordance-rings.purpose",
    claimKey: "concordance-rings.claim",
    howToReadKeys: [
      "concordance-rings.hint.roots",
      "concordance-rings.hint.hover",
      "concordance-rings.hint.view",
    ],
    // Rings, a clockwise 0–100 scale and threads: the geometry needs reading
    // notes of its own, not just colour swatches.
    readKeys: [
      "concordance-rings.read.rings",
      "concordance-rings.read.scale",
      "concordance-rings.read.ticks",
      "concordance-rings.read.threads",
      "concordance-rings.read.centre",
      "concordance-rings.read.numbers",
      "concordance-rings.read.caveat",
    ],
    figure: "concordance-anatomy",
  },

  // Canvas tints tracked roots with the accent, ghosts stay neutral.
  "knowledge-graph": {
    summaryKey: "knowledge-graph.summary",
    legend: [
      { color: "var(--accent-2)", shape: "circle", labelKey: "knowledge-graph.legend.tracked" },
      { color: NEUTRAL, shape: "circle", labelKey: "knowledge-graph.legend.untracked" },
      { color: "var(--accent)", shape: "line", labelKey: "knowledge-graph.legend.link" },
    ],
    hintKeys: [
      "knowledge-graph.hint.hover",
      "knowledge-graph.hint.click",
    ],
    purposeKey: "knowledge-graph.purpose",
    claimKey: "knowledge-graph.claim",
    howToReadKeys: [
      "knowledge-graph.hint.hover",
      "knowledge-graph.hint.click",
      "knowledge-graph.hint.legend",
    ],
  },

  // Frequency ramp in the warm V2 spectrum (yellow → amber → coral).
  heatmap: {
    summaryKey: "heatmap.summary",
    legend: [
      { color: CATEGORY_COLORS.preposition, shape: "rect", labelKey: "heatmap.legend.low" },
      { color: CATEGORY_COLORS.noun, shape: "rect", labelKey: "heatmap.legend.medium" },
      { color: CATEGORY_COLORS.particle, shape: "rect", labelKey: "heatmap.legend.high" },
    ],
    hintKeys: [
      "heatmap.hint.hover",
      "heatmap.hint.click",
    ],
    purposeKey: "heatmap.purpose",
    claimKey: "heatmap.claim",
    howToReadKeys: [
      "heatmap.hint.hover",
      "heatmap.hint.click",
      "heatmap.hint.legend",
    ],
  },
};
