"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import MorphologyInspector from "@/components/inspectors/MorphologyInspector";
import CommandBar from "@/components/search/CommandBar";
import CorpusIndex from "@/components/ui/CorpusIndex";
import LiveScanner from "@/components/ui/LiveScanner";
import GlossaryChips from "@/components/ui/GlossaryChips";
import VizExplainer from "@/components/ui/VizExplainer";
import type { CorpusToken } from "@/lib/schema/types";
import type { SearchMatchType } from "@/lib/analytics/events";
import type { SearchResultItem } from "@/lib/search/searchTypes";
import type { VisualizationMode } from "@/lib/schema/visualizationTypes";

export type DrawerTab = "explain" | "inspect" | "search" | "index";

interface ContextDrawerProps {
  isOpen: boolean;
  onToggleOpen: () => void;
  allTokens: CorpusToken[];
  vizMode: VisualizationMode;
  inspectorToken: CorpusToken | null;
  inspectorMode: "hover" | "focus" | "idle";
  selectedSurahId: number;
  /** Bumped by the intro chip to request the Explain tab (mirrors the
   *  token-focus → Inspect auto-switch below). */
  explainRequestId?: number;
  clearFocus: () => void;
  onTokenHover: (id: string | null) => void;
  onTokenSelect: (tokenId: string) => void;
  onRootSelect: (root: string | null) => void;
  onSelectSurah: (surahId: number, preferredView?: "root-network" | "radial-sura") => void;
  onSelectAyah: (surahId: number, tokenId: string) => void;
  onLemmaSelect: (lemma: string) => void;
  onSearchOpened: () => void;
  onSearchQuerySubmitted: (query: string) => void;
  onSearchResultSelected: (matchType: SearchMatchType) => void;
  onResultNavigate?: (result: SearchResultItem) => void;
  /** True while the full corpus is still streaming in — lets the inspector
   *  mark click-computed counts as "still counting" instead of silently
   *  showing partial numbers. */
  isCorpusLoading?: boolean;
}

/**
 * Auto-switching contextual drawer.
 * Rules: focusedToken → Inspect, search active → Search, default → Explain.
 * Manual override clears on next auto-switch trigger.
 */
