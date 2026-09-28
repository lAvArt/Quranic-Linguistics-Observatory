"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import TopBar from "@/components/shell/TopBar";
import StatusBar from "@/components/shell/StatusBar";
import JourneyRail from "@/components/shell/JourneyRail";
import ContextDrawer from "@/components/shell/ContextDrawer";
import GraphToolbar from "@/components/shell/GraphToolbar";
import VisualizationViewport from "@/components/home/VisualizationViewport";
import MobileVizBar from "@/components/ui/MobileVizBar";
import DisplaySettingsPanel from "@/components/ui/DisplaySettingsPanel";
import LexicalColorSwitch from "@/components/shell/LexicalColorSwitch";
import VizExportMenu from "@/components/ui/VizExportMenu";
import MobileSearchOverlay from "@/components/ui/MobileSearchOverlay";
import VizIntroCard from "@/components/ui/VizIntroCard";
import FirstRunMission from "@/components/onboarding/FirstRunMission";
import MissionChecklist from "@/components/onboarding/MissionChecklist";
import { deriveCorpusStatusPresentation } from "@/lib/corpus/statusPresentation";
import { SURAH_NAMES } from "@/lib/data/surahData";
import { useHomePageController, VizControlProvider } from "@/lib/hooks/useHomePageController";
import { useVizControl } from "@/lib/hooks/VizControlContext";
import { ALL_VIZ_MODES } from "@/lib/hooks/useVizModeState";
import { useEdgeSwipe } from "@/lib/hooks/useEdgeSwipe";
import type { CorpusOverviewData } from "@/lib/corpus/overviewData";
import type { ThemePreferenceState } from "@/lib/theme/themePreferences";
import type { VisualizationMode } from "@/lib/schema/visualizationTypes";

interface AppShellProps {
  initialCorpusData: CorpusOverviewData;
  initialThemePreference: ThemePreferenceState;
}

/** Persists the left dock's collapsed/expanded state across sessions — its
 *  own key (not folded into useHomePageController's viz-state blob) since
 *  it's dock chrome, not a viz preference. */
const LEFT_DOCK_STORAGE_KEY = "quran-corpus-left-dock";

