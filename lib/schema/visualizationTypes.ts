/**
 * Extended types for advanced visualizations
 */

import type { CorpusToken } from "./types";

// ============================================================================
// Visualization Mode Types
// ============================================================================

export type VisualizationMode =
  | "radial-sura"      // Radial layout showing sura structure
  | "root-network"     // Force-directed network of root connections
  | "arc-flow"         // Arc diagram with flowing connections
  | "dependency-tree"  // Traditional dependency graph
  | "sankey-flow"      // Root-to-lemma Sankey diagram
  | "surah-distribution" // Spiral view of all surahs
  | "corpus-architecture" // Global corpus hierarchy map
  | "knowledge-graph"  // Neural network of tracked roots
  | "collocation-network" // Network map for root collocations and PMI
  | "concordance-rings" // 2-3 roots across all 114 surahs as concentric rings
  | "heatmap";         // Frequency heatmap grid

// ============================================================================
// Visualization Groups — intent-based categorization for progressive disclosure
// ============================================================================

export type VisualizationCategory =
  | "overview"      // What does the Quran look like?
  | "explore-surah" // Study a specific chapter
  | "trace-root"    // Follow a word family across the corpus
  | "track-progress"; // Personal study journey

export interface VisualizationGroup {
  category: VisualizationCategory;
  /** The recommended "default" mode for beginners in this group */
  defaultMode: VisualizationMode;
  modes: VisualizationMode[];
}

export const VISUALIZATION_GROUPS: VisualizationGroup[] = [
  {
    category: "overview",
    defaultMode: "surah-distribution",
    modes: ["corpus-architecture", "surah-distribution"],
  },
  {
    category: "explore-surah",
    defaultMode: "radial-sura",
    modes: ["radial-sura", "dependency-tree", "arc-flow"],
  },
  {
    category: "trace-root",
    defaultMode: "root-network",
    modes: ["root-network", "sankey-flow", "collocation-network", "concordance-rings"],
  },
  {
    category: "track-progress",
    defaultMode: "knowledge-graph",
    modes: ["knowledge-graph"],
  },
];

/** Get the category a visualization mode belongs to */
export function getVisualizationCategory(mode: VisualizationMode): VisualizationCategory | null {
  for (const group of VISUALIZATION_GROUPS) {
    if (group.modes.includes(mode)) return group.category;
  }
  return null;
}

export interface VisualizationConfig {
  mode: VisualizationMode;
  theme: "light" | "dark";
  animationEnabled: boolean;
  showLabels: boolean;
  showGlows: boolean;
  interactionMode: "hover" | "click" | "both";
}

// ============================================================================
// Radial Visualization Types (Inspired by Image 1)
// ============================================================================

export interface RadialNode {
  id: string;
  label: string;
  labelArabic?: string;
  angle: number;          // Position on the arc (0-360)
  radius: number;         // Distance from center
  size: number;           // Node size (based on frequency/importance)
  color: string;
  category: "sura" | "ayah" | "root" | "lemma" | "token";
  data: unknown;
}

export interface RadialLink {
  id: string;
  source: string;
  target: string;
  weight: number;         // Affects line thickness
  color: string;
  curvature: number;      // 0-1, how curved the line is
  animated?: boolean;
}

export interface RadialSuraData {
  suraId: number;
  suraName: string;
  suraNameArabic: string;
  ayahCount: number;
  revelationPlace: "makkah" | "madinah";
  nodes: RadialNode[];
  links: RadialLink[];
  rootDistribution: Map<string, number>;
  posDistribution: Map<string, number>;
}

// ============================================================================
// Network Graph Types (Inspired by Image 2)
// ============================================================================

export interface NetworkNode {
  id: string;
  label: string;
  x?: number;
  y?: number;
  fx?: number | null;     // Fixed x position (for D3 force)
  fy?: number | null;     // Fixed y position (for D3 force)
  radius: number;
  color: string;
  glowColor?: string;
  glowIntensity?: number; // 0-1
  category: string;
  weight: number;         // Affects force simulation
  data: CorpusToken | Record<string, unknown>;
}

