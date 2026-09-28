import type { CorpusToken } from "@/lib/schema/types";
import { buildPhaseOneIndexes, queryPhaseOne } from "@/lib/search/indexes";
import { parseSearchQuery } from "@/lib/search/queryParser";
import type { SearchResultItem, SearchResultKind } from "@/lib/search/searchTypes";
import { SURAH_NAMES } from "@/lib/data/surahData";
import { queryBm25 } from "@/lib/search/bm25";
import { rrfMerge } from "@/lib/search/rrf";
import {
  buildSearchIndexes,
  type SearchDocMeta,
  type SearchIndexes,
} from "@/lib/search/searchDocuments";

// ============================================================================
// Query Intent Detection — classifies free-text input so the UI can route
// searches automatically without requiring structured syntax from the user.
// ============================================================================

export type QueryIntent =
  | "ayah-ref"         // e.g. "2:255" or "3:7"
  | "arabic-root"      // Short Arabic (2-4 chars, no diacritics) → likely a root
  | "arabic-text"      // Longer Arabic or Arabic with diacritics → token/verse text
  | "english-gloss"    // Latin characters → search English glosses
  | "structured"       // Contains field:value syntax
  | "empty";

const ARABIC_RANGE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const ARABIC_DIACRITICS = /[ً-ٰٟ]/;
const AYAH_REF_PATTERN = /^\d{1,3}:\d{1,3}$/;
const STRUCTURED_PATTERN = /\b(?:root|r|lemma|l|pos|p|ayah|a|text|t|gloss|g):/i;

const CONCEPT_DISCLAIMER = "AI-suggested match — verify against established tafsir.";

const RESULT_LIMIT = 24;

export function detectQueryIntent(query: string): QueryIntent {
  const trimmed = query.trim();
  if (!trimmed) return "empty";
  if (STRUCTURED_PATTERN.test(trimmed)) return "structured";
  if (AYAH_REF_PATTERN.test(trimmed)) return "ayah-ref";
  if (ARABIC_RANGE.test(trimmed)) {
    const stripped = trimmed.replace(/[\sً-ٰٟ]/g, "");
    if (stripped.length <= 4 && !ARABIC_DIACRITICS.test(trimmed)) return "arabic-root";
    return "arabic-text";
  }
  return "english-gloss";
}

export interface SearchCatalog {
  byId: Map<string, CorpusToken>;
  byRoot: Map<string, CorpusToken[]>;
  byLemma: Map<string, CorpusToken[]>;
  phaseOne: ReturnType<typeof buildPhaseOneIndexes>;
  indexes: SearchIndexes;
}

function pushBucket(map: Map<string, CorpusToken[]>, key: string, token: CorpusToken) {
  const bucket = map.get(key);
  if (bucket) {
    bucket.push(token);
    return;
  }
  map.set(key, [token]);
}

/**
 * One catalog per token array, shared by every search surface. The shell mounts
 * several (the top bar and two drawer tabs), and each used to build its own
 * copy in a render — three full index builds on the main thread every time the
 * corpus landed, which was most of a phone's page load.
 */
const catalogs = new WeakMap<CorpusToken[], SearchCatalog>();

export function getSearchCatalog(tokens: CorpusToken[]): SearchCatalog {
  let catalog = catalogs.get(tokens);
  if (!catalog) {
    catalog = buildSearchCatalog(tokens);
    catalogs.set(tokens, catalog);
  }
  return catalog;
}

export function hasSearchCatalog(tokens: CorpusToken[]): boolean {
  return catalogs.has(tokens);
}

export function buildSearchCatalog(tokens: CorpusToken[]): SearchCatalog {
  const byId = new Map<string, CorpusToken>();
  const byRoot = new Map<string, CorpusToken[]>();
  const byLemma = new Map<string, CorpusToken[]>();

  for (const token of tokens) {
    byId.set(token.id, token);
    if (token.root) pushBucket(byRoot, token.root, token);
    if (token.lemma) pushBucket(byLemma, token.lemma, token);
  }

  return {
    byId,
    byRoot,
    byLemma,
    phaseOne: buildPhaseOneIndexes(tokens),
    indexes: buildSearchIndexes(tokens),
  };
}

// ---------------------------------------------------------------------------
// Result construction — every ranked entity (root / lemma / ayah / surah) maps
// to a SearchResultItem whose actionTarget routes the user to the right viz.
// ---------------------------------------------------------------------------

