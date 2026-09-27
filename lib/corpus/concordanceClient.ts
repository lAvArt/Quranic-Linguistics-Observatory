/**
 * Client + query layer for the concordance rings (docs/CONCORDANCE-RINGS.md).
 *
 * `public/data/concordance.json` (built by scripts/build-concordance.ts) is
 * the per-ayah root map: for every ayah, one root index per word. Everything
 * the rings draw — which surahs qualify, where a root lights a tick, where the
 * roots meet — is derived here, so the renderer only has to lay out geometry.
 *
 * Lazy + cached: ~337 KB raw, 91 KB gzipped, fetched once the mode opens so
 * the rest of the app never pays for it.
 *
 * Deliberately free of rendering concerns — no colours, no angles, no canvas.
 * That keeps this unit-testable against the corpus, which is where the numbers
 * the view shows have to be right.
 */
import { SURAH_NAMES } from "@/lib/data/surahData";
import { normalizeArabicForSearch } from "@/lib/search/arabicNormalize";

/** Sentinel stored for a word that carries no root. */
export const NO_ROOT = -1;

/** How many roots a selection may hold; see the spec's open question on scope. */
export const MAX_ROOTS = 3;

export interface ConcordanceRoot {
  bare: string;
  bw: string;
  gloss: string | null;
  count: number;
}

export interface ConcordancePayload {
  version: number;
  roots: ConcordanceRoot[];
  surahs: { n: number; ayahs: number[][] }[];
  totals: { surahs: number; ayahs: number; words: number; rootBearing: number; roots: number };
}

/** Which surahs qualify for the stacked view. */
export type MeetIn = "ayah" | "surah";

export interface AyahHit {
  /** 1-based ayah number. */
  ayah: number;
  /** Bit i set when selected root i occurs in this ayah. */
  mask: number;
  /** Words in the ayah — the tick's height before normalising. */
  words: number;
  /** (i - 0.5) / N through the surah, per the spec. */
  pos: number;
  /** Every selected root occurs here. */
  meeting: boolean;
}

export interface SurahHit {
  n: number;
  name: string;
  arabic: string;
  revelationPlace: string;
  ayahCount: number;
  /** Longest ayah in this surah, so tick heights normalise within the ring. */
  maxWords: number;
  /** Only the ayahs where at least one selected root occurs. */
  hits: AyahHit[];
  /** Ayahs where every selected root occurs. */
  meetings: AyahHit[];
  /** Per selected root, how many ayahs of this surah hold it. */
  perRoot: number[];
  /** True when this surah passes the current `MeetIn` rule. */
  qualifies: boolean;
}

export interface ConcordanceSelection {
  /** The selected roots, in the order chosen — slot order in the rings. */
  roots: ConcordanceRoot[];
  meetIn: MeetIn;
  /** Every surah, in mushaf order, so "All 114" can dim rather than drop. */
  surahs: SurahHit[];
  /** Just the qualifying ones, same order. */
  qualifying: SurahHit[];
  totalMeetings: number;
}

let cache: ConcordancePayload | null = null;
let promise: Promise<ConcordancePayload> | null = null;

export async function loadConcordance(): Promise<ConcordancePayload> {
  if (cache) return cache;
  if (!promise) {
    promise = fetch("/data/concordance.json")
      .then((r) => {
        if (!r.ok) throw new Error(`concordance ${r.status}`);
        return r.json();
      })
      .then((d: ConcordancePayload) => {
        cache = d;
        return d;
      })
      .catch((e) => {
        promise = null; // allow a later retry
        throw e;
      });
  }
  return promise;
}

/**
 * Fold a root to its match key. Corpus root keys are plain-alif, while a user
 * may type any hamza carrier (ءمن / أمن / امن), so both sides collapse every
 * carrier onto one character before comparing — the same fold the rest of the
 * search surfaces apply.
 */
export function rootKey(value: string): string {
  return normalizeArabicForSearch(value).replace(/[اأإآٱئؤء]/g, "ء");
}

/** Index of a root in the payload's table, or -1. Accepts Arabic or Buckwalter. */
export function findRootIndex(payload: ConcordancePayload, query: string): number {
  const q = query.trim();
  if (!q) return -1;
  const key = rootKey(q);
  let fallback = -1;
  for (let i = 0; i < payload.roots.length; i++) {
    const r = payload.roots[i];
    if (r.bare === q || r.bw === q) return i;
    if (fallback === -1 && rootKey(r.bare) === key) fallback = i;
  }
  return fallback;
}