export interface NetworkEdge {
  id: string;
  source: string | NetworkNode;
  target: string | NetworkNode;
  weight: number;
  color: string;
  opacity: number;
  highlighted?: boolean;
  relationLabel?: string;
}

export interface NetworkGraphData {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  clusters?: NetworkCluster[];
}

export interface NetworkCluster {
  id: string;
  label: string;
  nodeIds: string[];
  color: string;
  centerX?: number;
  centerY?: number;
}

// ============================================================================
// Arc Flow Types
// ============================================================================

export interface ArcFlowNode {
  id: string;
  label: string;
  position: number;       // Position along the arc (0-1)
  side: "inner" | "outer";
  size: number;
  color: string;
  barHeight: number;      // For bar chart representation
}

export interface ArcFlowConnection {
  id: string;
  sourceId: string;
  targetId: string;
  weight: number;
  color: string;
  gradientColors?: [string, string];
}

export interface ArcFlowData {
  innerNodes: ArcFlowNode[];
  outerNodes: ArcFlowNode[];
  connections: ArcFlowConnection[];
  title: string;
  subtitle?: string;
}

// ============================================================================
// Animation & Interaction Types
// ============================================================================

export interface AnimationState {
  isPlaying: boolean;
  progress: number;       // 0-1
  duration: number;       // ms
  easing: "linear" | "easeIn" | "easeOut" | "easeInOut" | "spring";
}

export interface InteractionState {
  hoveredNodeId: string | null;
  selectedNodeIds: Set<string>;
  focusedNodeId: string | null;
  zoomLevel: number;
  panOffset: { x: number; y: number };
}

export interface TooltipData {
  visible: boolean;
  x: number;
  y: number;
  content: {
    title: string;
    subtitle?: string;
    details: Array<{ label: string; value: string }>;
  };
}

// ============================================================================
// Theme Types
// ============================================================================

export interface VisualizationTheme {
  name: string;
  background: string;
  foreground: string;
  accent: string;
  accentSecondary: string;
  nodeColors: {
    default: string;
    highlighted: string;
    selected: string;
    muted: string;
  };
  edgeColors: {
    default: string;
    highlighted: string;
    muted: string;
  };
  glowColors: {
    primary: string;
    secondary: string;
    accent: string;
  };
  textColors: {
    primary: string;
    secondary: string;
    muted: string;
  };
}

export const DARK_THEME: VisualizationTheme = {
  name: "dark",
  background: "#0a0a0f",
  foreground: "#ffffff",
  accent: "#ef4444",
  accentSecondary: "#3b82f6",
  nodeColors: {
    default: "#ffffff",
    highlighted: "#ef4444",
    selected: "#f97316",
    muted: "#374151",
  },
  edgeColors: {
    default: "rgba(255, 255, 255, 0.15)",
    highlighted: "rgba(239, 68, 68, 0.8)",
    muted: "rgba(255, 255, 255, 0.05)",
  },
  glowColors: {
    primary: "#ef4444",
    secondary: "#f97316",
    accent: "#ec4899",
  },
  textColors: {
    primary: "#ffffff",
    secondary: "rgba(255, 255, 255, 0.9)",
    muted: "rgba(255, 255, 255, 0.65)",
  },
};

export const LIGHT_THEME: VisualizationTheme = {
  name: "light",
  background: "#f8f4ec",
  foreground: "#1c1917",
  accent: "#0f766e",
  accentSecondary: "#1d4ed8",
  nodeColors: {
    default: "#334155",
    highlighted: "#0f766e",
    selected: "#ea580c",
    muted: "#d1d5db",
  },
  edgeColors: {
    default: "rgba(28, 25, 23, 0.15)",
    highlighted: "rgba(15, 118, 110, 0.8)",
    muted: "rgba(28, 25, 23, 0.05)",
  },
  glowColors: {
    primary: "#0f766e",
    secondary: "#ea580c",
    accent: "#db2777",
  },
  textColors: {
    primary: "#1c1917",
    secondary: "rgba(28, 25, 23, 0.7)",
    muted: "rgba(28, 25, 23, 0.4)",
  },
};

