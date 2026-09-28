/**
 * Corpus Loader - Progressive loading and caching of Quran corpus data
 * Handles loading from API, merging with morphology data, and caching
 */

import { quranApi, type QuranWord } from '@/lib/api/quranApi';
import { createClient } from '@/lib/supabase/client';

import {
    corpusCache,
    CORPUS_METADATA_KEY,
    PARTIAL_CORPUS_METADATA_KEY,
    type CacheMetadata,
} from '@/lib/cache/corpusCache';
import { FULL_CORPUS_TOKEN_FLOOR } from '@/lib/corpus/corpusExpectations';
import { SAMPLE_MORPHOLOGY_DATA } from '@/lib/corpus/morphologyData';
import { loadMorphologyMap, type MorphologyEntry, buildSampleMorphologyMap } from '@/lib/corpus/morphologyLoader';
import { ROOT_GLOSSES } from '@/lib/data/rootGlosses';
import type { CorpusToken, PartOfSpeech, AyahRecord } from '@/lib/schema/types';

export interface LoadingProgress {
    currentSura: number;
    totalSuras: number;
    currentTokens: number;
    totalTokens: number;
    status: 'idle' | 'loading' | 'caching' | 'complete' | 'error';
    message: string;
}

export type ProgressCallback = (progress: LoadingProgress) => void;

export interface CorpusBatchMeta {
    /** Surah IDs fully represented in `tokensSoFar`, ascending, cumulative since this load started. */
    completedSurahs: number[];
    /** True on the final call — its token array is the complete, final result (same array `loadFullCorpus` itself resolves with). */
    done: boolean;
}

/**
 * Progressive-reveal hook for `loadFullCorpus`: fires as WHOLE surahs finish
 * loading (never mid-surah), roughly every `BATCH_SURAH_SIZE` surahs, so a
 * caller can render a streaming corpus instead of waiting for the entire
 * load. Purely additive — callers that omit it see identical behavior to
 * before batching existed.
 */
export type BatchCallback = (tokensSoFar: CorpusToken[], meta: CorpusBatchMeta) => void;

const sampleMorphologyMap = buildSampleMorphologyMap(SAMPLE_MORPHOLOGY_DATA);
const TOKEN_ID_PATTERN = /^(\d+):(\d+):(\d+)$/;
const MORPHOLOGY_CACHE_VERSION = "qac-0.4.3-enrich-all-surahs";
let cachePolicyInFlight: Promise<void> | null = null;

// ~12 emissions across the 114-surah corpus — enough for a visibly
// sequential reveal without re-deriving downstream layouts (cluster
// hierarchies, force sims) so often that it thrashes them.
const BATCH_SURAH_SIZE = 10;

/**
 * Tracks whole-surah completion for the `onBatch` progressive-reveal
 * callback. Callers report each surah exactly once, in ascending order, via
 * `completeSurah`, passing the running token array (already containing that
 * surah's tokens) — this only DECIDES when to emit; it copies the array
 * solely at the moment it actually fires, so tracking a load with no
 * `onBatch` listener costs nothing extra.
 */
class SurahBatchTracker {
    private completedSurahs: number[] = [];
    private pendingSinceEmit = 0;

    constructor(private readonly onBatch: BatchCallback | undefined) { }

    completeSurah(suraId: number, tokensSoFar: CorpusToken[]): void {
        this.completedSurahs.push(suraId);
        this.pendingSinceEmit++;
        if (this.onBatch && this.pendingSinceEmit >= BATCH_SURAH_SIZE) {
            this.onBatch(tokensSoFar.slice(), { completedSurahs: [...this.completedSurahs], done: false });
            this.pendingSinceEmit = 0;
        }
    }

    /** Always fires (even with nothing new since the last batch) so a listener reliably observes `done: true`. */
    finish(tokensSoFar: CorpusToken[]): void {
        this.onBatch?.(tokensSoFar, { completedSurahs: [...this.completedSurahs], done: true });
    }
}

/** True when this metadata record proves the cached tokens carry current morphology. */
function metadataHasCurrentMorphology(metadata: CacheMetadata | null): boolean {
    return Boolean(metadata?.hasMorphology) && metadata?.morphologyVersion === MORPHOLOGY_CACHE_VERSION;
}

/**
 * The cache is invalidated by VERSION only — `CORPUS_CACHE_POLICY_VERSION` and
 * `MORPHOLOGY_CACHE_VERSION` — never by age. The corpus is a fixed text, so a
 * visitor downloads it once and keeps it until the data or its shape changes,
 * or they clear site data. (It used to expire after seven days, which made
 * every returning phone re-download ~77k tokens in 79 requests.)
 */