function AppShellContent({ initialCorpusData, initialThemePreference }: AppShellProps) {
  const t = useTranslations("Index");
  const tViz = useTranslations("VisualizationSwitcher.modes");
  // Flips true once the deep-link stage/apply chain below (searchParams ->
  // pendingDeepLink -> navigateToResult) has settled — either there was
  // nothing to hydrate, or the hydration it staged has been applied. Passed
  // into the controller so its URL-sync effect (state -> URL) never fires
  // before then and clobbers an incoming deep link's params.
  const [isDeepLinkHydrated, setIsDeepLinkHydrated] = useState(false);
  // Tracks the last searchParams string this component has already applied
  // (see the stage/apply effects below) — declared here, ahead of the
  // controller, so `markUrlSynced` can be handed down to it before it mounts.
  // Next's App Router patches `history.replaceState` globally and echoes ANY
  // URL change (even a passive one) back into `useSearchParams()`, so the
  // controller's own URL-sync effect writing the address bar would otherwise
  // look exactly like a fresh incoming deep link and re-trigger
  // `navigateToResult` below — re-running the deep-link selection from
  // whatever was JUST echoed and clobbering any local edit made in between.
  // `markUrlSynced` records the string *as it writes it*, so the echo is
  // recognized as already-applied via the apply effect's own dedupe check
  // instead of being reprocessed.
  const lastAppliedParamsRef = useRef<string | null>(null);
  const markUrlSynced = useCallback((search: string) => {
    lastAppliedParamsRef.current = search;
  }, []);
  const c = useHomePageController(initialCorpusData, initialThemePreference, isDeepLinkHydrated, markUrlSynced);
  // Mobile-only controlled settings surface — its trigger lives outside this
  // component (owned elsewhere); read directly from the same context
  // MobileVizBar itself pulls its legend/tools toggles from.
  const vizControl = useVizControl();
  // Expanded by default so the zoom controls + legend are always visible in a
  // fixed, predictable dock (top-anchored, grows downward). Collapsible on demand.
  const [isLeftPanelCollapsed, setIsLeftPanelCollapsed] = useState(false);
  // The dock collapses on desktop only; a phone shows the panel as a sheet.
  const dockCollapsed = isLeftPanelCollapsed && !c.isMobileViewport;

  // Hydrate the collapsed state from localStorage once mounted. Starting
  // from the `false` default above (rather than a lazy useState initializer
  // reading localStorage directly) keeps the server-rendered markup and the
  // client's first render identical — no hydration mismatch — then this
  // effect reconciles to the stored value right after, same pattern as
  // useHomePageController's own localStorage hydration.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(LEFT_DOCK_STORAGE_KEY) === "true") {
        setIsLeftPanelCollapsed(true);
      }
    } catch {
      // Ignore localStorage errors (private mode, quota, disabled storage, etc.)
    }
  }, []);

  // Calm entry collapses the dock for THIS landing only — skip persisting
  // that programmatic collapse so future organic visits aren't affected.
  // Re-set to true before each such setIsLeftPanelCollapsed call.
  const skipNextDockPersistRef = useRef(false);
  useEffect(() => {
    if (skipNextDockPersistRef.current) {
      skipNextDockPersistRef.current = false;
      return;
    }
    try {
      window.localStorage.setItem(LEFT_DOCK_STORAGE_KEY, String(isLeftPanelCollapsed));
    } catch {
      // Ignore localStorage errors
    }
  }, [isLeftPanelCollapsed]);

  // Edge-swipe gestures (touch): swipe in from the left edge to reveal the legend,
  // from the right edge to reveal the inspector; swipe back over a panel to dismiss.
  // Desktop-layout touch screens only. On a phone both panels are sheets that
  // rise from the bottom, so a sideways swipe opening one read as backwards —
  // and a swipe from the screen edge is the browser's own back gesture there.
  const handleOpenLeft = useCallback(() => setIsLeftPanelCollapsed(false), []);
  const handleCloseLeft = useCallback(() => setIsLeftPanelCollapsed(true), []);
  const handleOpenRight = useCallback(() => c.setIsSidebarOpen(true), [c.setIsSidebarOpen]);
  const handleCloseRight = useCallback(() => c.setIsSidebarOpen(false), [c.setIsSidebarOpen]);

  // Intro chip → drawer wiring: clicking the chip's label must open the
  // drawer AND land on its Explain tab. ContextDrawer's active tab is its
  // own internal state (it already reacts to a prop changing this way — see
  // its token-focus-triggers-Inspect effect), so a bump counter is enough to
  // ask it to switch without lifting the whole tab state up here.
  const [explainRequestId, setExplainRequestId] = useState(0);
  const handleOpenExplain = useCallback(() => {
    c.setIsSidebarOpen(true);
    setExplainRequestId((n) => n + 1);
  }, [c.setIsSidebarOpen]);

  useEdgeSwipe({
    leftOpen: !isLeftPanelCollapsed,
    rightOpen: c.isSidebarOpen,
    openLeft: handleOpenLeft,
    closeLeft: handleCloseLeft,
    openRight: handleOpenRight,
    closeRight: handleCloseRight,
    enabled: !c.isMobileViewport,
  });

  // Deep-link hydration: ?viz=&surah=&ayah=&root=&lemma=&token= (e.g. from
  // /search or the minimal home's CTAs). Read via useSearchParams — NOT
  // window.location — because during a client-side navigation this effect can
  // run before the browser URL is updated, which used to strand the selection
  // until a hard refresh. useSearchParams is reactive to soft navigations, so
  // changed params re-apply; the ref keeps identical params from re-applying.
  const searchParams = useSearchParams();
  const navigateToResult = c.handleSearchResultNavigate;

  // Stage → apply as a two-commit chain: the controller's own localStorage
  // hydration effect runs in the mount commit and can queue state updates
  // AFTER ours (clobbering the deep link with persisted defaults). Staging the
  // params string first means the apply effect belongs to a later commit,
  // whose updates deterministically flush after the controller's — the deep
  // link always wins, in dev (StrictMode double-invoke) and prod alike.
  const [pendingDeepLink, setPendingDeepLink] = useState<string | null>(null);
  useEffect(() => {
    const hasRelevantParam =
      searchParams.get("root") ||
      searchParams.get("lemma") ||
      searchParams.get("surah") ||
      searchParams.get("ayah") ||
      searchParams.get("token") ||
      searchParams.get("viz");
    if (!hasRelevantParam) {
      // Nothing to hydrate — the URL-sync effect is safe to start immediately.
      setIsDeepLinkHydrated(true);
      return;
    }
    // Same string re-sets are no-ops for React, so this can't loop.
    setPendingDeepLink(searchParams.toString());
  }, [searchParams]);

  useEffect(() => {
    if (!pendingDeepLink || lastAppliedParamsRef.current === pendingDeepLink) return;
    lastAppliedParamsRef.current = pendingDeepLink;
    const sp = new URLSearchParams(pendingDeepLink);
    const root = sp.get("root");
    const lemma = sp.get("lemma");
    const surah = sp.get("surah");
    const ayah = sp.get("ayah");
    const token = sp.get("token");
    const vizParam = sp.get("viz");
    const calmEntry = sp.get("entry") === "calm";
    // Only honour ?viz= when it names a real, renderable mode — an unknown
    // value must not steer navigation (or unlock the advanced mode set).
    const viz = ALL_VIZ_MODES.includes(vizParam as VisualizationMode)
      ? (vizParam as VisualizationMode)
      : null;
    navigateToResult({
      id: "deeplink",
      kind: "ayah",
      title: "",
      actionTarget: {
        routeMode: "explore",
        visualizationMode: viz ?? undefined,
        selection: {
          surahId: surah ? Number(surah) : undefined,
          ayah: ayah ? Number(ayah) : undefined,
          root: root || undefined,
          lemma: lemma || undefined,
          tokenId: token || undefined,
        },
        calmEntry,
      },
    });
    if (calmEntry && c.isMobileViewport) {
      // Mobile: chrome-light first contact — both sheets stay closed until
      // the MobileVizBar opens them. The DOCK's collapsed state is a desktop
      // notion and is left alone: collapsing it here used to make the legend
      // sheet open invisible (slid off-screen) from the first visit on.
    } else if (calmEntry) {
      // Desktop: land with BOTH side menus open so the full breakdown (left
      // legend/controls + right inspector) is visible immediately.
      skipNextDockPersistRef.current = true;
      setIsLeftPanelCollapsed(false);
      c.setIsSidebarOpen(true);
    }
    setIsDeepLinkHydrated(true);
  }, [pendingDeepLink, navigateToResult]);

  // Picking an occurrence from the inspector's list scopes to its surah and
  // focuses the word, and deliberately touches NOTHING else: not the root
  // (it stays pinned — the occurrence belongs to it) and not the viz mode.
  const handleSelectAyah = useCallback((surahId: number, tokenId: string) => {
    c.setSelectedSurahId(surahId);
    c.setFocusedTokenId(tokenId);
  }, [c.setSelectedSurahId, c.setFocusedTokenId]);

  const clearFocus = useCallback(() => {
    c.setFocusedTokenId(null);
    c.setSelectedRoot(null);
    c.setSelectedLemma(null);
    c.setSearchLockedRoot(null);
  }, [c.setFocusedTokenId, c.setSelectedRoot, c.setSelectedLemma, c.setSearchLockedRoot]);

  const statusPresentation = deriveCorpusStatusPresentation(c.readiness, c.dataStatus, c.isLoadingCorpus);
  const surahName = SURAH_NAMES[c.selectedSurahId]?.name ?? `${c.selectedSurahId}`;

  return (
    <div className="immersive-dashboard" data-theme={c.theme}>
      <div className="neural-bg" aria-hidden />

      {/* ── Top bar ── */}
      <TopBar
        allTokens={c.allTokens}
        theme={c.theme}
        setTheme={c.setTheme}
        onTokenSelect={c.handleTokenSelect}
        onTokenHover={c.setHoverTokenId}
        onRootSelect={c.handleRootSelect}
        onSearchOpened={() => c.handleSearchOpened("header")}
        onSearchQuerySubmitted={(q) => c.handleSearchQuerySubmitted(q, "header")}
        onSearchResultSelected={(m) => c.handleSearchResultSelected(m, "header")}
        onResultNavigate={c.handleSearchResultNavigate}
      />

      {/* ── Left dock: journey rail (spine) + viz info panel (body), fused
          into one glass container — mirrors the right side's single
          .context-drawer object (see `.viz-dock` in globals.css). Below
          980px the fusion is a no-op (`.viz-dock` is `display: contents`)
          AND the spine itself hides (`.journey-rail.in-dock`, see
          JourneyRail) — its views/legend/tools are consolidated into the
          floating MobileVizBar pill instead. Collapsing the dock (the
          spine's own bottom toggle, desktop only) shrinks the info column to
          zero width, leaving only the spine. */}
      <div className="viz-dock">
        <JourneyRail
          vizMode={c.vizMode}
          onVizModeChange={c.handleVizModeChange}
          isPanelCollapsed={isLeftPanelCollapsed}
          onTogglePanelCollapse={() => setIsLeftPanelCollapsed((collapsed) => !collapsed)}
          inDock
        />
        {/* Full-height info panel. Layout: legend pinned top, transient
            selection cards in the middle, zoom controls + collapse at the
            bottom. The portal renders legend/selection/zoom; CSS orders them.
            Conditionally mounted on mobile (only while opened from
            MobileVizBar's legend toggle); always mounted on desktop, where
            collapsing it just shrinks its width to 0 inside the dock. */}
        {(!c.isMobileViewport || c.isLeftSidebarOpen) && (
          <aside
            className={`viz-sidebar-stack ${dockCollapsed ? "collapsed" : ""}`}
            aria-hidden={dockCollapsed || undefined}
          >
            <div id="viz-sidebar-portal" className="viz-sidebar-content" />
            <button
              type="button"
              className="viz-left-collapse"
              // On a phone this panel is a sheet the MobileVizBar opens, so
              // hiding it closes the sheet — collapsing the (desktop) dock
              // instead left the sheet mounted but slid away, and the bar's
              // button then reopened nothing.
              onClick={() => (c.isMobileViewport ? vizControl.setLeftSidebarOpen(false) : setIsLeftPanelCollapsed(true))}
              aria-label={t("overlay.collapsePanel")}
              title={t("overlay.collapsePanel")}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              <span>{t("overlay.collapsePanel")}</span>
            </button>
          </aside>
        )}
      </div>

      {/* Left dock edge handle — a vertically-centered pull-tab on the dock's
          INNER (canvas-facing) edge, mirroring the right inspector drawer's
          .drawer-edge-handle. Desktop only (mobile uses the floating pill). */}
      {!c.isMobileViewport && (
        <button
          type="button"
          className={`dock-left-handle ${isLeftPanelCollapsed ? "" : "is-open"}`}
          onClick={() => setIsLeftPanelCollapsed((collapsed) => !collapsed)}
          aria-expanded={!isLeftPanelCollapsed}
          aria-label={isLeftPanelCollapsed ? t("overlay.expandPanel") : t("overlay.collapsePanel")}
          title={isLeftPanelCollapsed ? t("overlay.expandPanel") : t("overlay.collapsePanel")}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}

      {/* ── Main visualization area ── */}
      <main ref={c.mainVizRef} className="immersive-viewport viz-fullwidth" data-tour-id="main-viewport">
        <VisualizationViewport
          vizMode={c.vizMode}
          allTokens={c.allTokens}
          experienceLevel={c.experienceLevel}
          selectedSurahId={c.selectedSurahId}
          selectedAyahInSurah={c.selectedAyahInSurah}
          selectedRoot={c.selectedRoot}
          selectedRootValue={c.selectedRootValue}
          selectedLemmaValue={c.selectedLemmaValue}
          flows={c.flows}
          roots={c.roots}
          tokenById={c.tokenById}
          theme={c.theme}
          lexicalColorMode={c.lexicalColorMode}
          setHoverTokenId={c.setHoverTokenId}
          setFocusedTokenId={c.setFocusedTokenId}
          focusedToken={c.focusedToken}
          setSelectedSurahId={c.setSelectedSurahId}
          handleRootSelect={c.handleRootSelect}
          handleSurahSelect={c.handleSurahSelect}
          onExploreRoots={() => c.handleVizModeChange("root-network")}
        />
      </main>

      {/* ── Bottom graph toolbar ── */}
      <GraphToolbar
        theme={c.theme}
        setTheme={c.setTheme}
        colorThemeId={c.colorThemeId}
        setColorThemeId={c.setColorThemeId}
        lexicalColorMode={c.lexicalColorMode}
        setLexicalColorMode={c.setLexicalColorMode}
        customColorTheme={c.customColorTheme}
        handleCustomColorThemeChange={c.handleCustomColorThemeChange}
        handleResetCustomColorTheme={c.handleResetCustomColorTheme}
        experienceLevel={c.experienceLevel}
        handleExperienceLevelChange={c.handleExperienceLevelChange}
        handleReplayExperience={c.handleReplayExperience}
        mainVizRef={c.mainVizRef}
        vizMode={c.vizMode}
        selectedSurahId={c.selectedSurahId}
        showAdvancedModes={c.showAdvancedModes}
        setShowAdvancedModes={c.setShowAdvancedModes}
        handleVizModeChange={c.handleVizModeChange}
      />

      {/* ── Right context drawer ── */}
      <ContextDrawer
        isOpen={c.isSidebarOpen}
        onToggleOpen={() => c.setIsSidebarOpen(!c.isSidebarOpen)}
        allTokens={c.allTokens}
        vizMode={c.vizMode}
        inspectorToken={c.inspectorTokenFinal}
        inspectorMode={c.inspectorModeFinal}
        selectedSurahId={c.selectedSurahId}
        explainRequestId={explainRequestId}
        clearFocus={clearFocus}
        onTokenHover={c.setHoverTokenId}
        onTokenSelect={c.handleTokenSelect}
        onRootSelect={c.handleRootSelect}
        onSelectSurah={c.handleSurahSelect}
        onSelectAyah={handleSelectAyah}
        onLemmaSelect={c.handleLemmaSelect}
        onSearchOpened={() => c.handleSearchOpened("sidebar")}
        onSearchQuerySubmitted={(q) => c.handleSearchQuerySubmitted(q, "sidebar")}
        onSearchResultSelected={(m) => c.handleSearchResultSelected(m, "sidebar")}
        onResultNavigate={c.handleSearchResultNavigate}
        isCorpusLoading={c.isLoadingCorpus}
      />

      {/* ── Consolidated status / notification bar ── */}
      <StatusBar
        isLoading={c.isLoadingCorpus}
        loadingProgress={c.loadingProgress}
        dataStatus={c.dataStatus}
        statusPresentation={statusPresentation}
        searchStatus={c.searchStatus}
        overviewSurahCount={c.overview.surahCount}
        overviewRootCount={c.overview.rootCount}
        contextTransformNotice={c.contextTransformNotice}
        onRestoreFocusedContext={c.handleRestoreFocusedContext}
        onDismissContextTransformNotice={c.handleDismissContextTransformNotice}
        isHierarchicalMode={c.isHierarchicalMode}
        vizModeLabel={tViz(`${c.vizMode}.label`)}
        selectedSurahId={c.selectedSurahId}
        surahName={surahName}
        selectedAyah={c.selectedAyahInSurah}
        selectedRoot={c.selectedRootValue}
        onBreadcrumbNavigate={c.handleBreadcrumbNavigate}
      />

      {/* Intro chip — a small non-blocking "How to read this view" pill under
          the breadcrumb, introducing the active viz once per mode (persisted
          in localStorage). Keyed by mode so switching modes mounts a fresh
          instance (fresh dismiss check + auto-fade timer). Hidden only while
          the first-run overlay is up — being non-blocking, it no longer needs
          special-casing for deep links that arrive mid-task. */}
      <VizIntroCard
        key={c.vizMode}
        vizMode={c.vizMode}
        suppressed={c.firstRunState === "intent-selection"}
        onOpenExplain={handleOpenExplain}
      />

      {/* First-task feedback prompt */}
      {c.showFirstTaskFeedbackPrompt && (
        <div className="ui-floating-feedback" role="status" aria-live="polite">
          <p>{t("feedbackPrompt.question")}</p>
          <div className="ui-floating-feedback-actions">
            <button type="button" onClick={() => c.handleFirstTaskFeedback("helpful")}>{t("feedbackPrompt.helpful")}</button>
            <button type="button" onClick={() => c.handleFirstTaskFeedback("not_helpful")}>{t("feedbackPrompt.notHelpful")}</button>
            <button type="button" onClick={c.handleDismissFirstTaskFeedback}>{t("feedbackPrompt.dismiss")}</button>
          </div>
        </div>
      )}

      {/* Viz suggestion toast */}
      {c.vizSuggestion && (
        <div className="viz-suggestion-toast" role="status" aria-live="polite">
          <span className="viz-suggestion-text">{t(`${c.vizSuggestion.reason}`)}</span>
          <button type="button" className="viz-suggestion-accept" onClick={c.handleAcceptVizSuggestion}>
            {t("vizSuggestion.switch")}
          </button>
          <button type="button" className="viz-suggestion-dismiss" onClick={c.handleDismissVizSuggestion} aria-label={t("vizSuggestion.dismiss")}>
            ×
          </button>
        </div>
      )}

      {/* Mobile overlays */}
      <MobileVizBar
        vizMode={c.vizMode}
        onVizModeChange={c.handleVizModeChange}
        experienceLevel={c.experienceLevel}
        showAdvancedModes={c.showAdvancedModes}
        onToggleAdvancedModes={c.setShowAdvancedModes}
        theme={c.theme}
        onThemeChange={c.setTheme}
      />
      {/* One controlled display-settings sheet for mobile — GraphToolbar
          (which owns the desktop instance, gear trigger included) is hidden
          entirely below 980px, so this instance has no trigger of its own
          (`hideTrigger`) and is opened by a button elsewhere (owned by
          another component); it only needs to exist and answer to
          `isMobileSettingsOpen`. `mobileExtras` adds the toolbar controls
          that would otherwise be stranded with GraphToolbar — colour
          encoding switch and export menu, same props GraphToolbar gives
          them. */}
      {c.isMobileViewport && (
        <DisplaySettingsPanel
          theme={c.theme}
          onThemeChange={c.setTheme}
          colorTheme={c.colorThemeId}
          onColorThemeChange={c.setColorThemeId}
          lexicalColorMode={c.lexicalColorMode}
          onLexicalColorModeChange={c.setLexicalColorMode}
          customColorTheme={c.customColorTheme}
          onCustomColorThemeChange={c.handleCustomColorThemeChange}
          onResetCustomColorTheme={c.handleResetCustomColorTheme}
          experienceLevel={c.experienceLevel}
          onExperienceLevelChange={c.handleExperienceLevelChange}
          onReplayExperience={c.handleReplayExperience}
          exportTargetRef={c.mainVizRef}
          vizMode={c.vizMode}
          selectedSurahId={c.selectedSurahId}
          isOpen={vizControl.isMobileSettingsOpen}
          onOpenChange={vizControl.setMobileSettingsOpen}
          hideTrigger
          mobileExtras
        >
          <LexicalColorSwitch mode={c.lexicalColorMode} onChange={c.setLexicalColorMode} />
          <VizExportMenu targetRef={c.mainVizRef} vizMode={c.vizMode} selectedSurahId={c.selectedSurahId} />
        </DisplaySettingsPanel>
      )}
      <MobileSearchOverlay
        tokens={c.allTokens}
        onTokenSelect={c.handleTokenSelect}
        onTokenHover={c.setHoverTokenId}
        onRootSelect={c.handleRootSelect}
        onSearchOpened={() => c.handleSearchOpened("mobile")}
        onSearchQuerySubmitted={(q) => c.handleSearchQuerySubmitted(q, "mobile")}
        onSearchResultSelected={(m) => c.handleSearchResultSelected(m, "mobile")}
        onResultNavigate={c.handleSearchResultNavigate}
      />

      {/* Onboarding overlays */}
      <FirstRunMission
        isOpen={c.firstRunState === "intent-selection"}
        onSelectIntent={c.handleSelectMissionIntent}
        onSkip={c.handleOnboardingSkip}
        showOnStartup={c.showOnStartup}
        onShowOnStartupChange={c.handleOnboardingStartupChange}
      />
      {c.firstRunState === "mission-active" && c.activeMissionIntent && (
        <MissionChecklist
          isOpen
          missionIntent={c.activeMissionIntent}
          progress={c.missionProgress}
          onDismiss={c.handleMissionEnd}
          onComplete={c.handleMissionComplete}
        />
      )}
    </div>
  );
}

export default function AppShell({ initialCorpusData, initialThemePreference }: AppShellProps) {
  return (
    <VizControlProvider>
      <AppShellContent initialCorpusData={initialCorpusData} initialThemePreference={initialThemePreference} />
    </VizControlProvider>
  );
}
