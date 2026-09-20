import { ROOT_GLOSSES_AR } from "@/lib/data/rootGlossesAr";

export interface ResolvedGloss {
  text: string;
  /** True when `text` is a curated Arabic sense (renders rtl); false when
   *  it's the corpus's English gloss (renders ltr, as it always has). */
  isAr: boolean;
}

/**
 * Resolve a root's display gloss. In the `ar` locale, prefer the curated
 * classical Arabic sense (`lib/data/rootGlossesAr.ts`, corpus data — not
 * i18n copy) over the English corpus gloss, so Arabic surfaces read as
 * Arabic rather than mixing in ltr English fragments. Roots outside that
 * curated set — and every root in non-`ar` locales — fall back to the plain
 * English gloss.
 *
 * Shared by the minimal home and the root-frequency page so both label the
 * same root identically.
 */
export function resolveGloss(
  locale: string,
  bare: string,
  englishGloss: string | null | undefined,
): ResolvedGloss | null {
  if (locale === "ar") {
    const ar = ROOT_GLOSSES_AR[bare];
    if (ar) return { text: ar, isAr: true };
  }
  return englishGloss ? { text: englishGloss, isAr: false } : null;
}