async function ensureQuranComCachePolicy(): Promise<void> {
    if (!cachePolicyInFlight) {
        cachePolicyInFlight = (async () => {
            await corpusCache.ensureCachePolicyVersion();
        })().catch((error) => {
            cachePolicyInFlight = null;
            throw error;
        }).finally(() => {
            cachePolicyInFlight = null;
        });
    }

    await cachePolicyInFlight;
}

function buildMorphologyFallbackBySura(
    morphologyMap: Map<string, MorphologyEntry>
): Map<number, CorpusToken[]> {
    const bySura = new Map<number, CorpusToken[]>();

    for (const [tokenId, entry] of morphologyMap.entries()) {
        const match = tokenId.match(TOKEN_ID_PATTERN);
        if (!match) continue;

        const sura = Number(match[1]);
        const ayah = Number(match[2]);
        const position = Number(match[3]);
        const fallbackText = entry.stem || entry.lemma || entry.root || "-";

        if (!bySura.has(sura)) bySura.set(sura, []);
        bySura.get(sura)!.push({
            id: tokenId,
            sura,
            ayah,
            position,
            text: fallbackText,
            root: entry.root || "",
            lemma: entry.lemma || fallbackText,
            pos: (entry.pos ?? "N") as PartOfSpeech,
            morphology: {
                features: entry.features ?? {},
                gloss: null,
                stem: entry.stem ?? null,
            },
        });
    }

    for (const tokens of bySura.values()) {
        tokens.sort((a, b) => a.ayah - b.ayah || a.position - b.position);
    }

    return bySura;
}

/**
 * Convert Quran.com API word to CorpusToken format
 */
function wordToToken(
    sura: number,
    ayah: number,
    word: QuranWord,
    position: number,
    morphologyMap: Map<string, MorphologyEntry> | null
): CorpusToken {
    const tokenId = `${sura}:${ayah}:${position}`;

    // Try to get morphology from bundled data
    const morphData = morphologyMap?.get(tokenId) ?? sampleMorphologyMap.get(tokenId);

    const root = morphData?.root ?? '';

    // Gloss fallback chain:
    // 1. Quran.com API word translation (best — word-level English)
    // 2. Root-level fallback from static glossary (general root meaning)
    const gloss =
        word.translation?.text
        ?? (root ? ROOT_GLOSSES.get(root) ?? null : null);

    return {
        id: tokenId,
        sura,
        ayah,
        position,
        text: word.text,
        root,
        lemma: morphData?.lemma ?? word.text,
        pos: (morphData?.pos ?? 'N') as PartOfSpeech,
        morphology: {
            features: morphData?.features ?? {},
            gloss,
            stem: morphData?.stem ?? null,
        },
    };
}

/**
 * Enrich tokens with the authoritative QAC morphology file so EVERY surah has
 * root / lemma / pos — not just the ones whose source happened to carry roots.
 * Supabase corpora frequently ship roots for only some surahs; without this,
 * only the bundled sample (Al-Fatihah) renders POS-coloured bars + root
 * arcs/circles. Tokens that already have a root are left untouched; tokens
 * missing one are filled by `sura:ayah:position` lookup against the QAC map.
 */
async function enrichTokensWithMorphology(
    tokens: CorpusToken[],
    onProgress?: ProgressCallback
): Promise<CorpusToken[]> {
    const missing = tokens.reduce((n, t) => (t.root?.trim() ? n : n + 1), 0);
    // Already well-rooted (e.g. a complete corpus) — nothing to do.
    if (missing <= tokens.length * 0.02) return tokens;

    let map: Map<string, MorphologyEntry>;
    try {
        onProgress?.({ currentSura: 114, totalSuras: 114, currentTokens: tokens.length, totalTokens: tokens.length, status: 'loading', message: 'Adding root & morphology data…' });
        map = await loadMorphologyMap();
    } catch (err) {
        console.warn('[CorpusLoader] Morphology enrichment skipped (load failed):', err);
        return tokens;
    }

    let filled = 0;
    let relemmad = 0;
    const enriched = tokens.map((t) => {
        if (t.root?.trim()) return t;
        const m = map.get(`${t.sura}:${t.ayah}:${t.position}`);
        if (!m) return t;
        if (!m.root) {
            // Root-less word (proper noun / particle): no root to fill, but the
            // source (Supabase) derives a word's lemma from its FIRST segment,
            // so a leading proclitic (وَ / يٰ / بِ / ال — no LEM) steals a name's
            // lemma. The QAC map's content-lemma is authoritative — correcting
            // it keeps every occurrence (وَمُوسَىٰ, يٰمُوسَىٰ) counted under the name,
            // so /search and the inspector agree with the offline name-stats.
            if (m.lemma && m.lemma !== t.lemma) {
                relemmad++;
                return { ...t, lemma: m.lemma };
            }
            return t;
        }
        filled++;
        return {
            ...t,
            root: m.root,
            lemma: t.lemma && t.lemma !== t.text ? t.lemma : (m.lemma || t.lemma || t.text),
            pos: (m.pos ?? t.pos) as PartOfSpeech,
            morphology: {
                features: Object.keys(t.morphology.features ?? {}).length > 0 ? t.morphology.features : (m.features ?? {}),
                gloss: t.morphology.gloss ?? (ROOT_GLOSSES.get(m.root) ?? null),
                stem: t.morphology.stem ?? m.stem ?? null,
            },
        };
    });
    console.log(`[CorpusLoader] Morphology enrichment: filled ${filled.toLocaleString()} roots, corrected ${relemmad.toLocaleString()} root-less lemmas from QAC`);
    return enriched;
}

