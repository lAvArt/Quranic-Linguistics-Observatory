import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  findRootIndex,
  orderRings,
  selectConcordance,
  suggestRoots,
  type ConcordancePayload,
} from "@/lib/corpus/concordanceClient";

/**
 * Checked against the real payload, not a fixture: these numbers are what the
 * rings will show a reader, so they have to agree with the corpus.
 *
 * The surah counts come from the preset table in docs/CONCORDANCE-RINGS.md,
 * which was measured independently by the prototype. Matching them is how this
 * implementation proves it reproduces the prototype rather than merely running.
 */
describe("concordance rings — corpus query layer", () => {
  const file = path.resolve(process.cwd(), "public", "data", "concordance.json");
  const payload = JSON.parse(readFileSync(file, "utf8")) as ConcordancePayload;

  const pick = (...roots: string[]) => roots.map((r) => findRootIndex(payload, r));

  it("matches the corpus totals the rest of the site reports", () => {
    expect(payload.totals).toMatchObject({
      surahs: 114,
      ayahs: 6236,
      words: 77429,
      rootBearing: 49967,
      roots: 1642,
    });
    expect(payload.surahs).toHaveLength(114);
  });

  it("maps a known ayah to the right roots", () => {
    // 1:1 بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ → سمو · اله · رحم · رحم
    const words = payload.surahs[0].ayahs[0];
    expect(words).toHaveLength(4);
    expect(words.map((i) => payload.roots[i].bare)).toEqual(["سمو", "اله", "رحم", "رحم"]);
  });

  it("orders the root table by frequency", () => {
    expect(payload.roots[0].bare).toBe("اله");
    expect(payload.roots[0].count).toBe(2851);
    for (let i = 1; i < payload.roots.length; i++) {
      expect(payload.roots[i - 1].count).toBeGreaterThanOrEqual(payload.roots[i].count);
    }
  });

  // Every row of the spec's preset table, as surahs where the roots meet in at
  // least one ayah.
  it.each([
    ["آمنوا وعملوا الصالحات", ["امن", "عمل", "صلح"], 41],
    ["عذاب أليم", ["عذب", "الم"], 41],
    ["خلق السماوات والأرض", ["خلق", "سمو", "ارض"], 39],
    ["غفور رحيم", ["غفر", "رحم"], 37],
    ["الحياة الدنيا", ["حيي", "دنو"], 34],
    ["جنات تجري من تحتها الأنهار", ["جنن", "جري", "نهر"], 25],
    ["أنزل من السماء ماء", ["نزل", "سمو", "موه"], 21],
  ])("reproduces the preset %s", (_label, roots, expected) => {
    const sel = selectConcordance(payload, pick(...roots), "ayah");
    expect(sel.roots.map((r) => r.bare)).toEqual(roots);
    expect(sel.qualifying).toHaveLength(expected);
  });

  it("counts a meeting only where every selected root shares one ayah", () => {
    const sel = selectConcordance(payload, pick("خلق", "سمو", "ارض"), "ayah");
    for (const s of sel.qualifying) {
      expect(s.meetings.length).toBeGreaterThan(0);
      for (const m of s.meetings) {
        expect(m.meeting).toBe(true);
        expect(m.mask).toBe(0b111);
        // A meeting is one of that surah's ayahs, and its tick sits inside the ring.
        expect(m.ayah).toBeGreaterThanOrEqual(1);
        expect(m.ayah).toBeLessThanOrEqual(s.ayahCount);
        expect(m.pos).toBeGreaterThan(0);
        expect(m.pos).toBeLessThan(1);
      }
    }
  });

  it("qualifies more surahs when the roots need only share a surah", () => {
    const idx = pick("خلق", "سمو", "ارض");
    const perAyah = selectConcordance(payload, idx, "ayah");
    const perSurah = selectConcordance(payload, idx, "surah");
    expect(perSurah.qualifying.length).toBeGreaterThan(perAyah.qualifying.length);
    // Sharing an ayah implies sharing the surah, so the looser rule is a superset.
    const loose = new Set(perSurah.qualifying.map((s) => s.n));
    for (const s of perAyah.qualifying) expect(loose.has(s.n)).toBe(true);
  });

  it("places every ayah hit at its normalised position", () => {
    const sel = selectConcordance(payload, pick("رحم"), "ayah");
    const fatiha = sel.surahs.find((s) => s.n === 1)!;
    expect(fatiha.ayahCount).toBe(7);
    // 1:1 and 1:3 both carry رحم; ayah i sits at (i - ½)/N.
    const first = fatiha.hits.find((h) => h.ayah === 1)!;
    expect(first.pos).toBeCloseTo(0.5 / 7, 10);
    expect(first.words).toBe(4);
    expect(fatiha.hits.map((h) => h.ayah)).toContain(3);
  });

  it("keeps all 114 surahs available so the full view can dim rather than drop", () => {
    const sel = selectConcordance(payload, pick("خلق", "سمو", "ارض"), "ayah");
    expect(sel.surahs).toHaveLength(114);
    expect(sel.surahs.filter((s) => s.qualifies)).toHaveLength(sel.qualifying.length);
  });

  it("returns nothing selected when no roots are chosen", () => {
    const sel = selectConcordance(payload, [], "ayah");
    expect(sel.roots).toHaveLength(0);
    expect(sel.qualifying).toHaveLength(0);
    expect(sel.totalMeetings).toBe(0);
    expect(sel.surahs).toHaveLength(114);
  });

  it("caps a selection at three roots", () => {
    const sel = selectConcordance(payload, pick("خلق", "سمو", "ارض", "رحم"), "ayah");
    expect(sel.roots).toHaveLength(3);
  });

  it("finds a root however the hamza is written", () => {
    const plain = findRootIndex(payload, "امن");
    expect(plain).toBeGreaterThanOrEqual(0);
    for (const spelling of ["أمن", "ءمن", "آمن"]) {
      expect(findRootIndex(payload, spelling)).toBe(plain);
    }
    // Buckwalter too, per the spec.
    expect(findRootIndex(payload, payload.roots[plain].bw)).toBe(plain);
  });

  it("suggests roots by prefix and by gloss, commonest first", () => {
    const byPrefix = suggestRoots(payload, "رح");
    expect(byPrefix.length).toBeGreaterThan(0);
    expect(byPrefix[0].bare).toBe("رحم");
    const byGloss = suggestRoots(payload, "mercy");
    expect(byGloss.map((r) => r.bare)).toContain("رحم");
    for (let i = 1; i < byPrefix.length; i++) {
      expect(byPrefix[i - 1].count).toBeGreaterThanOrEqual(byPrefix[i].count);
    }
  });

  it("orders rings innermost first for each ordering", () => {
    const sel = selectConcordance(payload, pick("خلق", "سمو", "ارض"), "ayah");
    const mushaf = orderRings(sel.qualifying, "mushaf");
    expect(mushaf[0].n).toBeGreaterThan(mushaf[mushaf.length - 1].n);

    const byLength = orderRings(sel.qualifying, "length");
    for (let i = 1; i < byLength.length; i++) {
      expect(byLength[i - 1].ayahCount).toBeLessThanOrEqual(byLength[i].ayahCount);
    }

    const byMeetings = orderRings(sel.qualifying, "meetings");
    for (let i = 1; i < byMeetings.length; i++) {
      expect(byMeetings[i - 1].meetings.length).toBeLessThanOrEqual(byMeetings[i].meetings.length);
    }
  });
});
