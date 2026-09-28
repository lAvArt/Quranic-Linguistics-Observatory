"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { trackPerformanceMetric, trackSearchRecoveryShown } from "@/lib/analytics/events";
import CommandBar from "@/components/search/CommandBar";
import CorpusIndex from "@/components/ui/CorpusIndex";
import AppWorkspaceShell from "@/components/ui/AppWorkspaceShell";
import { ROOT_GLOSSES } from "@/lib/data/rootGlosses";
import { SURAH_NAMES } from "@/lib/data/surahData";
import { deriveCorpusStatusPresentation } from "@/lib/corpus/statusPresentation";
import type { CorpusOverviewData } from "@/lib/corpus/overviewData";
import { readDevSearchStatus } from "@/lib/dev/testOverrides";
import { useCorpusData } from "@/lib/hooks/useCorpusData";
import { useSearch } from "@/lib/hooks/useSearch";
import type { SearchMatchType } from "@/lib/analytics/events";
import { normalizeRootFamily, normalizeArabicForSearch } from "@/lib/search/arabicNormalize";
import { parseSearchQuery } from "@/lib/search/queryParser";
import NearbyPanel from "@/components/search/NearbyPanel";
import type { CorpusToken, PartOfSpeech } from "@/lib/schema/types";
import type { SearchResultItem, SearchResultKind } from "@/lib/search/searchTypes";

interface SearchWorkspaceProps {
  initialCorpusData?: CorpusOverviewData;
}

type SearchTranslate = (key: string, values?: Record<string, string | number>) => string;

// Dossier surah-distribution page size — 8 bar-rows visually matches the
// Corpus index's 25 compact rows, keeping the two columns height-balanced.
const SURAH_PAGE_SIZE = 8;

