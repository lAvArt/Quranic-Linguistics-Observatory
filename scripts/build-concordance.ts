/**
 * Precompute the per-ayah root map that the `concordance-rings` mode draws.
 *
 * Spec: docs/CONCORDANCE-RINGS.md. Every surah is a ring, every ayah a tick,
 * and a tick lights where a chosen root occurs. To draw that the view needs,
 * for every ayah, which root each word carries — that is the whole payload.
 *
 * Read from the QAC morphology file, exactly as scripts/build-root-stats.ts
 * does, so it is unaffected by the corpus_tokens seed misalignment that skews
 * DB-backed views. Word grouping matches that script segment for segment, and
 * the build asserts the totals agree with root-stats.json before writing.
 *
 * Two files, because they are needed at different moments:
 *
 *   concordance.json       the root map — every ring, tick and meeting. Fetched
 *                          when the mode opens. 337 KB raw, 91 KB gzipped.
 *   concordance-text.json  the words of every ayah, for the hover read-out.
 *                          Fetched on the first hover, so opening the mode
 *                          never pays for it.
 *
 * The text has to come from HERE, not from the app's ayah text source. Hover
 * colours the words that carry the chosen roots by word index, and the app's
 * full-corpus text comes from Supabase / Quran.com, whose word numbering does
 * not match the corpus wherever QAC splits or merges a written word — the same
 * drift that skews corpus_tokens. Text built from the morphology file lines up
 * with the root map index for index, by construction.
 *
 * Both committed.
 * Run: npm run data:concordance
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const SRC = path.join(ROOT_DIR, "public", "data", "quranic-corpus-morphology-0.4.txt");
const STATS = path.join(ROOT_DIR, "public", "data", "root-stats.json");
const OUT = path.join(ROOT_DIR, "public", "data", "concordance.json");
const TEXT_OUT = path.join(ROOT_DIR, "public", "data", "concordance-text.json");

// Buckwalter → Arabic. Same table as scripts/build-root-stats.ts; the two must
// agree or the root keys here would not join that file's glosses.
const BW2AR: Record<string, string> = {
  "'": "ء", "|": "آ", ">": "أ", "<": "إ", "&": "ؤ", "}": "ئ", A: "ا", b: "ب",
  p: "ة", t: "ت", v: "ث", j: "ج", H: "ح", x: "خ", d: "د", "*": "ذ", r: "ر",
  z: "ز", s: "س", $: "ش", S: "ص", D: "ض", T: "ط", Z: "ظ", E: "ع", g: "غ",
  f: "ف", q: "ق", k: "ك", l: "ل", m: "م", n: "ن", h: "ه", w: "و", Y: "ى",
  y: "ي", F: "ً", N: "ٌ", K: "ٍ", a: "َ", u: "ُ", i: "ِ", "~": "ّ", o: "ْ",
  "`": "ٰ", "{": "ٱ",
};
const STRIP = new Set(["^", "@", "_", ".", ",", "2", "[", "]", "#"]);
const bw2ar = (s: string) =>
  Array.from(s).filter((c) => !STRIP.has(c)).map((c) => BW2AR[c] ?? c).join("");

/** No root on this word. */
const NO_ROOT = -1;

interface Word {
  root: string | null;
  /** The written word, segments joined, vowelled as the corpus writes it. */
  text: string;
}

export interface ConcordancePayload {
  version: number;
  /** Root table, most frequent first. Index into this is what ayahs store. */
  roots: { bare: string; bw: string; gloss: string | null; count: number }[];
  /**
   * Surah n (1-based) → its ayahs → one root index per word, NO_ROOT for a
   * word that carries none. An ayah's length is its word count, which is what
   * sets tick height, so nothing else needs storing.
   */
  surahs: { n: number; ayahs: number[][] }[];
  totals: { surahs: number; ayahs: number; words: number; rootBearing: number; roots: number };
}