// ── In-memory singleton — avoids re-reading IDB on SPA navigation ────────────
// _memoryTokens: populated after first successful load; returned immediately on
//                subsequent calls within the same browser session.
// _activeLoad:   deduplicates concurrent calls (e.g. StrictMode double-mount).
let _memoryTokens: CorpusToken[] | null = null;
let _activeLoad: Promise<CorpusToken[]> | null = null;

/**
 * Write a freshly fetched full corpus to IndexedDB without holding the view
 * back until the write commits. The transaction is ISSUED at once, though, not
 * in idle time or in chunks: a reload lets an issued transaction finish, but
 * drops a write that hasn't started — measured, deferring it by even ~1.5 s
 * (or chunking it) left no cache when the reader reloaded straight after a
 * first visit, so the corpus downloaded again. Issuing costs one main-thread
 * pass over the tokens, once per device. The metadata that vouches for the
 * cache is written only after the tokens are stored, so a tab closed mid-write
 * leaves an unvouched cache that the next visit ignores and refetches, never a
 * partial one it trusts.
 */
function persistFullCorpus(tokens: CorpusToken[]): void {
    void (async () => {
        try {
            await corpusCache.storeTokens(tokens);
            await corpusCache.setMetadata(CORPUS_METADATA_KEY, {
                tokenCount: tokens.length,
                hasMorphology: true,
                morphologyVersion: MORPHOLOGY_CACHE_VERSION,
            });
        } catch (err) {
            console.warn('[CorpusLoader] Caching the corpus failed; the next visit will fetch it again.', err);
        }
    })();
}

// ── Supabase-backed corpus loader ─────────────────────────────────────────────

const SUPABASE_PAGE_SIZE = 1000; // rows per query
const SUPABASE_CONCURRENCY = 6; // pages in flight at once

/**
 * Fetch all corpus tokens from Supabase `corpus_tokens` table.
 * Returns null if the table is empty or the query fails (caller should fall back).
 */