export default function ContextDrawer({
  isOpen,
  onToggleOpen,
  allTokens,
  vizMode,
  inspectorToken,
  inspectorMode,
  selectedSurahId,
  explainRequestId,
  clearFocus,
  onTokenHover,
  onTokenSelect,
  onRootSelect,
  onSelectSurah,
  onSelectAyah,
  onLemmaSelect,
  onSearchOpened,
  onSearchQuerySubmitted,
  onSearchResultSelected,
  onResultNavigate,
  isCorpusLoading,
}: ContextDrawerProps) {
  const t = useTranslations("ContextDrawer");
  const [activeTab, setActiveTab] = useState<DrawerTab>("explain");

  // A viz mode that has just put something in viz-context-portal (a selected
  // ring's card, say) asks for the tab that portal lives on.
  useEffect(() => {
    const show = () => setActiveTab("explain");
    window.addEventListener("viz:context-request", show);
    return () => window.removeEventListener("viz:context-request", show);
  }, []);
  const [scannerOpen, setScannerOpen] = useState(false);
  const prevTokenRef = useRef<CorpusToken | null>(null);
  const prevExplainRequestRef = useRef(explainRequestId);

  // Tab behaviour: a deliberate CLICK (focus) on a graph element opens the
  // Inspect tab. HOVER never switches tabs — it only flags a hint on the Inspect
  // tab (see showInspectHint). The user's manually-chosen tab otherwise stays put.
  useEffect(() => {
    if (inspectorToken && inspectorMode === "focus" && inspectorToken !== prevTokenRef.current) {
      setActiveTab("inspect");
    }
    prevTokenRef.current = inspectorToken;
  }, [inspectorToken, inspectorMode]);

  // The intro chip's label requests the Explain tab the same way: the ref
  // starts equal to the initial id (0), so mounting/re-rendering is a no-op —
  // only an actual bump (a real click) flips the tab.
  useEffect(() => {
    if (explainRequestId !== undefined && explainRequestId !== prevExplainRequestRef.current) {
      setActiveTab("explain");
    }
    prevExplainRequestRef.current = explainRequestId;
  }, [explainRequestId]);

  const handleManualTabChange = useCallback((tab: DrawerTab) => {
    setActiveTab(tab);
  }, []);

  // Phone sheet: drag the grip down to close it (or tap it). The sheet follows
  // the finger, then either closes or springs back.
  const sheetRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ y0: number; dy: number } | null>(null);
  const onGripDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = { y0: e.clientY, dy: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);
  const onGripMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const sheet = sheetRef.current;
    if (!drag || !sheet) return;
    drag.dy = Math.max(0, e.clientY - drag.y0);
    sheet.style.transition = "none";
    sheet.style.transform = `translateY(${drag.dy}px)`;
  }, []);
  const onGripUp = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    const sheet = sheetRef.current;
    if (sheet) {
      sheet.style.transition = "";
      sheet.style.transform = "";
    }
    // A tap or a real pull closes it; a small nudge springs back.
    if (drag && (drag.dy < 6 || drag.dy > 70)) onToggleOpen();
  }, [onToggleOpen]);

  // Hovering a graph element while NOT on the Inspect tab → show a hint there,
  // rather than yanking the user to a different section.
  const showInspectHint = Boolean(inspectorToken) && inspectorMode === "hover" && activeTab !== "inspect";

  const tabs: { id: DrawerTab; labelKey: string }[] = [
    { id: "explain", labelKey: "explain" },
    { id: "inspect", labelKey: "inspect" },
    { id: "search", labelKey: "search" },
    { id: "index", labelKey: "index" },
  ];

  return (
    <>
      {/* Right-edge handle — the open/close affordance lives at the screen edge,
          where users instinctively look for it. Slides to the drawer's edge when open. */}
      <button
        type="button"
        className={`drawer-edge-handle ${isOpen ? "is-open" : ""}`}
        onClick={onToggleOpen}
        aria-label={isOpen ? t("collapse") : t("expand")}
        aria-expanded={isOpen}
        title={isOpen ? t("collapse") : t("expand")}
        data-tour-id="tools-toggle"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <aside
        ref={sheetRef}
        className={`context-drawer ${isOpen ? "open" : ""}`}
        aria-label={t("label")}
        data-tour-id="context-drawer"
      >
      {/* Phone only: the sheet's own way out — a grip to pull down or tap,
          and an explicit close — so hiding it never depends on finding the
          toggle in the bottom bar. */}
      <div
        className="drawer-sheet-head"
        onPointerDown={onGripDown}
        onPointerMove={onGripMove}
        onPointerUp={onGripUp}
        onPointerCancel={onGripUp}
      >
        <span className="drawer-sheet-grip" aria-hidden="true" />
        <button
          type="button"
          className="drawer-sheet-close"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onToggleOpen}
          aria-label={t("collapse")}
          title={t("collapse")}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div className="drawer-tabs" role="tablist" aria-label={t("panelLabel")}>
        {tabs.map((tab) => {
          const hinted = tab.id === "inspect" && showInspectHint;
          return (
            <button
              key={tab.id}
              className={`drawer-tab ${activeTab === tab.id ? "active" : ""} ${hinted ? "has-hint" : ""}`}
              onClick={() => handleManualTabChange(tab.id)}
              title={hinted ? "Click a graph element to inspect it here" : undefined}
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`drawer-panel-${tab.id}`}
              id={`drawer-tab-${tab.id}`}
            >
              {t(tab.labelKey)}
              {hinted ? <span className="drawer-tab-hint" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>

      <div className="drawer-glossary">
        <GlossaryChips />
      </div>

      {/* Explain tab */}
      <div
        className="drawer-content"
        role="tabpanel"
        id="drawer-panel-explain"
        aria-labelledby="drawer-tab-explain"
        style={{ display: activeTab === "explain" ? undefined : "none" }}
      >
        {/* Mode-owned details (a selected item's card, a mode's own lists)
            portal in here, the right-hand counterpart of viz-sidebar-portal.
            Empty for modes that don't use it. */}
        <div id="viz-context-portal" className="viz-context-portal" />
        <VizExplainer vizMode={vizMode} />
      </div>

      {/* Inspect tab */}
      <div
        className="drawer-content"
        role="tabpanel"
        id="drawer-panel-inspect"
        aria-labelledby="drawer-tab-inspect"
        style={{ display: activeTab === "inspect" ? undefined : "none" }}
      >
        <CommandBar
          tokens={allTokens}
          variant="bar"
          analyticsSurface="sidebar"
          onTokenSelect={onTokenSelect}
          onTokenHover={onTokenHover}
          onRootSelect={onRootSelect}
          onSearchOpened={onSearchOpened}
          onSearchQuerySubmitted={onSearchQuerySubmitted}
          onSearchResultSelected={onSearchResultSelected}
          onResultNavigate={onResultNavigate}
        />
        <div className="drawer-divider" />
        <button
          type="button"
          className="drawer-scanner-toggle"
          onClick={() => setScannerOpen(!scannerOpen)}
          aria-expanded={scannerOpen}
        >
          {scannerOpen ? t("hideScan") : t("scan")}
        </button>
        {scannerOpen && (
          <LiveScanner allTokens={allTokens} onTokenSelect={onTokenSelect} />
        )}
        <div className="drawer-divider" />
        <MorphologyInspector
          token={inspectorToken}
          mode={inspectorMode}
          onClearFocus={clearFocus}
          allTokens={allTokens}
          onRootSelect={onRootSelect}
          onSelectSurah={onSelectSurah}
          onSelectAyah={onSelectAyah}
          isCorpusLoading={isCorpusLoading}
        />
      </div>

      {/* Search tab */}
      <div
        className="drawer-content"
        role="tabpanel"
        id="drawer-panel-search"
        aria-labelledby="drawer-tab-search"
        style={{ display: activeTab === "search" ? undefined : "none" }}
      >
        <CommandBar
          tokens={allTokens}
          variant="panel"
          analyticsSurface="sidebar"
          onTokenSelect={onTokenSelect}
          onTokenHover={onTokenHover}
          onRootSelect={onRootSelect}
          onSearchOpened={onSearchOpened}
          onSearchQuerySubmitted={onSearchQuerySubmitted}
          onSearchResultSelected={onSearchResultSelected}
          onResultNavigate={onResultNavigate}
        />
      </div>

      {/* Index tab */}
      <div
        className="drawer-content"
        role="tabpanel"
        id="drawer-panel-index"
        aria-labelledby="drawer-tab-index"
        style={{ display: activeTab === "index" ? undefined : "none" }}
      >
        <CorpusIndex
          tokens={allTokens}
          onSelectSurah={onSelectSurah}
          onSelectRoot={(root) => onRootSelect(root)}
          onSelectLemma={onLemmaSelect}
          selectedSurahId={selectedSurahId}
        />
      </div>

      <style jsx>{`
        .context-drawer {
          position: fixed;
          top: var(--header-clearance);
          inset-inline-end: 1rem;
          bottom: calc(var(--footer-height) + 0.5rem);
          width: min(380px, 92vw);
          z-index: 40;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background: var(--panel);
          border: 1px solid var(--line);
          border-radius: 16px;
          box-shadow: -4px 0 24px rgba(0, 0, 0, 0.1);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          transform: translateX(calc(100% + 2rem));
          transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1);
          pointer-events: none;
        }

        :global([data-theme="dark"]) .context-drawer {
          background: rgba(22, 33, 39, 0.92);
          border-color: rgba(255, 255, 255, 0.1);
          box-shadow: -4px 0 24px rgba(0, 0, 0, 0.3);
        }

        :global([dir="rtl"]) .context-drawer {
          transform: translateX(calc(-100% - 2rem));
        }

        .context-drawer.open {
          transform: translateX(0);
          pointer-events: auto;
        }

        .drawer-tabs {
          display: flex;
          gap: 4px;
          padding: 4px;
          margin: 8px 8px 0;
          background: color-mix(in srgb, var(--panel), transparent 22%);
          border: 1px solid var(--line);
          border-radius: var(--radius-md);
          flex-shrink: 0;
        }

        .drawer-tab {
          position: relative;
          flex: 1;
          padding: 8px 10px;
          border: none;
          border-radius: var(--radius-sm);
          background: transparent;
          color: var(--ink-muted);
          font-family: inherit;
          font-size: 0.7rem;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          cursor: pointer;
          transition: background 0.18s, color 0.18s;
        }

        /* Hover-a-graph-element hint: a quiet pulsing dot on the Inspect tab,
           instead of force-switching the user's section. */
        .drawer-tab.has-hint {
          color: var(--accent);
        }

        .drawer-tab-hint {
          position: absolute;
          top: 4px;
          inset-inline-end: 6px;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--accent);
          animation: drawerTabHintPulse 1.4s ease-out infinite;
        }

        @keyframes drawerTabHintPulse {
          0% { box-shadow: 0 0 0 0 rgba(232, 146, 74, 0.5); }
          70% { box-shadow: 0 0 0 6px rgba(232, 146, 74, 0); }
          100% { box-shadow: 0 0 0 0 rgba(232, 146, 74, 0); }
        }

        /* Hover only where there is one: on touch, :hover sticks after a tap. */
        @media (hover: hover) {
          .drawer-tab:hover {
            color: var(--ink);
            background: color-mix(in srgb, var(--selection) 5%, transparent);
          }
        }

        .drawer-tab.active {
          background: var(--bg-2);
          color: var(--ink);
          font-weight: 700;
        }

        .drawer-tab:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: -2px;
          border-radius: 4px;
        }

        .drawer-glossary {
          padding: 10px 12px 8px;
          border-bottom: 1px solid var(--line);
          background: color-mix(in srgb, var(--panel), white 4%);
          flex-shrink: 0;
        }

        .drawer-content {
          flex: 1;
          overflow-y: auto;
          padding: 16px 16px calc(16px + var(--footer-height, 48px));
        }

        .drawer-divider {
          height: 1px;
          background: var(--line);
          margin: 16px 0;
        }

        .drawer-scanner-toggle {
          display: block;
          width: 100%;
          padding: 6px 12px;
          font-size: 0.78rem;
          color: var(--ink-muted);
          background: none;
          border: 1px dashed var(--line);
          border-radius: var(--radius-xs);
          cursor: pointer;
          text-align: center;
          margin-bottom: 8px;
        }

        .drawer-scanner-toggle:hover {
          color: var(--accent);
          border-color: var(--accent);
        }

        .drawer-sheet-head {
          display: none;
        }

        @media (max-width: 980px) {
          .context-drawer {
            top: auto;
            bottom: 0;
            inset-inline: 0;
            width: 100%;
            max-height: 65vh;
            border-radius: 16px 16px 0 0;
            transform: translateY(100%);
          }

          :global([dir="rtl"]) .context-drawer {
            transform: translateY(100%);
          }

          .context-drawer.open {
            transform: translateY(0);
          }

          .drawer-sheet-head {
            position: relative;
            display: flex;
            justify-content: center;
            align-items: center;
            flex-shrink: 0;
            height: 30px;
            touch-action: none;
            cursor: grab;
          }

          .drawer-sheet-grip {
            width: 40px;
            height: 4px;
            border-radius: 2px;
            background: var(--ink-muted);
            opacity: 0.55;
          }

          .drawer-sheet-close {
            position: absolute;
            top: 2px;
            inset-inline-end: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 34px;
            height: 34px;
            border: none;
            border-radius: 50%;
            background: transparent;
            color: var(--ink-secondary);
            cursor: pointer;
          }

          .drawer-sheet-close:focus-visible {
            outline: 2px solid var(--accent);
            outline-offset: -2px;
          }

          .drawer-tabs {
            margin-top: 0;
          }

          /* The bottom bar floats over the sheet's lower edge; pad the scroll
             area so its last rows can be scrolled clear of it. */
          .drawer-content {
            padding-bottom: calc(24px + var(--mobile-tools-bar-clearance, 90px));
          }
        }

        @media (hover: hover) {
          .drawer-sheet-close:hover {
            color: var(--ink);
            background: color-mix(in srgb, var(--selection) 8%, transparent);
          }
        }
      `}</style>
      </aside>
    </>
  );
}
