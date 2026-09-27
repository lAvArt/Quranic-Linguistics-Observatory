"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  trackModeSwitched,
} from "@/lib/analytics/events";
import type { ExperienceLevel } from "@/lib/schema/experience";
import type { VisualizationMode } from "@/lib/schema/visualizationTypes";
import { getVisualizationCategory } from "@/lib/schema/visualizationTypes";

// Every VISUALIZATION_GROUPS category shows its defaultMode to beginners
// (VisualizationSwitcher never fully hides a category) — this list must
// mirror those four defaults exactly, or the "ensure vizMode is in visible
// set" effect below silently snaps a just-selected mode back to
// radial-sura the instant it's chosen. "knowledge-graph" is the sole mode
// in the always-visible "track-progress" category, so it belongs here too
// (was missing: selecting it from the switcher or a mission used to bounce
// straight back to radial-sura for any beginner who hadn't separately
// toggled "show advanced").
export const BEGINNER_PRIMARY_MODES: VisualizationMode[] = [
  "radial-sura",
  "surah-distribution",
  "root-network",
  "knowledge-graph",
];

/**
 * Every mode the viewport can actually render — the "advanced" visible set.
 * Canonical list shared with deep-link validation (AppShell) so a `?viz=` param
 * is only honoured when it names a real, renderable mode.
 */
export const ALL_VIZ_MODES: VisualizationMode[] = [
  "corpus-architecture",
  "surah-distribution",
  "radial-sura",
  "root-network",
  "arc-flow",
  "dependency-tree",
  "sankey-flow",
  "collocation-network",
  "concordance-rings",
  "knowledge-graph",
];

interface ViewContextCapabilities {
  ayah: boolean;
  root: boolean;
  lemma: boolean;
}

export const VIEW_CONTEXT_CAPABILITIES: Record<VisualizationMode, ViewContextCapabilities> = {
  "corpus-architecture": { ayah: false, root: true, lemma: false },
  "surah-distribution": { ayah: false, root: true, lemma: false },
  "radial-sura": { ayah: true, root: true, lemma: false },
  "root-network": { ayah: false, root: true, lemma: false },
  "arc-flow": { ayah: true, root: true, lemma: true },
  "dependency-tree": { ayah: true, root: false, lemma: false },
  "sankey-flow": { ayah: false, root: false, lemma: false },
  "collocation-network": { ayah: false, root: true, lemma: false },
  "concordance-rings": { ayah: false, root: true, lemma: false },
  "knowledge-graph": { ayah: false, root: true, lemma: false },
  "heatmap": { ayah: false, root: false, lemma: false },
};

export interface ContextTransformNotice {
  title: string;
  description: string;
  recoveryLabel?: string;
}

export function describeContextTransform(
  nextMode: VisualizationMode,
  context: {
    surahId: number;
    ayah: number | null;
    root: string | null;
    lemma: string | null;
  }
): ContextTransformNotice | null {
  const capabilities = VIEW_CONTEXT_CAPABILITIES[nextMode];
  const hidden: string[] = [];

  if (context.ayah && !capabilities.ayah) hidden.push("ayah detail");
  if (context.root && !capabilities.root) hidden.push("root focus");
  if (context.lemma && !capabilities.lemma) hidden.push("lemma detail");

  if (nextMode === "dependency-tree" && !context.ayah) {
    return {
      title: "Switched to syntax view",
      description: `Dependency view keeps surah ${context.surahId}, but it needs a specific ayah before syntax details can appear.`,
    };
  }

  if (hidden.length === 0) return null;

  return {
    title: "Context adjusted for this view",
    description: `Switched to ${nextMode.replace(/-/g, " ")}. Preserved surah ${context.surahId}, while ${hidden.join(" and ")} ${hidden.length > 1 ? "are" : "is"} hidden in this view.`,
  };
}

export interface VizModeState {
  vizMode: VisualizationMode;
  experienceLevel: ExperienceLevel;
  showAdvancedModes: boolean;
  visibleVizModes: VisualizationMode[];
  isHierarchicalMode: boolean;
  contextTransformNotice: ContextTransformNotice | null;
  focusRecoveryTarget: { tokenId: string; mode: VisualizationMode } | null;
  vizSuggestion: { mode: VisualizationMode; reason: string } | null;

  setVizMode: (mode: VisualizationMode) => void;
  setExperienceLevel: (level: ExperienceLevel) => void;
  setShowAdvancedModes: (show: boolean) => void;
  setContextTransformNotice: (notice: ContextTransformNotice | null) => void;
  setFocusRecoveryTarget: (target: { tokenId: string; mode: VisualizationMode } | null) => void;
  setVizSuggestion: (suggestion: { mode: VisualizationMode; reason: string } | null) => void;

