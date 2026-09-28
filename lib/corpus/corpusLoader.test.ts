import { beforeEach, describe, expect, it, vi } from "vitest";
import { FULL_CORPUS_TOKEN_FLOOR } from "@/lib/corpus/corpusExpectations";
import type { CorpusToken } from "@/lib/schema/types";

/**
 * Must match MORPHOLOGY_CACHE_VERSION in lib/corpus/corpusLoader.ts.
 * The positive-control test ("trusts a cached corpus at the floor…") fails if
 * this drifts, which flags the hardcode for updating.
 */
const CURRENT_MORPHOLOGY_VERSION = "qac-0.4.3-enrich-all-surahs";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

interface StoredMetadata {
  key: string;
  lastUpdated: number;
  tokenCount?: number;
  hasMorphology?: boolean;
  morphologyVersion?: string;
}

const h = vi.hoisted(() => {
  const state = {
    tokens: new Map<string, { id: string; sura: number; root?: string }>(),
    verses: new Map<string, { id: string }>(),
    metadata: new Map<string, { key: string; lastUpdated: number } & Record<string, unknown>>(),
    supabaseCount: null as number | null,
    supabaseRows: [] as Record<string, unknown>[],
  };

  const corpusCache = {
    init: vi.fn(async () => ({})),
    storeTokens: vi.fn(async (tokens: { id: string; sura: number; root?: string }[]) => {
      for (const token of tokens) state.tokens.set(token.id, token);
    }),
    storeVerses: vi.fn(async (verses: { id: string }[]) => {
      for (const verse of verses) state.verses.set(verse.id, verse);
    }),
    getTokensBySura: vi.fn(async (suraId: number) =>
      [...state.tokens.values()].filter((token) => token.sura === suraId)
    ),
    getTokensByRoot: vi.fn(async () => []),
    getAllTokens: vi.fn(async () => [...state.tokens.values()]),
    getVerse: vi.fn(async (id: string) => state.verses.get(id) ?? null),
    getVersesBySura: vi.fn(async () => []),
    getTokenCount: vi.fn(async () => state.tokens.size),
    setMetadata: vi.fn(async (key: string, data: Record<string, unknown>) => {
      state.metadata.set(key, { key, ...data, lastUpdated: Date.now() });
    }),
    getMetadata: vi.fn(async (key: string) => state.metadata.get(key) ?? null),
    isMetadataExpired: vi.fn(
      (metadata: { lastUpdated?: number } | null, maxAgeMs: number = 7 * 24 * 60 * 60 * 1000) => {
        if (!metadata || typeof metadata.lastUpdated !== "number") return true;
        return Date.now() - metadata.lastUpdated > maxAgeMs;
      }
    ),
    clearCorpusData: vi.fn(async () => {
      state.tokens.clear();
      state.verses.clear();
      state.metadata.delete("corpus");
      state.metadata.delete("corpus:partial");
    }),
    ensureCachePolicyVersion: vi.fn(async () => false),
    clearAll: vi.fn(async () => {
      state.tokens.clear();
      state.verses.clear();
      state.metadata.clear();
    }),
  };

  const loadMorphologyMap = vi.fn();

  const quranApi = {
    getChapters: vi.fn(),
    getVersesByChapter: vi.fn(),
    getAllVersesForChapter: vi.fn(),
    getVerse: vi.fn(),
  };

  interface PagedQueryBuilder {
    order: (column: string) => PagedQueryBuilder;
    range: (from: number, to: number) => Promise<{ data: Record<string, unknown>[]; error: null }>;
  }

  const createClient = vi.fn(() => ({
    from: () => ({
      select: (_columns: string, options?: { count?: string; head?: boolean }) => {
        if (options?.head) {
          return Promise.resolve({ count: state.supabaseCount, error: null });
        }
        const builder: PagedQueryBuilder = {
          order: () => builder,
          range: (from: number, to: number) =>
            Promise.resolve({ data: state.supabaseRows.slice(from, to + 1), error: null }),
        };
        return builder;
      },
    }),
  }));

  return { state, corpusCache, loadMorphologyMap, quranApi, createClient };
});