function readThemeVariable(name: string): string | null {
  if (typeof document === "undefined") return null;
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || null;
}

export function resolveVisualizationTheme(theme: "light" | "dark"): VisualizationTheme {
  const base = theme === "dark" ? DARK_THEME : LIGHT_THEME;
  const accent = readThemeVariable("--accent") ?? base.accent;
  const accentSecondary = readThemeVariable("--accent-2") ?? base.accentSecondary;
  const background = readThemeVariable("--bg-0") ?? base.background;
  const foreground = readThemeVariable("--ink") ?? base.foreground;
  const textSecondary = readThemeVariable("--ink-secondary") ?? base.textColors.secondary;
  const textMuted = readThemeVariable("--ink-muted") ?? base.textColors.muted;

  return {
    ...base,
    background,
    foreground,
    accent,
    accentSecondary,
    nodeColors: {
      ...base.nodeColors,
      highlighted: accent,
      selected: accentSecondary,
    },
    edgeColors: {
      ...base.edgeColors,
      highlighted: accent,
    },
    glowColors: {
      ...base.glowColors,
      primary: accent,
      secondary: accentSecondary,
      accent,
    },
    textColors: {
      ...base.textColors,
      primary: foreground,
      secondary: textSecondary,
      muted: textMuted,
    },
  };
}

// ============================================================================
// Color Palettes
// ============================================================================

// Part-of-speech encoding palette — the authoritative "data-encoding spectrum"
// from the Observatory V2 design concept (DesignReference zip · color = part of
// speech). This is a DATA palette (carries linguistic meaning for analysis +
// teaching), kept separate from the selection/highlight ring (#FBEAD2, reserved,
// see SELECTION_RING). The on-canvas + Explain legends derive from these via
// getNodeColor(), so canvas and legend can never disagree. Shown in all modes.
export const CATEGORY_COLORS = {
  noun: "#e8924a",      // Amber
  verb: "#d06a86",      // Pink
  adjective: "#dd6a47", // Coral
  pronoun: "#56a697",   // Teal
  preposition: "#8e84cc", // Violet (V2 "proper noun / function word" hue)
  particle: "#e6c24e",  // Yellow
  conjunction: "#9fd4c4", // Mint
  other: "#94a3b8",     // Slate
};

// Reserved selection/highlight ring — excluded from the data palette so a
// "selected" state never collides with a part-of-speech color.
export const SELECTION_RING = "#fbead2";

export const GRADIENT_PALETTES = {
  warm: ["#ef4444", "#f97316", "#f59e0b", "#eab308"],
  cool: ["#3b82f6", "#06b6d4", "#14b8a6", "#22c55e"],
  vibrant: ["#ec4899", "#8b5cf6", "#3b82f6", "#06b6d4"],
  earth: ["#78350f", "#a16207", "#65a30d", "#0f766e"],
  night: ["#1e1b4b", "#312e81", "#4338ca", "#6366f1"],
};

// ============================================================================
// Utility Functions
// ============================================================================

export function getNodeColor(pos: string): string {
  const posMap: Record<string, string> = {
    N: CATEGORY_COLORS.noun,
    V: CATEGORY_COLORS.verb,
    ADJ: CATEGORY_COLORS.adjective,
    PRON: CATEGORY_COLORS.pronoun,
    P: CATEGORY_COLORS.preposition,
    PART: CATEGORY_COLORS.particle,
    CONJ: CATEGORY_COLORS.conjunction,
  };
  return posMap[pos] ?? CATEGORY_COLORS.other;
}

export function interpolateColor(color1: string, color2: string, t: number): string {
  // Simple hex color interpolation
  const c1 = parseInt(color1.slice(1), 16);
  const c2 = parseInt(color2.slice(1), 16);

  const r1 = (c1 >> 16) & 255;
  const g1 = (c1 >> 8) & 255;
  const b1 = c1 & 255;

  const r2 = (c2 >> 16) & 255;
  const g2 = (c2 >> 8) & 255;
  const b2 = c2 & 255;

  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);

  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