async function loadCorpusFromSupabase(
    onProgress?: ProgressCallback,
    onBatch?: BatchCallback
): Promise<CorpusToken[] | null> {
    try {
        const supabase = createClient();

        // Quick count to determine if data exists
        const { count, error: countError } = await supabase
            .from('corpus_tokens')
            .select('*', { count: 'exact', head: true });

        if (countError || !count || count === 0) {
            console.log('[CorpusLoader] Supabase corpus_tokens is empty, falling back to API.');
            return null;
        }

        // A partially-seeded table is not a full corpus — fall through to the
        // next source rather than caching a partial set as "the corpus".
        if (count < FULL_CORPUS_TOKEN_FLOOR) {
            console.warn(`[CorpusLoader] Supabase corpus_tokens has only ${count.toLocaleString()} rows (< ${FULL_CORPUS_TOKEN_FLOOR.toLocaleString()} floor); not a full corpus, falling back.`);
            return null;
        }

        console.log(`[CorpusLoader] Loading ${count.toLocaleString()} tokens from Supabase…`);
        onProgress?.({ currentSura: 0, totalSuras: 114, currentTokens: 0, totalTokens: count, status: 'loading', message: `Loading ${count.toLocaleString()} tokens from Supabase…` });

        const allTokens: CorpusToken[] = [];
        let from = 0;
        // Rows arrive globally ordered by (sura, ayah, position) across pages,
        // so every surah strictly below the highest one seen so far is
        // guaranteed fully read — the highest one might still have rows in
        // the next page, unless this was the final page. That's enough to
        // batch by whole surahs without any extra grouping query. The page
        // boundary itself rarely lines up with a surah boundary, though, so
        // `allTokens` can carry a trailing PARTIAL surah's rows past
        // `highestCompletedSura` — `completeIndex` tracks how far into
        // `allTokens` is safe to hand out, advancing (never rescanning) as
        // more surahs are confirmed complete, so every emitted snapshot ends
        // exactly at a surah boundary.
        const batchTracker = new SurahBatchTracker(onBatch);
        let highestCompletedSura = 0;
        let completeIndex = 0;

        // Pages are fetched SUPABASE_CONCURRENCY at a time but consumed strictly
        // in order, so everything below still sees rows ascending by (sura,
        // ayah, position). One page after another took ~47 s on a phone-class
        // CPU for the 79 pages of a full corpus; latency, not bandwidth, was
        // the cost.
        const fetchPage = (start: number) =>
            supabase
                .from('corpus_tokens')
                .select('id, sura, ayah, position, text, root, lemma, pos, morphology')
                .order('sura')
                .order('ayah')
                .order('position')
                .range(start, start + SUPABASE_PAGE_SIZE - 1);
        const pageStarts: number[] = [];
        for (let start = 0; start < count; start += SUPABASE_PAGE_SIZE) pageStarts.push(start);
        type Page = Awaited<ReturnType<typeof fetchPage>>;
        const inFlight = new Map<number, Promise<Page>>();
        let nextPage = 0;
        const fillWindow = () => {
            while (nextPage < pageStarts.length && inFlight.size < SUPABASE_CONCURRENCY) {
                // The query builder is lazy — it sends nothing until awaited —
                // so wrap it to start the request now. The no-op catch keeps a
                // page left in flight by an early exit from surfacing as an
                // unhandled rejection; the await below still sees the error.
                const request = Promise.resolve(fetchPage(pageStarts[nextPage]));
                request.catch(() => {});
                inFlight.set(nextPage, request);
                nextPage++;
            }
        };
        fillWindow();

        for (let page = 0; page < pageStarts.length; page++) {
            const { data, error } = await inFlight.get(page)!;
            inFlight.delete(page);
            fillWindow();

            if (error) throw error;
            if (!data || data.length === 0) break;

            for (const row of data) {
                const morph = row.morphology as { features?: Record<string, string>; stem?: string | null; gloss?: string | null } | null;
                allTokens.push({
                    id:       row.id,
                    sura:     row.sura,
                    ayah:     row.ayah,
                    position: row.position,
                    text:     row.text,
                    root:     row.root   ?? '',
                    lemma:    row.lemma  ?? row.text,
                    pos:      (row.pos   ?? 'N') as PartOfSpeech,
                    morphology: {
                        features: morph?.features ?? {},
                        gloss:    morph?.gloss    ?? null,
                        stem:     morph?.stem     ?? null,
                    },
                });
            }

            from += data.length;
            onProgress?.({ currentSura: allTokens[allTokens.length - 1]?.sura ?? 0, totalSuras: 114, currentTokens: allTokens.length, totalTokens: count, status: 'loading', message: `Loaded ${allTokens.length.toLocaleString()} / ${count.toLocaleString()} tokens from Supabase…` });

            const isFinalPage = page === pageStarts.length - 1 || from >= count;
            const highestSuraSeen = allTokens[allTokens.length - 1]?.sura ?? highestCompletedSura;
            const completeThrough = isFinalPage ? highestSuraSeen : highestSuraSeen - 1;
            if (completeThrough > highestCompletedSura) {
                while (completeIndex < allTokens.length && allTokens[completeIndex].sura <= completeThrough) {
                    completeIndex++;
                }
                const completeSnapshot = allTokens.slice(0, completeIndex);
                for (let suraId = highestCompletedSura + 1; suraId <= completeThrough; suraId++) {
                    batchTracker.completeSurah(suraId, completeSnapshot);
                }
                highestCompletedSura = completeThrough;
            }
        }

        batchTracker.finish(allTokens);

        console.log(`[CorpusLoader] Supabase: loaded ${allTokens.length.toLocaleString()} tokens`);
        return allTokens;
    } catch (err) {
        console.warn('[CorpusLoader] Supabase load failed:', err);
        return null;
    }
}