function metaToResult(
  meta: SearchDocMeta,
  byId: Map<string, CorpusToken>,
  overrideKind?: SearchResultKind,
): SearchResultItem {
  const token = meta.tokenId ? byId.get(meta.tokenId) : undefined;
  const semantic = overrideKind === "semantic";
  const explanation = semantic ? CONCEPT_DISCLAIMER : undefined;

  switch (meta.kind) {
    case "root":
      return {
        id: `root:${meta.root}`,
        kind: overrideKind ?? "root",
        title: meta.root,
        subtitle: meta.gloss ? `Root: ${meta.root} · ${meta.gloss}` : `Root: ${meta.root} (${meta.count})`,
        arabicText: meta.root,
        location: { surah: meta.sura, ayah: meta.ayah, tokenId: meta.tokenId },
        explanation: explanation ?? (meta.gloss || "Matched root family"),
        matchedRoot: meta.root,
        matchedLemma: meta.lemma || undefined,
        actionTarget: {
          routeMode: "explore",
          visualizationMode: "root-network",
          selection: { surahId: meta.sura, ayah: meta.ayah, root: meta.root, lemma: meta.lemma || undefined, tokenId: meta.tokenId },
        },
      };
    case "lemma":
      return {
        id: `lemma:${meta.lemma}`,
        kind: overrideKind ?? "lemma",
        title: meta.lemma,
        subtitle: meta.gloss
          ? `Lemma: ${meta.lemma} · ${meta.gloss} (${meta.count})`
          : `Lemma: ${meta.lemma} (${meta.count})`,
        arabicText: meta.lemma,
        location: { surah: meta.sura, ayah: meta.ayah, tokenId: meta.tokenId },
        explanation: explanation ?? "Matched lemma and lexical form",
        matchedRoot: meta.root || undefined,
        matchedLemma: meta.lemma,
        actionTarget: {
          routeMode: "explore",
          visualizationMode: "radial-sura",
          selection: { surahId: meta.sura, ayah: meta.ayah, root: meta.root || undefined, lemma: meta.lemma, tokenId: meta.tokenId },
        },
      };
    case "ayah":
      return {
        id: `ayah:${meta.sura}:${meta.ayah}`,
        kind: overrideKind ?? "ayah",
        title: `${meta.sura}:${meta.ayah}`,
        subtitle: SURAH_NAMES[meta.sura] ? `${SURAH_NAMES[meta.sura].name} ${meta.sura}:${meta.ayah}` : `${meta.sura}:${meta.ayah}`,
        arabicText: token?.text,
        location: { surah: meta.sura, ayah: meta.ayah, tokenId: meta.tokenId },
        explanation: explanation ?? "Matched verse text",
        matchedText: token?.text,
        actionTarget: {
          routeMode: "explore",
          visualizationMode: "dependency-tree",
          selection: { surahId: meta.sura, ayah: meta.ayah, tokenId: meta.tokenId },
        },
      };
    case "surah": {
      const surah = SURAH_NAMES[meta.sura];
      return {
        id: `surah:${meta.sura}`,
        kind: overrideKind ?? "surah",
        title: surah ? `${surah.name} — ${surah.meaning}` : `Surah ${meta.sura}`,
        subtitle: surah ? `Surah ${meta.sura} · ${surah.verses} verses` : `Surah ${meta.sura}`,
        arabicText: surah?.arabic,
        location: { surah: meta.sura, ayah: 1, tokenId: meta.tokenId },
        explanation: explanation ?? (surah ? `Surah ${meta.sura}: ${surah.name} (${surah.meaning})` : undefined),
        actionTarget: {
          routeMode: "explore",
          visualizationMode: "radial-sura",
          selection: { surahId: meta.sura, ayah: 1 },
        },
      };
    }
  }
}

