"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { ExperienceLevel } from "@/lib/schema/experience";
import type { VisualizationMode } from "@/lib/schema/visualizationTypes";
import { VISUALIZATION_GROUPS, type VisualizationCategory } from "@/lib/schema/visualizationTypes";
import GlossaryChips from "@/components/ui/GlossaryChips";

interface VisualizationSwitcherProps {
  currentMode: VisualizationMode;
  onModeChange: (mode: VisualizationMode) => void;
  experienceLevel: ExperienceLevel;
  showAdvancedModes: boolean;
  onToggleAdvancedModes: (value: boolean) => void;
  theme: "light" | "dark";
  onThemeChange: (theme: "light" | "dark") => void;
}

const VISUALIZATION_OPTIONS: Array<{
  mode: VisualizationMode;
  icon: string;
}> = [
    // Monochrome geometric glyphs, one per mode: no colour emoji (they came
    // with the old design and ignored the theme), no two modes sharing one.
    { mode: "corpus-architecture", icon: "⬡" },
    { mode: "surah-distribution", icon: "∷" },
    { mode: "radial-sura", icon: "\u25C9" },
    { mode: "root-network", icon: "\u2B21" },
    { mode: "arc-flow", icon: "\u2312" },
    { mode: "dependency-tree", icon: "\u228F" },
    { mode: "sankey-flow", icon: "\u224B" },
    { mode: "collocation-network", icon: "⊛" },
    { mode: "concordance-rings", icon: "◎" },
    { mode: "knowledge-graph", icon: "⁘" },
  ];

function getIcon(mode: VisualizationMode): string {
  return VISUALIZATION_OPTIONS.find((o) => o.mode === mode)?.icon ?? "\u25C9";
}

export default function VisualizationSwitcher({
  currentMode,
  onModeChange,
  experienceLevel,
  showAdvancedModes,
  onToggleAdvancedModes,
  theme: _theme,
  onThemeChange: _onThemeChange,
}: VisualizationSwitcherProps) {
  const t = useTranslations('VisualizationSwitcher');
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<VisualizationCategory>>(new Set());
  const dropdownId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isBeginner = experienceLevel === "beginner" && !showAdvancedModes;

  // For beginners, show only the default mode per group; for advanced, show all
  const visibleGroups = useMemo(() => {
    return VISUALIZATION_GROUPS.map((group) => ({
      ...group,
      visibleModes: isBeginner && !expandedGroups.has(group.category)
        ? [group.defaultMode]
        : group.modes,
      hasMore: isBeginner && group.modes.length > 1 && !expandedGroups.has(group.category),
    }));
  }, [isBeginner, expandedGroups]);

  useEffect(() => {
    if (!isExpanded) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      const clickedInsideTrigger = !!triggerRef.current?.contains(target);
      const clickedInsideDropdown = !!dropdownRef.current?.contains(target);
      if (!clickedInsideTrigger && !clickedInsideDropdown) {
        setIsExpanded(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsExpanded(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isExpanded]);

  const handleModeSelect = useCallback(
    (mode: VisualizationMode) => {
      onModeChange(mode);
      setIsExpanded(false);
    },
    [onModeChange]
  );

  const toggleGroupExpand = useCallback((category: VisualizationCategory) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }, []);

  return (
    <div className="ui-viz-switcher" ref={containerRef} data-tour-id="viz-switcher-root">
      <div>
        <button
          ref={triggerRef}
          type="button"
          className="ui-viz-switcher-current"
          data-testid="viz-switcher-trigger"
          aria-expanded={isExpanded}
          aria-controls={dropdownId}
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <span className="ui-viz-switcher-icon">{getIcon(currentMode)}</span>
          <div className="ui-viz-switcher-info">
            <span className="ui-viz-switcher-label">{t(`modes.${currentMode}.label`)}</span>
            <span className="ui-viz-switcher-desc">{t(`modes.${currentMode}.description`)}</span>
          </div>
          <span className={`ui-viz-switcher-arrow ${isExpanded ? "expanded" : ""}`}>{"\u25BE"}</span>
        </button>
      </div>

      {isExpanded && (
        <div ref={dropdownRef} className="ui-viz-switcher-dropdown" id={dropdownId}>
          <div className="ui-viz-switcher-section">
            <GlossaryChips vizMode={currentMode} />
          </div>

          {visibleGroups.map((group) => (
            <div key={group.category} className="ui-viz-switcher-section">
              <div className="ui-viz-switcher-section-head">
                <strong>{t(`groups.${group.category}.label`)}</strong>
                <span>{t(`groups.${group.category}.description`)}</span>
              </div>
              {group.visibleModes.map((mode) => (
                <button
                  type="button"
                  key={mode}
                  className={`ui-viz-switcher-option ${currentMode === mode ? "active" : ""}`}
                  data-mode={mode}
                  data-testid={`viz-option-${mode}`}
                  onClick={() => handleModeSelect(mode)}
                >
                  <span className="ui-viz-switcher-icon">{getIcon(mode)}</span>
                  <div className="ui-viz-switcher-info">
                    <span className="ui-viz-switcher-label">{t(`modes.${mode}.label`)}</span>
                    <span className="ui-viz-switcher-desc">{t(`modes.${mode}.description`)}</span>
                  </div>
                </button>
              ))}
              {group.hasMore && (
                <button
                  type="button"
                  className="ui-viz-switcher-group-expand"
                  onClick={() => toggleGroupExpand(group.category)}
                >
                  {t("showMore", { count: group.modes.length - 1 })}
                </button>
              )}
            </div>
          ))}

          {experienceLevel === "beginner" && (
            <button
              type="button"
              className="ui-viz-switcher-toggle"
              onClick={() => onToggleAdvancedModes(!showAdvancedModes)}
            >
              {showAdvancedModes ? t("lessVisualizations") : t("moreVisualizations")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