/**
 * Load full corpus progressively with caching.
 *
 * Load priority (fastest → slowest):
 *   1. In-memory singleton (same session, zero I/O)
 *   2. IndexedDB cache (local, sub-second)
 *   3. Supabase (remote; only on cold/stale cache)
 *   4. Quran.com API + bundled morphology file (fallback)
 *
 * Concurrent calls within the same session return the same in-flight promise,
 * so the corpus is never fetched more than once per page lifetime.
 *
 * `onBatch` (optional) fires as whole surahs finish loading — see
 * `BatchCallback`. The in-memory singleton and IndexedDB-cache hits below
 * resolve the full result near-instantly (sub-second, local-only I/O), so
 * there's nothing meaningful to progressively reveal there; `onBatch` only
 * fires more than once on the genuinely sequential Supabase/Quran.com paths
 * inside `_doLoadFullCorpus`. Either way, the promise always resolves with
 * the same final array a batch-unaware caller would have gotten before.
 */
export function loadFullCorpus(onProgress?: ProgressCallback, onBatch?: BatchCallback): Promise<CorpusToken[]> {
    // 1. In-memory hit — no I/O at all
    if (_memoryTokens) {
        onProgress?.({ currentSura: 114, totalSuras: 114, currentTokens: _memoryTokens.length, totalTokens: _memoryTokens.length, status: 'complete', message: `Loaded ${_memoryTokens.length.toLocaleString()} tokens (in-memory)` });
        return Promise.resolve(_memoryTokens);
    }
    // 2. Deduplicate concurrent calls
    if (_activeLoad) return _activeLoad;

    _activeLoad = _doLoadFullCorpus(onProgress, onBatch).then(tokens => {
        _memoryTokens = tokens;
        _activeLoad = null;
        return tokens;
    }, err => {
        _activeLoad = null;
        throw err;
    });
    return _activeLoad;
}

// ── Context-first per-surah loading ──────────────────────────────────────────
// The QAC morphology file carries every surah's root/lemma/pos, so once parsed
// we can build any surah instantly. This lets the CURRENTLY-OPEN surah render
// fully (POS-coloured bars, root arcs, circles) within one morphology fetch,
// instead of waiting for the whole corpus to stream from Supabase/API.
let _morphologyBySura: Map<number, CorpusToken[]> | null = null;
let _morphologyBySuraPromise: Promise<Map<number, CorpusToken[]>> | null = null;

export async function loadSurahContext(suraId: number): Promise<CorpusToken[]> {
    // If the full corpus is already loaded, slice it (most accurate text/gloss).
    if (_memoryTokens) return _memoryTokens.filter((t) => t.sura === suraId);

    if (!_morphologyBySura) {
        if (!_morphologyBySuraPromise) {
            _morphologyBySuraPromise = loadMorphologyMap()
                .then((map) => {
                    _morphologyBySura = buildMorphologyFallbackBySura(map);
                    return _morphologyBySura;
                })
                .catch((err) => {
                    _morphologyBySuraPromise = null;
                    throw err;
                });
        }
        try {
            await _morphologyBySuraPromise;
        } catch (err) {
            console.warn(`[CorpusLoader] loadSurahContext(${suraId}) morphology load failed:`, err);
            return [];
        }
    }
    return _morphologyBySura?.get(suraId) ?? [];
}