vi.mock("@/lib/cache/corpusCache", () => ({
  corpusCache: h.corpusCache,
  CORPUS_METADATA_KEY: "corpus",
  PARTIAL_CORPUS_METADATA_KEY: "corpus:partial",
  QURAN_COM_CACHE_TTL_MS: 7 * 24 * 60 * 60 * 1000,
  CORPUS_CACHE_POLICY_VERSION: 1,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: h.createClient,
}));

vi.mock("@/lib/api/quranApi", () => ({
  quranApi: h.quranApi,
}));

vi.mock("@/lib/corpus/morphologyLoader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/corpus/morphologyLoader")>();
  return { ...actual, loadMorphologyMap: h.loadMorphologyMap };
});

function makeTokens(count: number, sura = 2): CorpusToken[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${sura}:1:${index + 1}`,
    sura,
    ayah: 1,
    position: index + 1,
    text: `t${index + 1}`,
    root: "كتب",
    lemma: "كتاب",
    pos: "N",
    morphology: { features: {}, gloss: null, stem: null },
  }));
}

function makeSupabaseRows(count: number): Record<string, unknown>[] {
  return makeTokens(count).map((token) => ({
    id: token.id,
    sura: token.sura,
    ayah: token.ayah,
    position: token.position,
    text: token.text,
    root: token.root,
    lemma: token.lemma,
    pos: token.pos,
    morphology: { features: {}, gloss: null, stem: null },
  }));
}

/** Rows spanning multiple whole surahs, globally sura/ayah/position-ordered — matches what a real `.order('sura').order('ayah').order('position')` query returns. */
function makeSupabaseRowsAcrossSurahs(tokensPerSurah: number, surahCount: number): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (let suraId = 1; suraId <= surahCount; suraId++) {
    for (let position = 1; position <= tokensPerSurah; position++) {
      rows.push({
        id: `${suraId}:1:${position}`,
        sura: suraId,
        ayah: 1,
        position,
        text: `t${suraId}-${position}`,
        root: "كتب",
        lemma: "كتاب",
        pos: "N",
        morphology: { features: {}, gloss: null, stem: null },
      });
    }
  }
  return rows;
}

function makeChapters(count: number): { id: number; name_simple: string }[] {
  return Array.from({ length: count }, (_, i) => ({ id: i + 1, name_simple: `Chapter${i + 1}` }));
}

function makeChapterVerse(suraId: number, wordCount: number) {
  return {
    verse_key: `${suraId}:1`,
    verse_number: 1,
    text_uthmani: "بِسْمِ اللَّهِ",
    words: Array.from({ length: wordCount }, (_, i) => ({
      char_type_name: "word",
      position: i + 1,
      text: `w${suraId}-${i + 1}`,
    })),
  };
}

/**
 * Shared invariants for `onBatch` call sequences, regardless of which data
 * path produced them: batches report WHOLE surahs only (the surah id set
 * inside a batch's own token array exactly matches its reported
 * `completedSurahs`, so no partial/trailing surah ever leaks through and no
 * complete surah goes unreported), `completedSurahs` is strictly ascending
 * with no duplicates and only ever grows across calls, and the final call
 * is `done: true`.
 */
function assertValidBatchSequence(
  calls: [CorpusToken[], { completedSurahs: number[]; done: boolean }][],
  expectedFinalTokenCount: number,
  expectedFinalSurahCount: number
) {
  expect(calls.length).toBeGreaterThan(1); // more than a single all-at-once emission

  let previousCompleted: number[] = [];
  calls.forEach(([tokensSoFar, meta], callIndex) => {
    // Ascending, no duplicates.
    const sorted = [...meta.completedSurahs].sort((a, b) => a - b);
    expect(meta.completedSurahs).toEqual(sorted);
    expect(new Set(meta.completedSurahs).size).toBe(meta.completedSurahs.length);

    // Cumulative: strictly grows, previous call's ids are a prefix of this one's.
    expect(meta.completedSurahs.slice(0, previousCompleted.length)).toEqual(previousCompleted);
    if (callIndex < calls.length - 1) {
      expect(meta.completedSurahs.length).toBeGreaterThan(previousCompleted.length);
    }
    previousCompleted = meta.completedSurahs;

    // Whole-surah invariant: the surah ids actually present in this batch's
    // token array are EXACTLY the reported completedSurahs — never more
    // (a partial trailing surah leaking through) and never fewer (a
    // complete surah left unreported).
    const suraIdsInSnapshot = new Set(tokensSoFar.map((t) => t.sura));
    expect(suraIdsInSnapshot).toEqual(new Set(meta.completedSurahs));
  });

  const [finalTokens, finalMeta] = calls[calls.length - 1];
  expect(finalMeta.done).toBe(true);
  expect(calls.slice(0, -1).every(([, meta]) => meta.done === false)).toBe(true);
  expect(finalTokens).toHaveLength(expectedFinalTokenCount);
  expect(finalMeta.completedSurahs).toHaveLength(expectedFinalSurahCount);
}

function seedCachedTokens(tokens: CorpusToken[]) {
  for (const token of tokens) h.state.tokens.set(token.id, token);
}

function seedMetadata(key: string, data: Partial<StoredMetadata>) {
  h.state.metadata.set(key, { key, lastUpdated: Date.now(), ...data });
}

/** Re-import a fresh corpusLoader so its module-level singletons reset per test. */
async function importLoader() {
  return import("@/lib/corpus/corpusLoader");
}

beforeEach(() => {
  vi.resetModules();
  h.state.tokens.clear();
  h.state.verses.clear();
  h.state.metadata.clear();
  h.state.supabaseCount = null;
  h.state.supabaseRows = [];
  vi.clearAllMocks();
  h.loadMorphologyMap.mockResolvedValue(new Map());
  h.quranApi.getChapters.mockRejectedValue(new Error("quran.com api disabled in test"));
  h.quranApi.getVersesByChapter.mockRejectedValue(new Error("quran.com api disabled in test"));
  h.quranApi.getAllVersesForChapter.mockRejectedValue(new Error("quran.com api disabled in test"));
  h.quranApi.getVerse.mockRejectedValue(new Error("quran.com api disabled in test"));
});

describe("loadFullCorpus cache trust", () => {
  it("does not trust a below-floor cache as the full corpus even with matching full-corpus metadata", async () => {
    seedCachedTokens(makeTokens(500));
    seedMetadata("corpus", {
      tokenCount: 500,
      hasMorphology: true,
      morphologyVersion: CURRENT_MORPHOLOGY_VERSION,
    });

    const { loadFullCorpus } = await importLoader();

    // Supabase is empty and the API rejects, so the only way this could
    // resolve is by (wrongly) trusting the 500-token cache as complete.
    await expect(loadFullCorpus()).rejects.toThrow();
    expect(h.corpusCache.getAllTokens).not.toHaveBeenCalled();
  });

  it("trusts a cached corpus at the floor when full-corpus metadata matches", async () => {
    seedCachedTokens(makeTokens(FULL_CORPUS_TOKEN_FLOOR));
    seedMetadata("corpus", {
      tokenCount: FULL_CORPUS_TOKEN_FLOOR,
      hasMorphology: true,
      morphologyVersion: CURRENT_MORPHOLOGY_VERSION,
    });

    const { loadFullCorpus } = await importLoader();
    const tokens = await loadFullCorpus();

    expect(tokens).toHaveLength(FULL_CORPUS_TOKEN_FLOOR);
    expect(h.createClient).not.toHaveBeenCalled();
    expect(h.quranApi.getChapters).not.toHaveBeenCalled();
  });

  it("never satisfies the full-corpus check from the partial metadata key, regardless of token count", async () => {
    // Even an above-floor token count must not be trusted when only the
    // partial (per-surah) metadata key vouches for it.
    seedCachedTokens(makeTokens(FULL_CORPUS_TOKEN_FLOOR + 10));
    seedMetadata("corpus:partial", {
      tokenCount: FULL_CORPUS_TOKEN_FLOOR + 10,
      hasMorphology: true,
      morphologyVersion: CURRENT_MORPHOLOGY_VERSION,
    });

    const { loadFullCorpus } = await importLoader();

    await expect(loadFullCorpus()).rejects.toThrow();
    expect(h.corpusCache.getAllTokens).not.toHaveBeenCalled();
  });

  it("keeps a fresh partial-only cache alive through the policy check (no wipe on every load)", async () => {
    seedCachedTokens(makeTokens(30, 1));
    seedMetadata("corpus:partial", {
      tokenCount: 30,
      hasMorphology: true,
      morphologyVersion: CURRENT_MORPHOLOGY_VERSION,
    });

    const { loadFullCorpus } = await importLoader();
    await expect(loadFullCorpus()).rejects.toThrow();

    // The partial cache is not full, but nothing about it is stale, so the
    // policy must not clear it (loadSurahs still serves the embed from it).
    expect(h.corpusCache.clearCorpusData).not.toHaveBeenCalled();
    expect(h.state.tokens.size).toBe(30);
  });

  it("never expires a cache by age: the corpus is downloaded once", async () => {
    seedCachedTokens(makeTokens(30, 1));
    h.state.metadata.set("corpus:partial", {
      key: "corpus:partial",
      lastUpdated: Date.now() - 52 * WEEK_MS,
      tokenCount: 30,
      hasMorphology: true,
      morphologyVersion: CURRENT_MORPHOLOGY_VERSION,
    });

    const { loadFullCorpus } = await importLoader();
    await expect(loadFullCorpus()).rejects.toThrow();

    expect(h.corpusCache.clearCorpusData).not.toHaveBeenCalled();
    expect(h.state.tokens.size).toBe(30);
  });
});

describe("loadFullCorpus Supabase floor", () => {
  it("treats a below-floor Supabase count as not-full and falls through to the next source", async () => {
    h.state.supabaseCount = 5000;
    h.state.supabaseRows = makeSupabaseRows(5000);

    const { loadFullCorpus } = await importLoader();

    await expect(loadFullCorpus()).rejects.toThrow();
    // Fall-through proof: the API path ran after Supabase was rejected…
    expect(h.quranApi.getChapters).toHaveBeenCalled();
    // …and the partial Supabase set was never cached as the corpus.
    expect(h.corpusCache.storeTokens).not.toHaveBeenCalled();
    expect(h.state.metadata.has("corpus")).toBe(false);
  });

  it("accepts a Supabase corpus at the floor and records it under the full-corpus key", async () => {
    h.state.supabaseCount = FULL_CORPUS_TOKEN_FLOOR;
    h.state.supabaseRows = makeSupabaseRows(FULL_CORPUS_TOKEN_FLOOR);

    const { loadFullCorpus } = await importLoader();
    const tokens = await loadFullCorpus();

    expect(tokens).toHaveLength(FULL_CORPUS_TOKEN_FLOOR);
    expect(h.state.metadata.get("corpus")).toMatchObject({
      tokenCount: FULL_CORPUS_TOKEN_FLOOR,
      hasMorphology: true,
      morphologyVersion: CURRENT_MORPHOLOGY_VERSION,
    });
    expect(h.state.metadata.has("corpus:partial")).toBe(false);
  });
});

describe("loadFullCorpus batching (onBatch)", () => {
  it("streams whole-surah batches from the Supabase path, ending with done:true and the full result", async () => {
    const SURAH_COUNT = 25;
    const TOKENS_PER_SURAH = FULL_CORPUS_TOKEN_FLOOR / SURAH_COUNT; // exactly at the floor
    h.state.supabaseCount = FULL_CORPUS_TOKEN_FLOOR;
    h.state.supabaseRows = makeSupabaseRowsAcrossSurahs(TOKENS_PER_SURAH, SURAH_COUNT);

    const { loadFullCorpus } = await importLoader();
    const onBatch = vi.fn<(tokens: CorpusToken[], meta: { completedSurahs: number[]; done: boolean }) => void>();
    const resolved = await loadFullCorpus(undefined, onBatch);

    expect(resolved).toHaveLength(FULL_CORPUS_TOKEN_FLOOR);
    assertValidBatchSequence(onBatch.mock.calls, FULL_CORPUS_TOKEN_FLOOR, SURAH_COUNT);
    // The final onBatch snapshot and the promise's own resolved value agree.
    const [finalTokens] = onBatch.mock.calls[onBatch.mock.calls.length - 1];
    expect(finalTokens).toEqual(resolved);
  });

  it("streams whole-surah batches from the Quran.com + morphology fallback path", async () => {
    const CHAPTER_COUNT = 13; // > the largest tuned batch size (12) so at least 2 batches fire regardless of exact tuning
    h.quranApi.getChapters.mockResolvedValue(makeChapters(CHAPTER_COUNT));
    h.quranApi.getAllVersesForChapter.mockImplementation(async (chapterId: number) => [
      makeChapterVerse(chapterId, 5),
    ]);

    const { loadFullCorpus } = await importLoader();
    const onBatch = vi.fn<(tokens: CorpusToken[], meta: { completedSurahs: number[]; done: boolean }) => void>();
    const resolved = await loadFullCorpus(undefined, onBatch);

    expect(resolved).toHaveLength(CHAPTER_COUNT * 5);
    assertValidBatchSequence(onBatch.mock.calls, CHAPTER_COUNT * 5, CHAPTER_COUNT);
    const [finalTokens] = onBatch.mock.calls[onBatch.mock.calls.length - 1];
    expect(finalTokens).toEqual(resolved);
  }, 10_000);

  it("never fires onBatch for callers that don't ask for it (no behavior change)", async () => {
    h.state.supabaseCount = FULL_CORPUS_TOKEN_FLOOR;
    h.state.supabaseRows = makeSupabaseRowsAcrossSurahs(FULL_CORPUS_TOKEN_FLOOR / 25, 25);

    const { loadFullCorpus } = await importLoader();
    const tokens = await loadFullCorpus();

    expect(tokens).toHaveLength(FULL_CORPUS_TOKEN_FLOOR);
  });
});

describe("loadSurahs (partial/embed path)", () => {
  const verse = {
    verse_key: "1:1",
    verse_number: 1,
    text_uthmani: "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ",
    words: [
      { char_type_name: "word", position: 1, text: "بِسْمِ" },
      { char_type_name: "word", position: 2, text: "اللَّهِ" },
      { char_type_name: "end", position: 3, text: "١" },
    ],
  };

  it("records its write under the partial metadata key, never the full-corpus key", async () => {
    h.quranApi.getAllVersesForChapter.mockResolvedValue([verse]);

    const { loadSurahs } = await importLoader();
    const tokens = await loadSurahs([1]);

    expect(tokens).toHaveLength(2);
    expect(h.state.metadata.has("corpus:partial")).toBe(true);
    expect(h.state.metadata.has("corpus")).toBe(false);
  });

  it("keeps serving its own cached surah when only the partial metadata key vouches for it", async () => {
    seedCachedTokens(makeTokens(20, 1));
    seedMetadata("corpus:partial", {
      tokenCount: 20,
      hasMorphology: true,
      morphologyVersion: CURRENT_MORPHOLOGY_VERSION,
    });

    const { loadSurahs } = await importLoader();
    const tokens = await loadSurahs([1]);

    expect(tokens).toHaveLength(20);
    expect(h.quranApi.getAllVersesForChapter).not.toHaveBeenCalled();
  });
});
