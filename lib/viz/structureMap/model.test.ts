import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { findRootIndex, type ConcordancePayload } from "@/lib/corpus/concordanceClient";
import { buildStructureModel, occurrencesOf, surahsWithRoot } from "@/lib/viz/structureMap/model";

const payload = JSON.parse(readFileSync(path.resolve(process.cwd(), "public", "data", "concordance.json"), "utf8")) as ConcordancePayload;
const model = buildStructureModel(payload);

describe("structure model", () => {
  it("accounts for every word and every root-bearing word", () => {
    expect(model.surahs).toHaveLength(114);
    expect(model.surahs.reduce((s, x) => s + x.words, 0)).toBe(payload.totals.words);
    const bearing = model.surahs.reduce((s, x) => s + x.roots.reduce((t, r) => t + r.count, 0), 0);
    expect(bearing).toBe(payload.totals.rootBearing);
    expect(model.surahs[0].words).toBe(29);
    expect(model.surahs[0].ayahs).toBe(7);
  });

  it("orders each surah's roots by frequency, and a root's surah counts sum to its total", () => {
    for (const s of model.surahs) for (let i = 1; i < s.roots.length; i++) expect(s.roots[i - 1].count).toBeGreaterThanOrEqual(s.roots[i].count);
    const rahma = findRootIndex(payload, "رحم");
    const bySurah = surahsWithRoot(model, rahma);
    expect([...bySurah.values()].reduce((a, b) => a + b, 0)).toBe(payload.roots[rahma].count);
  });

  it("lists occurrences in ayah order with the first word that carries the root", () => {
    const rahma = findRootIndex(payload, "رحم");
    const occ = occurrencesOf(payload, rahma);
    const fatiha = occ.get(1)!;
    expect(fatiha.map((o) => o.ayah)).toEqual([1, 3]);
    expect(fatiha[0]).toEqual({ ayah: 1, count: 2, word: 3 });
    let words = 0;
    occ.forEach((list) => list.forEach((o) => (words += o.count)));
    expect(words).toBe(payload.roots[rahma].count);
    expect(occurrencesOf(payload, -1).size).toBe(0);
  });
});