async function _doLoadFullCorpus(
    onProgress?: ProgressCallback,
    onBatch?: BatchCallback
): Promise<CorpusToken[]> {
    const progress: LoadingProgress = {
        currentSura: 0,
        totalSuras: 114,
        currentTokens: 0,
        totalTokens: 0,
        status: 'idle',
        message: 'Initializing...',
    };

    const notify = () => onProgress?.(progress);

    try {
        // ── 1. Check IndexedDB cache first (local, no network) ───────────────
        progress.status = 'loading';
        progress.message = 'Checking cache...';
        notify();

        await ensureQuranComCachePolicy();

        const cachedCount = await corpusCache.getTokenCount();
        // Only the full-corpus metadata key may vouch for the cache here; a
        // partial (per-surah) load writes PARTIAL_CORPUS_METADATA_KEY instead
        // and must never masquerade as a full corpus.
        const cacheMeta = await corpusCache.getMetadata(CORPUS_METADATA_KEY);
        const cacheHasMorphology = Boolean(cacheMeta?.hasMorphology);
        const cacheMorphologyMatches = cacheMeta?.morphologyVersion === MORPHOLOGY_CACHE_VERSION;

        if (cachedCount >= FULL_CORPUS_TOKEN_FLOOR && cacheHasMorphology && cacheMorphologyMatches) {
            console.log(`[CorpusLoader] Found ${cachedCount} cached tokens`);
            progress.message = `Loading ${cachedCount.toLocaleString()} cached tokens...`;
            notify();

            const tokens = await corpusCache.getAllTokens() as CorpusToken[];
            // Require >30% of tokens to have roots; a cache built without morphology fails this.
            const rootedCount = tokens.filter(t => t.root?.trim()).length;
            const hasRoots = rootedCount > tokens.length * 0.3;
            console.log(`[CorpusLoader] Cache root coverage: ${rootedCount}/${tokens.length} (${Math.round(rootedCount / tokens.length * 100)}%)`);

            if (hasRoots) {
                progress.status = 'complete';
                progress.totalTokens = tokens.length;
                progress.currentTokens = tokens.length;
                progress.message = `Loaded ${tokens.length.toLocaleString()} tokens from cache`;
                notify();
                console.log(`[CorpusLoader] Loaded ${tokens.length} tokens from cache`);
                return tokens;
            }

            console.warn('[CorpusLoader] Cache root coverage too low / morphology outdated. Rebuilding...');
            await corpusCache.clearCorpusData();
        }

        // ── 2. Try Supabase (only on cold/stale cache) ───────────────────────
        progress.status = 'loading';
        progress.message = 'Checking Supabase corpus…';
        notify();

        const supabaseTokens = await loadCorpusFromSupabase(onProgress, onBatch);
        if (supabaseTokens && supabaseTokens.length > 0) {
            // Fill any missing roots/morphology from the authoritative QAC file so
            // EVERY surah (not just Al-Fatihah) renders POS-coloured bars + arcs.
            const enrichedTokens = await enrichTokensWithMorphology(supabaseTokens, onProgress);
            // Cache in IndexedDB so future loads never hit the network.
            persistFullCorpus(enrichedTokens);
            progress.status = 'complete';
            progress.totalTokens = enrichedTokens.length;
            progress.currentTokens = enrichedTokens.length;
            progress.message = `Loaded ${enrichedTokens.length.toLocaleString()} tokens from Supabase`;
            notify();
            return enrichedTokens;
        }

        // ── 3. Load morphology map (required for Quran.com API path) ─────────
        let morphologyMap: Map<string, MorphologyEntry> | null = null;
        let morphologyFallbackBySura: Map<number, CorpusToken[]> | null = null;
        try {
            morphologyMap = await loadMorphologyMap();
            morphologyFallbackBySura = buildMorphologyFallbackBySura(morphologyMap);
            console.log(`[CorpusLoader] Morphology loaded: ${morphologyMap.size.toLocaleString()} entries`);
        } catch (err) {
            console.warn('[CorpusLoader] Failed to load morphology map, falling back to sample data.', err);
        }

        console.log('[CorpusLoader] No cache found, fetching from API...');

        // ── 4. Fetch from Quran.com API ───────────────────────────────────────
        progress.message = 'Fetching chapters...';
        notify();

        const chapters = await quranApi.getChapters();
        progress.totalSuras = chapters.length;

        const allTokens: CorpusToken[] = [];
        const allVerses: AyahRecord[] = [];
        // This loop already processes chapters strictly in ascending order
        // (Quran.com's `getChapters()` returns 1..N), one whole surah per
        // iteration — the natural place to report whole-surah batches.
        const batchTracker = new SurahBatchTracker(onBatch);

        for (let i = 0; i < chapters.length; i++) {
            const chapter = chapters[i];
            progress.currentSura = i + 1;
            progress.message = `Loading ${chapter.name_simple} (${i + 1}/${chapters.length})...`;
            notify();

            try {
                // Ensure we get verses with full text
                const verses = await quranApi.getAllVersesForChapter(chapter.id, { words: true });

                for (const verse of verses) {
                    // Create AyahRecord
                    if (verse.words) {
                        const ayahRecord: AyahRecord = {
                            id: verse.verse_key,
                            suraId: chapter.id,
                            ayahNumber: verse.verse_number,
                            textUthmani: verse.text_uthmani || verse.text_uthmani_simple || verse.text_imlaei || verse.text_imlaei_simple || verse.text_simple || "",
                            textSimple: verse.text_imlaei_simple || verse.text_imlaei || verse.text_simple || undefined,
                            tokenIds: []
                        };

                        const verseTokens: CorpusToken[] = [];
                        for (const word of verse.words) {
                            if (word.char_type_name !== 'word') continue;
                            const token = wordToToken(chapter.id, verse.verse_number, word, word.position, morphologyMap);
                            verseTokens.push(token);
                            ayahRecord.tokenIds.push(token.id);
                        }

                        allTokens.push(...verseTokens);
                        allVerses.push(ayahRecord);
                    }
                }

                progress.currentTokens = allTokens.length;
                console.log("[CorpusLoader] Loaded %o: %o verses, %o tokens", chapter.name_simple, verses.length, allTokens.length);
                notify();
            } catch (err) {
                console.warn(`[CorpusLoader] Failed to load surah ${chapter.id}:`, err);
                const fallbackTokens = morphologyFallbackBySura?.get(chapter.id) ?? [];
                if (fallbackTokens.length > 0) {
                    allTokens.push(...fallbackTokens);
                    progress.currentTokens = allTokens.length;
                    progress.message = `Using bundled morphology fallback for ${chapter.name_simple} (${i + 1}/${chapters.length})...`;
                    notify();
                    console.log(`[CorpusLoader] Fallback used for surah ${chapter.id}: ${fallbackTokens.length} tokens`);
                }
            }

            // Whole surah is settled (fetched or fell back) either way —
            // this is the atomic unit `onBatch` reports on.
            batchTracker.completeSurah(chapter.id, allTokens);

            // Small delay to avoid rate limiting
            if (i < chapters.length - 1) {
                await new Promise(r => setTimeout(r, 100));
            }
        }

        batchTracker.finish(allTokens);

        // Cache the loaded tokens AND verses
        progress.status = 'caching';
        progress.message = 'Caching tokens for offline access...';
        notify();

        await corpusCache.storeTokens(allTokens);
        await corpusCache.storeVerses(allVerses);

        // Full-corpus attempt: record under the full key. If the result fell
        // short (failed chapters), the FULL_CORPUS_TOKEN_FLOOR check above
        // prevents the next load from trusting it as complete.
        await corpusCache.setMetadata(CORPUS_METADATA_KEY, {
            tokenCount: allTokens.length,
            hasMorphology: Boolean(morphologyMap),
            morphologyVersion: morphologyMap ? MORPHOLOGY_CACHE_VERSION : undefined,
        });

        progress.status = 'complete';
        progress.totalTokens = allTokens.length;
        progress.message = `Loaded and cached ${allTokens.length.toLocaleString()} tokens`;
        notify();

        return allTokens;
    } catch (error) {
        console.error('[CorpusLoader] Critical error:', error);
        progress.status = 'error';
        progress.message = error instanceof Error ? error.message : 'Failed to load corpus';
        notify();
        throw error;
    }
}

