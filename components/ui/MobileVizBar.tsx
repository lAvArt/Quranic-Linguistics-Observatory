"use client";

import { useTranslations } from "next-intl";
import { useVizControl } from "@/lib/hooks/VizControlContext";
import VisualizationSwitcher from "@/components/ui/VisualizationSwitcher";
import type { ExperienceLevel } from "@/lib/schema/experience";
import type { VisualizationMode } from "@/lib/schema/visualizationTypes";

interface MobileVizBarProps {
  vizMode: VisualizationMode;
  onVizModeChange: (mode: VisualizationMode) => void;
  experienceLevel: ExperienceLevel;
  showAdvancedModes: boolean;
  onToggleAdvancedModes: (value: boolean) => void;
  theme: "light" | "dark";
  onThemeChange: (theme: "light" | "dark") => void;
}

interface QuickViewItem {
  id: string;
  mode: VisualizationMode;
  labelKey: string;
  hintKey: string;
  testId?: string;
  icon: React.ReactNode;
}

/* Same three icons as JourneyRail's views group (surah-distribution /
   root-network / radial-sura) — kept in sync by eye since JourneyRail
   doesn't export them. */
const QUICK_VIEWS: QuickViewItem[] = [
  {
    id: "discover",
    mode: "surah-distribution",
    labelKey: "discover",
    hintKey: "discoverHint",
    testId: "mobile-viz-bar-discover",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 4v16h16" />
        <circle cx="8.5" cy="8" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="11" cy="14.5" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="15" cy="9.5" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="18.5" cy="13" r="1.6" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    id: "root",
    mode: "root-network",
    labelKey: "root",
    hintKey: "rootHint",
    testId: "mobile-viz-bar-root",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="8.5" opacity="0.55" />
        <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
        <circle cx="12" cy="3.5" r="1.8" fill="currentColor" stroke="none" />
        <circle cx="6.4" cy="18.4" r="1.5" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    id: "ayah",
    mode: "radial-sura",
    labelKey: "ayah",
    hintKey: "ayahHint",
    testId: "mobile-viz-bar-ayah",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="4" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="17.7" cy="6.3" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="20" cy="12" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="17.7" cy="17.7" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="12" cy="20" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="6.3" cy="17.7" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="4" cy="12" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="6.3" cy="6.3" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="2" opacity="0.7" />
      </svg>
    ),
  },
];

/* Controls glyph — sliders, for the sheet with each view's legend and
   controls. Distinct from the settings gear used by DisplaySettingsPanel. */
const controlsIcon = (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="4" x2="5" y2="20" />
    <circle cx="5" cy="9" r="2" fill="currentColor" stroke="none" />
    <line x1="12" y1="4" x2="12" y2="20" />
    <circle cx="12" cy="16" r="2" fill="currentColor" stroke="none" />
    <line x1="19" y1="4" x2="19" y2="20" />
    <circle cx="19" cy="7" r="2" fill="currentColor" stroke="none" />
  </svg>
);

/* Details glyph — a screen with a sheet raised from its bottom edge, which
   is where the details sheet (explain / inspect / search / index) comes from. */
const detailsIcon = (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
    <path d="M3.5 13.5h17" />
    <path d="M10 16.5h4" />
  </svg>
);

/**
 * One floating bottom pill for the mobile viz screen — replaces the previous
 * three-strip stack (JourneyRail top strip + GraphToolbar + MobileBottomBar).
 * Consolidates: mode switcher, the 3 quick-view shortcuts (mirroring
 * JourneyRail's views group), and the legend/tools surface toggles. Display
 * settings (the ⚙ gear) live in a separate controlled panel — see
 * AppShell's `DisplaySettingsPanel` instance — reached from the top bar, not
 * from this pill.
 */
