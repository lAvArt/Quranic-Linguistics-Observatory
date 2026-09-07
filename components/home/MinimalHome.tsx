"use client";

import { useState, useEffect, useMemo, useCallback, useRef, useSyncExternalStore } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import { useTranslations, useLocale } from "next-intl";
import LanguageSwitcher from "@/components/ui/LanguageSwitcher";
import { AuthButton } from "@/components/ui/AuthButton";
import { SURAH_NAMES } from "@/lib/data/surahData";
import { ROOT_GLOSSES_AR } from "@/lib/data/rootGlossesAr";
import {
  loadRootStats,
  lookupRoot,
  rootPrefixMatches,
  rootOfTheDay,
  type RootStat,
  type RootStatsIndex,
  type ExampleVerse,
} from "@/lib/corpus/rootStatsClient";
import {
  loadNameStats,
  lookupName,
  namePrefixMatches,
  type NameStat,
  type NameStatsIndex,
} from "@/lib/corpus/nameStatsClient";
import { loadFormIndex, lookupFormRoot, type FormIndex } from "@/lib/corpus/formIndexClient";
import {
  loadLemmaFormStats,
  lookupForm,
  lookupLemma,
  type DrillEntry,
  type LemmaFormStats,
} from "@/lib/corpus/lemmaFormStatsClient";
import { fetchOccurrences, fetchOccurrencesByRefs, type OccurrenceAyah } from "@/lib/corpus/occurrencesClient";
import { normalizeArabicForSearch, foldRasmAlef } from "@/lib/search/arabicNormalize";

/** A home search hit is either a root or a root-less name/word. */
type HomeHit = RootStat | NameStat;
/** NameStat carries a `kind`; RootStat does not — the structural discriminator. */
function isNameHit(hit: HomeHit): hit is NameStat {
  return "kind" in hit;
}

// SSR-safe "is this a narrow (≤640px) viewport" read — same
// useSyncExternalStore + matchMedia shape as VizControlContext's mobile
// query, so the server-rendered markup (which can't know the client's
// viewport) always matches the client's first paint before hydration
// swaps in the real value.
const NARROW_QUERY = "(max-width: 640px)";
function subscribeNarrowQuery(cb: () => void) {
  const mql = window.matchMedia(NARROW_QUERY);
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
}
function getNarrowSnapshot() {
  return window.matchMedia(NARROW_QUERY).matches;
}
function getNarrowServerSnapshot() {
  return false; // SSR assumes the wider, unabridged placeholder
}
function useIsNarrowViewport() {
  return useSyncExternalStore(subscribeNarrowQuery, getNarrowSnapshot, getNarrowServerSnapshot);
}

// Each root is tinted by its dominant part of speech (V2 POS spectrum).
const POS_COLOR: Record<string, string> = {
  N: "#E8924A",
  V: "#D06A86",
  ADJ: "#DD6A47",
  PRON: "#56A697",
  P: "#E6C24E",
};
const rootColor = (s: RootStat): string => POS_COLOR[s.pos?.[0]?.[0] ?? "N"] ?? "#E8924A";

interface ResolvedGloss {
  text: string;
  /** True when `text` is a curated Arabic sense (renders rtl); false when
   *  it's the corpus's English gloss (renders ltr, as it always has). */
  isAr: boolean;
}

/**
 * Resolve a root's display gloss. In the `ar` locale, prefer the curated
 * classical Arabic sense (`lib/data/rootGlossesAr.ts`, corpus data — not
 * i18n copy) over the English corpus gloss, so the landing page reads as
 * Arabic rather than mixing in ltr English fragments. Roots outside that
 * curated 48-root set — and every root in non-`ar` locales — keep falling
 * back to the plain English gloss, exactly as before.
 */
function resolveGloss(locale: string, bare: string, englishGloss: string | null | undefined): ResolvedGloss | null {
  if (locale === "ar") {
    const ar = ROOT_GLOSSES_AR[bare];
    if (ar) return { text: ar, isAr: true };
  }
  return englishGloss ? { text: englishGloss, isAr: false } : null;
}

/** Locale-aware sūrah name — Arabic script in `ar`, transliteration otherwise. */
function useSurahName() {
  const locale = useLocale();
  return (id: number): string => {
    const s = SURAH_NAMES[id];
    if (!s) return `Sūrah ${id}`;
    return locale === "ar" ? s.arabic : s.name;
  };
}

