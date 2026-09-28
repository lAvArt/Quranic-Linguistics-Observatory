/**
 * What the structure map draws, derived once from the concordance payload
 * (public/data/concordance.json). That file holds every word's root index,
 * ayah by ayah, so the map is complete the moment ~350 KB arrive — it no
 * longer waits for the streamed token corpus, and its counts are the same
 * ones the concordance rings show.
 */
import { NO_ROOT, type ConcordancePayload, type ConcordanceRoot } from "@/lib/corpus/concordanceClient";

export interface SurahRoot {
  /** Index into `StructureModel.roots`. */
  root: number;
  /** Words in this surah carrying the root. */
  count: number;
}

export interface SurahProfile {
  n: number;
  words: number;
  ayahs: number;
  /** Every root in the surah, most frequent first (ties: commoner in the Quran first). */
  roots: SurahRoot[];
  /** root index → words carrying it here. */
  countByRoot: Map<number, number>;
}

export interface StructureModel {
  /** Index n − 1. */
  surahs: SurahProfile[];
  roots: ConcordanceRoot[];
  maxWords: number;
  maxRootCount: number;
  totals: ConcordancePayload["totals"];
}

export function buildStructureModel(payload: ConcordancePayload): StructureModel {
  const surahs: SurahProfile[] = payload.surahs.map((s) => {
    const countByRoot = new Map<number, number>();
    let words = 0;
    for (const ayah of s.ayahs) {
      words += ayah.length;
      for (const r of ayah) {
        if (r === NO_ROOT) continue;
        countByRoot.set(r, (countByRoot.get(r) ?? 0) + 1);
      }
    }
    // The payload's root table is ordered by Quran-wide frequency, so the
    // index breaks ties the same way everywhere.
    const roots = [...countByRoot].map(([root, count]) => ({ root, count })).sort((a, b) => b.count - a.count || a.root - b.root);
    return { n: s.n, words, ayahs: s.ayahs.length, roots, countByRoot };
  });
  return {
    surahs,
    roots: payload.roots,
    maxWords: Math.max(...surahs.map((s) => s.words)),
    maxRootCount: Math.max(...payload.roots.map((r) => r.count)),
    totals: payload.totals,
  };
}

export interface Occurrence {
  ayah: number;
  /** Words in the ayah carrying the root. */
  count: number;
  /** 1-based position of the first of them, for a token id. */
  word: number;
}

/** Every ayah holding a root, by surah, in ayah order. */
export function occurrencesOf(payload: ConcordancePayload, root: number): Map<number, Occurrence[]> {
  const out = new Map<number, Occurrence[]>();
  if (root < 0) return out;
  for (const s of payload.surahs) {
    let list: Occurrence[] | undefined;
    s.ayahs.forEach((ayah, i) => {
      let count = 0;
      let word = 0;
      for (let w = 0; w < ayah.length; w++) {
        if (ayah[w] !== root) continue;
        if (count === 0) word = w + 1;
        count++;
      }
      if (count === 0) return;
      if (!list) {
        list = [];
        out.set(s.n, list);
      }
      list.push({ ayah: i + 1, count, word });
    });
  }
  return out;
}

/** Surahs holding a root, with how many of their words carry it. */
export function surahsWithRoot(model: StructureModel, root: number): Map<number, number> {
  const out = new Map<number, number>();
  if (root < 0) return out;
  for (const s of model.surahs) {
    const c = s.countByRoot.get(root);
    if (c) out.set(s.n, c);
  }
  return out;
}