async function main() {
  const text = await fs.readFile(SRC, "utf8");

  // sura → ayah → word → the word's root and length. A word is several
  // segments; the first segment carrying a ROOT tag gives the word its root,
  // which is how build-root-stats.ts counts one root per orthographic word.
  const quran = new Map<number, Map<number, Map<number, Word>>>();
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const parts = line.split("\t");
    if (parts.length < 4) continue;
    const m = parts[0].match(/\((\d+):(\d+):(\d+):(\d+)\)/);
    if (!m) continue;
    const sura = +m[1], ayah = +m[2], word = +m[3];
    const rootTok = parts[3].split("|").find((t) => t.startsWith("ROOT:"));

    let s = quran.get(sura);
    if (!s) quran.set(sura, (s = new Map()));
    let a = s.get(ayah);
    if (!a) s.set(ayah, (a = new Map()));
    let w = a.get(word);
    if (!w) a.set(word, (w = { root: null, text: "" }));
    w.text += bw2ar(parts[1]);
    if (rootTok && !w.root) w.root = bw2ar(rootTok.slice(5));
  }

  // Root table ordered by frequency, so index 0 is the commonest root and the
  // indices ayahs store stay small — which is most of why the payload is small.
  const counts = new Map<string, number>();
  for (const s of quran.values())
    for (const a of s.values())
      for (const w of a.values()) if (w.root) counts.set(w.root, (counts.get(w.root) ?? 0) + 1);
  const ordered = [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
  const rootIdx = new Map(ordered.map(([r], i) => [r, i]));

  const stats = JSON.parse(await fs.readFile(STATS, "utf8")).roots as Record<
    string,
    { gloss: string | null; bw: string; count: number }
  >;

  // Guard: this file and root-stats.json must see the same corpus. If they
  // drift, every count the rings show would disagree with the rest of the site.
  const statRoots = Object.keys(stats).length;
  if (ordered.length !== statRoots) {
    throw new Error(`root count ${ordered.length} != root-stats ${statRoots}`);
  }
  for (const [bare, count] of ordered) {
    if (stats[bare]?.count !== count) {
      throw new Error(`count mismatch for ${bare}: ${count} vs root-stats ${stats[bare]?.count}`);
    }
  }

  let ayahCount = 0;
  let wordCount = 0;
  let rootBearing = 0;
  const ayahText: string[][][] = [];
  const surahs = [...quran.keys()].sort((a, b) => a - b).map((n) => {
    const ayahs = [...quran.get(n)!.entries()]
      .sort((x, y) => x[0] - y[0])
      .map(([, a]) => {
        const ws = [...a.entries()].sort((x, y) => x[0] - y[0]).map(([, w]) => w);
        ayahCount++;
        wordCount += ws.length;
        for (const w of ws) if (w.root) rootBearing++;
        return ws;
      });
    // Parallel arrays, index for index: the root map and the words it indexes.
    ayahText.push(ayahs.map((ws) => ws.map((w) => w.text)));
    return { n, ayahs: ayahs.map((ws) => ws.map((w) => (w.root ? rootIdx.get(w.root)! : NO_ROOT))) };
  });

  const payload: ConcordancePayload = {
    version: 1,
    roots: ordered.map(([bare, count]) => ({
      bare,
      bw: stats[bare]?.bw ?? "",
      gloss: stats[bare]?.gloss ?? null,
      count,
    })),
    surahs,
    totals: {
      surahs: surahs.length,
      ayahs: ayahCount,
      words: wordCount,
      rootBearing,
      roots: ordered.length,
    },
  };

  await fs.writeFile(OUT, JSON.stringify(payload));
  await fs.writeFile(TEXT_OUT, JSON.stringify({ version: 1, surahs: ayahText }));
  const bytes = (await fs.stat(OUT)).size;
  const textBytes = (await fs.stat(TEXT_OUT)).size;

  console.log(`\n── concordance.json ───────────────────────────────────────────`);
  console.log(`   ${payload.totals.surahs} surahs · ${payload.totals.ayahs} ayahs · ${payload.totals.words.toLocaleString("en-US")} words`);
  console.log(`   ${payload.totals.rootBearing.toLocaleString("en-US")} root-bearing · ${payload.totals.roots} roots`);
  console.log(`\n   root map   ${(bytes / 1024).toFixed(0)} KB  — fetched when the mode opens`);
  console.log(`   ayah text  ${(textBytes / 1024).toFixed(0)} KB  — fetched on first hover`);
  console.log(`\n   -> ${path.relative(ROOT_DIR, OUT)}`);
  console.log(`   -> ${path.relative(ROOT_DIR, TEXT_OUT)}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