/** Roots whose key, Buckwalter or gloss starts with the query, commonest first. */
export function suggestRoots(
  payload: ConcordancePayload,
  query: string,
  limit = 8,
): ConcordanceRoot[] {
  const q = query.trim();
  if (!q) return [];
  const key = rootKey(q);
  const lower = q.toLowerCase();
  const out: ConcordanceRoot[] = [];
  // The table is already ordered by frequency, so the first matches found are
  // the ones to offer; no sort needed.
  for (const r of payload.roots) {
    const hit =
      rootKey(r.bare).startsWith(key) ||
      r.bw.toLowerCase().startsWith(lower) ||
      (r.gloss ?? "").toLowerCase().includes(lower);
    if (hit) {
      out.push(r);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/**
 * Everything the rings need for one set of roots.
 *
 * Walks every ayah once and records, per ayah, which selected roots occur.
 * `mask` is a bitfield rather than a list because the renderer asks "is root i
 * here?" per tick per frame, and a bit test is free.
 */
export function selectConcordance(
  payload: ConcordancePayload,
  rootIndices: number[],
  meetIn: MeetIn = "ayah",
): ConcordanceSelection {
  const picked = rootIndices
    .filter((i) => i >= 0 && i < payload.roots.length)
    .slice(0, MAX_ROOTS);
  const roots = picked.map((i) => payload.roots[i]);
  const allMask = (1 << picked.length) - 1;

  const surahs: SurahHit[] = payload.surahs.map((s) => {
    const meta = SURAH_NAMES[s.n];
    const n = s.ayahs.length;
    let maxWords = 1;
    const hits: AyahHit[] = [];
    const meetings: AyahHit[] = [];
    const perRoot = new Array<number>(picked.length).fill(0);

    for (let i = 0; i < n; i++) {
      const words = s.ayahs[i];
      if (words.length > maxWords) maxWords = words.length;
      if (!picked.length) continue;

      let mask = 0;
      for (const idx of words) {
        if (idx === NO_ROOT) continue;
        const slot = picked.indexOf(idx);
        if (slot !== -1) mask |= 1 << slot;
      }
      if (!mask) continue;

      const hit: AyahHit = {
        ayah: i + 1,
        mask,
        words: words.length,
        pos: (i + 0.5) / n,
        meeting: mask === allMask && allMask !== 0,
      };
      for (let b = 0; b < picked.length; b++) if (mask & (1 << b)) perRoot[b]++;
      hits.push(hit);
      if (hit.meeting) meetings.push(hit);
    }

    // "one ayah" wants the roots together in a single ayah; "one surah" only
    // wants each of them present somewhere in the surah.
    const qualifies = picked.length === 0
      ? false
      : meetIn === "ayah"
        ? meetings.length > 0
        : perRoot.every((c) => c > 0);

    return {
      n: s.n,
      name: meta?.name ?? `Surah ${s.n}`,
      arabic: meta?.arabic ?? "",
      revelationPlace: meta?.revelationPlace ?? "makkah",
      ayahCount: n,
      maxWords,
      hits,
      meetings,
      perRoot,
      qualifies,
    };
  });

  const qualifying = surahs.filter((s) => s.qualifies);
  return {
    roots,
    meetIn,
    surahs,
    qualifying,
    totalMeetings: surahs.reduce((sum, s) => sum + s.meetings.length, 0),
  };
}

/**
 * Ring order options from the spec. `firstMeeting` sorts by where a surah's
 * first meeting falls: at rest the first meetings trace a spiral outward, and
 * aligning afterwards turns the spiral into a column.
 */
export type RingOrder = "mushaf" | "length" | "meetings" | "firstMeeting";

/**
 * Ring order, innermost first. Mushaf order runs 114 → 1 so the short surahs
 * sit at the centre, as the spec describes. Ties always fall back to mushaf
 * order so a sort is stable across renders.
 */
export function orderRings(surahs: SurahHit[], order: RingOrder): SurahHit[] {
  const out = [...surahs];
  if (order === "mushaf") return out.sort((a, b) => b.n - a.n);
  if (order === "length") return out.sort((a, b) => a.ayahCount - b.ayahCount || b.n - a.n);
  if (order === "firstMeeting") {
    // A surah with no meeting has nowhere to sit on the spiral; it goes last.
    const first = (s: SurahHit) => (s.meetings.length ? s.meetings[0].pos : Infinity);
    return out.sort((a, b) => first(a) - first(b) || b.n - a.n);
  }
  return out.sort((a, b) => a.meetings.length - b.meetings.length || b.n - a.n);
}

/** Surah n → its ayahs → the written words, index-aligned with the root map. */
export interface ConcordanceText {
  version: number;
  surahs: string[][][];
}

let textCache: ConcordanceText | null = null;
let textPromise: Promise<ConcordanceText> | null = null;

/**
 * The words of every ayah, for the hover read-out.
 *
 * A separate file from the root map on purpose: ~258 KB gzipped against the
 * map's 91, and only a reader who hovers needs it, so it is fetched on the
 * first hover rather than when the mode opens. It is the corpus's own text
 * rather than the app's ayah source because hover colours root words BY WORD
 * INDEX, and the app's text (Supabase / Quran.com) numbers words differently
 * wherever the corpus splits or merges a written word.
 */
export async function loadConcordanceText(): Promise<ConcordanceText> {
  if (textCache) return textCache;
  if (!textPromise) {
    textPromise = fetch("/data/concordance-text.json")
      .then((r) => {
        if (!r.ok) throw new Error(`concordance-text ${r.status}`);
        return r.json();
      })
      .then((d: ConcordanceText) => {
        textCache = d;
        return d;
      })
      .catch((e) => {
        textPromise = null;
        throw e;
      });
  }
  return textPromise;
}