export default function MobileVizBar({
  vizMode,
  onVizModeChange,
  experienceLevel,
  showAdvancedModes,
  onToggleAdvancedModes,
  theme,
  onThemeChange,
}: MobileVizBarProps) {
  const tRail = useTranslations("JourneyRail");
  const tBar = useTranslations("MobileBottomBar");
  const { isLeftSidebarOpen, isRightSidebarOpen, toggleLeftSidebar, toggleRightSidebar } = useVizControl();

  return (
    <div className="mobile-viz-bar mobile-only" data-testid="mobile-viz-bar">
      <div className="mobile-viz-bar-inner">
        <div className="mvb-switcher">
          <VisualizationSwitcher
            currentMode={vizMode}
            onModeChange={onVizModeChange}
            experienceLevel={experienceLevel}
            showAdvancedModes={showAdvancedModes}
            onToggleAdvancedModes={onToggleAdvancedModes}
            theme={theme}
            onThemeChange={onThemeChange}
          />
        </div>

        <div className="mvb-quick-views">
          {QUICK_VIEWS.map((item) => {
            const isActive = vizMode === item.mode;
            return (
              <button
                key={item.id}
                type="button"
                className={`mvb-btn ${isActive ? "active" : ""}`}
                data-testid={item.testId}
                aria-label={`${tRail(item.labelKey)} — ${tRail(item.hintKey)}`}
                title={tRail(item.hintKey)}
                onClick={() => onVizModeChange(item.mode)}
              >
                {item.icon}
              </button>
            );
          })}
        </div>

        <div className="mvb-divider" />

        {/* The two sheets, named in words: an icon alone was easy to lose,
            and closing a sheet left no obvious way back to it. */}
        <button
          type="button"
          className={`mvb-btn mvb-sheet ${isLeftSidebarOpen ? "active" : ""}`}
          data-testid="mobile-viz-bar-legend"
          aria-label={isLeftSidebarOpen ? tBar("hideLegend") : tBar("showLegend")}
          title={isLeftSidebarOpen ? tBar("hideLegend") : tBar("showLegend")}
          aria-pressed={isLeftSidebarOpen}
          onClick={toggleLeftSidebar}
        >
          {controlsIcon}
          <span className="mvb-label" aria-hidden="true">{tBar("controls")}</span>
        </button>

        <button
          type="button"
          className={`mvb-btn mvb-sheet ${isRightSidebarOpen ? "active" : ""}`}
          data-testid="mobile-viz-bar-tools"
          aria-label={isRightSidebarOpen ? tBar("hideTools") : tBar("showTools")}
          title={isRightSidebarOpen ? tBar("hideTools") : tBar("showTools")}
          aria-pressed={isRightSidebarOpen}
          onClick={toggleRightSidebar}
        >
          {detailsIcon}
          <span className="mvb-label" aria-hidden="true">{tBar("details")}</span>
        </button>
      </div>

      <style jsx>{`
        /* Fixed bottom-center, deliberately physical (not logical) left/
           transform: symmetric centering has no direction to get "wrong" in
           RTL, unlike an inline-start anchor. */
        .mobile-viz-bar {
          position: fixed;
          left: 50%;
          transform: translateX(-50%);
          bottom: calc(env(safe-area-inset-bottom) + 14px);
          z-index: 90;
          max-width: calc(100vw - 16px);
          width: max-content;
        }

        .mobile-viz-bar-inner {
          display: flex;
          align-items: center;
          gap: 6px;
          /* Vertical padding tuned so the pill's total height lands close to
             --mobile-tools-bar-height (globals.css) — its tallest child is
             the VisualizationSwitcher trigger (icon + two-line label), not
             the 40px icon buttons alone. */
          padding: 6px 8px;
          background: var(--panel);
          border: 1px solid var(--line);
          border-radius: var(--radius-pill);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.12);
        }

        :global([data-theme="dark"]) .mobile-viz-bar-inner {
          background: rgba(22, 33, 39, 0.88);
          border-color: rgba(255, 255, 255, 0.1);
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
        }

        .mvb-switcher {
          flex: 1 1 auto;
          min-width: 0;
        }

        .mvb-quick-views {
          display: flex;
          align-items: center;
          gap: 2px;
          flex-shrink: 0;
        }

        .mvb-divider {
          width: 1px;
          height: 24px;
          background: var(--line);
          margin: 0 2px;
          flex-shrink: 0;
        }

        .mvb-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          flex-shrink: 0;
          background: transparent;
          border: 1px solid transparent;
          border-radius: 12px;
          color: var(--ink-secondary);
          cursor: pointer;
          transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
        }

        /* Labelled sheet toggles: icon over a short word. */
        .mvb-sheet {
          flex-direction: column;
          gap: 2px;
          width: auto;
          min-width: 52px;
          padding: 0 6px;
        }

        .mvb-label {
          font-size: 9.5px;
          font-weight: 600;
          line-height: 1;
          letter-spacing: 0.02em;
          white-space: nowrap;
        }

        /* Hover only where there is one: on touch, :hover sticks after a tap
           and left the last-tapped button looking selected. */
        @media (hover: hover) {
          .mvb-btn:hover {
            background: rgba(0, 0, 0, 0.05);
            color: var(--ink);
          }

          :global([data-theme="dark"]) .mvb-btn:hover {
            background: rgba(255, 255, 255, 0.08);
          }
        }

        /* A phone has room for the switcher and two named sheets, not also
           three shortcuts to views the switcher already lists. */
        @media (max-width: 440px) {
          .mvb-quick-views,
          .mvb-divider {
            display: none;
          }
        }

        /* Quiet selection tint, matching the rail/toolbar's active treatment
           — never a saturated accent fill (that stays reserved for data). */
        .mvb-btn.active {
          background: color-mix(in srgb, var(--selection) 8%, transparent);
          border-color: color-mix(in srgb, var(--selection) 22%, transparent);
          color: var(--selection);
        }

        .mvb-btn:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }
      `}</style>
    </div>
  );
}