/**
 * Load tokens for specific surahs only
 */
export async function loadSurahs(
    suraIds: number[],
    onProgress?: ProgressCallback
): Promise<CorpusToken[]> {
    const progress: LoadingProgress = {
        currentSura: 0,
        totalSuras: suraIds.length,
        currentTokens: 0,
        totalTokens: 0,
        status: 'loading',
        message: 'Loading surahs...',
    };

    const notify = () => onProgress?.(progress);
    const allTokens: CorpusToken[] = [];
    let morphologyMap: Map<string, MorphologyEntry> | null = null;
    let morphologyFallbackBySura: Map<number, CorpusToken[]> | null = null;
    await ensureQuranComCachePolicy();
    try {
        morphologyMap = await loadMorphologyMap();
        morphologyFallbackBySura = buildMorphologyFallbackBySura(morphologyMap);
        console.log(`[CorpusLoader] Morphology loaded: ${morphologyMap.size.toLocaleString()} entries`);
    } catch (err) {
        console.warn('[CorpusLoader] Failed to load morphology map, falling back to sample data.', err);
    }

    // Cached per-surah tokens may have been written by a full-corpus load OR a
    // previous partial (per-surah) load — either metadata record can vouch for
    // their morphology here. Neither implies the cache is a full corpus.
    const fullCacheMeta = await corpusCache.getMetadata(CORPUS_METADATA_KEY);
    const partialCacheMeta = await corpusCache.getMetadata(PARTIAL_CORPUS_METADATA_KEY);
    const cacheMorphologyTrusted =
        metadataHasCurrentMorphology(fullCacheMeta) || metadataHasCurrentMorphology(partialCacheMeta);
    for (let i = 0; i < suraIds.length; i++) {
        const suraId = suraIds[i];
        progress.currentSura = i + 1;
        progress.message = `Loading surah ${suraId}...`;
        notify();

        // Try cache first
        const cached = await corpusCache.getTokensBySura(suraId) as CorpusToken[];

        const cachedHasRoots = cached.some(t => t.root && t.root.trim().length > 0);
        if (cached.length > 0 && ((cacheMorphologyTrusted && cachedHasRoots) || !morphologyMap)) {
            allTokens.push(...cached);
        } else {
            if (cached.length > 0 && (!cachedHasRoots || !cacheMorphologyTrusted)) {
                await corpusCache.clearCorpusData();
            }

            // Load from API with full verses
            try {
                const verses = await quranApi.getAllVersesForChapter(suraId, { words: true });
                const verseTokens: CorpusToken[] = [];
                const versesRecords: AyahRecord[] = [];

                for (const verse of verses) {
                    if (verse.words) {
                        const ayahRecord: AyahRecord = {
                            id: verse.verse_key,
                            suraId: suraId,
                            ayahNumber: verse.verse_number,
                            textUthmani: verse.text_uthmani || verse.text_uthmani_simple || verse.text_imlaei || verse.text_imlaei_simple || verse.text_simple || "",
                            textSimple: verse.text_imlaei_simple || verse.text_imlaei || verse.text_simple || undefined,
                            tokenIds: []
                        };

                        for (const word of verse.words) {
                            if (word.char_type_name !== 'word') continue;
                            const token = wordToToken(suraId, verse.verse_number, word, word.position, morphologyMap);
                            verseTokens.push(token);
                            ayahRecord.tokenIds.push(token.id);
                        }
                        versesRecords.push(ayahRecord);
                    }
                }

                allTokens.push(...verseTokens);
                await corpusCache.storeTokens(verseTokens);
                await corpusCache.storeVerses(versesRecords);
            } catch (err) {
                // Constant format string, values passed as arguments: console.*
                // treats argument 0 as a format spec, so interpolating into it lets a
                // value smuggle in directives (CodeQL js/tainted-format-string).
                console.warn("[CorpusLoader] Failed API load for surah %o, trying morphology fallback.", suraId, err);
                const fallbackTokens = morphologyFallbackBySura?.get(suraId) ?? [];
                allTokens.push(...fallbackTokens);
                await corpusCache.storeTokens(fallbackTokens);
            }
        }

        progress.currentTokens = allTokens.length;
        notify();
    }

    // Partial load: record under the PARTIAL key only. Writing the full
    // 'corpus' key here would let a single-surah /embed visit poison the
    // shared cache into being treated as a complete corpus.
    await corpusCache.setMetadata(PARTIAL_CORPUS_METADATA_KEY, {
        tokenCount: allTokens.length,
        hasMorphology: Boolean(morphologyMap),
        morphologyVersion: morphologyMap ? MORPHOLOGY_CACHE_VERSION : undefined,
    });

    progress.status = 'complete';
    progress.message = `Loaded ${allTokens.length.toLocaleString()} tokens`;
    notify();

    return allTokens;
}
/**
 * Get full ayah record from cache
 */