/** 114-bar per-sūrah occurrence histogram. */
function SurahStrip({
  hist,
  color,
  height = 84,
  activeSura = null,
}: {
  hist: number[];
  color: string;
  height?: number;
  /** Sūrah whose bar to spotlight — tracks the verse shown in the carousel. */
  activeSura?: number | null;
}) {
  const [hover, setHover] = useState<{ sura: number; count: number } | null>(null);
  const surahName = useSurahName();
  const W = 720;
  const H = height;
  const n = 114;
  const gap = W / n;
  const max = Math.max(1, ...hist);
  const activeC = activeSura != null ? hist[activeSura - 1] ?? 0 : 0;
  const activeBH = activeC ? 3 + (activeC / max) * (H - 12) : 0;
  const activeX = activeSura != null ? (activeSura - 1) * gap + gap * 0.5 : 0;
  return (
    <div className="mhome-strip">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: "block", overflow: "visible" }}>
        <line x1={0} y1={H - 0.5} x2={W} y2={H - 0.5} style={{ stroke: "rgba(var(--mh-ink-rgb), 0.12)" }} strokeWidth={1} />
        {hist.map((c, i) => {
          if (!c) return null;
          const v = c / max;
          const bh = 3 + v * (H - 12);
          const isActive = i + 1 === activeSura;
          const wide = isActive ? gap * 0.72 : gap * 0.6;
          const x = i * gap + (gap - Math.max(1.4, wide)) / 2;
          const faint = v <= 0.26;
          const isHover = hover?.sura === i + 1;
          const base = isActive || isHover ? 1 : v > 0.6 ? 1 : faint ? 1 : 0.55;
          // When a verse is spotlighted, fade the rest so the active bar pops —
          // the distribution shape stays readable, just quieter.
          const spotlight = activeSura != null && !isActive && !isHover;
          return (
            <rect
              key={i}
              x={x}
              y={H - bh}
              width={Math.max(1.4, wide)}
              height={bh}
              rx={1}
              style={{ fill: isActive || isHover || !faint ? color : "rgba(var(--mh-ink-rgb), 0.18)" }}
              opacity={spotlight ? Math.min(base, 0.32) : base}
            />
          );
        })}
        {/* Spotlight the carousel's current verse: a marker dot above its bar. */}
        {activeSura != null && activeC > 0 && (
          <circle cx={activeX} cy={H - activeBH - 6} r={3} style={{ fill: color, stroke: "var(--mh-canvas)", strokeWidth: 1 }} />
        )}
        {/* full-height hover targets so thin bars are easy to catch */}
        {hist.map((c, i) =>
          c ? (
            <rect
              key={`h${i}`}
              x={i * gap}
              y={0}
              width={gap}
              height={H}
              fill="transparent"
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHover({ sura: i + 1, count: c })}
              onMouseLeave={() => setHover((h) => (h?.sura === i + 1 ? null : h))}
            />
          ) : null
        )}
      </svg>
      {hover && (
        <div className="mhome-strip-tip" style={{ left: `clamp(70px, ${((hover.sura - 0.5) / n) * 100}%, calc(100% - 70px))` }}>
          <span className="mhome-strip-tip-name">{surahName(hover.sura)}</span>
          <span className="mhome-strip-tip-count" style={{ color }}>
            {hover.count}×
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * `children` is the crawlable tail — the page's prose and the site's internal
 * link map, handed in from the server page.
 *
 * It has to render INSIDE `.mhome`, not after it. `.mhome` is
 * `position: fixed; inset: 0` with its own `overflow-y: auto`, so anything
 * following it in the document sits underneath a full-viewport overlay: laid
 * out at y=0 and never reachable by scrolling. Text a reader cannot reach is
 * cloaking — a worse problem than the thin page it would be fixing. Inside
 * this container it scrolls with everything else and is just the page's end.
 */
export default function MinimalHome({
  initialQuery = "",
  children,
}: {
  initialQuery?: string;
  children?: React.ReactNode;
}) {
  const t = useTranslations("Home");
  const tFooter = useTranslations("Footer");
  const params = useParams();
  const router = useRouter();
  const locale = (params?.locale as string) || "en";
  const isNarrow = useIsNarrowViewport();

  // Seeded (server-side) from ?q= so returning to the home page — e.g. browser
  // Back out of the graph — restores the last search instead of a blank box.
  const [q, setQ] = useState(initialQuery);
  const [dq, setDq] = useState(initialQuery);
  const [raised, setRaised] = useState(false);
  const [idx, setIdx] = useState<RootStatsIndex | null>(null);
  const [nameIdx, setNameIdx] = useState<NameStatsIndex | null>(null);
  const [formIdx, setFormIdx] = useState<FormIndex | null>(null);
  // Lemma/form drill-down stats — lazy, only once a root result is shown (~2 MB
  // raw / ~0.5 MB brotli), so the resting home page never loads it.
  const [drillIdx, setDrillIdx] = useState<LemmaFormStats | null>(null);
  // The candidate the user picked from the chooser (null = show chooser / the
  // sole candidate). Cleared whenever the query changes.
  const [selected, setSelected] = useState<HomeHit | null>(null);
  // Featured root is stable for the whole local calendar day — same root all
  // day, changing at local midnight — not per session/reload. This is a plain
  // integer day count (for `idx.featured[epochDay % length]`), not a PRNG
  // seed, so it doesn't reuse lib/quiz's date-seed convention (dailyPuzzle.ts
  // / personalizedQuiz.ts hash a UTC-calendar-day string into a mulberry32
  // seed to shuffle a shared, same-for-everyone quiz); that's a different
  // shape of value for a different purpose. Computed once on mount — cheap,
  // and the day boundary shifting under a long-lived tab is a non-issue here.
  const [epochDay] = useState(() => Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000));

  useEffect(() => {
    let on = true;
    loadRootStats()
      .then((d) => on && setIdx(d))
      .catch(() => {});
    // Root-less names/words (Moses, Mary, من, حتى…) live in a parallel index so
    // typing a name resolves to its own occurrence card instead of "no match".
    loadNameStats()
      .then((d) => on && setNameIdx(d))
      .catch(() => {});
    // Surface-form → root index: lets an inflected word (اسم, اسماء) resolve to
    // its root so the chooser can offer it beside same-prefix names.
    loadFormIndex()
      .then((d) => on && setFormIdx(d))
      .catch(() => {});
    return () => {
      on = false;
    };
  }, []);

  // Suppress the global site chrome (footer) for a calm, minimal landing.
  useEffect(() => {
    document.documentElement.classList.add("mhome-active");
    return () => document.documentElement.classList.remove("mhome-active");
  }, []);

  // Debounce the query that drives the panel — the view settles once you pause,
  // instead of flickering result/no-match on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDq(q), 200);
    return () => clearTimeout(timer);
  }, [q]);

  // The search bar rides up as soon as it holds text, and lingers a few seconds
  // after being emptied before settling back down (no abrupt drop).
  useEffect(() => {
    if (q.trim().length > 0) {
      setRaised(true);
      return;
    }
    const timer = setTimeout(() => setRaised(false), 2500);
    return () => clearTimeout(timer);
  }, [q]);

  // Mirror the committed query into the URL (?q=) through Next's router so it
  // OWNS the entry. PUSH a new entry on the resting→search transition (so Back
  // lands on the resting home instead of leaving the site), REPLACE for every
  // later edit/clear (no history spam). Opening a result pushes a ?viz= entry,
  // so Back from the graph returns here with ?q= intact (see initialQuery).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const current = new URLSearchParams(window.location.search).get("q") ?? "";
    const term = dq.trim();
    if (current === term) return;
    const url = term ? `/${locale}?q=${encodeURIComponent(term)}` : `/${locale}`;
    if (current === "" && term !== "") router.push(url, { scroll: false });
    else router.replace(url, { scroll: false });
  }, [dq, locale, router]);

  // /en and /en?q= both render this component (no remount), so Back/Forward
  // between them must reconcile React state to the URL — otherwise a stale
  // query lingers. Restores the resting home on Back out of a search.
  useEffect(() => {
    const onPop = () => {
      const urlQ = new URLSearchParams(window.location.search).get("q") ?? "";
      setQ(urlQ);
      setDq(urlQ);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Deliberate picks (chips / today / suggestions) resolve immediately.
  const pick = useCallback((v: string) => {
    setQ(v);
    setDq(v);
  }, []);

  // All plausible matches for the query — root(s) AND name(s) — so a shared
  // prefix (e.g. اسم → root سمو + name إسماعيل, عمر → root عمر + name عمران)
  // doesn't silently occlude one behind the other. Ranked: exact match first,
  // then by occurrence count. When more than one survives, the UI shows a
  // chooser instead of guessing.
  const candidates = useMemo<HomeHit[]>(() => {
    const q = dq.trim();
    if (!q || !idx || !nameIdx) return [];
    const out: HomeHit[] = [];
    const seen = new Set<string>();
    // Hits that answer the query DIRECTLY, recorded at push time rather than
    // re-derived below: a hit's own key can't tell you it was exact. رحم reached
    // from "الرحمن" through the form index IS the answer the user typed, yet its
    // bare form doesn't equal the query — so key comparison would rank it level
    // with a loose prefix guess and let a commoner root outrank it on frequency.
    const direct = new Set<string>();
    const hitKey = (h: HomeHit) => (isNameHit(h) ? `n:${h.key}` : `r:${h.bare}`);
    const pushRoot = (bare?: string, isDirect = false) => {
      if (!bare) return;
      const r = idx.roots[bare];
      if (r && !seen.has(`r:${bare}`)) {
        seen.add(`r:${bare}`);
        if (isDirect) direct.add(`r:${bare}`);
        out.push(r);
      }
    };
    const pushName = (e?: NameStat | null, isDirect = false) => {
      if (e && !seen.has(`n:${e.key}`)) {
        seen.add(`n:${e.key}`);
        if (isDirect) direct.add(`n:${e.key}`);
        out.push(e);
      }
    };

    // Multi-word queries are phrases / compound names; a sub-word's root would
    // just be noise, so only match names (compounds) for them.
    const multiWord = /\s/.test(q);

    // Exact / direct matches.
    pushName(nameIdx ? lookupName(nameIdx, q) : null, true);
    if (!multiWord) {
      const lr = lookupRoot(idx, q);
      if (lr) pushRoot(lr.bare, true);
      // Inflected surface word → its root (اسم → سمو, الرحمن → رحم).
      if (formIdx) pushRoot(lookupFormRoot(formIdx, q) ?? undefined, true);
    }
    // Same-prefix alternatives (partial typing).
    for (const e of namePrefixMatches(nameIdx, q)) pushName(e);
    if (!multiWord) for (const r of rootPrefixMatches(idx, q)) pushRoot(r.bare);

    // Three tiers, because suggestions now start at the first keystroke and a
    // one-letter query drags in the most common roots in the Qurʾān — without
    // this ordering they bury the word actually typed:
    //   0. the query IS this entry's key (رحم typed, رحم found)
    //   1. resolved from the query (الرحمن → رحم, موس → موسى) — exact in intent,
    //      but its key differs, so key comparison alone would miss it
    //   2. same-prefix suggestions, by frequency
    const qn = normalizeArabicForSearch(q);
    const rank = (h: HomeHit) => {
      const key = isNameHit(h) ? h.key : normalizeArabicForSearch(h.bare);
      if (key === qn) return 0;
      return direct.has(hitKey(h)) ? 1 : 2;
    };
    out.sort((a, b) => rank(a) - rank(b) || b.count - a.count);
    return out.slice(0, 8);
  }, [idx, nameIdx, formIdx, dq]);

  // The single result to render: an explicit chooser pick, or the sole
  // candidate. More than one (and no pick) → show the chooser.
  const active = selected ?? (candidates.length === 1 ? candidates[0] : null);
  const showChooser = !selected && candidates.length > 1;

  // Drill-down (root → lemma → form): fetch the stats once a ROOT result is
  // shown, then resolve the typed word's specific lemma + exact form so the
  // result panel can offer the "exact match" narrowing.
  // Prefetch as soon as there's a query (not just once a root result renders),
  // so the drill stats are ready when the panel mounts — the smart default
  // (lead with Word for a specific typed word) then applies without a visible
  // Root→Word flip. Cached after the first load, so it's paid once per session.
  const hasTypedQuery = dq.trim().length > 0;
  useEffect(() => {
    if (!hasTypedQuery || drillIdx) return;
    let on = true;
    loadLemmaFormStats().then((d) => on && setDrillIdx(d)).catch(() => {});
    return () => { on = false; };
  }, [hasTypedQuery, drillIdx]);
  const drill = useMemo<{ lemma: DrillEntry | null; form: DrillEntry | null } | null>(() => {
    if (!active || isNameHit(active) || !drillIdx) return null;
    const term = dq.trim();
    if (!term) return null;
    // A drill entry must belong to the root being displayed. lookupLemma /
    // lookupForm match the TYPED TEXT against a global index, so "أب" returns
    // أَبٌ (47×, root ابو) whichever root the chooser picked — which is how
    // choosing ا-ب-ب (أَبًّا "fodder", 1×) rendered father's 47 occurrences and
    // father's verses under a correct "الجذر 1" tile. An entry with no root of
    // its own belongs to no root, so it cannot belong to this one either.
    const bare = active.bare;
    const ofRoot = (e: DrillEntry | null) => (e && e.r === bare ? e : null);
    return { lemma: ofRoot(lookupLemma(drillIdx, term)), form: ofRoot(lookupForm(drillIdx, term)) };
  }, [active, drillIdx, dq]);

  const today = useMemo(() => (idx ? rootOfTheDay(idx, epochDay) : null), [idx, epochDay]);
  const todayGloss = useMemo(() => (today ? resolveGloss(locale, today.bare, today.gloss) : null), [today, locale]);
  const chips = useMemo(() => (idx ? idx.featured.slice(0, 6).map((b) => idx.roots[b]).filter(Boolean) : []), [idx]);
  const suggestions = useMemo(() => (idx ? idx.featured.slice(0, 3).map((b) => idx.roots[b]).filter(Boolean) : []), [idx]);

  const hasQuery = dq.trim().length > 0;
  const hasResult = active !== null || showChooser;
  // Wait for BOTH indexes before declaring "no match", so a name doesn't flash
  // no-match while the name index is still loading.
  const noMatch = hasQuery && !!idx && !!nameIdx && candidates.length === 0;

  // A new query clears any prior chooser selection.
  useEffect(() => {
    setSelected(null);
  }, [dq]);

  const enterApp = useCallback(
    (root?: string, viz = "root-network", surah?: number) => {
      const sp = new URLSearchParams({ viz });
      if (root) {
        sp.set("root", root);
        // First contact from home lands calm: dock collapsed, drawer closed,
        // focused constellation only — chrome reveals as the user reaches
        // for it (see AppShell's deep-link hydration).
        sp.set("entry", "calm");
      }
      // Surah-scoped views should land where the root actually occurs.
      if (surah) sp.set("surah", String(surah));
      router.push(`/${locale}?${sp.toString()}`);
    },
    [locale, router]
  );

  /**
   * Correlation search — the home half of the الجوار idea. A companion word
   * typed here is answered with the ayahs where it stands WITH the current
   * result. Computed server-side (/api/corpus/cooccurrence): the home page
   * carries no corpus by design, and the offline indexes cap refs at 10 per
   * entry, so client-side intersection would break on any word with more than
   * ten occurrences — إنسان alone has 71.
   */
  const [pairOpen, setPairOpen] = useState(false);
  const [pairQ, setPairQ] = useState("");
  const [pairDq, setPairDq] = useState("");
  interface PairRes {
    count: number;
    xOccurrences: number;
    surahs: number;
    first: { sura: number; ayah: number } | null;
    top: [number, number, number][];
    hist: number[];
    ayahs: { sura: number; ayah: number; word: number; text: string }[];
  }
  const [pairRes, setPairRes] = useState<PairRes | null>(null);
  /** ayah = exact shared ayah · w5 = within ±5 words · adjacent = ayah ±1. */
  const [pairWindow, setPairWindow] = useState<"ayah" | "w5" | "adjacent">("ayah");
  /** Reach of the adjacent window (± ayahs), 1–10. */
  const [pairSpan, setPairSpan] = useState(1);
  const [pairBusy, setPairBusy] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setPairDq(pairQ.trim()), 450);
    return () => clearTimeout(id);
  }, [pairQ]);
  // A new primary result resets the companion; closing the bar clears it.
  useEffect(() => { setPairQ(""); setPairDq(""); setPairRes(null); setPairWindow("ayah"); setPairSpan(1); }, [active?.bare]);
  useEffect(() => { if (!pairOpen) { setPairQ(""); setPairDq(""); setPairRes(null); } }, [pairOpen]);
  useEffect(() => {
    if (!pairOpen || !pairDq || !active) { setPairRes(null); return; }
    const xkind = isNameHit(active) ? "lemma" : "root";
    const x = isNameHit(active) ? (active.lemma || active.bare) : active.bare;
    // Two spellings travel: the word as typed (the DB normalizes toward
    // full-alif spellings, which is how people type) and the QAC-resolved
    // lemma (rasm), whichever of the two the database actually holds.
    const y = pairDq;
    const yalt = drillIdx ? lookupLemma(drillIdx, pairDq)?.d ?? "" : "";
    const ac = new AbortController();
    setPairBusy(true);
    fetch(`/api/corpus/cooccurrence?xkind=${xkind}&x=${encodeURIComponent(x)}&y=${encodeURIComponent(y)}${yalt ? `&yalt=${encodeURIComponent(yalt)}` : ""}&window=${pairWindow}${pairWindow === "adjacent" ? `&span=${pairSpan}` : ""}&limit=10`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && typeof d.count === "number") setPairRes(d);
        else setPairRes({ count: 0, xOccurrences: 0, surahs: 0, first: null, top: [], hist: [], ayahs: [] });
      })
      .catch(() => {})
      .finally(() => setPairBusy(false));
    return () => ac.abort();
  }, [pairOpen, pairDq, active, drillIdx, pairWindow, pairSpan]);

  const pairActive = pairOpen && !!pairDq && !!pairRes && pairRes.count > 0 && !!active;
  // The SAME result card, scoped to the co-occurrence subset. Every field the
  // card renders (headline count, tiles, histogram, top chips, carousel
  // totals) reads the stat, so overriding the stat IS the pair mode.
  const pairStat = useMemo<HomeHit | null>(() => {
    if (!pairActive || !active || !pairRes) return null;
    return {
      ...active,
      count: pairRes.xOccurrences,
      surahs: pairRes.surahs,
      verses: pairRes.count,
      forms: 0,
      first: pairRes.first,
      top: pairRes.top,
      hist: pairRes.hist,
    } as HomeHit;
  }, [pairActive, active, pairRes]);
  const pairVerses = useMemo<OccurrenceAyah[] | null>(
    () => (pairActive && pairRes ? pairRes.ayahs.map((a) => ({ sura: a.sura, ayah: a.ayah, text: a.text, positions: [a.word] })) : null),
    [pairActive, pairRes],
  );

  const enterAyah = useCallback(
    (s: number, a: number, w: number, root: string) => {
      const sp = new URLSearchParams({
        viz: "radial-sura",
        surah: String(s),
        ayah: String(a),
        token: `${s}:${a}:${w}`,
        root,
      });
      router.push(`/${locale}?${sp.toString()}`);
    },
    [locale, router]
  );

  // Names have no root, so they can't use enterApp (?root=… is meaningless
  // downstream). Focus the name's first occurrence via ?token — the inspector
  // groups by that token's lemma (the name) and shows its full occurrence card.
  const enterName = useCallback(
    (stat: NameStat) => {
      const sp = new URLSearchParams({ viz: "radial-sura", entry: "calm" });
      if (stat.rep) {
        sp.set("surah", String(stat.rep.sura));
        sp.set("ayah", String(stat.rep.ayah));
        sp.set("token", `${stat.rep.sura}:${stat.rep.ayah}:${stat.rep.word}`);
      }
      if (stat.lemma) sp.set("lemma", stat.lemma);
      router.push(`/${locale}?${sp.toString()}`);
    },
    [locale, router]
  );

  // Open one specific ayah (from the result verse carousel) in the observatory.
  const openAyah = useCallback(
    // `word` is the 1-indexed matched word position (from the occurrence API):
    // deep-link it as the focused token so the graph highlights that exact
    // ayah + the inspector shows the SEARCHED word — not the ayah's first
    // proclitic (a bare ?ayah= resolves to word 1, e.g. the "وَ" conjunction).
    (s: number, a: number, word?: number) => {
      const sp = new URLSearchParams({ viz: "radial-sura", surah: String(s), ayah: String(a), entry: "calm" });
      if (word && word > 0) sp.set("token", `${s}:${a}:${word}`);
      router.push(`/${locale}?${sp.toString()}`);
    },
    [locale, router]
  );

  return (
    <div className={`mhome ${hasResult ? "has-result" : ""}`}>
      <div className="mhome-atmos" aria-hidden="true" />

      {/* corner mark + lang/skip — standard logo affordance: click returns to
          the resting home state (clears any live search) */}
      <button
        type="button"
        className="mhome-mark"
        onClick={() => {
          setQ("");
          setDq("");
          setRaised(false);
        }}
        aria-label="Quranic Linguistics Observatory"
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "inherit", font: "inherit" }}
      >
        <span className="mhome-glyph">
          {/* Same mark as the observatory TopBar so the brand reads as one
              site across surfaces. */}
          <Image src="/favicon.svg" alt="" width={22} height={22} />
        </span>
        <span className="mhome-wordmark">
          {t("wordmark1")}
          <br />
          {t("wordmark2")}
        </span>
      </button>
      {/* The minimal home hides the site footer, but the Kais Dukes /
          Quranic Arabic Corpus credit is a standing rule on EVERY page —
          a slim fixed line stands in for the full footer here. */}
      <a
        className="mhome-credit"
        href="https://corpus.quran.com/"
        target="_blank"
        rel="noopener noreferrer"
        title={tFooter("creditTitle")}
      >
        {tFooter("credit")}
      </a>

      <div className="mhome-topright">
        <div className="mhome-lang">
          <LanguageSwitcher />
        </div>
        <button type="button" className="mhome-skip" onClick={() => enterApp(undefined, "radial-sura")}>
          {t("skipToApp")}
        </button>
        {/* Signed-in state must be visible on the landing too — same badge
            as the observatory header. Outermost slot, like every app's
            header: actions first, identity at the edge. */}
        <AuthButton />
      </div>

      <div className={`mhome-stack ${raised ? "is-active" : ""}`}>
        {/* The headline is an ayah (Fussilat 41:3) — Arabic in BOTH locales,
            so the element pins its own lang/dir instead of inheriting the
            page locale's. */}
        <h1 className={`mhome-headline ${hasQuery ? "is-hidden" : ""}`} lang="ar" dir="rtl">
          {t("headline")}
        </h1>

        {/* search box */}
        <div className="mhome-search">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.5" y2="16.5" />
          </svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              // Enter = resolve now (skip the debounce); Escape = clear.
              if (e.key === "Enter") setDq(q);
              else if (e.key === "Escape") {
                setQ("");
                setDq("");
              }
            }}
            placeholder={isNarrow ? t("placeholderShort") : t("placeholder")}
            aria-label={t("eyebrow")}
            autoComplete="off"
            spellCheck={false}
          />
          {active && (
            <button
              type="button"
              className={`mhome-pair-btn ${pairOpen ? "is-on" : ""}`}
              title={t("pairButton")}
              aria-label={t("pairButton")}
              aria-expanded={pairOpen}
              onClick={() => setPairOpen((o) => !o)}
            >
              ⇄
            </button>
          )}
          {active ? (
            <span className="mhome-matched">
              <span className="mhome-match-dot" style={{ background: rootColor(active) }} />
              {isNameHit(active) ? t("matchedName", { name: active.root }) : t("matched", { root: active.root })}
            </span>
          ) : showChooser ? (
            <span className="mhome-matched">{t("matchesCount", { n: candidates.length })}</span>
          ) : (
            <kbd className="mhome-enter">{t("enterHint")} ⏎</kbd>
          )}
        </div>

        {/* correlation bar — a second, smaller question under the first */}
        {pairOpen && active && (
          <div className="mhome-pair">
            <div className="mhome-pair-bar">
              <input
                value={pairQ}
                onChange={(e) => setPairQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") setPairOpen(false); }}
                placeholder={t("pairPlaceholder", { word: active.root })}
                aria-label={t("pairButton")}
                autoComplete="off"
                spellCheck={false}
                dir="rtl"
              />
              <button type="button" className="mhome-pair-x" aria-label={t("closeVerse")} onClick={() => setPairOpen(false)}>×</button>
            </div>
            {pairDq && (
              <div className="mhome-pair-windows header-button-group" role="group" aria-label={t("pairWindowLabel")}>
                {(["ayah", "w5", "adjacent"] as const).map((w) => (
                  <button
                    key={w}
                    type="button"
                    className={`control-pill-btn ${pairWindow === w ? "active" : ""}`}
                    onClick={() => setPairWindow(w)}
                  >
                    {w === "ayah"
                      ? t("pairWinAyah")
                      : w === "w5"
                        ? t("pairWinW5")
                        : t("pairWinAdjacent", { n: pairSpan })}
                  </button>
                ))}
                {pairWindow === "adjacent" && (
                  <span className="mhome-pair-span" role="group" aria-label={t("pairSpanLabel")}>
                    <button
                      type="button"
                      className="control-pill-btn"
                      aria-label={t("pairSpanLess")}
                      disabled={pairSpan <= 1}
                      onClick={() => setPairSpan((n) => Math.max(1, n - 1))}
                    >
                      −
                    </button>
                    <span className="mhome-pair-span-n" dir="ltr">± {pairSpan}</span>
                    <button
                      type="button"
                      className="control-pill-btn"
                      aria-label={t("pairSpanMore")}
                      disabled={pairSpan >= 10}
                      onClick={() => setPairSpan((n) => Math.min(10, n + 1))}
                    >
                      +
                    </button>
                  </span>
                )}
              </div>
            )}
            {pairDq && (
              pairBusy && !pairRes ? (
                <p className="mhome-pair-note">{t("pairSearching")}</p>
              ) : pairRes && pairRes.count > 0 ? (
                <div className="mhome-pair-notewrap">
                  <p className="mhome-pair-note">
                    {t("pairCount", { n: pairRes.count, x: active.root, y: pairDq })}
                  </p>
                  {/* The card shows ten ayahs at most; the full set lives in the
                      search workspace, which runs the SAME question through the
                      قرب: operator — client-side, uncapped, previewable. */}
                  <button
                    type="button"
                    className="mhome-rv-more"
                    onClick={() =>
                      router.push(
                        `/${locale}/search?q=${encodeURIComponent(`${dq.trim() || active.bare} قرب:${pairDq}`)}`,
                      )
                    }
                  >
                    {t("pairSeeAll", { n: pairRes.count })} <span aria-hidden="true">→</span>
                  </button>
                </div>
              ) : pairRes ? (
                <p className="mhome-pair-note">{t("pairNone", { x: active.root, y: pairDq })}</p>
              ) : null
            )}
          </div>
        )}

        {/* reveal zone */}
        <div className="mhome-reveal">
          {active ? (
            <ResultPanel
              stat={pairActive && pairStat ? pairStat : active}
              pairWith={pairActive ? pairDq : null}
              onClearPair={() => setPairOpen(false)}
              pairVerses={pairActive ? pairVerses : null}
              drill={pairActive ? null : drill}
              query={dq.trim()}
              formIdx={formIdx}
              drillIdx={drillIdx}
              t={t}
              onExplore={enterApp}
              onExploreName={enterName}
              onOpenAyah={openAyah}
              onBack={selected && candidates.length > 1 ? () => setSelected(null) : () => window.history.back()}
            />
          ) : showChooser ? (
            <ResultChooser candidates={candidates} t={t} onPick={setSelected} />
          ) : noMatch ? (
            <div className="mhome-nomatch">
              <p>{t("noMatch", { q: q.trim() })}</p>
              <div className="mhome-chips">
                {suggestions.map((r) => {
                  const g = resolveGloss(locale, r.bare, r.gloss);
                  return (
                    <button key={r.bare} type="button" className="mhome-chip is-suggest" onClick={() => pick(r.bare)}>
                      <span dir="rtl" lang="ar" className="mhome-chip-ar">
                        {r.root}
                      </span>
                      <span
                        className={g?.isAr ? "mhome-gloss-ar" : undefined}
                        dir={g?.isAr ? "rtl" : undefined}
                        lang={g?.isAr ? "ar" : undefined}
                      >
                        {g?.text.split(/[/·]/)[0].trim()}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="mhome-resting">
              {/* Common roots — right beneath the search bar. */}
              <div className="mhome-chips">
                {chips.map((r) => {
                  const g = resolveGloss(locale, r.bare, r.gloss);
                  return (
                    <button key={r.bare} type="button" className="mhome-chip" onClick={() => pick(r.bare)}>
                      <span dir="rtl" lang="ar" className="mhome-chip-ar">
                        {r.root}
                      </span>
                      {g && (
                        <span
                          className={`mhome-chip-gloss ${g.isAr ? "mhome-gloss-ar" : ""}`}
                          dir={g.isAr ? "rtl" : undefined}
                          lang={g.isAr ? "ar" : undefined}
                        >
                          {g.text.split(/[/·]/)[0].trim()}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Today's root — editorial, uncontained, with a verse carousel. */}
              {today && (
                <section className="mhome-today" aria-label={t("todaysRoot")}>
                  <div className="mhome-today-head">
                    <span className="mhome-today-eyebrow">{t("todaysRoot")}</span>
                    <button type="button" className="mhome-today-all" onClick={() => pick(today.bare)}>
                      {t("seeAll")}
                    </button>
                  </div>
                  <div className="mhome-today-masthead">
                    <div className="mhome-today-id">
                      <span dir="rtl" lang="ar" className="mhome-today-ar" style={{ color: rootColor(today) }}>
                        {today.root}
                      </span>
                      <div className="mhome-today-idmeta">
                        {locale !== "ar" && <span className="mhome-today-translit">{today.translit}</span>}
                        {todayGloss && (
                          <span
                            className={`mhome-today-gloss ${todayGloss.isAr ? "mhome-gloss-ar" : ""}`}
                            dir={todayGloss.isAr ? "rtl" : "ltr"}
                            lang={todayGloss.isAr ? "ar" : undefined}
                          >
                            “{todayGloss.text}”
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="mhome-today-stats">
                      <div className="mhome-today-stat">
                        <span className="mhome-today-stat-n" style={{ color: rootColor(today) }}>
                          {today.count.toLocaleString()}
                        </span>
                        <span className="mhome-today-stat-l">{t("statOccurrences")}</span>
                      </div>
                      <div className="mhome-today-stat">
                        <span className="mhome-today-stat-n">
                          {today.surahs}
                          <span className="mhome-today-stat-of"> / 114</span>
                        </span>
                        <span className="mhome-today-stat-l">{t("statSurahs")}</span>
                      </div>
                    </div>
                  </div>
                  {today.examples && today.examples.length > 0 && (
                    <VerseCarousel
                      examples={today.examples}
                      color={rootColor(today)}
                      rootBare={today.bare}
                      glossOf={(r) => resolveGloss(locale, r, idx?.roots[r]?.gloss)}
                      onOpenGraph={(ex) => enterAyah(ex.s, ex.a, ex.w, today.bare)}
                    />
                  )}
                </section>
              )}
            </div>
          )}
        </div>
      </div>

      {children}

      <style jsx>{styles}</style>
    </div>
  );
}

/**
 * Disambiguation list — shown when a query matches more than one entity (a root
 * and a same-prefix name, several names, …). The user picks; that choice then
 * renders as the full result card.
 */
function ResultChooser({
  candidates,
  t,
  onPick,
}: {
  candidates: HomeHit[];
  t: ReturnType<typeof useTranslations>;
  onPick: (hit: HomeHit) => void;
}) {
  const locale = useLocale();
  return (
    <div className="mhome-chooser">
      <div className="mhome-chooser-lab">{t("chooserTitle")}</div>
      <div className="mhome-chooser-list">
        {candidates.map((c) => {
          const isName = isNameHit(c);
          const ar = isName ? c.root : c.bare;
          const gloss = resolveGloss(locale, c.bare, c.gloss);
          const color = rootColor(c);
          return (
            <button
              key={`${isName ? "n" : "r"}:${isName ? c.key : c.bare}`}
              type="button"
              className="mhome-chooser-row"
              onClick={() => onPick(c)}
            >
              <span className="mhome-chooser-dot" style={{ background: color }} />
              <span className="mhome-chooser-ar" dir="rtl" lang="ar">{ar}</span>
              <span className="mhome-chooser-meta">
                <span className="mhome-chooser-kind">{isName ? t("kindName") : t("kindRoot")}</span>
                {gloss && (
                  <span
                    className={gloss.isAr ? "mhome-gloss-ar" : undefined}
                    dir={gloss.isAr ? "rtl" : undefined}
                    lang={gloss.isAr ? "ar" : undefined}
                  >
                    {gloss.text.split(/[/·]/)[0].trim()}
                  </span>
                )}
              </span>
              <span className="mhome-chooser-count" style={{ color }}>
                {c.count.toLocaleString()}
                <span className="mhome-chooser-x">×</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ResultPanel({
  stat,
  pairWith = null,
  pairVerses = null,
  onClearPair,
  drill,
  query,
  formIdx,
  drillIdx,
  t,
  onExplore,
  onExploreName,
  onOpenAyah,
  onBack,
}: {
  stat: HomeHit;
  /** Correlation mode: the companion word. The SAME card renders, scoped to
      the ayahs both words share — the caller pre-scopes `stat` and supplies
      the shared verses; here it only reshapes highlighting and hides the
      drill/forms furniture, whose subset counts the pair API does not know. */
  pairWith?: string | null;
  pairVerses?: OccurrenceAyah[] | null;
  /** Clears correlation mode (the ⇄ chip doubles as the exit). */
  onClearPair?: () => void;
  drill: { lemma: DrillEntry | null; form: DrillEntry | null } | null;
  query: string;
  formIdx: FormIndex | null;
  drillIdx: LemmaFormStats | null;
  t: ReturnType<typeof useTranslations>;
  onExplore: (root?: string, viz?: string, surah?: number) => void;
  onExploreName: (stat: NameStat) => void;
  onOpenAyah: (sura: number, ayah: number, word?: number) => void;
  onBack: () => void;
}) {
  const color = rootColor(stat);
  const surahName = useSurahName();
  const locale = useLocale();
  const isName = isNameHit(stat);
  const resultGloss = resolveGloss(locale, stat.bare, stat.gloss);
  const maxTop = Math.max(1, ...stat.top.map((x) => x[1]));
  // External classical-dictionary lookup word. Roots use the hamza-citation
  // form (corpus writes hamza as plain alif, e.g. امن → أمن) that Almaany/Doha
  // index by; names/words go as-is.
  const dictWord = isName ? stat.bare : stat.bare.replace(/[اأإآٱئؤء]/g, "أ");

  const statId = isName ? stat.key : stat.bare;

  // Exact-match drill-down: narrow a root result to its specific lemma (word +
  // inflections) or exact surface form. Only offered for roots that actually
  // resolve to a lemma/form.
  const [gran, setGran] = useState<"root" | "lemma" | "form">("root");
  // Smart default: if the user typed a SPECIFIC word (its normalized form isn't
  // the bare root — e.g. قرآن, whose root قرا also covers the unrelated قروء)
  // and that word has a lemma, lead with the Word view so they see just that
  // word, not the whole root family. A bare-root query (قرا) stays on Root, and
  // once the user picks a tab their choice sticks (no snap-back on data load).
  const typedSpecificWord =
    !isName && !!query && normalizeArabicForSearch(query) !== stat.bare;
  const userChoseGranRef = useRef(false);
  useEffect(() => {
    userChoseGranRef.current = false;
    setGran("root");
  }, [statId]);
  useEffect(() => {
    if (userChoseGranRef.current) return;
    setGran(typedSpecificWord && drill?.lemma ? "lemma" : "root");
  }, [typedSpecificWord, drill]);
  const chooseGran = (g: "root" | "lemma" | "form") => {
    userChoseGranRef.current = true;
    setGran(g);
  };

  // Sūrah of the verse currently shown in the carousel → the strip spotlights it.
  const [activeSura, setActiveSura] = useState<number | null>(null);
  useEffect(() => setActiveSura(null), [statId]);
  const showDrill = !pairWith && !isName && !!drill && !!(drill.lemma || drill.form);
  const drillEntry: DrillEntry | null =
    gran === "lemma" ? drill?.lemma ?? null : gran === "form" ? drill?.form ?? null : null;
  const drilling = drillEntry !== null;

  // Preview ayahs that contain the searched word — lazily fetched (best-effort).
  // Drill-down views fetch by precomputed refs; compound (multi-word) names
  // carry explicit occurrence refs (no single lemma); everything else fetches
  // by lemma (names) or bare root.
  const occ = isName ? (stat as NameStat).occ : undefined;
  const fetchTerm = isName ? stat.lemma : stat.bare;
  const canFetchVerses =
    drilling || (occ != null && occ.length > 0) || (Boolean(fetchTerm) && !/\s/.test(fetchTerm));
  const [verses, setVerses] = useState<OccurrenceAyah[] | null>(canFetchVerses ? null : []);
  useEffect(() => {
    if (pairVerses) {
      setVerses(pairVerses);
      return;
    }
    if (!canFetchVerses) {
      setVerses([]);
      return;
    }
    setVerses(null);
    const ac = new AbortController();
    const request = drillEntry
      ? fetchOccurrencesByRefs(
          drillEntry.refs.map(([s, a, w]) => [s, a, w, 1] as [number, number, number, number]),
          10,
          ac.signal,
        )
      : occ != null && occ.length > 0
        ? fetchOccurrencesByRefs(occ, 10, ac.signal)
        : fetchOccurrences(isName ? "lemma" : "root", fetchTerm, 10, ac.signal);
    request.then((a) => setVerses(a));
    return () => ac.abort();
    // statId identifies the result; gran switches the drill-down granularity.
  }, [statId, isName, gran, pairVerses]);

  // What the count card + carousel reflect: the drilled lemma/form, else root.
  const displayCount = drilling ? drillEntry!.c : stat.count;
  const displayArabic = drilling ? drillEntry!.d : stat.root;
  const versesTotal = drilling ? drillEntry!.c : stat.verses;

  // Does a (normalized) rendered word belong to the current search target?
  // Content-based so it survives the corpus's QAC-vs-Uthmani word-numbering
  // drift (see ResultVerses). Root → the word's root; lemma → the word's lemma;
  // form → exact spelling; name → the name's surface (proclitic-tolerant).
  const pairKeys = useMemo(() => {
    if (!pairWith) return null;
    const keys = new Set<string>();
    const add = (v?: string | null) => {
      if (!v) return;
      const k = foldRasmAlef(normalizeArabicForSearch(v));
      if (k.length >= 2) keys.add(k);
    };
    add(pairWith);
    if (drillIdx) {
      const lem = lookupLemma(drillIdx, pairWith);
      add(lem?.d);
      if (lem?.r) add(lem.r);
    }
    return keys;
  }, [pairWith, drillIdx]);

  const formKey = drill?.form ? normalizeArabicForSearch(drill.form.d) : null;
  const lemmaKey = drill?.lemma ? normalizeArabicForSearch(drill.lemma.d) : null;
  const isHit = useCallback(
    (w: string): boolean => {
      if (!w) return false;
      if (pairKeys) {
        const folded = foldRasmAlef(w);
        for (const k of pairKeys) {
          if (folded === k || folded.includes(k)) return true;
        }
        // fall through: X's own match rules apply as usual
      }
      if (gran === "form") return !!formKey && (w === formKey || foldRasmAlef(w) === formKey);
      if (gran === "lemma") {
        if (!lemmaKey || !drillIdx) return false;
        const e = drillIdx.forms[w] ?? drillIdx.forms[foldRasmAlef(w)];
        return e?.l === lemmaKey;
      }
      if (isName) {
        const target = normalizeArabicForSearch((stat as NameStat).lemma || stat.bare);
        if (!target) return false;
        const stripped = w.replace(/^(وال|فال|بال|كال|لل|ال|و|ف|ب|ك|ل)/, "");
        return w === target || stripped === target || foldRasmAlef(w) === target;
      }
      return !!formIdx && lookupFormRoot(formIdx, w) === stat.bare;
    },
    [gran, formKey, lemmaKey, drillIdx, isName, stat, formIdx],
  );

  return (
    <div className={`mhome-result ${pairWith ? "is-paired" : ""}`}>
      <button type="button" className="mhome-back" onClick={onBack}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        {t("back")}
      </button>
      <div className="mhome-result-head">
        <div className="mhome-count">
          {displayCount.toLocaleString()}
        </div>
        <div className="mhome-count-lab">
          <div className="mhome-occ">
            {pairWith ? t("pairOccurrencesWith", { y: pairWith }) : t("occurrences")}
          </div>
          <div className="mhome-ident">
            {pairWith && (
              <button
                type="button"
                className="mhome-pair-with"
                dir="rtl"
                lang="ar"
                title={t("pairClear")}
                onClick={onClearPair}
              >
                ⇄ {pairWith} ×
              </button>
            )}
            <span dir="rtl" lang="ar" className="mhome-ident-ar" style={{ color }}>
              {displayArabic}
            </span>
            {!drilling && locale !== "ar" && <span className="mhome-ident-tr">{stat.translit}</span>}
            {!drilling && resultGloss && (
              <span
                className={`mhome-ident-gl ${resultGloss.isAr ? "mhome-gloss-ar" : ""}`}
                dir={resultGloss.isAr ? "rtl" : "ltr"}
                lang={resultGloss.isAr ? "ar" : undefined}
              >
                “{resultGloss.text}”
              </span>
            )}
            {/* Classical-dictionary lookups (Almaany · لسان العرب, Doha) — small
                external links for deeper etymology. */}
            <span className="mhome-dict">
              <a
                className="mhome-dict-badge"
                href={`https://www.almaany.com/ar/dict/ar-ar/${dictWord}/?c=${encodeURIComponent("لسان العرب")}`}
                target="_blank"
                rel="noopener noreferrer"
                title={t("dictAlmaany", { word: dictWord })}
                aria-label={t("dictAlmaany", { word: dictWord })}
              >
                <span lang="ar" dir="rtl">المعاني</span>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
              <a
                className="mhome-dict-badge"
                href={`https://www.dohadictionary.org/dictionary/${encodeURIComponent(dictWord)}`}
                target="_blank"
                rel="noopener noreferrer"
                title={t("dictDoha", { word: dictWord })}
                aria-label={t("dictDoha", { word: dictWord })}
              >
                <span lang="ar" dir="rtl">معجم الدوحة</span>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            </span>
          </div>
        </div>
      </div>

      {showDrill && (
        <>
          <div className="mhome-drill" role="tablist" aria-label={t("exactLabel")}>
            {(["root", "lemma", "form"] as const).map((g) => {
              const e = g === "root" ? null : g === "lemma" ? drill!.lemma : drill!.form;
              const n = g === "root" ? stat.count : e?.c;
              const label = g === "root" ? t("granRoot") : g === "lemma" ? t("granWord") : t("granForm");
              return (
                <button
                  key={g}
                  type="button"
                  role="tab"
                  aria-selected={gran === g}
                  className={`mhome-drill-tab ${gran === g ? "is-active" : ""}`}
                  style={gran === g ? { borderColor: color, color } : undefined}
                  disabled={g !== "root" && !e}
                  onClick={() => chooseGran(g)}
                >
                  <span className="mhome-drill-lab">{label}</span>
                  {typeof n === "number" && <span className="mhome-drill-n">{n.toLocaleString()}</span>}
                </button>
              );
            })}
          </div>
          <div className="mhome-drill-hint">
            {gran === "lemma" ? t("granHintWord") : gran === "form" ? t("granHintForm") : t("granHintRoot")}
          </div>
        </>
      )}

      {!drilling && (
      <>
      <div className="mhome-stats">
        <div className="mhome-stat">
          <span className="mhome-stat-n">
            {stat.surahs}
            <span className="mhome-stat-of"> / 114</span>
          </span>
          <span className="mhome-stat-l">{t("statSurahs")}</span>
        </div>
        <div className="mhome-stat">
          <span className="mhome-stat-n">{stat.verses.toLocaleString()}</span>
          <span className="mhome-stat-l">{t("statVerses")}</span>
        </div>
        {!pairWith && (
          <div className="mhome-stat">
            <span className="mhome-stat-n">{stat.forms}</span>
            <span className="mhome-stat-l">{t("statForms")}</span>
          </div>
        )}
        {stat.first && (
          <div className="mhome-stat">
            <span className="mhome-stat-n mhome-stat-ref">{surahName(stat.first.sura)}</span>
            <span className="mhome-stat-l">
              {t("statFirst")} · {stat.first.sura}:{stat.first.ayah}
            </span>
          </div>
        )}
      </div>

      <div className="mhome-where">
        <span className="mhome-where-lab">{t("whereLabel")}</span>
        <span className="mhome-where-of">{t("ofSurahs", { n: stat.surahs })}</span>
      </div>
      <SurahStrip hist={stat.hist} color={color} height={74} activeSura={activeSura} />
      {/* The SVG bars always run sūrah 1 → 114 left-to-right, so the axis
          labels must too — even in RTL. */}
      <div className="mhome-ticks" dir="ltr">
        {["1", "30", "60", "90", "114"].map((tk) => (
          <span key={tk}>{tk}</span>
        ))}
      </div>

      <div className="mhome-top">
        {stat.top.map(([sura, c, ayah]) => (
          <div
            key={sura}
            className={`mhome-top-chip ${sura === activeSura ? "is-active" : ""}`}
            style={sura === activeSura ? { borderColor: color } : undefined}
          >
            <span className="mhome-top-name">{surahName(sura)}</span>
            {/* When the word occurs in this sūrah just once, show its verse ref
                instead of "1×" — more useful than a count of one. */}
            {c === 1 && ayah ? (
              <span className="mhome-top-ref">{sura}:{ayah}</span>
            ) : (
              <>
                <span className="mhome-top-bar">
                  <span style={{ width: `${Math.round((c / maxTop) * 100)}%`, background: color }} />
                </span>
                <span className="mhome-top-c" style={{ color }}>
                  {c}×
                </span>
              </>
            )}
          </div>
        ))}
      </div>
      </>
      )}

      {verses !== null && verses.length > 0 && (
        <ResultVerses
          verses={verses}
          color={color}
          total={versesTotal}
          isHit={isHit}
          onActiveVerse={drilling ? undefined : setActiveSura}
          t={t}
          onOpenAyah={onOpenAyah}
          onOpenFull={() => (isName ? onExploreName(stat) : onExplore(stat.bare, "radial-sura", stat.first?.sura ?? stat.top[0]?.[0]))}
        />
      )}

      <div className="mhome-ctas">
        {isName ? (
          /* Names have no root, so the root-network / sankey sub-CTAs (which
             emit ?root=…) don't apply. A single primary opens the name's first
             occurrence in context, where the inspector shows its full count. */
          <button type="button" className="mhome-cta-p" onClick={() => onExploreName(stat)}>
            {t("exploreName")} <span aria-hidden="true">→</span>
          </button>
        ) : (
          <>
            {/* Primary lands on the radial surah view — one surah, the root's
                words in context — the gentlest first graph; the network is the
                explicit next step up in density. Scope to the SAME surah the
                home preview showed (the root's first occurrence, which is where
                the verse carousel starts) rather than its highest-frequency
                surah, so the view the user opens matches the verse they saw. */}
            <button type="button" className="mhome-cta-p" onClick={() => onExplore(stat.bare, "radial-sura", stat.first?.sura ?? stat.top[0]?.[0])}>
              {t("exploreRoot")} <span aria-hidden="true">→</span>
            </button>
            <div className="mhome-ctas-sub">
              <button type="button" className="mhome-cta-s" onClick={() => onExplore(stat.bare, "root-network")}>
                {t("seeNetwork")}
              </button>
              {!pairWith && (
                <button type="button" className="mhome-cta-g" onClick={() => onExplore(stat.bare, "sankey-flow", stat.top[0]?.[0])}>
                  {t("compareForms", { n: stat.forms })}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Search-result verse carousel: cycles through the ayahs that contain the
 * searched word (collapsed), and on click expands to a list of up to 10. When
 * the word occurs in more ayahs than shown, a CTA sends the user to the full
 * corpus. Mirrors the resting "today's root" carousel's look.
 */
/**
 * Chevron pointing along the reading order asked for. `back` means "toward the
 * start of the reading order" — left in LTR, right in RTL — so the glyph always
 * agrees with the swipe gesture and the arrow key that triggers it.
 */
function Chevron({ back, isRtl }: { back: boolean; isRtl: boolean }) {
  const pointsLeft = back !== isRtl;
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={pointsLeft ? undefined : { transform: "scaleX(-1)" }}
    >
      <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Pointer controls for a verse carousel, rendered INSIDE the viewport (which
 * clips, so they cannot hang outside the card). Dots stay for narrow screens —
 * a thumb finds a dot row faster than a 34px target, and side arrows would
 * crowd the ayah — while wider viewports get arrows plus a position counter;
 * see the breakpoint swap in the stylesheet.
 */
function CarouselArrows({
  isRtl,
  backLabel,
  forwardLabel,
  onBack,
  onForward,
}: {
  isRtl: boolean;
  backLabel: string;
  forwardLabel: string;
  onBack: () => void;
  onForward: () => void;
}) {
  return (
    <>
      <button type="button" className="mhome-nav mhome-nav-back" aria-label={backLabel} onClick={onBack}>
        <Chevron back isRtl={isRtl} />
      </button>
      <button type="button" className="mhome-nav mhome-nav-fwd" aria-label={forwardLabel} onClick={onForward}>
        <Chevron back={false} isRtl={isRtl} />
      </button>
    </>
  );
}

/**
 * ← / → step through a carousel in READING order: under RTL, ArrowLeft
 * advances. Scoped to the carousel (it is focusable) rather than bound to
 * window — the search box owns the arrow keys for caret movement, and this page
 * is a search box first.
 */
function useCarouselKeys(isRtl: boolean, onBack: () => void, onForward: () => void) {
  return useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      e.preventDefault(); // otherwise the page scrolls sideways under the card
      const forward = isRtl ? e.key === "ArrowLeft" : e.key === "ArrowRight";
      (forward ? onForward : onBack)();
    },
    [isRtl, onBack, onForward]
  );
}

function ResultVerses({
  verses,
  color,
  total,
  isHit,
  onActiveVerse,
  t,
  onOpenAyah,
  onOpenFull,
}: {
  verses: OccurrenceAyah[];
  color: string;
  total: number;
  /** True when a rendered word (already normalized) belongs to the searched
      root/lemma/form. Content-based so it's immune to the QAC-vs-Uthmani word-
      numbering drift that made position-based highlighting land on the wrong
      word (e.g. الله instead of the adjacent سميع). */
  isHit: (normalizedWord: string) => boolean;
  /** The sūrah of the verse currently on screen (null while the full list is
      expanded), so the sūrah strip above can highlight the matching bar. */
  onActiveVerse?: (sura: number | null) => void;
  t: ReturnType<typeof useTranslations>;
  onOpenAyah: (sura: number, ayah: number, word?: number) => void;
  onOpenFull: () => void;
}) {
  const surahName = useSurahName();
  const isRtl = useLocale() === "ar";
  const n = verses.length;
  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState(1);
  // The verses array can be SWAPPED under a mounted carousel (the correlation
  // mode hands in the shared ayahs directly, with no unmount in between). A
  // stale index into a shorter array read undefined and crashed the whole
  // result card; clamp at the read site and snap back on shrink.
  useEffect(() => {
    if (idx >= n && n > 0) setIdx(0);
  }, [idx, n]);
  const [open, setOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (paused || open || n <= 1) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setTimeout(() => {
      setDir(1);
      setIdx((i) => (i + 1) % n);
    }, 5500);
    return () => clearTimeout(timer);
  }, [idx, paused, open, n]);

  // Tell the sūrah strip which bar to highlight: the verse on screen (collapsed
  // carousel), or none while the full list is open. Clear on unmount.
  useEffect(() => {
    onActiveVerse?.(open ? null : verses[idx]?.sura ?? null);
  }, [idx, open, verses, onActiveVerse]);
  useEffect(() => () => onActiveVerse?.(null), [onActiveVerse]);

  const go = useCallback((i: number, d: number) => {
    setDir(d);
    setIdx(((i % n) + n) % n);
  }, [n]);

  const onKeyDown = useCarouselKeys(
    isRtl,
    useCallback(() => go(idx - 1, -1), [go, idx]),
    useCallback(() => go(idx + 1, 1), [go, idx])
  );

  const onTouchStart = (e: React.TouchEvent) => {
    const p = e.touches[0];
    touch.current = { x: p.clientX, y: p.clientY };
    setPaused(true);
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    setPaused(false);
    if (!start) return;
    const p = e.changedTouches[0];
    const dx = p.clientX - start.x;
    if (Math.abs(dx) > 40) {
      const forward = isRtl ? dx > 0 : dx < 0;
      go(idx + (forward ? 1 : -1), forward ? 1 : -1);
    }
  };

  const isArabicWord = (tok: string) => /[ء-يٱ-ەﭐ-ﻼ]/.test(tok);

  // The Uthmani rasm writes some letters as COMBINING small letters — 2:133
  // spells the name إِبْرَٰهِـۧمَ with a small high yeh (U+06E7) — and the
  // shared normalizer strips those as diacritics, so the word normalizes to
  // ابرهم and no key can match it. Restore them to real letters BEFORE
  // normalizing, here in the highlight path only: the shared normalizer keys
  // every shipped index, and changing it would desync them all.
  const restoreSmallLetters = (tok: string) =>
    tok.replace(/\u06E5|\u06E6|\u06E7|\u06E8/g, (m) =>
      m === "\u06E5" ? "و" : m === "\u06E8" ? "ن" : "ي");
  const normForHighlight = (tok: string) => normalizeArabicForSearch(restoreSmallLetters(tok));

  // Highlight the searched word(s) by CONTENT: normalize each rendered word and
  // ask isHit whether it belongs to the searched root/lemma/form. Deliberately
  // NOT by the API's word positions — those come from corpus_tokens, whose QAC-
  // derived numbering drifts from the Uthmani whitespace tokenization after any
  // QAC "merged" word (e.g. بعد+ما = one word), landing the mark on the wrong
  // word. Content matching has no such offset.
  const renderText = (ayah: OccurrenceAyah) =>
    ayah.text.split(/\s+/).filter(Boolean).map((tok, j) => {
      const norm = isArabicWord(tok) ? normForHighlight(tok) : "";
      const hl = norm.length >= 2 && isHit(norm);
      return (
        <span key={j} className={hl ? "mhome-verse-hl" : undefined} style={hl ? { color } : undefined}>
          {tok}{" "}
        </span>
      );
    });

  // The Uthmani whitespace index (marks skipped) of the first matching word —
  // this equals its corpus word position, so deep-linking it focuses the right
  // word in the graph. Falls back to the API position if nothing matched.
  const firstHitPosition = (ayah: OccurrenceAyah): number | undefined => {
    let wi = 0;
    for (const tok of ayah.text.split(/\s+/).filter(Boolean)) {
      if (!isArabicWord(tok)) continue;
      wi += 1;
      const norm = normForHighlight(tok);
      if (norm.length >= 2 && isHit(norm)) return wi;
    }
    return ayah.positions[0];
  };

  const ex = verses[Math.min(idx, Math.max(0, n - 1))];
  const hasMore = total > n;

  return (
    <div className="mhome-rv">
      <div className="mhome-rv-lab">
        <span className="mhome-where-lab">{t("versesTitle")}</span>
        <span className="mhome-where-of">{t("versesCount", { shown: n, total })}</span>
      </div>

      {!open ? (
        <div
          className="mhome-carousel"
          role="group"
          aria-label={t("versesTitle")}
          // The container holds focus, not the card: the card is keyed by index
          // so it REMOUNTS on every step (that is what drives the slide
          // animation), which destroys focus and would leave a keyboard user
          // stuck after a single press. The container survives every step.
          tabIndex={n > 1 ? 0 : undefined}
          onKeyDown={onKeyDown}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={(e) => {
            // Resume only once focus leaves the carousel entirely — stepping
            // between the arrows and the card is still "the user is here".
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setPaused(false);
          }}
        >
          <div className="mhome-carousel-viewport" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            <button
              key={idx}
              type="button"
              className={`mhome-verse ${dir >= 0 ? "is-next" : "is-prev"}`}
              onClick={() => setOpen(true)}
              title={`${surahName(ex.sura)} ${ex.sura}:${ex.ayah}`}
              aria-expanded={false}
            >
              <p dir="rtl" lang="ar" className="mhome-verse-ar">{renderText(ex)}</p>
              <span className="mhome-verse-ref">
                <span className="mhome-verse-name">{surahName(ex.sura)}</span>
                <span className="mhome-verse-num">{ex.sura}:{ex.ayah}</span>
              </span>
            </button>
            {n > 1 && (
              <CarouselArrows
                isRtl={isRtl}
                backLabel={t("versePrev")}
                forwardLabel={t("verseNext")}
                onBack={() => go(idx - 1, -1)}
                onForward={() => go(idx + 1, 1)}
              />
            )}
          </div>
          {n > 1 && (
            <div className="mhome-nav-row">
              <div className="mhome-dots" role="tablist" aria-label={t("versesTitle")}>
                {verses.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    role="tab"
                    aria-selected={i === idx}
                    aria-label={`${i + 1} / ${n}`}
                    className={`mhome-dot ${i === idx ? "is-active" : ""}`}
                    style={i === idx ? { background: color } : undefined}
                    onClick={() => go(i, i > idx ? 1 : -1)}
                  />
                ))}
              </div>
              {/* Takes the dots' place above the breakpoint: across ten verses a
                  dot row reads as decoration, a counter as position. */}
              <span className="mhome-nav-count" dir="ltr">{idx + 1} / {n}</span>
            </div>
          )}
          <div className="mhome-rv-hint">{t("versesOpenHint")}</div>
        </div>
      ) : (
        <div className="mhome-rv-open">
          <div className="mhome-bd-head">
            <span className="mhome-bd-eyebrow">{t("versesCount", { shown: n, total })}</span>
            <button type="button" className="mhome-bd-close" onClick={() => setOpen(false)} aria-label={t("closeVerse")}>×</button>
          </div>
          <div className="mhome-rv-list">
            {verses.map((v, i) => (
              <button key={i} type="button" className="mhome-rv-row" onClick={() => onOpenAyah(v.sura, v.ayah, firstHitPosition(v))}>
                <p dir="rtl" lang="ar" className="mhome-rv-ar">{renderText(v)}</p>
                <span className="mhome-rv-ref">
                  <span className="mhome-verse-name">{surahName(v.sura)}</span>
                  <span className="mhome-verse-num">{v.sura}:{v.ayah}</span>
                </span>
              </button>
            ))}
          </div>
          {hasMore && (
            <button type="button" className="mhome-rv-more" onClick={onOpenFull}>
              {t("seeAllVerses", { total })} <span aria-hidden="true">→</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** One ayah at a time: auto-advancing, dots, swipe. Click to expand word-by-word. */
function VerseCarousel({
  examples,
  color,
  rootBare,
  glossOf,
  onOpenGraph,
}: {
  examples: ExampleVerse[];
  color: string;
  rootBare: string;
  glossOf: (root: string) => ResolvedGloss | null;
  onOpenGraph: (ex: ExampleVerse) => void;
}) {
  const t = useTranslations("Home");
  const surahName = useSurahName();
  const isRtl = useLocale() === "ar";
  const n = examples.length;
  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState(1);
  useEffect(() => {
    if (idx >= n && n > 0) setIdx(0);
  }, [idx, n]);
  const [open, setOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);

  const go = useCallback(
    (i: number, d: number) => {
      setDir(d);
      setIdx(((i % n) + n) % n);
    },
    [n]
  );

  const onKeyDown = useCarouselKeys(
    isRtl,
    useCallback(() => go(idx - 1, -1), [go, idx]),
    useCallback(() => go(idx + 1, 1), [go, idx])
  );

  // Auto-advance every ~5.5s unless paused (hover / swipe), expanded, or the
  // user prefers reduced motion.
  useEffect(() => {
    if (paused || open || n <= 1) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setTimeout(() => {
      setDir(1);
      setIdx((i) => (i + 1) % n);
    }, 5500);
    return () => clearTimeout(timer);
  }, [idx, paused, open, n]);

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY };
    setPaused(true);
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    setPaused(false);
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
      // "Next" follows the reading direction: swipe left in LTR, right in RTL.
      const forward = isRtl ? dx > 0 : dx < 0;
      if (forward) go(idx + 1, 1);
      else go(idx - 1, -1);
    }
  };

  const ex = examples[Math.min(idx, Math.max(0, n - 1))];

  return (
    <div
      className="mhome-carousel"
      role="group"
      aria-label={t("versesTitle")}
      // Focus lives here, not on the card — see ResultVerses above.
      tabIndex={n > 1 ? 0 : undefined}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setPaused(false);
      }}
    >
      <div className="mhome-carousel-viewport" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <button
          key={idx}
          type="button"
          className={`mhome-verse ${dir >= 0 ? "is-next" : "is-prev"} ${open ? "is-open" : ""}`}
          onClick={() => setOpen((o) => !o)}
          title={`${surahName(ex.s)} ${ex.s}:${ex.a}`}
          aria-expanded={open}
        >
          <p dir="rtl" lang="ar" className="mhome-verse-ar">
            {ex.words.map((w, j) => (
              <span
                key={j}
                className={w.root === rootBare ? "mhome-verse-hl" : undefined}
                style={w.root === rootBare ? { color } : undefined}
              >
                {w.t}{" "}
              </span>
            ))}
          </p>
          <span className="mhome-verse-ref">
            <span className="mhome-verse-name">{surahName(ex.s)}</span>
            <span className="mhome-verse-num">
              {ex.s}:{ex.a}
            </span>
          </span>
        </button>
        {n > 1 && (
          <CarouselArrows
            isRtl={isRtl}
            backLabel={t("versePrev")}
            forwardLabel={t("verseNext")}
            onBack={() => go(idx - 1, -1)}
            onForward={() => go(idx + 1, 1)}
          />
        )}
      </div>

      {open && (
        <div className="mhome-breakdown">
          <div className="mhome-bd-head">
            <span className="mhome-bd-eyebrow">{t("wordByWord")}</span>
            <button type="button" className="mhome-bd-close" onClick={() => setOpen(false)} aria-label={t("closeVerse")}>
              ×
            </button>
          </div>
          <div className="mhome-bd-words">
            {ex.words
              .filter((w) => w.root)
              .map((w, j) => {
                const gloss = glossOf(w.root);
                return (
                  <div key={j} className={`mhome-bd-word ${w.root === rootBare ? "is-root" : ""}`}>
                    <span dir="rtl" lang="ar" className="mhome-bd-surface">
                      {w.t}
                    </span>
                    <span className="mhome-bd-meta">
                      <span dir="rtl" lang="ar" className="mhome-bd-root" style={{ color: POS_COLOR[w.pos] ?? "#E8924A" }}>
                        {Array.from(w.root).join("-")}
                      </span>
                      <span className="mhome-bd-pos">{t(`pos.${w.pos}`)}</span>
                      {gloss && (
                        <span
                          className={`mhome-bd-gloss ${gloss.isAr ? "mhome-gloss-ar" : ""}`}
                          dir={gloss.isAr ? "rtl" : undefined}
                          lang={gloss.isAr ? "ar" : undefined}
                        >
                          {gloss.text}
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
          </div>
          <button type="button" className="mhome-bd-open" onClick={() => onOpenGraph(ex)}>
            {t("openInGraphs")} <span aria-hidden="true">→</span>
          </button>
        </div>
      )}

      {n > 1 && (
        <div className="mhome-nav-row">
          <div className="mhome-dots" role="tablist" aria-label={t("versesTitle")}>
            {examples.map((_, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === idx}
                aria-label={`${i + 1} / ${n}`}
                className={`mhome-dot ${i === idx ? "is-active" : ""}`}
                style={i === idx ? { background: color } : undefined}
                onClick={() => go(i, i > idx ? 1 : -1)}
              />
            ))}
          </div>
          <span className="mhome-nav-count" dir="ltr">{idx + 1} / {n}</span>
        </div>
      )}
    </div>
  );
}

const styles = `
  .mhome {
    /* ── Component palette ─────────────────────────────────────────────
       Scoped custom properties; the defaults below are the dark
       "slate-teal" values (must stay pixel-identical to the original
       hardcoded palette). A light "reading mode" override follows.
       POS / root hues stay fixed in both themes: color is data. */
    --mh-canvas: #0E161A;
    --mh-panel: #142026;
    --mh-panel-rgb: 20, 32, 38;
    --mh-raised: #1C2A31;
    --mh-card-rgb: 28, 42, 49;
    --mh-hairline: rgba(198, 222, 230, 0.08);
    --mh-hairline-soft: rgba(198, 222, 230, 0.07);
    --mh-hairline-strong: rgba(198, 222, 230, 0.14);
    --mh-btn-hairline: rgba(237, 225, 209, 0.14);
    --mh-search-border: rgba(251, 234, 210, 0.18);
    --mh-ink: #ECE4D8;
    --mh-ink-rgb: 236, 228, 216;
    --mh-ink-72: rgba(236, 228, 216, 0.7);
    --mh-ink-55: rgba(236, 228, 216, 0.55);
    --mh-ink-hi: #FBEAD2;
    --mh-ink-hi-rgb: 251, 234, 210;
    --mh-accent: #f0b074;
    --mh-accent-rgb: 232, 146, 74;
    --mh-accent-soft: rgba(232, 146, 74, 0.08);
    --mh-accent-border: rgba(232, 146, 74, 0.4);
    --mh-glow: rgba(232, 146, 74, 0.28);
    --mh-cta-bg: #E8924A;
    --mh-cta-ink: #2A1606;
    --mh-count-glow: rgba(251, 234, 210, 0.22);
    --mh-shadow-strong: rgba(0, 0, 0, 0.45);
    --mh-atmos-2: rgba(142, 132, 204, 0.05);

    position: fixed;
    inset: 0;
    background: var(--mh-canvas);
    color: var(--mh-ink);
    font-family: 'Space Grotesk', system-ui, sans-serif;
    overflow-y: auto;
    overflow-x: hidden;
  }
  /* Light "reading mode" — Observatory V3 parchment palette.
     NB: this stylesheet is injected as plain (untransformed) CSS, so the
     theme hook must be a plain selector — :global() would be dropped by
     the browser as an invalid pseudo-class. */
  [data-theme="light"] .mhome {
    --mh-canvas: #F7F3EA;
    --mh-panel: #FFFFFF;
    --mh-panel-rgb: 255, 255, 255;
    --mh-raised: #EFE6D6;
    --mh-card-rgb: 255, 255, 255;
    --mh-hairline: rgba(31, 28, 25, 0.12);
    --mh-hairline-soft: rgba(31, 28, 25, 0.1);
    --mh-hairline-strong: rgba(31, 28, 25, 0.18);
    --mh-btn-hairline: rgba(31, 28, 25, 0.18);
    --mh-search-border: rgba(31, 28, 25, 0.16);
    --mh-ink: #1F1C19;
    --mh-ink-rgb: 31, 28, 25;
    --mh-ink-72: rgba(31, 28, 25, 0.7);
    --mh-ink-55: rgba(31, 28, 25, 0.55);
    --mh-ink-hi: #1F1C19;
    --mh-ink-hi-rgb: 31, 28, 25;
    /* Burnt amber (B5571F family, darkened a touch for AA on parchment). */
    --mh-accent: #A9531B;
    --mh-accent-rgb: 181, 87, 31;
    --mh-accent-soft: rgba(181, 87, 31, 0.1);
    --mh-accent-border: rgba(181, 87, 31, 0.45);
    --mh-glow: rgba(181, 87, 31, 0.16);
    --mh-cta-bg: #B5571F;
    --mh-cta-ink: #FFFFFF;
    --mh-count-glow: rgba(181, 87, 31, 0.14);
    --mh-shadow-strong: rgba(31, 28, 25, 0.14);
    --mh-atmos-2: rgba(142, 132, 204, 0.07);
  }
  /* Root/POS "data colors" (rootColor()/POS_COLOR) are tuned for the dark
     slate-teal canvas and fall below text contrast on parchment (e.g. amber
     #E8924A ≈ 2.2:1). A brightness/saturate filter darkens the rendered
     glyphs enough to read while preserving each color's hue — "color is
     data" still holds, only luminance shifts. Two strengths: large display
     glyphs only need to clear the 3:1 large-text minimum; small labels and
     counts must clear the stricter 4.5:1 body-text minimum, so they get a
     deeper filter. Graphics (bars, dots, chip fills) are untouched — this
     only ever targets colored TEXT. */
  [data-theme="light"] .mhome .mhome-today-ar,
  [data-theme="light"] .mhome .mhome-today-stat-n,
  [data-theme="light"] .mhome .mhome-ident-ar,
  [data-theme="light"] .mhome .mhome-verse-hl {
    filter: brightness(0.62) saturate(1.15);
  }
  [data-theme="light"] .mhome .mhome-top-c,
  [data-theme="light"] .mhome .mhome-bd-root,
  [data-theme="light"] .mhome .mhome-strip-tip-count {
    filter: brightness(0.5) saturate(1.15);
  }
  .mhome-atmos {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      radial-gradient(50% 56% at 50% 44%, rgba(var(--mh-accent-rgb), 0.06), transparent 60%),
      radial-gradient(44% 50% at 50% 102%, var(--mh-atmos-2), transparent 60%);
    transition: background 0.5s ease;
  }
  .mhome.has-result .mhome-atmos {
    background: radial-gradient(48% 50% at 50% 26%, rgba(var(--mh-accent-rgb), 0.06), transparent 60%);
  }
  .mhome-mark {
    position: absolute; top: 26px; inset-inline-start: 30px; z-index: 3;
    display: flex; align-items: center; gap: 11px;
  }
  .mhome-glyph {
    width: 30px; height: 30px; border: 1px solid rgba(var(--mh-ink-hi-rgb), 0.4); border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    font-family: 'Amiri', serif; font-size: 17px; color: var(--mh-ink-hi);
  }
  .mhome-wordmark {
    font: 600 9.5px/1.5 'Space Grotesk', sans-serif; letter-spacing: 0.18em;
    text-transform: uppercase; color: rgba(var(--mh-ink-rgb), 0.45);
  }
  .mhome-topright {
    position: absolute; top: 22px; inset-inline-end: 26px; z-index: 3;
    display: flex; align-items: center; gap: 12px;
  }
  .mhome-credit {
    position: fixed; bottom: 14px; left: 50%; transform: translateX(-50%);
    z-index: 3; font: 500 10.5px 'Space Grotesk', sans-serif; letter-spacing: 0.04em;
    color: rgba(var(--mh-ink-rgb), 0.4); text-decoration: none; white-space: nowrap;
    transition: color 0.15s ease;
  }
  .mhome-credit:hover { color: rgba(var(--mh-ink-rgb), 0.75); }
  .mhome-lang :global(.control-pill-btn) {
    background: transparent; border: 1px solid var(--mh-btn-hairline); border-radius: 999px;
    padding: 7px 12px; color: var(--mh-ink-55); cursor: pointer;
    font: 600 11px 'Space Grotesk', sans-serif; letter-spacing: 0.03em;
    transition: color 0.15s, border-color 0.15s, background 0.15s;
  }
  .mhome-lang :global(.control-pill-btn:hover) { color: var(--mh-ink); border-color: var(--mh-accent-border); }
  .mhome-lang :global(.control-pill-btn.active) {
    background: rgba(var(--mh-accent-rgb), 0.14); border-color: rgba(var(--mh-accent-rgb), 0.45); color: var(--mh-accent);
  }
  .mhome-skip {
    background: transparent; border: 1px solid var(--mh-btn-hairline); border-radius: 999px;
    padding: 7px 14px; color: rgba(var(--mh-ink-rgb), 0.6); cursor: pointer;
    font: 500 11px 'Space Grotesk', sans-serif; letter-spacing: 0.04em; white-space: nowrap;
    transition: color 0.15s, border-color 0.15s;
  }
  .mhome-skip:hover { color: var(--mh-ink); border-color: rgba(var(--mh-accent-rgb), 0.5); }

  /* Idle: the search bar sits toward the middle. Once it holds text it glides
     up (is-active) and holds there; position is binary, not per-letter, and it
     lingers a moment after clearing before settling back. */
  .mhome-stack {
    position: relative; z-index: 2;
    width: min(760px, calc(100vw - 48px));
    margin: 0 auto;
    min-height: 100%;
    display: flex; flex-direction: column; align-items: center; justify-content: flex-start;
    padding: 26vh 0 90px;
    transition: padding-top 0.9s cubic-bezier(0.33, 0, 0.15, 1);
  }
  .mhome-stack.is-active { padding-top: 9.5vh; }
  /* Active state (typing / result / no-match) runs a tighter rhythm so a
     result's stat tiles, histogram and CTA row still clear the fold at
     1440x900 — resting keeps its full, calmer spacing. */
  .mhome-stack.is-active .mhome-reveal { margin-top: 21px; }

  .mhome-headline {
    /* Amiri: the headline is Quranic text (41:3) with Uthmani marks —
       needs an Arabic typeface with full diacritic support, generous
       line-height so stacked marks never clip. */
    font-family: 'Amiri', var(--font-arabic, serif);
    font-weight: 400; font-size: clamp(28px, 4.6vw, 44px);
    line-height: 1.9; letter-spacing: 0; text-align: center; color: var(--mh-ink);
    margin: 0 0 2px; transition: opacity 0.3s ease;
  }
  /* Hidden while searching, but keeps its box so the search bar never jumps. */
  .mhome-headline.is-hidden { opacity: 0; pointer-events: none; }

  .mhome-search {
    margin-top: 30px; width: 100%;
    display: flex; align-items: center; gap: 15px; height: 68px; padding: 0 24px;
    background: var(--mh-raised); border: 1px solid var(--mh-search-border); border-radius: 18px;
    box-shadow: 0 22px 60px var(--mh-shadow-strong), 0 0 0 7px rgba(var(--mh-accent-rgb), 0.04);
    transition: border-color 0.25s ease, box-shadow 0.25s ease;
  }
  .mhome-search:focus-within {
    border-color: rgba(var(--mh-accent-rgb), 0.45);
    box-shadow: 0 22px 60px var(--mh-shadow-strong), 0 0 0 7px rgba(var(--mh-accent-rgb), 0.08);
  }
  .mhome-search svg { flex: 0 0 auto; color: rgba(var(--mh-ink-hi-rgb), 0.7); }
  .mhome-search input {
    flex: 1; min-width: 0; background: transparent; border: none; outline: none;
    color: var(--mh-ink); font: 400 21px 'Space Grotesk', sans-serif;
  }
  .mhome-search input::placeholder { color: rgba(var(--mh-ink-rgb), 0.4); }
  .mhome-enter {
    flex: 0 0 auto; font: 500 11px 'Space Grotesk', sans-serif; letter-spacing: 0.04em;
    color: rgba(var(--mh-ink-rgb), 0.45); border: 1px solid var(--mh-btn-hairline);
    padding: 4px 9px; border-radius: 7px;
  }
  .mhome-matched {
    flex: 0 0 auto; display: inline-flex; align-items: center; gap: 7px;
    font: 500 11px 'Space Grotesk', sans-serif; color: rgba(var(--mh-ink-rgb), 0.5);
  }
  .mhome-match-dot { width: 6px; height: 6px; border-radius: 999px; }

  .mhome-reveal { width: 100%; margin-top: 28px; }

  /* resting */
  .mhome-resting { display: flex; flex-direction: column; align-items: stretch; gap: 30px; animation: mhfade 0.4s ease; }

  .mhome-chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 7px; }
  .mhome-chip {
    display: inline-flex; align-items: center; gap: 7px; padding: 5px 12px; border-radius: 999px;
    background: rgba(var(--mh-ink-rgb), 0.03); border: 1px solid var(--mh-hairline-soft);
    color: rgba(var(--mh-ink-rgb), 0.66); cursor: pointer; transition: border-color 0.15s, background 0.15s, color 0.15s;
  }
  .mhome-chip:hover { border-color: var(--mh-accent-border); background: rgba(var(--mh-accent-rgb), 0.06); color: var(--mh-ink); }
  .mhome-chip-ar { font-family: 'Amiri', serif; font-size: 14px; }
  .mhome-chip-gloss { font: 400 12px 'Space Grotesk', sans-serif; color: rgba(var(--mh-ink-rgb), 0.5); }
  .mhome-chip.is-suggest { background: var(--mh-accent-soft); border-color: rgba(var(--mh-accent-rgb), 0.25); color: var(--mh-accent); }

  /* today's root — editorial, uncontained */
  .mhome-today { display: flex; flex-direction: column; gap: 18px; }
  .mhome-today-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .mhome-today-eyebrow { font: 600 10px 'Space Grotesk', sans-serif; letter-spacing: 0.18em; text-transform: uppercase; color: rgba(var(--mh-ink-rgb), 0.5); }
  .mhome-today-all { background: none; border: none; padding: 0; cursor: pointer; font: 500 11px 'Space Grotesk', sans-serif; color: rgba(var(--mh-ink-rgb), 0.5); transition: color 0.15s; }
  .mhome-today-all:hover { color: var(--mh-accent); }

  /* masthead — each fact highlighted */
  .mhome-today-masthead { display: flex; align-items: flex-end; justify-content: space-between; gap: 22px 36px; flex-wrap: wrap; }
  .mhome-today-id { display: flex; align-items: baseline; gap: 18px; flex-wrap: wrap; }
  .mhome-today-ar { font-family: 'Amiri', serif; font-size: 44px; line-height: 1; }
  .mhome-today-idmeta { display: flex; flex-direction: column; gap: 3px; }
  .mhome-today-translit { font: 500 14px 'Space Grotesk', sans-serif; color: var(--mh-ink-72); letter-spacing: 0.02em; }
  .mhome-today-gloss { font: 400 16px 'Space Grotesk', sans-serif; color: var(--mh-ink); }
  .mhome-today-stats { display: flex; gap: 28px; }
  .mhome-today-stat { display: flex; flex-direction: column; gap: 5px; }
  .mhome-today-stat-n { font-family: 'Fraunces', serif; font-weight: 400; font-size: 30px; line-height: 1; color: var(--mh-ink); font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
  .mhome-today-stat-of { font-family: 'Space Grotesk', sans-serif; font-size: 15px; color: rgba(var(--mh-ink-rgb), 0.38); }
  .mhome-today-stat-l { font: 600 10px 'Space Grotesk', sans-serif; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(var(--mh-ink-rgb), 0.5); }

  /* verse carousel — one ayah at a time, auto-advancing, dots + swipe */
  .mhome-carousel { display: flex; flex-direction: column; gap: 15px; }
  .mhome-carousel-viewport { position: relative; overflow: hidden; }
  .mhome-verse {
    width: 100%; height: 190px; text-align: start; cursor: pointer;
    display: grid; grid-template-rows: 1fr auto; gap: 14px;
    padding: 20px 22px; border-radius: 16px;
    background: rgba(var(--mh-card-rgb), 0.5); border: 1px solid var(--mh-hairline);
    transition: border-color 0.18s, background 0.18s;
  }
  .mhome-verse:hover { border-color: var(--mh-accent-border); background: rgba(var(--mh-card-rgb), 0.8); }
  .mhome-verse.is-next { animation: mhSlideNext 0.42s cubic-bezier(0.16,1,0.3,1); }
  .mhome-verse.is-prev { animation: mhSlidePrev 0.42s cubic-bezier(0.16,1,0.3,1); }
  .mhome-verse-ar {
    margin: 0; align-self: center;
    font-family: 'Amiri', serif; font-size: 20px; line-height: 1.85; color: rgba(var(--mh-ink-rgb), 0.85);
    /* 3 lines × 37px fits the card's 117px text area — clamp matches what
       actually fits, so long verses ellipsize instead of clipping mid-line. */
    display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
  }
  .mhome-verse-hl { font-weight: 700; text-shadow: 0 0 22px currentColor; }
  .mhome-verse-ref { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .mhome-verse-name { font: 500 12.5px 'Space Grotesk', sans-serif; color: var(--mh-ink); }
  .mhome-verse-num { font: 500 11px 'Space Grotesk', sans-serif; color: rgba(var(--mh-ink-rgb), 0.4); font-variant-numeric: tabular-nums; }

  .mhome-nav-row { display: flex; justify-content: center; align-items: center; min-height: 8px; }
  .mhome-dots { display: flex; justify-content: center; gap: 7px; }
  .mhome-dot {
    width: 6px; height: 6px; padding: 0; border: none; border-radius: 999px; cursor: pointer;
    background: rgba(var(--mh-ink-rgb), 0.22); transition: width 0.22s, background 0.22s;
  }
  .mhome-dot.is-active { width: 22px; }

  /* Carousel arrows. Inside the viewport because it clips (overflow: hidden),
     so a negative offset would simply disappear. Logical insets, not left/right
     — Lightning CSS compiles logical props behind :lang() at a specificity a
     physical override cannot beat, so mixing the two loses silently in RTL. */
  .mhome-nav {
    position: absolute; top: 50%; transform: translateY(-50%);
    display: none; place-items: center; width: 34px; height: 34px; padding: 0;
    border-radius: 999px; cursor: pointer;
    background: rgba(var(--mh-card-rgb), 0.82);
    border: 1px solid var(--mh-hairline-soft);
    color: rgba(var(--mh-ink-rgb), 0.6);
    opacity: 0; transition: opacity 0.18s, color 0.18s, border-color 0.18s, background 0.18s;
  }
  .mhome-nav-back { inset-inline-start: 10px; }
  .mhome-nav-fwd { inset-inline-end: 10px; }
  .mhome-nav:hover { color: var(--mh-ink); border-color: var(--mh-accent-border); background: rgba(var(--mh-card-rgb), 0.95); }
  /* Quiet until wanted — but never hidden from keyboard users, and always shown
     on a device that cannot hover. */
  .mhome-carousel:hover .mhome-nav,
  .mhome-carousel:focus-within .mhome-nav { opacity: 1; }
  .mhome-nav:focus-visible { opacity: 1; }
  @media (hover: none) { .mhome-nav { opacity: 1; } }

  /* The carousel is focusable (see the tabIndex comment), so it needs a ring
     that reads as intentional rather than the browser's default rectangle. */
  .mhome-carousel:focus { outline: none; }
  .mhome-carousel:focus-visible {
    outline: 2px solid var(--mh-accent-border);
    outline-offset: 5px;
    border-radius: 18px;
  }

  .mhome-nav-count {
    display: none; font: 500 11px 'Space Grotesk', sans-serif;
    font-variant-numeric: tabular-nums; letter-spacing: 0.06em;
    color: rgba(var(--mh-ink-rgb), 0.42);
  }

  /* The swap the desktop ask is about: arrows + counter take over from the dot
     row, which stays the touch affordance below the same 640px breakpoint the
     rest of this component uses (NARROW_QUERY). */
  @media (min-width: 641px) {
    .mhome-nav { display: grid; }
    .mhome-dots { display: none; }
    .mhome-nav-count { display: inline; }
    /* Keep the ayah clear of the arrow targets. Symmetric, so physical padding
       is direction-agnostic here and sidesteps the logical-prop trap above. */
    .mhome-verse { padding: 20px 54px; }
  }

  @keyframes mhSlideNext { from { opacity: 0; transform: translateX(30px); } to { opacity: 1; transform: none; } }
  @keyframes mhSlidePrev { from { opacity: 0; transform: translateX(-30px); } to { opacity: 1; transform: none; } }
  /* In RTL, "next" enters from the left (reading direction is mirrored). */
  :global([dir="rtl"]) .mhome-verse.is-next { animation-name: mhSlidePrev; }
  :global([dir="rtl"]) .mhome-verse.is-prev { animation-name: mhSlideNext; }

  /* result verse carousel (ayahs containing the searched word) */
  /* correlation (pair) search */
  .mhome-pair-btn {
    flex: none; width: 30px; height: 30px; border-radius: 999px; cursor: pointer;
    display: grid; place-items: center; font-size: 15px;
    background: transparent; border: 1px solid var(--mh-hairline-soft);
    color: rgba(var(--mh-ink-rgb), 0.55);
    transition: color 0.15s, border-color 0.15s, background 0.15s;
  }
  .mhome-pair-btn:hover, .mhome-pair-btn.is-on {
    color: var(--mh-ink); border-color: var(--mh-accent-border);
    background: rgba(var(--mh-card-rgb), 0.7);
  }
  .mhome-pair { display: flex; flex-direction: column; gap: 12px; margin-top: 10px; }
  /* Visually SECONDARY: narrower than the main bar and inset under it, so the
     hierarchy reads at a glance instead of presenting two equal search bars. */
  .mhome-pair-bar {
    width: min(560px, 92%); margin-inline: auto;
    display: flex; align-items: center; gap: 10px;
    padding: 8px 16px; border-radius: 14px;
    background: rgba(var(--mh-card-rgb), 0.55); border: 1px solid var(--mh-hairline);
  }
  .mhome-pair-bar input {
    flex: 1; min-width: 0; background: none; border: none; outline: none;
    font: 500 15px 'Space Grotesk', sans-serif; color: var(--mh-ink);
  }
  .mhome-pair-bar input::placeholder { color: rgba(var(--mh-ink-rgb), 0.38); }
  .mhome-pair-x {
    flex: none; width: 24px; height: 24px; border-radius: 999px; cursor: pointer;
    background: transparent; border: none; color: rgba(var(--mh-ink-rgb), 0.5); font-size: 16px;
  }
  .mhome-pair-x:hover { color: var(--mh-ink); }
  .mhome-pair-note { margin: 0; font: 400 13px 'Space Grotesk', sans-serif; color: rgba(var(--mh-ink-rgb), 0.65); }
  .mhome-pair-notewrap { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .mhome-pair-with {
    margin-inline-start: 10px; padding: 2px 10px; border-radius: 999px;
    font-size: 15px; border: 1px solid var(--mh-accent-border); color: var(--mh-ink);
    background: rgba(var(--mh-card-rgb), 0.6); cursor: pointer;
  }
  .mhome-pair-with:hover { background: rgba(var(--mh-card-rgb), 0.9); }
  .mhome-pair-windows { justify-content: center; align-items: center; flex-wrap: wrap; gap: 8px; }
  .mhome-pair-span { display: inline-flex; align-items: center; gap: 4px; margin-inline-start: 6px; }
  .mhome-pair-span-n {
    min-width: 42px; text-align: center; font: 600 13px 'Space Grotesk', sans-serif;
    font-variant-numeric: tabular-nums; color: var(--mh-ink);
  }
  .mhome-pair-span .control-pill-btn:disabled { opacity: 0.35; cursor: default; }
  /* The whole card announces its scope: an accent edge band on the reading
     side, so pair-scoped numbers can never pass for global ones even in a
     crop that loses the chip and the note line. */
  .mhome-result.is-paired {
    border-inline-start: 3px solid var(--mh-accent-border);
    padding-inline-start: 16px;
    border-radius: 4px;
  }

  .mhome-rv { display: flex; flex-direction: column; gap: 12px; }
  .mhome-rv-lab { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
  .mhome-rv-hint { text-align: center; font: 500 10.5px 'Space Grotesk', sans-serif; letter-spacing: 0.04em; text-transform: uppercase; color: rgba(var(--mh-ink-rgb), 0.4); }
  .mhome-rv-open {
    display: flex; flex-direction: column; gap: 12px; padding: 16px 18px; border-radius: 16px;
    background: rgba(var(--mh-panel-rgb), 0.92); border: 1px solid var(--mh-hairline); animation: mhfade 0.3s ease;
  }
  .mhome-rv-list { display: flex; flex-direction: column; gap: 8px; max-height: 340px; overflow-y: auto; padding-right: 4px; }
  .mhome-rv-row {
    text-align: start; cursor: pointer; display: grid; grid-template-rows: auto auto; gap: 8px;
    padding: 14px 16px; border-radius: 12px; background: rgba(var(--mh-card-rgb), 0.5);
    border: 1px solid var(--mh-hairline); transition: border-color 0.16s, background 0.16s;
  }
  .mhome-rv-row:hover { border-color: var(--mh-accent-border); background: rgba(var(--mh-card-rgb), 0.85); }
  .mhome-rv-ar {
    margin: 0; font-family: 'Amiri', serif; font-size: 18px; line-height: 1.8; color: rgba(var(--mh-ink-rgb), 0.85);
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .mhome-rv-ref { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .mhome-rv-more {
    cursor: pointer; text-align: center; padding: 12px 16px; border-radius: 12px;
    border: 1px dashed var(--mh-accent-border); background: transparent; color: var(--mh-accent);
    font: 600 12.5px 'Space Grotesk', sans-serif; transition: background 0.16s, border-color 0.16s;
  }
  .mhome-rv-more:hover { background: rgba(var(--mh-card-rgb), 0.6); border-color: var(--mh-accent); }

  /* inline word-by-word expand */
  .mhome-verse.is-open { border-color: var(--mh-accent-border); background: rgba(var(--mh-card-rgb), 0.8); border-radius: 16px 16px 0 0; }
  .mhome-breakdown {
    margin-top: -1px; padding: 18px 20px 20px; border-radius: 0 0 16px 16px;
    background: rgba(var(--mh-panel-rgb), 0.92); border: 1px solid var(--mh-hairline); border-top: none;
    animation: mhfade 0.3s ease;
  }
  .mhome-bd-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
  .mhome-bd-eyebrow { font: 600 10px 'Space Grotesk', sans-serif; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(var(--mh-ink-rgb), 0.5); }
  .mhome-bd-close { background: none; border: none; color: rgba(var(--mh-ink-rgb), 0.5); font-size: 20px; line-height: 1; cursor: pointer; padding: 0 4px; transition: color 0.15s; }
  .mhome-bd-close:hover { color: var(--mh-ink); }
  .mhome-bd-words { display: grid; grid-template-columns: 1fr 1fr; gap: 7px 22px; }
  .mhome-bd-word { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; padding: 7px 10px; border-radius: 9px; }
  .mhome-bd-word.is-root { background: var(--mh-accent-soft); }
  .mhome-bd-surface { font-family: 'Amiri', serif; font-size: 21px; color: var(--mh-ink); flex: 0 0 auto; }
  .mhome-bd-meta { display: flex; align-items: baseline; gap: 9px; flex-wrap: wrap; justify-content: flex-end; text-align: end; }
  .mhome-bd-root { font-family: 'Amiri', serif; font-size: 15px; }
  .mhome-bd-pos { font: 500 9.5px 'Space Grotesk', sans-serif; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(var(--mh-ink-rgb), 0.45); }
  .mhome-bd-gloss { font: 400 12px 'Space Grotesk', sans-serif; color: rgba(var(--mh-ink-rgb), 0.6); }
  .mhome-bd-open {
    margin-top: 16px; display: inline-flex; align-items: center; gap: 8px; height: 42px; padding: 0 18px;
    border-radius: 11px; background: rgba(var(--mh-accent-rgb), 0.12); border: 1px solid rgba(var(--mh-accent-rgb), 0.32); color: var(--mh-accent);
    font: 600 13px 'Space Grotesk', sans-serif; cursor: pointer; transition: background 0.15s, border-color 0.15s;
  }
  .mhome-bd-open:hover { background: rgba(var(--mh-accent-rgb), 0.2); border-color: rgba(var(--mh-accent-rgb), 0.5); }
  @media (max-width: 640px) { .mhome-bd-words { grid-template-columns: 1fr; } }

  /* no match */
  .mhome-nomatch { text-align: center; animation: mhfade 0.3s ease; }
  .mhome-nomatch p { font: 400 15px 'Space Grotesk', sans-serif; color: rgba(var(--mh-ink-rgb), 0.6); margin: 0 0 14px; }

  /* result chooser (disambiguation) */
  .mhome-chooser { display: flex; flex-direction: column; gap: 12px; animation: mhfade 0.4s ease; }
  .mhome-chooser-lab { font: 600 10px 'Space Grotesk', sans-serif; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(var(--mh-ink-rgb), 0.5); }
  .mhome-chooser-list { display: flex; flex-direction: column; gap: 8px; }
  .mhome-chooser-row {
    display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 14px;
    padding: 15px 18px; border-radius: 14px; cursor: pointer; text-align: start;
    background: rgba(var(--mh-card-rgb), 0.5); border: 1px solid var(--mh-hairline);
    transition: border-color 0.16s, background 0.16s, transform 0.16s;
  }
  .mhome-chooser-row:hover { border-color: var(--mh-accent-border); background: rgba(var(--mh-card-rgb), 0.85); }
  :global([dir="ltr"]) .mhome-chooser-row:hover { transform: translateX(2px); }
  :global([dir="rtl"]) .mhome-chooser-row:hover { transform: translateX(-2px); }
  .mhome-chooser-dot { width: 9px; height: 9px; border-radius: 999px; }
  .mhome-chooser-ar { font-family: 'Amiri', serif; font-size: 22px; color: var(--mh-ink); }
  .mhome-chooser-meta { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .mhome-chooser-kind { font: 600 9px 'Space Grotesk', sans-serif; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(var(--mh-ink-rgb), 0.4); }
  .mhome-chooser-meta > span:last-child { font: 500 12px 'Space Grotesk', sans-serif; color: rgba(var(--mh-ink-rgb), 0.6); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mhome-chooser-count { font: 600 17px 'Space Grotesk', sans-serif; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .mhome-chooser-x { font-size: 11px; opacity: 0.6; margin-inline-start: 1px; }

  /* result */
  .mhome-result { animation: mhfade 0.4s ease; }
  .mhome-back {
    display: inline-flex; align-items: center; gap: 6px; margin-bottom: 17px;
    background: none; border: none; padding: 4px 0; cursor: pointer;
    font: 500 12px 'Space Grotesk', sans-serif; letter-spacing: 0.02em; color: var(--mh-ink-55);
    transition: color 0.15s;
  }
  .mhome-back:hover { color: var(--mh-ink); }
  [dir="rtl"] .mhome-back svg { transform: scaleX(-1); }
  .mhome-result-head { display: flex; align-items: flex-end; gap: 24px; }
  .mhome-count {
    font-family: 'Fraunces', serif; font-weight: 300; font-size: clamp(58px, 9vw, 92px);
    line-height: 0.82; letter-spacing: -0.02em; font-variant-numeric: tabular-nums;
    color: var(--mh-ink-hi);
    text-shadow: 0 0 44px var(--mh-count-glow);
  }
  .mhome-count-lab { padding-bottom: 9px; }
  .mhome-occ { font: 500 13px 'Space Grotesk', sans-serif; letter-spacing: 0.04em; color: rgba(var(--mh-ink-rgb), 0.6); }
  .mhome-ident { display: flex; align-items: center; gap: 9px; margin-top: 8px; flex-wrap: wrap; }
  .mhome-ident-ar { font-family: 'Amiri', serif; font-size: 26px; }
  .mhome-ident-tr { font: 400 14px 'Space Grotesk', sans-serif; color: var(--mh-ink); }
  .mhome-ident-gl { font: 400 13px 'Space Grotesk', sans-serif; color: rgba(var(--mh-ink-rgb), 0.5); }
  .mhome-dict { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .mhome-dict-badge {
    display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px;
    border: 1px solid var(--mh-hairline); background: rgba(var(--mh-card-rgb), 0.5);
    font: 500 11px 'Space Grotesk', sans-serif; color: rgba(var(--mh-ink-rgb), 0.6);
    text-decoration: none; transition: color 0.15s, border-color 0.15s, background 0.15s;
  }
  .mhome-dict-badge:hover { color: var(--mh-ink); border-color: var(--mh-accent-border); background: rgba(var(--mh-card-rgb), 0.85); }
  .mhome-dict-badge svg { opacity: 0.7; }

  /* exact-match drill-down: root → word (lemma) → exact form */
  .mhome-drill { display: flex; gap: 8px; margin-top: 18px; }
  .mhome-drill-tab {
    flex: 1 1 0; display: flex; flex-direction: column; align-items: center; gap: 3px;
    padding: 9px 10px; border-radius: 12px; cursor: pointer;
    background: rgba(var(--mh-card-rgb), 0.45); border: 1px solid var(--mh-hairline-soft);
    color: rgba(var(--mh-ink-rgb), 0.6); transition: border-color 0.15s, color 0.15s, background 0.15s;
  }
  .mhome-drill-tab:hover:not(:disabled) { border-color: var(--mh-accent-border); color: var(--mh-ink); }
  .mhome-drill-tab.is-active { background: rgba(var(--mh-card-rgb), 0.85); }
  .mhome-drill-tab:disabled { opacity: 0.4; cursor: not-allowed; }
  .mhome-drill-lab { font: 600 11px 'Space Grotesk', sans-serif; letter-spacing: 0.03em; text-transform: uppercase; }
  .mhome-drill-n { font: 600 17px 'Space Grotesk', sans-serif; font-variant-numeric: tabular-nums; color: var(--mh-ink); }
  .mhome-drill-tab:not(.is-active) .mhome-drill-n { color: rgba(var(--mh-ink-rgb), 0.6); }
  .mhome-drill-hint { margin-top: 8px; font: 400 12px 'Space Grotesk', sans-serif; color: rgba(var(--mh-ink-rgb), 0.55); }

  /* occurrence stats — proper tiles, not cramped text */
  .mhome-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 19px; }
  .mhome-stat {
    display: flex; flex-direction: column; gap: 6px; padding: 15px 16px; border-radius: 13px;
    background: rgba(var(--mh-card-rgb), 0.45); border: 1px solid var(--mh-hairline-soft);
  }
  .mhome-stat-n {
    font-family: 'Fraunces', serif; font-weight: 400; font-size: 30px; line-height: 1; color: var(--mh-ink);
    font-variant-numeric: tabular-nums; letter-spacing: -0.01em;
  }
  .mhome-stat-of { font-family: 'Space Grotesk', sans-serif; font-size: 15px; color: rgba(var(--mh-ink-rgb), 0.38); letter-spacing: 0; }
  .mhome-stat-ref { font-size: 20px; line-height: 1.15; }
  .mhome-stat-l {
    font: 600 10px 'Space Grotesk', sans-serif; letter-spacing: 0.1em; text-transform: uppercase;
    color: rgba(var(--mh-ink-rgb), 0.5);
  }
  @media (max-width: 640px) {
    .mhome-stats { grid-template-columns: repeat(2, 1fr); }
  }

  .mhome-where { display: flex; align-items: center; justify-content: space-between; margin: 22px 0 8px; }
  .mhome-where-lab { font: 600 10px 'Space Grotesk', sans-serif; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(var(--mh-ink-rgb), 0.5); }
  .mhome-where-of { font: 500 11px 'Space Grotesk', sans-serif; color: rgba(var(--mh-ink-rgb), 0.4); }
  .mhome-ticks { display: flex; justify-content: space-between; margin-top: 7px; font: 500 9.5px 'Space Grotesk', sans-serif; letter-spacing: 0.08em; color: rgba(var(--mh-ink-rgb), 0.32); }

  /* distribution strip hover tooltip — lives in reserved space above the bars
     so it never covers the section label or the chart itself */
  .mhome-strip { position: relative; padding-top: 29px; }
  .mhome-strip-tip {
    position: absolute; top: 0; transform: translateX(-50%);
    display: flex; align-items: center; gap: 8px; white-space: nowrap; pointer-events: none; z-index: 6;
    padding: 5px 11px; border-radius: 9px; background: var(--mh-raised); border: 1px solid var(--mh-hairline-strong);
    box-shadow: 0 8px 24px var(--mh-shadow-strong);
    animation: mhfade 0.15s ease;
  }
  .mhome-strip-tip-name { font: 500 12px 'Space Grotesk', sans-serif; color: var(--mh-ink); }
  .mhome-strip-tip-count { font: 600 12px 'Space Grotesk', sans-serif; font-variant-numeric: tabular-nums; }

  .mhome-top { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 15px; }
  .mhome-top-chip { display: flex; align-items: center; gap: 10px; padding: 8px 13px; border-radius: 11px; background: var(--mh-raised); border: 1px solid var(--mh-hairline); transition: background 0.2s, border-color 0.2s; }
  .mhome-top-chip.is-active { background: rgba(var(--mh-card-rgb), 0.9); }
  .mhome-top-name { font: 500 13px 'Space Grotesk', sans-serif; color: var(--mh-ink); white-space: nowrap; }
  .mhome-top-bar { width: 40px; height: 4px; border-radius: 999px; background: var(--mh-hairline); overflow: hidden; display: block; flex: 0 0 auto; }
  .mhome-top-bar span { display: block; height: 100%; border-radius: 999px; }
  .mhome-top-c { font: 600 12px 'Space Grotesk', sans-serif; font-variant-numeric: tabular-nums; }
  .mhome-top-ref { font: 500 11px 'Space Grotesk', sans-serif; color: rgba(var(--mh-ink-rgb), 0.5); font-variant-numeric: tabular-nums; }

  .mhome-ctas { display: flex; flex-direction: column; align-items: center; gap: 13px; margin-top: 27px; }
  .mhome-ctas-sub { display: flex; flex-wrap: wrap; justify-content: center; gap: 11px; }
  .mhome-cta-p {
    display: inline-flex; align-items: center; justify-content: center; gap: 9px; height: 48px; padding: 0 28px;
    border: none; border-radius: 12px; background: var(--mh-cta-bg); color: var(--mh-cta-ink); font: 600 14px 'Space Grotesk', sans-serif;
    cursor: pointer; transition: filter 0.15s, transform 0.15s; box-shadow: 0 8px 26px rgba(var(--mh-accent-rgb), 0.22);
  }
  .mhome-cta-p:hover { filter: brightness(1.06); transform: translateY(-1px); }
  .mhome-cta-s { height: 44px; padding: 0 18px; border-radius: 12px; background: var(--mh-raised); border: 1px solid var(--mh-hairline); color: var(--mh-ink); font: 600 13px 'Space Grotesk', sans-serif; cursor: pointer; transition: border-color 0.15s; }
  .mhome-cta-g { height: 44px; padding: 0 18px; border-radius: 12px; background: transparent; border: 1px solid var(--mh-hairline); color: var(--mh-ink-72); font: 600 13px 'Space Grotesk', sans-serif; cursor: pointer; transition: border-color 0.15s; }
  .mhome-cta-s:hover, .mhome-cta-g:hover { border-color: var(--mh-accent-border); }

  /* Curated Arabic glosses (ar locale, lib/data/rootGlossesAr.ts) render in
     the Arabic type family, same as every other Arabic-script element on
     this screen — layered after the *-gloss rules above so it wins the
     font-family tie-break while keeping each site's own size/color/spacing. */
  .mhome-gloss-ar { font-family: 'Amiri', serif; }

  @keyframes mhfade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

  @media (max-width: 640px) {
    /* Keep the idle→typing glide on mobile too — just with tighter stops. */
    .mhome-stack { padding-top: 21vh; }
    .mhome-stack.is-active { padding-top: 82px; }
    .mhome-search { height: 58px; padding: 0 18px; }
    .mhome-search input { font-size: 17px; }
    .mhome-result-head { gap: 15px; }
    .mhome-topright { inset-inline-end: 16px; }
    .mhome-mark { inset-inline-start: 18px; }
    /* At this width the corner mark and the lang/skip/auth row share one
       line — even glyph-only, the mark ends up underneath the row, so the
       whole mark drops out (brand identity stays in the footer credit). */
    .mhome-mark { display: none; }
    .mhome-topright {
      flex-wrap: nowrap;
      gap: 8px;
    }
    /* The skip pill is the one element here with unbounded text length —
       clamp + ellipsize it so it can never push the auth button off-row
       or collide with the mark. Logical max-width so both LTR and RTL
       reserve the same share of the viewport. */
    .mhome-skip {
      max-width: 42vw;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .mhome-resting, .mhome-result, .mhome-nomatch, .mhome-verse, .mhome-breakdown, .mhome-strip-tip { animation: none; }
    .mhome-atmos, .mhome-stack, .mhome-search, .mhome-dot, .mhome-headline { transition: none; }
  }
`;
