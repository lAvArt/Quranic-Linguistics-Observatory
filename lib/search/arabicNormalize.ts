export const ARABIC_DIACRITICS_RE = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;
export const TATWEEL_RE = /\u0640/g;

const WEAK_FINAL_ROOT_CHARS = new Set(["ا", "ى", "ي", "و"]);
const COMMON_SUFFIXES = [
  "كما",
  "كم",
  "كن",
  "هما",
  "هم",
  "هن",
  "نا",
  "ها",
  "ه",
  "ك",
  "ي",
];

/**
 * Memo for the two pure functions below. Building the search indexes calls them
 * several times per token — hundreds of thousands of calls over ~20k distinct
 * strings — and without it normalisation alone was most of a page load on a
 * phone (profiled: 12 s of a 25 s index build at 4× CPU throttle). Cleared, not
 * evicted, when it fills, which only an unusual burst of distinct queries does.
 */
const MEMO_LIMIT = 60_000;
const normalizedMemo = new Map<string, string>();
const variantsMemo = new Map<string, readonly string[]>();

function remember<V>(memo: Map<string, V>, key: string, value: V): V {
  if (memo.size >= MEMO_LIMIT) memo.clear();
  memo.set(key, value);
  return value;
}

export function normalizeArabicForSearch(value: string): string {
  const hit = normalizedMemo.get(value);
  return hit !== undefined ? hit : remember(normalizedMemo, value, normalizeUncached(value));
}

function normalizeUncached(value: string): string {
  return value
    .trim()
    .normalize("NFKD")
    .replace(ARABIC_DIACRITICS_RE, "")
    .replace(TATWEEL_RE, "")
    .replace(/[ٱأإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ");
}

/**
 * Bridge the alef-madda (آ = hamza+alef) to the corpus's explicit hamza-alef
 * spelling. The corpus is inconsistent: some words are written with a real
 * hamza (قرآن → قُرْءَان, i.e. ء+ا) while others use the madda (مآب). A plain
 * query with آ normalizes (NFKD strips the madda) to a bare alef — قرآن → قران
 * — which misses the قرءان key. Rewriting آ → ء+ا on the RAW string, before
 * normalization, produces the قرءان form. Applied only as an EXTRA variant
 * (see searchKeyVariants), so the madda-spelled words (مآب) still resolve.
 */
export function foldMaddaToHamzaAlef(value: string): string {
  // Composed آ (آ) and decomposed alef+maddah (آ) → ء+ا.
  return value
    .replace(/آ/g, "ءا")
    .replace(/آ/g, "ءا");
}

/**
 * Drop the standalone hamza (ء, U+0621). The corpus writes many words with an
 * explicit hamza the modern speller omits — قُرْءَان vs قرآن/قران, دُعَاء vs دعا
 * — so folding ء out lets a hamza-less query reach a hamza-carrying key (and
 * vice-versa). Used ADDITIVELY (an extra alias key at build time, an extra
 * lookup variant at query time), never to replace the literal key, so the many
 * words whose ء-stripped form collides with a different real word stay distinct
 * (the direct key always wins first).
 */
export function foldHamza(value: string): string {
  return value.replace(/ء/g, "");
}

/**
 * Normalized key(s) to try for a search query, most-specific first: the plain
 * normalization, the alef-madda bridge (foldMaddaToHamzaAlef), and the
 * hamza-dropped fold (foldHamza) of each — so a query reaches a key written
 * with a different-but-equivalent hamza spelling (قران/قرآن/قرأن ↔ قرءان).
 * Deduped, order-preserving; callers try these DIRECT before any rasm fold.
 * Memoised: the returned array is shared, so callers must only read it.
 */
export function searchKeyVariants(query: string): readonly string[] {
  const hit = variantsMemo.get(query);
  return hit ?? remember(variantsMemo, query, variantsUncached(query));
}

function variantsUncached(query: string): string[] {
  const base = normalizeArabicForSearch(query);
  const bridged = normalizeArabicForSearch(foldMaddaToHamzaAlef(query));
  const out: string[] = [];
  const add = (k: string) => {
    if (k && k.length >= 2 && !out.includes(k)) out.push(k);
  };
  for (const k of [base, bridged]) {
    add(k);
    add(foldHamza(k));
  }
  return out;
}

/**
 * Fold a modern (imlāʾī) spelling toward the corpus's Uthmani rasm by dropping
 * the MEDIAL long-alef — the letter the rasm most commonly omits (صالح is
 * written صلح, الصالحين → الصلحين, رحمان → رحمن). Keeps the first and last
 * letters so a leading article/hamza-alif or a genuine final alef survives.
 * Callers use it as a FALLBACK after a direct lookup misses, so an over-fold
 * that matches nothing is harmless. Expects an already-normalized key.
 */
export function foldRasmAlef(normalized: string): string {
  if (normalized.length <= 2) return normalized;
  return normalized[0] + normalized.slice(1, -1).replace(/ا/g, "") + normalized[normalized.length - 1];
}

export function normalizeRootFamily(value: string): string {
  const normalized = normalizeArabicForSearch(value);
  if (!normalized) return normalized;
  const chars = [...normalized];
  const last = chars[chars.length - 1];
  if (last && WEAK_FINAL_ROOT_CHARS.has(last)) {
    chars[chars.length - 1] = "ي";
  }
  return chars.join("");
}

export function buildLemmaCandidates(value: string): Set<string> {
  const base = normalizeArabicForSearch(value);
  const candidates = new Set<string>();
  if (!base) return candidates;
  candidates.add(base);

  if (base.startsWith("ال") && base.length > 3) {
    candidates.add(base.slice(2));
  }

  for (const suffix of COMMON_SUFFIXES) {
    if (base.length > suffix.length + 1 && base.endsWith(suffix)) {
      candidates.add(base.slice(0, -suffix.length));
    }
  }

  return candidates;
}