export async function getAyah(sura: number, ayah: number): Promise<AyahRecord | null> {
    const id = `${sura}:${ayah}`;
    try {
        await ensureQuranComCachePolicy();
        const record = (await corpusCache.getVerse(id)) as AyahRecord | null;
        const cachedText = record?.textSimple?.trim() || record?.textUthmani?.trim();
        if (record && cachedText) {
            return record;
        }
    } catch (err) {
        console.warn(`[CorpusLoader] Failed to fetch ayah ${id}`, err);
    }

    try {
        const verse = await quranApi.getVerse(id);
        const fetchedRecord: AyahRecord = {
            id,
            suraId: sura,
            ayahNumber: ayah,
            textUthmani: verse.text_uthmani || verse.text_uthmani_simple || verse.text_imlaei || verse.text_imlaei_simple || verse.text_simple || "",
            textSimple: verse.text_imlaei_simple || verse.text_imlaei || verse.text_simple || undefined,
            tokenIds: verse.words
                ? verse.words
                    .filter((word) => word.char_type_name === 'word')
                    .map((word) => `${sura}:${ayah}:${word.position}`)
                : [],
        };

        try {
            await corpusCache.storeVerses([fetchedRecord]);
        } catch (cacheErr) {
            console.warn(`[CorpusLoader] Failed to cache ayah ${id}`, cacheErr);
        }

        return fetchedRecord;
    } catch (err) {
        console.warn(`[CorpusLoader] Failed to fetch ayah ${id} from API`, err);
        return null;
    }
}
export function getSampleData(): CorpusToken[] {
    return [...SAMPLE_MORPHOLOGY_DATA];
}

/**
 * Clear all cached data
 */
export async function clearCache(): Promise<void> {
    await corpusCache.clearAll();
}
