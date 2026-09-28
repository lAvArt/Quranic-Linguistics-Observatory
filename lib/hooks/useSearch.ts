"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import type { CorpusToken, PartOfSpeech } from "@/lib/schema/types";
import { useDebounce } from "@/lib/hooks/useDebounce";
import { trackPerformanceMetric, type SearchMatchType } from "@/lib/analytics/events";
import {
  getSearchCatalog,
  groupSearchResults,
  hasSearchCatalog,
  searchCorpus,
  detectQueryIntent,
  type QueryIntent,
} from "@/lib/search/searchService";
import type { SearchResultItem } from "@/lib/search/searchTypes";
import { fetchConceptExpansion } from "@/lib/search/conceptClient";
import { FULL_CORPUS_TOKEN_FLOOR } from "@/lib/corpus/corpusExpectations";

/** Let the page settle after the corpus lands before warming the search index. */
const WARM_DELAY_MS = 3000;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

type AnalyticsSurface = "header" | "sidebar" | "mobile" | "workspace" | "unknown" | "explore" | "search" | "shared";

export interface UseSearchOptions {
  tokens: CorpusToken[];
  /** Surface identifier for analytics performance tracking */
  analyticsSurface?: AnalyticsSurface;
  /** Whether advanced filters start expanded (default: false) */
  initialFiltersExpanded?: boolean;
}

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface UseSearchReturn {
  // Query
  query: string;
  setQuery: (q: string) => void;
  effectiveQuery: string;

  // Dropdown / keyboard nav
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  selectedIndex: number;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;

  // Advanced filters
  filterRoot: string;
  setFilterRoot: (v: string) => void;
  filterLemma: string;
  setFilterLemma: (v: string) => void;
  filterPos: PartOfSpeech | "";
  setFilterPos: (v: PartOfSpeech | "") => void;
  filterAyah: string;
  setFilterAyah: (v: string) => void;
  filtersExpanded: boolean;
  setFiltersExpanded: (v: boolean) => void;
  hasActiveFilters: boolean;

  // Results
  results: SearchResultItem[];
  groupedResults: ReturnType<typeof groupSearchResults>;
  queryIntent: QueryIntent;

  // Refs (for wiring keyboard‑scroll + focus on the presentation side)
  inputRef: React.RefObject<HTMLInputElement | null>;
  resultsRef: React.RefObject<HTMLDivElement | null>;

  // Actions
  selectResult: (result: SearchResultItem) => {
    tokenId: string | undefined;
    matchType: SearchMatchType;
    matchedRoot: string | undefined;
    result: SearchResultItem;
  } | null;
  handleKeyDown: (event: React.KeyboardEvent) => void;
  clearAll: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSearch({
  tokens,
  analyticsSurface = "unknown",
  initialFiltersExpanded = false,
}: UseSearchOptions): UseSearchReturn {
  // ---- state ----
  const [query, setQuery] = useState("");
  const _debouncedQuery = useDebounce(query, 200);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filtersExpanded, setFiltersExpanded] = useState(initialFiltersExpanded);
  const [filterRoot, setFilterRoot] = useState("");
  const [filterLemma, setFilterLemma] = useState("");
  const [filterPos, setFilterPos] = useState<PartOfSpeech | "">("");
  const [filterAyah, setFilterAyah] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const mountedAtRef = useRef<number>(performance.now());
  const hasTrackedInteractionRef = useRef(false);

  // ---- effective query ----
  const effectiveQuery = useMemo(() => {
    const parts: string[] = [];
    if (query.trim()) parts.push(query.trim());
    if (filterRoot.trim()) parts.push(`root:${filterRoot.trim()}`);
    if (filterLemma.trim()) parts.push(`lemma:${filterLemma.trim()}`);
    if (filterPos) parts.push(`pos:${filterPos}`);
    if (filterAyah.trim()) parts.push(`ayah:${filterAyah.trim()}`);
    return parts.join(" ");
  }, [query, filterRoot, filterLemma, filterPos, filterAyah]);

  const debouncedEffectiveQuery = useDebounce(effectiveQuery, 200);

  // ---- intent ----
  const queryIntent = useMemo(() => detectQueryIntent(query), [query]);

  // ---- concept-expansion lane (Claude → corpus terms → BM25F, fused via RRF) ----
  // Reads user preference from localStorage (toggle in DisplaySettingsPanel).
  const [conceptTerms, setConceptTerms] = useState<string[]>([]);
  const conceptAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let enabled = true;
    try {
      const stored =
        localStorage.getItem("qcv-concept-search-enabled") ??
        localStorage.getItem("qcv-semantic-search-enabled");
      enabled = stored === null ? true : JSON.parse(stored);
    } catch {
      // Ignore storage read failures and keep concept search enabled by default.
    }

    // Only expand natural-language (English gloss) queries; lexical and
    // structured queries are already well served by the BM25F + exact lanes.
    const trimmed = _debouncedQuery.trim();
    if (!enabled || trimmed.length < 3 || detectQueryIntent(trimmed) !== "english-gloss") {
      setConceptTerms([]);
      return;
    }

    conceptAbortRef.current?.abort();
    const controller = new AbortController();
    conceptAbortRef.current = controller;

    fetchConceptExpansion(trimmed, controller.signal).then((expansion) => {
      if (!controller.signal.aborted) setConceptTerms(expansion.terms);
    });

    return () => controller.abort();
  }, [_debouncedQuery]);

  // ---- search (structured exact + BM25F lexical lane, fused with concept lane) ----
  const hasActiveFilters = !!(filterRoot || filterLemma || filterPos || filterAyah);
  // The catalog is built on demand — searchCorpus ignores queries under two
  // characters, so nothing needs it until then — and shared across surfaces.
  const wantsCatalog = debouncedEffectiveQuery.trim().length >= 2;
  const catalog = useMemo(() => (wantsCatalog ? getSearchCatalog(tokens) : null), [wantsCatalog, tokens]);
  const results = useMemo<SearchResultItem[]>(
    () => (catalog ? searchCorpus(tokens, catalog, debouncedEffectiveQuery, conceptTerms) : []),
    [catalog, debouncedEffectiveQuery, conceptTerms, tokens],
  );

  // Warm it while the page is idle once the whole corpus is in, so the first
  // query doesn't pay for the build. Streaming batches never trigger this.
  useEffect(() => {
    if (tokens.length < FULL_CORPUS_TOKEN_FLOOR || hasSearchCatalog(tokens)) return;
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1));
    const cancelIdle = window.cancelIdleCallback ?? window.clearTimeout;
    let idleId = 0;
    const timer = window.setTimeout(() => {
      idleId = idle(() => getSearchCatalog(tokens), { timeout: 10_000 }) as number;
    }, WARM_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      if (idleId) cancelIdle(idleId);
    };
  }, [tokens]);
  const groupedResults = useMemo(() => groupSearchResults(results), [results]);

  // ---- result selection (pure — returns payload, consumer fires callbacks) ----
  const selectResult = useCallback(
    (result: SearchResultItem) => {
      const tokenId = result.location?.tokenId;
      if (!tokenId) return null;
      setIsOpen(false);
      return {
        tokenId,
        matchType: result.kind as SearchMatchType,
        matchedRoot: result.matchedRoot,
        result,
      };
    },
    [],
  );

  // ---- keyboard navigation (ArrowUp / ArrowDown / Escape only) ----
  // Enter is intentionally NOT handled here — the presentation component
  // wires Enter → selectResult → consumer callbacks (see CommandBar).
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (event.key === "Escape") {
        setIsOpen(false);
        inputRef.current?.blur();
      }
    },
    [results.length],
  );

  // ---- clearAll ----
  const clearAll = useCallback(() => {
    setQuery("");
    setFilterRoot("");
    setFilterLemma("");
    setFilterPos("");
    setFilterAyah("");
    inputRef.current?.focus();
  }, []);

  // ---- effects: reset selected index when results change ----
  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  // ---- effects: scroll selected result into view ----
  useEffect(() => {
    if (!resultsRef.current || results.length === 0) return;
    const el = resultsRef.current.querySelector<HTMLElement>(`#search-result-${selectedIndex}`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, results.length]);

  // ---- effects: first‑interaction analytics ----
  useEffect(() => {
    if (!debouncedEffectiveQuery.trim() || debouncedEffectiveQuery.trim().length < 2) return;
    if (!hasTrackedInteractionRef.current) {
      trackPerformanceMetric(
        "first_search_interaction",
        analyticsSurface,
        Math.round(performance.now() - mountedAtRef.current),
        { query_length: debouncedEffectiveQuery.trim().length },
      );
      hasTrackedInteractionRef.current = true;
    }
  }, [analyticsSurface, debouncedEffectiveQuery]);

  return {
    query,
    setQuery,
    effectiveQuery,
    isOpen,
    setIsOpen,
    selectedIndex,
    setSelectedIndex,
    filterRoot,
    setFilterRoot,
    filterLemma,
    setFilterLemma,
    filterPos,
    setFilterPos,
    filterAyah,
    setFilterAyah,
    filtersExpanded,
    setFiltersExpanded,
    hasActiveFilters,
    results,
    groupedResults,
    queryIntent,
    inputRef,
    resultsRef,
    selectResult,
    handleKeyDown,
    clearAll,
  };
}