function structuredItem(
  token: CorpusToken,
  kind: SearchResultKind,
  subtitle: string,
  explanation: string,
): SearchResultItem {
  return {
    id: `${kind}:${token.id}`,
    kind,
    title: token.text,
    subtitle,
    arabicText: token.text,
    location: { surah: token.sura, ayah: token.ayah, tokenId: token.id },
    explanation,
    matchedRoot: token.root || undefined,
    matchedLemma: token.lemma || undefined,
    matchedText: token.text,
    actionTarget: {
      routeMode: "explore",
      visualizationMode: kind === "ayah" ? "dependency-tree" : "radial-sura",
      selection: {
        surahId: token.sura,
        ayah: token.ayah,
        root: token.root || undefined,
        lemma: token.lemma || undefined,
        tokenId: token.id,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Lexical lane — BM25F over each entity index, fused with RRF so the four
// rankings combine without score-scale calibration. Roots are weighted highest
// (the primary navigational entity), then ayahs, lemmas, surahs.
// ---------------------------------------------------------------------------

const LANE_LIMIT = 40;

function laneIds(indexes: SearchIndexes, query: string | string[]): {
  root: string[];
  ayah: string[];
  lemma: string[];
  surah: string[];
} {
  return {
    root: queryBm25(indexes.root, query, { limit: LANE_LIMIT }).map((h) => h.id),
    ayah: queryBm25(indexes.ayah, query, { limit: LANE_LIMIT }).map((h) => h.id),
    lemma: queryBm25(indexes.lemma, query, { limit: LANE_LIMIT }).map((h) => h.id),
    surah: queryBm25(indexes.surah, query, { limit: LANE_LIMIT }).map((h) => h.id),
  };
}

function runLexicalLane(indexes: SearchIndexes, freeText: string): string[] {
  const ids = laneIds(indexes, freeText);
  return rrfMerge(
    [
      { ids: ids.root, weight: 1 },
      { ids: ids.ayah, weight: 0.9 },
      { ids: ids.lemma, weight: 0.7 },
      { ids: ids.surah, weight: 0.6 },
    ],
    { limit: LANE_LIMIT },
  ).map((r) => r.id);
}

function runConceptLane(indexes: SearchIndexes, terms: string[]): string[] {
  if (terms.length === 0) return [];
  const root = queryBm25(indexes.root, terms, { limit: LANE_LIMIT }).map((h) => h.id);
  const ayah = queryBm25(indexes.ayah, terms, { limit: LANE_LIMIT }).map((h) => h.id);
  return rrfMerge(
    [
      { ids: root, weight: 1 },
      { ids: ayah, weight: 0.8 },
    ],
    { limit: LANE_LIMIT },
  ).map((r) => r.id);
}

/**
 * Rank corpus entities for a query.
 *
 * Structured filters (root:/lemma:/pos:/ayah:) and exact ayah references are
 * pinned on top via the exact inverted index. Free text is ranked by BM25F
 * (lexical lane) optionally fused with concept-expansion terms supplied by the
 * Claude-backed concept route (concept lane). The two lanes combine via RRF;
 * concept-only hits are tagged "semantic" so the UI shows the AI badge.
 */
export function searchCorpus(
  tokens: CorpusToken[],
  catalog: SearchCatalog,
  rawQuery: string,
  conceptTerms: string[] = [],
): SearchResultItem[] {
  const query = rawQuery.trim();
  if (query.length < 2) return [];

  const parsed = parseSearchQuery(query);
  const freeText = (parsed.freeText || parsed.raw).trim();

  const results: SearchResultItem[] = [];
  const seen = new Set<string>();
  const push = (item: SearchResultItem) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    results.push(item);
  };

  // ── Structured exact lane (pinned on top) ──
  if (parsed.root || parsed.lemma || parsed.pos || parsed.ayah) {
    const ids = queryPhaseOne(catalog.phaseOne, {
      root: parsed.root,
      lemma: parsed.lemma,
      pos: parsed.pos,
      ayah: parsed.ayah,
    });
    for (const id of ids) {
      const token = catalog.byId.get(id);
      if (!token) continue;
      const kind: SearchResultKind = parsed.ayah ? "ayah" : parsed.root ? "root" : parsed.lemma ? "lemma" : "token";
      push(
        structuredItem(
          token,
          kind,
          parsed.ayah ? `${token.sura}:${token.ayah}` : token.morphology?.gloss ?? token.lemma,
          parsed.ayah ? "Matched exact ayah reference" : parsed.root ? "Matched root family" : parsed.lemma ? "Matched lemma" : "Matched structured search",
        ),
      );
    }
  }

  if (!freeText) return results.slice(0, RESULT_LIMIT);

  // ── Exact ayah reference (e.g. "2:255") ──
  if (AYAH_REF_PATTERN.test(freeText)) {
    const ayahMeta = catalog.indexes.metaById.get(`ayah:${freeText}`);
    if (ayahMeta) push(metaToResult(ayahMeta, catalog.byId));
  }

  // ── Lexical + concept lanes, fused with RRF ──
  const lexicalIds = runLexicalLane(catalog.indexes, freeText);
  const conceptIds = runConceptLane(catalog.indexes, conceptTerms);
  const lexicalSet = new Set(lexicalIds);

  const fused = rrfMerge(
    [
      { ids: lexicalIds, weight: 1 },
      { ids: conceptIds, weight: 0.8 },
    ],
    { limit: RESULT_LIMIT * 2 },
  );

  for (const { id } of fused) {
    const meta = catalog.indexes.metaById.get(id);
    if (!meta) continue;
    const conceptOnly = !lexicalSet.has(id);
    push(metaToResult(meta, catalog.byId, conceptOnly ? "semantic" : undefined));
    if (results.length >= RESULT_LIMIT) break;
  }

  return results.slice(0, RESULT_LIMIT);
}

export function groupSearchResults(results: SearchResultItem[]): Array<{
  kind: SearchResultKind;
  items: SearchResultItem[];
}> {
  const grouped = new Map<SearchResultKind, SearchResultItem[]>();
  for (const result of results) {
    const bucket = grouped.get(result.kind);
    if (bucket) {
      bucket.push(result);
      continue;
    }
    grouped.set(result.kind, [result]);
  }

  return [...grouped.entries()].map(([kind, items]) => ({ kind, items }));
}
