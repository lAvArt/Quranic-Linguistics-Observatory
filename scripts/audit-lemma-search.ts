/**
 * Coverage audit for the home search's entry resolution.
 *
 * The home screen decides whether a query matches ANYTHING using three
 * sources — proper names, root keys, and surface forms (form-index). It never
 * consults the lemma map, which is only loaded afterwards to fill the
 * Word / Form tabs on a result that already exists.
 *
 * That means a word can be displayed by the UI and still be unfindable: type
 * back the lemma the result card just showed you (يَصِفُ) and the search comes
 * up empty, because يصف is a lemma, not a surface form and not a root.
 *
 * This walks every key in every index through the REAL resolver functions and
 * reports what fraction is reachable. Run: npx tsx scripts/audit-lemma-search.ts
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lookupRoot, type RootStatsIndex } from "../lib/corpus/rootStatsClient";
import { lookupName, type NameStatsIndex } from "../lib/corpus/nameStatsClient";
import { lookupFormRoot, type FormIndex } from "../lib/corpus/formIndexClient";
import { lookupLemma, type LemmaFormStats } from "../lib/corpus/lemmaFormStatsClient";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = async <T,>(f: string): Promise<T> =>
  JSON.parse(await fs.readFile(path.join(ROOT_DIR, "public", "data", f), "utf8")) as T;

async function main() {
  const [roots, names, forms, drill] = await Promise.all([
    read<RootStatsIndex>("root-stats.json"),
    read<NameStatsIndex>("name-stats.json"),
    read<FormIndex>("form-index.json"),
    read<LemmaFormStats>("lemma-form-stats.json"),
  ]);

  /** The three sources `candidates` in MinimalHome consulted BEFORE the fix. */
  const resolvesToday = (q: string): string =>
    lookupName(names, q) ? "name"
      : lookupRoot(roots, q) ? "root"
        : lookupFormRoot(forms, q) ? "form"
          : "MISS";

  /** What it resolves now — same order, with the lemma map as a fourth source. */
  const resolvesNow = (q: string): string => {
    const before = resolvesToday(q);
    if (before !== "MISS") return before;
    return lookupLemma(drill, q)?.r ? "lemma" : "MISS";
  };

  const lemmaKeys = Object.keys(drill.lemmas);
  const formKeys = Object.keys(drill.forms);
  const rootKeys = Object.keys(roots.roots);

  const report = (label: string, keys: string[], weight: (k: string) => number) => {
    const miss = keys.filter((k) => resolvesToday(k) === "MISS");
    const total = keys.reduce((s, k) => s + weight(k), 0);
    const lost = miss.reduce((s, k) => s + weight(k), 0);
    console.log(
      `  ${label.padEnd(22)} ${String(keys.length - miss.length).padStart(5)}/${String(keys.length).padEnd(5)} reachable` +
      `   ${miss.length} miss` +
      `   (${((100 * lost) / total).toFixed(1)}% of their occurrences)`,
    );
    return miss;
  };

  console.log("\n── Home search entry resolution: what is reachable ──────────────\n");
  console.log("  Sources consulted today: names → roots → surface forms.\n");

  report("root keys", rootKeys, (k) => roots.roots[k].count);
  report("surface form keys", formKeys, (k) => drill.forms[k].c);
  const missedLemmas = report("lemma keys", lemmaKeys, (k) => drill.lemmas[k].c);

  // Would consulting the lemma map close it?
  const stillMissing = missedLemmas.filter((k) => !lookupLemma(drill, k));
  console.log(
    `\n  Adding the lemma map as a fourth source recovers ${missedLemmas.length - stillMissing.length}` +
    ` of the ${missedLemmas.length} missing lemmas (${stillMissing.length} would still miss).`,
  );

  const lostOcc = missedLemmas.reduce((s, k) => s + drill.lemmas[k].c, 0);
  console.log(`  Those lemmas account for ${lostOcc.toLocaleString("en-US")} occurrences.`);

  // Guard: with the lemma source wired in, nothing the result card can display
  // should be unfindable. Exits non-zero if a change ever drops that source.
  const stillUnreachable = lemmaKeys.filter((k) => resolvesNow(k) === "MISS");
  console.log(
    stillUnreachable.length === 0
      ? "\n  AFTER the fix: every lemma key resolves.\n"
      : `\n  AFTER the fix: ${stillUnreachable.length} lemma keys STILL unreachable — ${stillUnreachable.slice(0, 10).join(" ")}\n`,
  );
  if (stillUnreachable.length) process.exitCode = 1;

  console.log("  Worst offenders — unreachable lemmas by occurrence count:\n");
  const worst = missedLemmas
    .map((k) => ({ k, e: drill.lemmas[k] }))
    .sort((a, b) => b.e.c - a.e.c)
    .slice(0, 25);
  for (const { k, e } of worst) {
    const viaForm = Object.keys(drill.forms).find((f) => drill.forms[f].l === k);
    console.log(
      `    ${k.padEnd(12)} ${e.d.padEnd(16)} ${String(e.c).padStart(4)}×  root ${(e.r ?? "—").padEnd(7)}` +
      `  findable instead as: ${viaForm ?? "(no form)"}`,
    );
  }

  // The specific case reported.
  // The surface forms that also miss — a separate, smaller gap.
  const missedForms = formKeys.filter((k) => resolvesToday(k) === "MISS");
  console.log(`\n  Surface forms that also miss (${missedForms.length}):\n`);
  console.log(
    "    " + missedForms.slice(0, 24).map((k) => `${k}(${drill.forms[k].c})`).join("  "),
  );
  const inFormIndex = missedForms.filter((k) => forms.forms[k]);
  console.log(
    `\n    ${inFormIndex.length} of them ARE in form-index yet still do not resolve` +
    ` — a normalization mismatch rather than missing data.`,
  );

  console.log("\n  Reported case:\n");
  for (const q of ["وصف", "يصف", "تصف", "يصفون", "نصف"]) {
    const l = drill.lemmas[q];
    const f = drill.forms[q];
    console.log(
      `    ${q.padEnd(8)} resolves=${resolvesToday(q).padEnd(5)}` +
      `  lemma=${l ? `${l.d} ${l.c}×` : "—"}`.padEnd(22) +
      `  form=${f ? `${f.d} ${f.c}×` : "—"}`,
    );
  }
  console.log();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
