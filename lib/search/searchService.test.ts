import { describe, expect, it } from "vitest";
import { buildSearchCatalog, getSearchCatalog, groupSearchResults, hasSearchCatalog, searchCorpus } from "@/lib/search/searchService";
import type { CorpusToken } from "@/lib/schema/types";

const TOKENS: CorpusToken[] = [
  {
    id: "1:1:1",
    sura: 1,
    ayah: 1,
    position: 1,
    text: "الْحَمْدُ",
    root: "حمد",
    lemma: "حمد",
    pos: "N",
    morphology: {
      features: {},
      gloss: "praise",
      stem: "حمد",
    },
  },
  {
    id: "1:2:1",
    sura: 1,
    ayah: 2,
    position: 1,
    text: "رَبِّ",
    root: "ربب",
    lemma: "رب",
    pos: "N",
    morphology: {
      features: {},
      gloss: "lord",
      stem: "رب",
    },
  },
];

describe("searchService", () => {
  const catalog = buildSearchCatalog(TOKENS);

  it("returns root matches with contextual action targets", () => {
    const results = searchCorpus(TOKENS, catalog, "حمد");
    expect(results[0]?.kind).toBe("root");
    expect(results[0]?.actionTarget.selection?.root).toBe("حمد");
  });

  it("returns exact ayah matches for ayah references", () => {
    const results = searchCorpus(TOKENS, catalog, "1:2");
    expect(results.some((entry) => entry.kind === "ayah")).toBe(true);
  });

  it("groups results by result kind", () => {
    const results = searchCorpus(TOKENS, catalog, "رب");
    const groups = groupSearchResults(results);
    expect(groups[0]?.kind).toBeDefined();
    expect(groups.flatMap((group) => group.items).length).toBe(results.length);
  });
});

describe("shared search catalog", () => {
  it("builds one catalog per token array, shared by every caller", () => {
    const tokens = [...TOKENS];
    expect(hasSearchCatalog(tokens)).toBe(false);
    const a = getSearchCatalog(tokens);
    expect(hasSearchCatalog(tokens)).toBe(true);
    expect(getSearchCatalog(tokens)).toBe(a);
    // A new array (the next corpus batch) is a new catalog, never a stale one.
    expect(getSearchCatalog([...tokens])).not.toBe(a);
  });

  it("searches the same through the shared catalog as through a fresh one", () => {
    const tokens = [...TOKENS];
    expect(searchCorpus(tokens, getSearchCatalog(tokens), "حمد")).toEqual(searchCorpus(tokens, buildSearchCatalog(tokens), "حمد"));
  });
});