export default function SearchWorkspace({ initialCorpusData }: SearchWorkspaceProps) {
  const t = useTranslations("SearchWorkspace");
  // Numbers in the page's locale, not the runtime's: a bare toLocaleString()
  // used the server's own locale (Arabic digits on this machine) and the
  // browser's on the client, so the page failed to hydrate.
  const locale = useLocale();
  const nf = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const tGlobal = useTranslations("GlobalSearch");
  const tSelection = useTranslations("CurrentSelectionPanel");
  const tShared = useTranslations("Visualizations.Shared");
  const tSemantic = useTranslations("SemanticSearchPanel");
  const tMorph = useTranslations("MorphologyInspector");
  const router = useRouter();
  const { allTokens, dataStatus, isLoadingCorpus, overview, overviewSource, readiness } = useCorpusData(initialCorpusData);
  const searchStatus = readDevSearchStatus() ?? "available";
  const [selectedToken, setSelectedToken] = useState<CorpusToken | null>(null);
  const [selectedRoot, setSelectedRoot] = useState<string | null>(null);
  // Surah picked in the Corpus index — drives the surah dossier card and
  // scopes the index's Root/Lemma tabs to that surah.
  const [indexSurahId, setIndexSurahId] = useState<number | null>(null);
  // Root dossier surah distribution: paginated (mirrors the Corpus index
  // pager on the right) so both columns keep balanced, bounded heights.
  const [surahPage, setSurahPage] = useState(0);
  const [hasTrackedShellRender, setHasTrackedShellRender] = useState(false);
  const search = useSearch({
    tokens: allTokens,
    analyticsSurface: "workspace",
    initialFiltersExpanded: true,
  });

  // Hydrate the query from ?q= once on mount, making /{locale}/search?q=…
  // a shareable deep link (and the layout's JSON-LD SearchAction target an
  // honest one). window.location instead of useSearchParams keeps this page
  // statically prerenderable without a Suspense boundary.
  const applyInitialQuery = search.setQuery;
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) applyInitialQuery(q);
  }, [applyInitialQuery]);

  const statusPresentation = useMemo(
    () => deriveCorpusStatusPresentation(readiness, dataStatus, isLoadingCorpus),
    [dataStatus, isLoadingCorpus, readiness]
  );

  const parsedQuery = useMemo(() => parseSearchQuery(search.query), [search.query]);
  const hasSearchInput = useMemo(
    () =>
      Boolean(
        search.query.trim() ||
        search.filterRoot.trim() ||
        search.filterLemma.trim() ||
        search.filterAyah.trim() ||
        search.filterPos
      ),
    [search.filterAyah, search.filterLemma, search.filterPos, search.filterRoot, search.query]
  );

  const spotlightRoot = useMemo(() => {
    if (selectedRoot?.trim()) return selectedRoot.trim();
    if (search.filterRoot.trim()) return search.filterRoot.trim();
    if (parsedQuery.root?.trim()) return parsedQuery.root.trim();
    // Any bare Arabic query is a spotlight candidate — rootInsight tries a root
    // family first, then a root-less name/word (Moses, Mary, حتى…) by lemma.
    if ((search.queryIntent === "arabic-root" || search.queryIntent === "arabic-text") && search.query.trim()) {
      return search.query.trim();
    }
    return (
      search.results.find((result) => result.matchedRoot?.trim())?.matchedRoot?.trim() ??
      search.results.find((result) => result.matchedLemma?.trim())?.matchedLemma?.trim() ??
      ""
    );
  }, [parsedQuery.root, search.filterRoot, search.query, search.queryIntent, search.results, selectedRoot]);

  useEffect(() => {
    setSurahPage(0);
  }, [spotlightRoot]);

  const rootInsight = useMemo(() => {
    if (!spotlightRoot) return null;

    const rootFamily = normalizeRootFamily(spotlightRoot);
    let matchingTokens = allTokens.filter((token) => token.root && normalizeRootFamily(token.root) === rootFamily);
    let byName = false;
    if (matchingTokens.length === 0) {
      // No root family — try a root-less name / function word by normalized
      // lemma (proper nouns like موسى / مريم have a lemma but no root). The
      // loader/enrichment makes token.lemma reliable for prefixed occurrences,
      // so this counts every occurrence, matching the home name card.
      const queryNorm = normalizeArabicForSearch(spotlightRoot);
      if (queryNorm) {
        matchingTokens = allTokens.filter(
          (token) => !token.root && normalizeArabicForSearch(token.lemma) === queryNorm,
        );
        byName = matchingTokens.length > 0;
      }
    }
    if (matchingTokens.length === 0) return null;

    const rootCounts = new Map<string, number>();
    const surahMap = new Map<number, { occurrences: number; ayahs: Set<number> }>();
    const lemmaCounts = new Map<string, number>();
    const formCounts = new Map<string, number>();
    const posCounts = new Map<PartOfSpeech, number>();
    const ayahKeys = new Set<string>();
    let gloss = "";

    for (const token of matchingTokens) {
      rootCounts.set(token.root, (rootCounts.get(token.root) ?? 0) + 1);
      lemmaCounts.set(token.lemma, (lemmaCounts.get(token.lemma) ?? 0) + 1);
      formCounts.set(token.text, (formCounts.get(token.text) ?? 0) + 1);
      posCounts.set(token.pos, (posCounts.get(token.pos) ?? 0) + 1);
      ayahKeys.add(`${token.sura}:${token.ayah}`);
      if (!gloss && token.morphology.gloss) gloss = token.morphology.gloss;

      const entry = surahMap.get(token.sura) ?? { occurrences: 0, ayahs: new Set<number>() };
      entry.occurrences += 1;
      entry.ayahs.add(token.ayah);
      surahMap.set(token.sura, entry);
    }

    const displayRoot = byName
      ? (matchingTokens[0]?.lemma || spotlightRoot)
      : ([...rootCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
         matchingTokens[0]?.root ??
         spotlightRoot);

    return {
      displayRoot,
      gloss: ROOT_GLOSSES.get(displayRoot) ?? ROOT_GLOSSES.get(spotlightRoot) ?? gloss,
      occurrences: matchingTokens.length,
      surahCount: surahMap.size,
      ayahCount: ayahKeys.size,
      lemmaCount: lemmaCounts.size,
      posBreakdown: [...posCounts.entries()].sort((a, b) => b[1] - a[1]),
      topLemmas: [...lemmaCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 5),
      topForms: [...formCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 8),
      topSurahs: [...surahMap.entries()]
        .map(([surahId, value]) => ({
          surahId,
          name: SURAH_NAMES[surahId]?.name ?? `Surah ${surahId}`,
          arabic: SURAH_NAMES[surahId]?.arabic ?? "",
          occurrences: value.occurrences,
          ayahCount: value.ayahs.size,
        }))
        .sort((a, b) => b.occurrences - a.occurrences || a.surahId - b.surahId),
    };
  }, [allTokens, spotlightRoot]);

  // Surah dossier: what a surah is MADE OF (its roots and lemmas) — shown
  // when a surah is picked in the index and no root spotlight overrides it.
  const surahInsight = useMemo(() => {
    if (!indexSurahId) return null;
    const meta = SURAH_NAMES[indexSurahId];
    // No early return on empty tokens: while the corpus is still streaming,
    // the dossier shows the surah's static metadata immediately and the
    // counts/chips fill in as batches land (streaming-honesty rule).
    const surahTokens = allTokens.filter((token) => token.sura === indexSurahId);

    const rootCounts = new Map<string, number>();
    const lemmaCounts = new Map<string, number>();
    const ayahs = new Set<number>();
    for (const token of surahTokens) {
      if (token.root) rootCounts.set(token.root, (rootCounts.get(token.root) ?? 0) + 1);
      if (token.lemma) lemmaCounts.set(token.lemma, (lemmaCounts.get(token.lemma) ?? 0) + 1);
      ayahs.add(token.ayah);
    }

    return {
      surahId: indexSurahId,
      name: meta?.name ?? `Surah ${indexSurahId}`,
      arabic: meta?.arabic ?? "",
      verses: meta?.verses ?? ayahs.size,
      tokenCount: surahTokens.length,
      rootCount: rootCounts.size,
      lemmaCount: lemmaCounts.size,
      topRoots: [...rootCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 12),
      topLemmas: [...lemmaCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 12),
    };
  }, [allTokens, indexSurahId]);

  // Shared by the index's Root tab AND the surah dossier's root chips:
  // filter to the root and spotlight its corpus-wide dossier.
  const handleIndexRootSelect = (root: string) => {
    const token =
      allTokens.find((entry) => normalizeRootFamily(entry.root) === normalizeRootFamily(root)) ?? null;
    search.setQuery("");
    search.setFilterLemma("");
    search.setFilterPos("");
    search.setFilterAyah("");
    search.setFilterRoot(root);
    search.setFiltersExpanded(true);
    setSelectedToken(token);
    setSelectedRoot(root);
  };

  const resultBuckets = useMemo(
    () =>
      search.groupedResults
        .map((group) => ({ kind: group.kind, count: group.items.length }))
        .sort((a, b) => b.count - a.count),
    [search.groupedResults]
  );

  const activeLens = useMemo(() => {
    if (spotlightRoot) return { label: tGlobal("types.root"), value: spotlightRoot };
    if (search.filterLemma.trim() || parsedQuery.lemma?.trim()) {
      return { label: tGlobal("types.lemma"), value: search.filterLemma.trim() || parsedQuery.lemma?.trim() || "" };
    }
    if (search.filterAyah.trim() || parsedQuery.ayah?.trim() || search.queryIntent === "ayah-ref") {
      return {
        label: tShared("ayah"),
        value: search.filterAyah.trim() || parsedQuery.ayah?.trim() || search.query.trim(),
      };
    }
    if (search.queryIntent === "english-gloss") return { label: tGlobal("types.gloss"), value: search.query.trim() };
    if (search.queryIntent === "arabic-text") return { label: tGlobal("types.text"), value: search.query.trim() };
    if (search.queryIntent === "structured") {
      return { label: tGlobal("intentHints.structured"), value: search.query.trim() };
    }
    return null;
  }, [
    parsedQuery.ayah,
    parsedQuery.lemma,
    search.filterAyah,
    search.filterLemma,
    search.query,
    search.queryIntent,
    spotlightRoot,
    tGlobal,
    tShared,
  ]);

  const pinnedSurahName = useMemo(() => {
    if (!selectedToken) return null;
    const surah = SURAH_NAMES[selectedToken.sura];
    return surah ? `${selectedToken.sura}. ${surah.name}` : String(selectedToken.sura);
  }, [selectedToken]);

  // Empty-state cards (no lens picked yet, no root spotlighted yet) are filler
  // before the user has typed anything — render the lens/spotlight cards only
  // once they actually carry a value. The tokens-ready card always shows: it's
  // the one place the corpus size/match count is surfaced (see quickSearch head).
  const snapshotCards = useMemo(() => {
    const resultSummary = resultBuckets
      .slice(0, 3)
      .map((bucket) => `${bucket.count} ${getResultKindLabel(bucket.kind, tGlobal, tShared)}`)
      .join(" • ");

    const cards = [
      {
        key: "tokens",
        label: hasSearchInput ? t("snapshot.matches") : t("snapshot.ready"),
        value: nf.format((hasSearchInput ? search.results.length : allTokens.length)),
        // Note: the "try a query" example (searchPrimerHint) is surfaced once,
        // as the standalone hint line below the cards — this detail must stay
        // distinct so the example text isn't shown twice on screen.
        detail: hasSearchInput ? resultSummary || t("snapshot.noMatches") : t("snapshot.readyHint"),
      },
    ];

    if (activeLens) {
      cards.push({
        key: "lens",
        label: t("snapshot.lens"),
        value: activeLens.label,
        detail: activeLens.value,
      });
    }

    if (rootInsight) {
      cards.push({
        key: "spotlight",
        label: t("snapshot.spotlight"),
        value: rootInsight.displayRoot,
        detail: rootInsight.gloss || t("snapshot.spotlightHint"),
      });
    }

    return cards;
  }, [activeLens, allTokens.length, hasSearchInput, resultBuckets, rootInsight, search.results.length, t, tGlobal, tShared]);

  useEffect(() => {
    if (searchStatus === "unavailable") trackSearchRecoveryShown("search");
  }, [searchStatus]);

  useEffect(() => {
    if (hasTrackedShellRender) return;
    const navigationEntry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const durationMs = navigationEntry ? Math.round(navigationEntry.domContentLoadedEventEnd) : Math.round(performance.now());
    trackPerformanceMetric("shell_render", "search", durationMs, {
      shell_ready: readiness.overviewReady,
      corpus_source: overviewSource,
    });
    setHasTrackedShellRender(true);
  }, [hasTrackedShellRender, overviewSource, readiness.overviewReady]);

  const handleResultSelected = (_matchType: SearchMatchType) => {
    // Analytics handled upstream; navigation happens via handleResultNavigate.
  };

  // Picking a result opens it in the Explore view (deep link) so the dedicated
  // search page is navigable, not a dead-end dashboard.
  const handleResultNavigate = useCallback(
    (result: SearchResultItem) => {
      const sel = result.actionTarget.selection ?? {};
      const params = new URLSearchParams();
      if (result.actionTarget.visualizationMode) params.set("viz", result.actionTarget.visualizationMode);
      if (sel.surahId) params.set("surah", String(sel.surahId));
      if (sel.ayah) params.set("ayah", String(sel.ayah));
      if (sel.root) params.set("root", sel.root);
      if (sel.lemma) params.set("lemma", sel.lemma);
      if (sel.tokenId) params.set("token", sel.tokenId);
      router.push(`/?${params.toString()}`);
    },
    [router]
  );

  const statusLabel = t(`status.${statusPresentation.statusLabel}`);

  // Only one status line is ever shown at a time — loading takes priority
  // (it's the most actionable: results may still be partial), then fallback,
  // then the shell-ready note. Previously these three rendered as independent
  // paragraphs and could double up (shell-ready + loading simultaneously).
  const primaryStatusMessage = statusPresentation.showLoadingMessage
    ? t("loadingMessage")
    : statusPresentation.showFallbackMessage
      ? t("fallbackMessage")
      : statusPresentation.showShellReadyMessage
        ? t("shellReadyMessage", {
            surahCount: overview.surahCount,
            rootCount: nf.format(overview.rootCount),
          })
        : null;

  return (
    <AppWorkspaceShell
      kicker={t("kicker")}
      title={t("title")}
      description=""
      status={<div className="ui-pill">{statusLabel}</div>}
      backgroundVariant="search"
      compact
    >
      {primaryStatusMessage ? (
        <div
          className={`workspace-status-pill${statusPresentation.showFallbackMessage ? " workspace-status-pill-fallback" : ""}`}
          data-testid="search-workspace-status-message"
        >
          {primaryStatusMessage}
        </div>
      ) : null}

      {searchStatus === "unavailable" ? (
        <div className="ui-message ui-message-error workspace-status-message" data-testid="search-workspace-search-message">
          {t("searchUnavailableMessage")}
        </div>
      ) : null}

      <div className="ui-grid-two">
        <section className="ui-card ui-section-card ui-section-card-tall">
          <div className="ui-card-head">
            <div className="workspace-head-copy">
              <h2>{t("quickSearch")}</h2>
              <p>{t("searchPrimerDescription")}</p>
            </div>
          </div>

          <div className="workspace-search-stack">
            <div className="workspace-command-bar">
              <CommandBar
                tokens={allTokens}
                variant="panel"
                analyticsSurface="workspace"
                search={search}
                onTokenSelect={(tokenId) => {
                  const token = allTokens.find((entry) => entry.id === tokenId) ?? null;
                  setSelectedToken(token);
                  setSelectedRoot(token?.root ?? null);
                }}
                onTokenHover={() => {}}
                onRootSelect={setSelectedRoot}
                onSearchResultSelected={handleResultSelected}
                onResultNavigate={handleResultNavigate}
              />
            </div>

            <div className="workspace-snapshot-grid">
              {snapshotCards.map((card) => (
                <article key={card.key} className="workspace-snapshot-card">
                  <span className="workspace-snapshot-label">{card.label}</span>
                  <strong className="workspace-snapshot-value">{card.value}</strong>
                  <span className="workspace-snapshot-detail">{card.detail}</span>
                </article>
              ))}
            </div>

            {resultBuckets.length > 0 ? (
              <div className="workspace-bucket-row">
                {resultBuckets.map((bucket) => (
                  <span key={bucket.kind} className="workspace-bucket-chip">
                    {bucket.count} {getResultKindLabel(bucket.kind, tGlobal, tShared)}
                  </span>
                ))}
              </div>
            ) : (
              <p className="workspace-search-hint">{t("searchPrimerHint")}</p>
            )}

            {!rootInsight && surahInsight ? (
              <article className="workspace-root-card" data-testid="search-surah-dossier">
                <div className="workspace-root-head">
                  <div>
                    <p className="ui-kicker">{t("surahInsight.title")}</p>
                    <h3 className="workspace-root-title">
                      {surahInsight.surahId}. {surahInsight.name}
                    </h3>
                    <p className="workspace-root-gloss" lang="ar" dir="rtl">{surahInsight.arabic}</p>
                  </div>
                </div>

                <div className="workspace-root-metrics">
                  <div className="workspace-root-metric">
                    <span>{t("surahInsight.verses")}</span>
                    <strong>{nf.format(surahInsight.verses)}</strong>
                  </div>
                  <div className="workspace-root-metric">
                    <span>{t("surahInsight.words")}</span>
                    <strong>{nf.format(surahInsight.tokenCount)}</strong>
                  </div>
                  <div className="workspace-root-metric">
                    <span>{t("surahInsight.roots")}</span>
                    <strong>{nf.format(surahInsight.rootCount)}</strong>
                  </div>
                  <div className="workspace-root-metric">
                    <span>{t("surahInsight.lemmas")}</span>
                    <strong>{nf.format(surahInsight.lemmaCount)}</strong>
                  </div>
                </div>

                <div className="workspace-root-section">
                  <span className="workspace-root-section-label">{t("surahInsight.topRoots")}</span>
                  <div className="workspace-tag-row">
                    {surahInsight.topRoots.map(([root, count]) => (
                      <button
                        key={root}
                        type="button"
                        className="workspace-tag workspace-tag-button"
                        onClick={() => handleIndexRootSelect(root)}
                        title={t("surahInsight.rootChipHint")}
                      >
                        <span lang="ar" dir="rtl">{root}</span>
                        <em>{count}</em>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="workspace-root-section">
                  <span className="workspace-root-section-label">{t("surahInsight.topLemmas")}</span>
                  <div className="workspace-tag-row">
                    {surahInsight.topLemmas.map(([lemma, count]) => (
                      <span key={lemma} className="workspace-tag">
                        <span lang="ar" dir="rtl">{lemma}</span>
                        <em>{count}</em>
                      </span>
                    ))}
                  </div>
                </div>
              </article>
            ) : null}

            {/* Collocation as a search answer: what is NAMED near the query.
                Sits under the root card because it answers a different question
                — the root card is "what is this word", this is "who says it". */}
            {spotlightRoot.trim() || parsedQuery.near ? (
              <NearbyPanel
                tokens={allTokens}
                // With a near: operator the anchor is the free text alone —
                // spotlightRoot may still carry the raw query, operator included.
                term={parsedQuery.near ? parsedQuery.freeText : spotlightRoot}
                pairValue={parsedQuery.near ?? null}
                isCorpusLoading={isLoadingCorpus}
              />
            ) : null}

            {rootInsight ? (
              <article className="workspace-root-card">
                <div className="workspace-root-head">
                  <div>
                    <p className="ui-kicker">{t("rootInsight.title")}</p>
                    <h3 className="workspace-root-title" lang="ar" dir="rtl">{rootInsight.displayRoot}</h3>
                    {rootInsight.gloss ? <p className="workspace-root-gloss">{rootInsight.gloss}</p> : null}
                  </div>
                  <span className="workspace-root-badge">
                    {tSemantic("rootInfo.occurrences", { count: nf.format(rootInsight.occurrences) })}
                  </span>
                </div>

                <div className="workspace-root-metrics">
                  <div className="workspace-root-metric">
                    <span>{tMorph("rootDistribution.stats.occurrences")}</span>
                    <strong>{nf.format(rootInsight.occurrences)}</strong>
                  </div>
                  <div className="workspace-root-metric">
                    <span>{tSemantic("rootInfo.stats.surahs")}</span>
                    <strong>{nf.format(rootInsight.surahCount)}</strong>
                  </div>
                  <div className="workspace-root-metric">
                    <span>{tMorph("rootDistribution.stats.ayahs")}</span>
                    <strong>{nf.format(rootInsight.ayahCount)}</strong>
                  </div>
                  <div className="workspace-root-metric">
                    <span>{tSemantic("rootInfo.stats.lemmas")}</span>
                    <strong>{nf.format(rootInsight.lemmaCount)}</strong>
                  </div>
                </div>

                {rootInsight.posBreakdown.length > 0 ? (
                  <div className="workspace-root-section">
                    <span className="workspace-root-section-label">{t("rootInsight.posMix")}</span>
                    <div className="workspace-tag-row">
                      {rootInsight.posBreakdown.map(([pos, count]) => (
                        <span key={pos} className="workspace-tag">
                          {formatPosLabel(pos, tGlobal)} <small>{count}</small>
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {rootInsight.topLemmas.length > 0 ? (
                  <div className="workspace-root-section">
                    <span className="workspace-root-section-label">{t("rootInsight.topLemmas")}</span>
                    <div className="workspace-tag-row">
                      {rootInsight.topLemmas.map(([lemma, count]) => (
                        <span key={lemma} className="workspace-tag workspace-tag-arabic" lang="ar" dir="rtl">
                          {lemma} <small>{count}</small>
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {rootInsight.topForms.length > 0 ? (
                  <div className="workspace-root-section">
                    <span className="workspace-root-section-label">{tSemantic("rootInfo.formsLabel")}</span>
                    <div className="workspace-tag-row">
                      {rootInsight.topForms.map(([form, count]) => (
                        <span key={form} className="workspace-tag workspace-tag-arabic" lang="ar" dir="rtl">
                          {form} <small>{count}</small>
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="workspace-root-section">
                  <span className="workspace-root-section-label">{tSemantic("rootInfo.surahDistribution")}</span>
                  <div className="workspace-surah-list">
                    {rootInsight.topSurahs.slice(surahPage * SURAH_PAGE_SIZE, (surahPage + 1) * SURAH_PAGE_SIZE).map((surah) => {
                      const maxOccurrences = rootInsight.topSurahs[0]?.occurrences ?? 1;
                      const width = Math.max(10, (surah.occurrences / maxOccurrences) * 100);
                      return (
                        <div key={surah.surahId} className="workspace-surah-item">
                          <div className="workspace-surah-copy">
                            <span className="workspace-surah-name">{surah.surahId}. {surah.name}</span>
                            {surah.arabic ? (
                              <span className="workspace-surah-arabic" lang="ar" dir="rtl">{surah.arabic}</span>
                            ) : null}
                          </div>
                          <div className="workspace-surah-bar">
                            <span style={{ width: `${width}%` }} />
                          </div>
                          <span className="workspace-surah-meta">
                            {surah.occurrences} • {surah.ayahCount} {tMorph("rootDistribution.stats.ayahs")}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {rootInsight.topSurahs.length > SURAH_PAGE_SIZE ? (
                    <div className="workspace-surah-pager" data-testid="root-dossier-surah-pager">
                      <button
                        type="button"
                        className="workspace-surah-pager-btn"
                        onClick={() => setSurahPage(Math.max(0, surahPage - 1))}
                        disabled={surahPage === 0}
                        aria-label={t("surahPagePrev")}
                      >
                        ‹
                      </button>
                      <span className="workspace-surah-pager-status">
                        {t("surahPageStatus", {
                          from: surahPage * SURAH_PAGE_SIZE + 1,
                          to: Math.min(rootInsight.topSurahs.length, (surahPage + 1) * SURAH_PAGE_SIZE),
                          total: rootInsight.topSurahs.length,
                        })}
                      </span>
                      <button
                        type="button"
                        className="workspace-surah-pager-btn"
                        onClick={() => setSurahPage(Math.min(Math.ceil(rootInsight.topSurahs.length / SURAH_PAGE_SIZE) - 1, surahPage + 1))}
                        disabled={(surahPage + 1) * SURAH_PAGE_SIZE >= rootInsight.topSurahs.length}
                        aria-label={t("surahPageNext")}
                      >
                        ›
                      </button>
                    </div>
                  ) : null}
                </div>
              </article>
            ) : null}

            <div className="selection-card ui-card-muted workspace-selection-card">
              <p className="selection-label ui-kicker">{t("currentResult")}</p>
              {selectedToken ? (
                <>
                  <div className="workspace-selection-topline">
                    <strong lang="ar" dir="rtl">{selectedToken.text}</strong>
                    <span className="workspace-selection-root">{selectedToken.root || t("noRoot")}</span>
                  </div>
                  <p className="workspace-selection-gloss">
                    {selectedToken.morphology.gloss || rootInsight?.gloss || t("noGloss")}
                  </p>
                  <div className="workspace-selection-grid">
                    <div className="workspace-selection-meta">
                      <span>{tSelection("labels.surah")}</span>
                      <strong>{pinnedSurahName}</strong>
                    </div>
                    <div className="workspace-selection-meta">
                      <span>{tSelection("labels.ayah")}</span>
                      <strong>{selectedToken.ayah}</strong>
                    </div>
                    <div className="workspace-selection-meta">
                      <span>{tSelection("labels.lemma")}</span>
                      <strong lang="ar" dir="rtl">{selectedToken.lemma}</strong>
                    </div>
                    <div className="workspace-selection-meta">
                      <span>{tShared("pos")}</span>
                      <strong>{formatPosLabel(selectedToken.pos, tGlobal)}</strong>
                    </div>
                  </div>
                </>
              ) : (
                <p className="ui-empty-copy">{t("emptySelection")}</p>
              )}
            </div>
          </div>
        </section>

        <section className="ui-card ui-section-card ui-section-card-tall">
          <div className="ui-card-head">
            <h2>{t("corpusIndex")}</h2>
          </div>
          <CorpusIndex
            tokens={allTokens}
            selectedSurahId={indexSurahId ?? undefined}
            onClearSurah={() => setIndexSurahId(null)}
            onSelectSurah={(surahId) => {
              // A surah pick opens the SURAH dossier (what the surah is made
              // of) — it must never spotlight some arbitrary token's root.
              setIndexSurahId(surahId);
              setSelectedToken(null);
              setSelectedRoot(null);
            }}
            onSelectRoot={handleIndexRootSelect}
            onSelectLemma={(lemma) => {
              const token = allTokens.find((entry) => entry.lemma === lemma) ?? null;
              search.setQuery("");
              search.setFilterRoot("");
              search.setFilterPos("");
              search.setFilterAyah("");
              search.setFilterLemma(lemma);
              search.setFiltersExpanded(true);
              setSelectedToken(token);
              setSelectedRoot(token?.root ?? null);
            }}
          />
        </section>
      </div>

      <style jsx>{`
        .workspace-status-message {
          margin-bottom: 1rem;
        }

        /* Single compact status line (loading/fallback/shell-ready are
           mutually exclusive at render time — see primaryStatusMessage).
           Reads as a status chip, not body copy. */
        .workspace-status-pill {
          display: inline-flex;
          align-items: center;
          max-width: 100%;
          margin-bottom: 1rem;
          padding: 0.45rem 0.85rem;
          border: 1px solid var(--line);
          border-radius: var(--radius-pill);
          background: var(--ui-surface-muted);
          color: var(--ink-secondary);
          font-size: 0.82rem;
          line-height: 1.35;
        }

        .workspace-status-pill-fallback {
          border-color: color-mix(in srgb, var(--ui-danger-fg) 18%, var(--line));
          background: var(--ui-danger-bg);
          color: var(--ui-danger-fg);
        }

        .workspace-head-copy {
          display: grid;
          gap: 0.3rem;
        }

        .workspace-head-copy p {
          margin: 0;
          max-width: 44ch;
          color: var(--ink-muted);
          font-size: 0.9rem;
        }

        .workspace-search-stack {
          display: grid;
          gap: 1rem;
        }

        .workspace-command-bar :global(.global-search) {
          max-width: none;
        }

        .workspace-command-bar :global(.search-input-wrapper) {
          padding: 0.75rem 0.85rem;
          border-radius: 14px;
          background: var(--ui-surface);
          border-color: color-mix(in srgb, var(--accent) 40%, var(--line));
        }

        .workspace-command-bar :global(.search-input) {
          font-size: 0.92rem;
        }

        .workspace-command-bar :global(.search-overlay-container) {
          display: grid;
          gap: 0.5rem;
          margin-top: 0.5rem;
        }

        .workspace-command-bar :global(.search-advanced-filters),
        .workspace-command-bar :global(.search-results-dropdown) {
          margin-top: 0;
          border-radius: 18px;
          border-color: rgba(17, 24, 39, 0.08);
          background: rgba(255, 255, 255, 0.92);
        }

        .workspace-command-bar :global(.search-advanced-filters) {
          padding: 0.8rem;
        }

        .workspace-snapshot-grid {
          display: grid;
          /* auto-fit, not a fixed 3-up: the lens/spotlight cards only render
             once active, so the row can legitimately hold 1-3 cards. */
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 0.75rem;
        }

        .workspace-snapshot-card,
        .workspace-root-card {
          padding: 1rem;
          border: 1px solid var(--line);
          border-radius: 14px;
          background: var(--ui-surface-soft);
        }

        /* Mirrors the Corpus index pager so both columns read as one system. */
        .workspace-surah-pager {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 18px;
          margin-top: 0.8rem;
          padding-top: 12px;
          border-top: 1px solid var(--line);
        }

        .workspace-surah-pager-btn {
          width: 30px;
          height: 30px;
          border-radius: 8px;
          border: 1px solid var(--line);
          background: transparent;
          color: var(--ink-secondary);
          font-size: 1rem;
          line-height: 1;
          cursor: pointer;
        }

        .workspace-surah-pager-btn:hover:not(:disabled) {
          border-color: var(--accent);
          color: var(--ink);
        }

        .workspace-surah-pager-btn:disabled {
          opacity: 0.35;
          cursor: default;
        }

        .workspace-surah-pager-status {
          font-size: 0.72rem;
          color: var(--ink-muted);
          font-variant-numeric: tabular-nums;
        }

        .workspace-tag-button {
          cursor: pointer;
          font-family: inherit;
          transition: border-color 0.15s ease, color 0.15s ease;
        }

        .workspace-tag-button:hover {
          border-color: var(--accent);
          color: var(--ink);
        }

        .workspace-tag em {
          font-style: normal;
          color: var(--ink-muted);
          font-variant-numeric: tabular-nums;
        }

        .workspace-snapshot-card {
          display: grid;
          gap: 0.2rem;
          min-height: 104px;
        }

        .workspace-snapshot-label,
        .workspace-root-section-label,
        .workspace-selection-meta span {
          color: var(--ink-muted);
          font-size: 0.74rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .workspace-snapshot-value {
          font-size: 1.05rem;
          line-height: 1.25;
        }

        .workspace-snapshot-detail {
          color: var(--ink-muted);
          font-size: 0.85rem;
          line-height: 1.45;
        }

        .workspace-bucket-row,
        .workspace-tag-row {
          display: flex;
          flex-wrap: wrap;
          gap: 0.55rem;
        }

        .workspace-bucket-chip,
        .workspace-tag,
        .workspace-selection-root,
        .workspace-root-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          padding: 0.38rem 0.7rem;
          border-radius: 999px;
          background: rgba(17, 24, 39, 0.06);
          color: var(--ink);
          font-size: 0.8rem;
          line-height: 1;
        }

        .workspace-tag small {
          color: var(--ink-muted);
          font-size: 0.72rem;
        }

        .workspace-tag-arabic {
          font-family: var(--font-arabic, serif);
          font-size: 1rem;
        }

        .workspace-search-hint {
          margin: 0;
          color: var(--ink-muted);
          font-size: 0.9rem;
        }

        .workspace-root-card {
          display: grid;
          gap: 1rem;
          border-color: color-mix(in srgb, var(--accent) 24%, var(--line));
          background: var(--ui-surface-soft);
        }

        .workspace-root-head {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          align-items: flex-start;
        }

        .workspace-root-title {
          margin: 0.15rem 0 0;
          font-family: var(--font-arabic, serif);
          font-size: clamp(1.8rem, 4vw, 2.35rem);
          line-height: 1.05;
        }

        .workspace-root-gloss,
        .workspace-selection-gloss {
          margin: 0;
          color: var(--ink-muted);
        }

        .workspace-root-metrics,
        .workspace-selection-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 0.7rem;
        }

        .workspace-root-metric,
        .workspace-selection-meta {
          display: grid;
          gap: 0.3rem;
          padding: 0.8rem 0.85rem;
          border-radius: 16px;
          border: 1px solid rgba(17, 24, 39, 0.06);
          background: rgba(255, 255, 255, 0.58);
        }

        .workspace-root-metric span {
          color: var(--ink-muted);
          font-size: 0.73rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .workspace-root-section {
          display: grid;
          gap: 0.65rem;
        }

        .workspace-surah-list {
          display: grid;
          gap: 0.65rem;
        }

        .workspace-surah-item {
          display: grid;
          gap: 0.35rem;
        }

        .workspace-surah-copy,
        .workspace-selection-topline {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          align-items: center;
        }

        .workspace-surah-name {
          font-weight: 600;
        }

        .workspace-surah-arabic {
          color: var(--ink-muted);
          font-family: var(--font-arabic, serif);
        }

        .workspace-surah-bar {
          height: 0.45rem;
          border-radius: 999px;
          background: rgba(17, 24, 39, 0.08);
          overflow: hidden;
        }

        .workspace-surah-bar span {
          display: block;
          height: 100%;
          border-radius: inherit;
          background: var(--accent);
        }

        .workspace-surah-meta {
          color: var(--ink-muted);
          font-size: 0.82rem;
        }

        .selection-card {
          margin-top: 0;
        }

        .selection-label {
          margin-bottom: 0;
        }

        @media (max-width: 960px) {
          .workspace-root-metrics,
          .workspace-selection-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 640px) {
          .workspace-root-metrics,
          .workspace-selection-grid {
            grid-template-columns: 1fr;
          }

          .workspace-root-head,
          .workspace-surah-copy,
          .workspace-selection-topline {
            flex-direction: column;
            align-items: flex-start;
          }
        }

        /* Flat token surfaces — the old navy linear-gradients + gold radial
           tints were the last visible remnant of the pre-observatory theme. */
        :global([data-theme="dark"] .workspace-command-bar .search-input-wrapper) {
          background: var(--panel);
        }

        :global([data-theme="dark"] .workspace-command-bar .search-advanced-filters),
        :global([data-theme="dark"] .workspace-command-bar .search-results-dropdown) {
          background: var(--panel);
        }

        :global([data-theme="dark"] .workspace-snapshot-card),
        :global([data-theme="dark"] .workspace-root-card) {
          background: color-mix(in srgb, var(--panel) 94%, transparent);
          border-color: var(--line);
        }

        :global([data-theme="dark"] .workspace-root-metric),
        :global([data-theme="dark"] .workspace-selection-meta) {
          background: rgba(255, 255, 255, 0.03);
          border-color: rgba(255, 255, 255, 0.05);
        }

        :global([data-theme="dark"] .workspace-bucket-chip),
        :global([data-theme="dark"] .workspace-tag),
        :global([data-theme="dark"] .workspace-selection-root),
        :global([data-theme="dark"] .workspace-root-badge) {
          background: rgba(255, 255, 255, 0.06);
        }

        :global([data-theme="dark"] .workspace-surah-bar) {
          background: rgba(255, 255, 255, 0.08);
        }
      `}</style>
    </AppWorkspaceShell>
  );
}

function formatPosLabel(pos: PartOfSpeech, tGlobal: SearchTranslate) {
  switch (pos) {
    case "N":
      return tGlobal("filters.noun");
    case "V":
      return tGlobal("filters.verb");
    case "P":
      return tGlobal("filters.particle");
    case "ADJ":
      return tGlobal("filters.adjective");
    case "PRON":
      return tGlobal("filters.pronoun");
    default:
      return pos;
  }
}

function getResultKindLabel(kind: SearchResultKind, tGlobal: SearchTranslate, tShared: SearchTranslate) {
  switch (kind) {
    case "ayah":
      return tShared("ayah");
    case "surah":
      return tShared("surah");
    case "root":
      return tGlobal("types.root");
    case "lemma":
      return tGlobal("types.lemma");
    case "gloss":
      return tGlobal("types.gloss");
    case "translation":
      return tGlobal("types.translation");
    case "semantic":
      return tGlobal("types.semantic");
    case "token":
    default:
      return "Token";
  }
}