  handleExperienceLevelChange: (level: ExperienceLevel) => void;
  handleDismissVizSuggestion: () => void;
  handleDismissContextTransformNotice: () => void;
  suggestVisualization: (context: {
    root?: string | null;
    surahId?: number;
    ayah?: number | null;
  }) => void;
}

/**
 * Manages visualization mode, experience level, context transform notices,
 * and viz suggestion state. Cross-cutting handlers (handleVizModeChange,
 * handleAcceptVizSuggestion, handleRestoreFocusedContext) stay in the
 * composing controller since they touch selection state.
 */
export function useVizModeState(): VizModeState {
  const [vizMode, setVizMode] = useState<VisualizationMode>("radial-sura");
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel>("beginner");
  const [showAdvancedModes, setShowAdvancedModes] = useState(false);
  const [contextTransformNotice, setContextTransformNotice] =
    useState<ContextTransformNotice | null>(null);
  const [focusRecoveryTarget, setFocusRecoveryTarget] = useState<{
    tokenId: string;
    mode: VisualizationMode;
  } | null>(null);
  const [vizSuggestion, setVizSuggestion] = useState<{
    mode: VisualizationMode;
    reason: string;
  } | null>(null);

  const suggestVisualization = useCallback(
    (context: { root?: string | null; surahId?: number; ayah?: number | null }) => {
      if (context.root && getVisualizationCategory(vizMode) !== "trace-root") {
        setVizSuggestion({ mode: "root-network", reason: "vizSuggestion.traceRoot" });
        return;
      }
      if (context.surahId && getVisualizationCategory(vizMode) !== "explore-surah") {
        setVizSuggestion({ mode: "radial-sura", reason: "vizSuggestion.exploreSurah" });
        return;
      }
      if (context.ayah && getVisualizationCategory(vizMode) !== "explore-surah") {
        setVizSuggestion({ mode: "dependency-tree", reason: "vizSuggestion.analyzeAyah" });
        return;
      }
      setVizSuggestion(null);
    },
    [vizMode]
  );

  // Auto-dismiss context transform notice after 5s
  useEffect(() => {
    if (!contextTransformNotice) return;
    const timeoutId = window.setTimeout(() => {
      setContextTransformNotice(null);
      setFocusRecoveryTarget(null);
    }, 5000);
    return () => window.clearTimeout(timeoutId);
  }, [contextTransformNotice]);

  const visibleVizModes = useMemo<VisualizationMode[]>(
    () =>
      experienceLevel === "advanced" || showAdvancedModes
        ? ALL_VIZ_MODES
        : BEGINNER_PRIMARY_MODES,
    [experienceLevel, showAdvancedModes]
  );

  const handleExperienceLevelChange = useCallback(
    (level: ExperienceLevel) => {
      if (level !== experienceLevel) {
        trackModeSwitched(experienceLevel, level);
      }
      setExperienceLevel(level);
      if (level === "advanced") {
        setShowAdvancedModes(true);
        return;
      }
      setShowAdvancedModes(false);
      if (!BEGINNER_PRIMARY_MODES.includes(vizMode)) {
        setVizMode("radial-sura");
      }
    },
    [experienceLevel, vizMode]
  );

  // Ensure vizMode is in the visible set
  useEffect(() => {
    if (visibleVizModes.includes(vizMode)) return;
    setVizMode(visibleVizModes[0] ?? "radial-sura");
  }, [visibleVizModes, vizMode]);

  const isHierarchicalMode = useMemo(
    () =>
      ["corpus-architecture", "radial-sura", "surah-distribution", "dependency-tree"].includes(
        vizMode
      ),
    [vizMode]
  );

  const handleDismissVizSuggestion = useCallback(() => {
    setVizSuggestion(null);
  }, []);

  const handleDismissContextTransformNotice = useCallback(() => {
    setContextTransformNotice(null);
    setFocusRecoveryTarget(null);
  }, []);

  return {
    vizMode,
    experienceLevel,
    showAdvancedModes,
    visibleVizModes,
    isHierarchicalMode,
    contextTransformNotice,
    focusRecoveryTarget,
    vizSuggestion,
    setVizMode,
    setExperienceLevel,
    setShowAdvancedModes,
    setContextTransformNotice,
    setFocusRecoveryTarget,
    setVizSuggestion,
    handleExperienceLevelChange,
    handleDismissVizSuggestion,
    handleDismissContextTransformNotice,
    suggestVisualization,
  };
}
