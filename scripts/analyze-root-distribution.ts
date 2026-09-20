/**
 * Root frequency — local analysis + prototype report.
 *
 * Reads `public/data/root-stats.json` (built by scripts/build-root-stats.ts
 * straight from the QAC morphology file, so it is unaffected by the
 * corpus_tokens seed misalignment that skews DB-backed views) and reports
 * what is there: which roots occur most often, how the counts are spread
 * across frequency bands, which roots land on near-identical counts, and
 * how much of the text each tier accounts for.
 *
 * Descriptive only — the report states what the counts are, never why.
 * Resist adding model fits, distribution names, or causal framing here.
 *
 * Emits a console summary plus two artefacts under `public/data/_local/`
 * (gitignored). That directory is used rather than `public/_local/` because
 * proxy.ts only exempts `/data` from locale rewriting — anywhere else the
 * .html 307s to /{locale}/… and 404s. Served by `next dev` at
 * http://localhost:3000/data/_local/root-distribution.html :
 *   root-distribution.json  — the aggregates, ready for a future page
 *   root-distribution.html  — a self-contained visual prototype
 *
 * Also writes two committed files:
 *   public/data/root-frequency.json  — the aggregates the /frequency page
 *     renders from (read at build time by a server component, so none of it
 *     reaches the client bundle)
 *   docs/ROOT-GLOSS-GAPS.md          — the gloss worklist
 *
 * Run: npm run data:root-dist
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const SRC = path.join(ROOT_DIR, "public", "data", "root-stats.json");
const OUT_DIR = path.join(ROOT_DIR, "public", "data", "_local");

interface RootEntry {
  bare: string;
  root: string;
  translit: string;
  gloss: string | null;
  count: number;
  surahs: number;
  verses: number;
  forms: number;
  first: { sura: number; ayah: number } | null;
  top: [number, number, number][];
  hist: number[];
  pos: [string, number][];
}

/** Rank cut-points the coverage ladder walks. */
const CUTS = [1, 5, 10, 25, 50, 100, 200, 300, 500, 750, 1000, 1250, 1500];
/** Frequency tiers the leaderboard groups by. */
const TIERS: { label: string; lo: number; hi: number }[] = [
  { label: "Most frequent", lo: 1, hi: 10 },
  { label: "Second tier", lo: 11, hi: 50 },
  { label: "Third tier", lo: 51, hi: 100 },
  { label: "Fourth tier", lo: 101, hi: 250 },
  { label: "Fifth tier", lo: 251, hi: 500 },
];
/** The band that prompted this analysis — always shown, however dense it is. */
const FOCUS_COUNT = 280;
/** Log-scale buckets for the frequency-band chart. */
const BUCKETS: [number, number][] = [
  [1, 1], [2, 2], [3, 4], [5, 9], [10, 19], [20, 49],
  [50, 99], [100, 199], [200, 499], [500, 999], [1000, Infinity],
];

interface Report {
  version: number;
  generated: string;
  totals: { roots: number; words: number; hapax: number; median: number; mean: number };
  tiers: { label: string; lo: number; hi: number; words: number; share: number; floor: number }[];
  coverage: { rank: number; words: number; share: number; minCount: number }[];
  buckets: { lo: number; hi: number | null; roots: number; words: number }[];
  ties: { count: number; n: number; members: { bare: string; gloss: string | null; surahs: number }[] }[];
  bands: { lo: number; hi: number; focus: boolean; members: { bare: string; count: number; surahs: number; gloss: string | null }[] }[];
  leaderboard: {
    rank: number; bare: string; translit: string; gloss: string | null;
    count: number; surahs: number; verses: number; forms: number;
    share: number; cumShare: number;
  }[];
  scatter: { bare: string; gloss: string | null; count: number; surahs: number; topShare: number; topSura: number }[];
}

async function main() {
  const raw = JSON.parse(await fs.readFile(SRC, "utf8")) as { roots: Record<string, RootEntry> };
  const roots = Object.values(raw.roots).sort((x, y) => y.count - x.count || x.bare.localeCompare(y.bare));
  const N = roots.length;
  const totalWords = roots.reduce((s, r) => s + r.count, 0);

  // ── Coverage ladder ──────────────────────────────────────────────────────
  const cum: number[] = [];
  let running = 0;
  for (const r of roots) cum.push((running += r.count));
  const coverage = CUTS.filter((c) => c < N).map((c) => ({
    rank: c,
    words: cum[c - 1],
    share: cum[c - 1] / totalWords,
    minCount: roots[c - 1].count,
  }));
  coverage.push({ rank: N, words: totalWords, share: 1, minCount: roots[N - 1].count });

  // ── Tiers ────────────────────────────────────────────────────────────────
  const tiers = TIERS.map((t) => {
    const band = roots.slice(t.lo - 1, t.hi);
    const words = band.reduce((s, r) => s + r.count, 0);
    return { ...t, words, share: words / totalWords, floor: band[band.length - 1].count };
  });

  // ── Frequency bands ──────────────────────────────────────────────────────
  const buckets = BUCKETS.map(([lo, hi]) => {
    const rs = roots.filter((r) => r.count >= lo && r.count <= hi);
    return {
      lo,
      hi: Number.isFinite(hi) ? hi : null,
      roots: rs.length,
      words: rs.reduce((s, r) => s + r.count, 0),
    };
  });
  const spectrum = new Map<number, number>();
  for (const r of roots) spectrum.set(r.count, (spectrum.get(r.count) ?? 0) + 1);
  const hapax = spectrum.get(1) ?? 0;

  // ── Roots landing on the same, or nearly the same, count ─────────────────
  const ties = [...spectrum.entries()]
    .filter(([c, n]) => n > 1 && c >= 40)
    .sort((a, b) => b[1] - a[1] || b[0] - a[0])
    .slice(0, 12)
    .map(([count, n]) => ({
      count,
      n,
      members: roots
        .filter((r) => r.count === count)
        .map((r) => ({ bare: r.bare, gloss: r.gloss, surahs: r.surahs })),
    }));

  /** Sliding ±5% window: where do several roots share nearly one count? */
  const windows: { lo: number; hi: number; members: RootEntry[] }[] = [];
  for (const r of roots) {
    if (r.count < 50) break;
    const lo = Math.floor(r.count * 0.95);
    const hi = Math.ceil(r.count * 1.05);
    const members = roots.filter((m) => m.count >= lo && m.count <= hi);
    if (members.length >= 4) windows.push({ lo, hi, members });
  }
  windows.sort((a, b) => b.members.length - a.members.length || b.hi - a.hi);
  // Seed with the band under investigation so it survives the density ranking.
  const focusLo = Math.floor(FOCUS_COUNT * 0.95);
  const focusHi = Math.ceil(FOCUS_COUNT * 1.05);
  const bands: typeof windows = [
    { lo: focusLo, hi: focusHi, members: roots.filter((r) => r.count >= focusLo && r.count <= focusHi) },
  ];
  for (const w of windows) {
    if (bands.some((b) => w.lo <= b.hi && w.hi >= b.lo)) continue;
    bands.push(w);
    if (bands.length >= 6) break;
  }
  bands.sort((a, b) => b.hi - a.hi);

  // ── Occurrences against sūrah reach ──────────────────────────────────────
  const scatter = roots
    .filter((r) => r.count >= 20)
    .map((r) => ({
      bare: r.bare,
      gloss: r.gloss,
      count: r.count,
      surahs: r.surahs,
      topShare: r.top[0] ? r.top[0][1] / r.count : 0,
      topSura: r.top[0] ? r.top[0][0] : 0,
    }));

  const report: Report = {
    version: 2,
    generated: new Date().toISOString(),
    totals: {
      roots: N,
      words: totalWords,
      hapax,
      median: roots[Math.floor(N / 2)].count,
      mean: totalWords / N,
    },
    tiers,
    coverage,
    buckets,
    ties,
    bands: bands.map((b) => ({
      lo: b.lo,
      hi: b.hi,
      focus: b.lo === focusLo && b.hi === focusHi,
      members: b.members.map((r) => ({ bare: r.bare, count: r.count, surahs: r.surahs, gloss: r.gloss })),
    })),
    leaderboard: roots.slice(0, 500).map((r, i) => ({
      rank: i + 1,
      bare: r.bare,
      translit: r.translit,
      gloss: r.gloss,
      count: r.count,
      surahs: r.surahs,
      verses: r.verses,
      forms: r.forms,
      share: r.count / totalWords,
      cumShare: cum[i] / totalWords,
    })),
    scatter,
  };

  // ── Console summary ──────────────────────────────────────────────────────
  const pc = (x: number) => `${(100 * x).toFixed(1)}%`;
  console.log(`\n── Root frequency ─────────────────────────────────────────────`);
  console.log(`   ${N} roots · ${totalWords.toLocaleString("en-US")} root-bearing words`);
  console.log(`   mean ${report.totals.mean.toFixed(1)}x · median ${report.totals.median}x · most frequent ${roots[0].count}x (${roots[0].bare})`);
  console.log(`\n   Tiers:`);
  for (const t of tiers)
    console.log(`     ${t.label.padEnd(14)} ranks ${String(t.lo).padStart(3)}-${String(t.hi).padEnd(3)}  ${String(t.words).padStart(6)} words  ${pc(t.share).padStart(6)}  (down to ${t.floor}x)`);
  console.log(`\n   Coverage:`);
  for (const c of coverage.filter((c) => c.rank === 10 || c.rank === 100 || c.rank === 500 || c.rank === N))
    console.log(`     top ${String(c.rank).padStart(4)} roots -> ${pc(c.share).padStart(6)} of all root-bearing words (down to ${c.minCount}x)`);
  console.log(`     ${hapax} roots (${pc(hapax / N)}) occur exactly once — together ${pc(hapax / totalWords)} of words`);
  console.log(`\n   Roots sharing a count (±5% window):`);
  for (const b of bands)
    console.log(`     ${String(b.lo).padStart(4)}-${String(b.hi).padEnd(4)} ${String(b.members.length).padStart(2)} roots  ${b.members.map((r) => r.bare).join(" ")}`);

  await fs.mkdir(OUT_DIR, { recursive: true });
  const jsonPath = path.join(OUT_DIR, "root-distribution.json");
  const htmlPath = path.join(OUT_DIR, "root-distribution.html");
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 1));
  await fs.writeFile(htmlPath, renderReport(report));

  // Committed copy the /frequency page reads at build time.
  const pagePath = path.join(ROOT_DIR, "public", "data", "root-frequency.json");
  await fs.writeFile(pagePath, JSON.stringify(report));
  console.log(`
   -> ${path.relative(ROOT_DIR, pagePath)}  (${((await fs.stat(pagePath)).size / 1024).toFixed(0)} KB, committed)`);

  const gapsPath = path.join(ROOT_DIR, "docs", "ROOT-GLOSS-GAPS.md");
  const gaps = roots.filter((r) => !r.gloss);
  await fs.writeFile(gapsPath, renderGlossGaps(roots, totalWords));
  console.log(`\n   ${gaps.length} of ${N} roots still have no gloss (${pc(gaps.length / N)}), covering ${pc(gaps.reduce((s, r) => s + r.count, 0) / totalWords)} of the text`);
  console.log(`   -> ${path.relative(ROOT_DIR, gapsPath)}`);

  console.log(`\n   -> ${path.relative(ROOT_DIR, jsonPath)}`);
  console.log(`   -> ${path.relative(ROOT_DIR, htmlPath)}`);
  console.log(`      http://localhost:3000/data/_local/root-distribution.html  (with npm run dev)\n`);
}

// ═══ Report ════════════════════════════════════════════════════════════════

function renderReport(p: Report): string {
  const pct = (x: number, d = 1) => `${(100 * x).toFixed(d)}%`;
  const num = (x: number) => x.toLocaleString("en-US");
  const peak = p.leaderboard[0].count;

  // ── Ranked curve (no fit, no model — just the ranked counts) ─────────────
  const zw = 720, zh = 360, zm = { t: 16, r: 16, b: 40, l: 52 };
  const maxLr = Math.log10(500);
  const maxLf = Math.log10(peak);
  const zx = (lr: number) => zm.l + (lr / maxLr) * (zw - zm.l - zm.r);
  const zy = (lf: number) => zh - zm.b - (lf / maxLf) * (zh - zm.t - zm.b);
  const curveDots = p.leaderboard
    .map((r) => `<circle cx="${zx(Math.log10(r.rank)).toFixed(1)}" cy="${zy(Math.log10(r.count)).toFixed(1)}" r="1.7"><title>#${r.rank} ${r.bare} — ${num(r.count)}×</title></circle>`)
    .join("");
  const zTicksX = [1, 10, 100, 500].map(
    (v) => `<g class="tick"><line x1="${zx(Math.log10(v)).toFixed(1)}" y1="${zh - zm.b}" x2="${zx(Math.log10(v)).toFixed(1)}" y2="${zh - zm.b + 5}"/><text x="${zx(Math.log10(v)).toFixed(1)}" y="${zh - zm.b + 18}" text-anchor="middle">${v}</text></g>`,
  ).join("");
  const zTicksY = [10, 100, 1000].map(
    (v) => `<g class="tick"><line x1="${zm.l - 5}" y1="${zy(Math.log10(v)).toFixed(1)}" x2="${zm.l}" y2="${zy(Math.log10(v)).toFixed(1)}"/><text x="${zm.l - 9}" y="${(zy(Math.log10(v)) + 4).toFixed(1)}" text-anchor="end">${v}×</text></g>`,
  ).join("");

  // ── Frequency-band bars ──────────────────────────────────────────────────
  const bw = 720, bh = 260, bm = { t: 14, r: 14, b: 46, l: 48 };
  const bMax = Math.max(...p.buckets.map((b) => Math.max(b.roots / p.totals.roots, b.words / p.totals.words)));
  const bandW = (bw - bm.l - bm.r) / p.buckets.length;
  const bucketBars = p.buckets
    .map((b, i) => {
      const x = bm.l + i * bandW;
      const h1 = ((b.roots / p.totals.roots) / bMax) * (bh - bm.t - bm.b);
      const h2 = ((b.words / p.totals.words) / bMax) * (bh - bm.t - bm.b);
      const label = b.hi === null ? `${b.lo}+` : b.lo === b.hi ? `${b.lo}` : `${b.lo}–${b.hi}`;
      return `<g><rect x="${(x + bandW * 0.12).toFixed(1)}" y="${(bh - bm.b - h1).toFixed(1)}" width="${(bandW * 0.34).toFixed(1)}" height="${h1.toFixed(1)}" class="b-roots"/>` +
        `<rect x="${(x + bandW * 0.5).toFixed(1)}" y="${(bh - bm.b - h2).toFixed(1)}" width="${(bandW * 0.34).toFixed(1)}" height="${h2.toFixed(1)}" class="b-words"/>` +
        `<text x="${(x + bandW / 2).toFixed(1)}" y="${bh - bm.b + 16}" text-anchor="middle" class="blabel">${label}</text>` +
        `<title>${label} occurrences — ${b.roots} roots (${pct(b.roots / p.totals.roots)} of roots), ${num(b.words)} words (${pct(b.words / p.totals.words)} of text)</title></g>`;
    })
    .join("");

  // ── Coverage ladder ──────────────────────────────────────────────────────
  const ladder = p.coverage
    .map((c) => `<div class="lad">
      <span class="lad-rank">top ${num(c.rank)}</span>
      <span class="lad-bar"><i style="width:${(100 * c.share).toFixed(2)}%"></i></span>
      <span class="lad-pct">${pct(c.share)}</span>
      <span class="lad-note">≥ ${c.minCount}×</span>
    </div>`)
    .join("");

  // ── Tier summary ─────────────────────────────────────────────────────────
  const tierRows = p.tiers
    .map((t) => `<tr>
      <td class="tier-l">${t.label}</td>
      <td class="n dim">${t.lo}–${t.hi}</td>
      <td class="n">${num(t.words)}</td>
      <td class="n">${pct(t.share)}</td>
      <td class="n dim">${num(t.floor)}× and up</td>
    </tr>`)
    .join("");

  // ── Bands + exact ties ───────────────────────────────────────────────────
  const bandCards = p.bands
    .map((b) => `<div class="band${b.focus ? " focus" : ""}">
      <header><b>${b.lo}–${b.hi}×</b><span>${b.members.length} roots within ±5%</span></header>
      <ul>${b.members.map((m) => `<li><span class="ar">${m.bare}</span><span class="n">${m.count}×</span><span class="g">${m.gloss ?? "—"}</span><span class="s">${m.surahs} sūrahs</span></li>`).join("")}</ul>
    </div>`)
    .join("");
  const tieCards = p.ties
    .slice(0, 8)
    .map((t) => `<div class="tie"><b>${t.count}×</b><span class="tie-n">${t.n} roots</span><span class="tie-m">${t.members.map((m) => `<i class="ar">${m.bare}</i>`).join("")}</span></div>`)
    .join("");

  // ── Leaderboard, grouped by tier ─────────────────────────────────────────
  const rows = p.leaderboard
    .map((r) => {
      const tier = p.tiers.find((t) => t.lo === r.rank);
      const sep = tier
        ? `<tr class="sep" data-rank="${tier.lo}"><td colspan="9">${tier.label}<span> · ranks ${tier.lo}–${tier.hi} · ${pct(tier.share)} of the text</span></td></tr>`
        : "";
      return `${sep}<tr data-rank="${r.rank}">
      <td class="r">${r.rank}</td>
      <td class="ar">${r.bare}</td>
      <td class="tl">${r.translit}</td>
      <td class="g">${r.gloss ?? "—"}</td>
      <td class="n">${num(r.count)}</td>
      <td class="n dim">${r.surahs}</td>
      <td class="n dim">${num(r.verses)}</td>
      <td class="bar"><i style="width:${((r.count / peak) * 100).toFixed(2)}%"></i></td>
      <td class="n dim">${pct(r.cumShare)}</td>
    </tr>`;
    })
    .join("");
  const tabs = p.tiers
    .map((t, i) => `<button type="button" data-n="${t.hi}" aria-pressed="${i === 0}">Top ${t.hi}</button>`)
    .join("");

  // ── Occurrences against sūrah reach ──────────────────────────────────────
  const sw = 720, sh = 340, sm = { t: 16, r: 16, b: 42, l: 52 };
  const sLo = Math.log10(20);
  const sx = (c: number) =>
    sm.l + ((Math.log10(c) - sLo) / (Math.log10(peak) - sLo)) * (sw - sm.l - sm.r);
  const sy = (s: number) => sh - sm.b - (s / 114) * (sh - sm.t - sm.b);
  const dots = p.scatter
    .map((d) => `<circle cx="${sx(d.count).toFixed(1)}" cy="${sy(d.surahs).toFixed(1)}" r="${(2 + Math.min(4, d.count / 250)).toFixed(1)}" class="${d.topShare > 0.15 ? "conc" : ""}"><title>${d.bare} — ${d.count}× across ${d.surahs} sūrahs${d.gloss ? ` · ${d.gloss}` : ""}</title></circle>`)
    .join("");
  const sTicksX = [20, 50, 100, 300, 1000, peak].map(
    (v) => `<g class="tick"><line x1="${sx(v).toFixed(1)}" y1="${sh - sm.b}" x2="${sx(v).toFixed(1)}" y2="${sh - sm.b + 5}"/><text x="${sx(v).toFixed(1)}" y="${sh - sm.b + 18}" text-anchor="middle">${v}×</text></g>`,
  ).join("");
  const sTicksY = [0, 30, 60, 90, 114].map(
    (v) => `<g class="tick"><line x1="${sm.l - 5}" y1="${sy(v).toFixed(1)}" x2="${sm.l}" y2="${sy(v).toFixed(1)}"/><text x="${sm.l - 9}" y="${(sy(v) + 4).toFixed(1)}" text-anchor="end">${v}</text></g>`,
  ).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Root frequency — local prototype</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=Space+Grotesk:wght@400;500;700&display=swap" rel="stylesheet">
<style>
:root{
  --bg-0:#0e161a; --bg-1:#142026; --bg-2:#1c2a31;
  --ink:#ece4d8; --ink-2:rgba(236,228,216,.72); --ink-3:rgba(236,228,216,.5);
  --line:rgba(198,222,230,.12); --panel:rgba(20,32,38,.92);
  --accent:#e8924a; --accent-2:#56a697;
}
*{box-sizing:border-box}
body{
  margin:0; padding:0 0 96px;
  background:
    radial-gradient(ellipse at 16% 20%, rgba(232,146,74,.10), transparent 52%),
    radial-gradient(ellipse at 84% 66%, rgba(86,166,151,.08), transparent 52%),
    var(--bg-0);
  color:var(--ink); font-family:"Space Grotesk","Segoe UI",sans-serif;
  font-size:15px; line-height:1.55; -webkit-font-smoothing:antialiased;
}
.wrap{max-width:860px;margin:0 auto;padding:0 20px}
header.top{padding:56px 0 24px;border-bottom:1px solid var(--line);margin-bottom:40px}
header.top h1{font-size:30px;margin:0 0 6px;letter-spacing:-.02em;font-weight:500}
header.top p{margin:0;color:var(--ink-3);font-size:13px}
.stamp{display:inline-block;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin-bottom:14px}
section{margin:0 0 56px}
h2{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-3);font-weight:500;margin:0 0 6px}
h3{font-size:21px;font-weight:500;margin:0 0 12px;letter-spacing:-.01em}
p.lede{color:var(--ink-2);margin:0 0 22px;max-width:64ch}
.ar{font-family:"Amiri","Scheherazade New",serif;font-size:1.28em;direction:rtl;unicode-bidi:isolate}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px 22px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:0 0 26px}
.kpi{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.kpi b{display:block;font-size:26px;font-weight:500;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.kpi span{font-size:11px;color:var(--ink-3);letter-spacing:.06em;text-transform:uppercase}
.kpi.ac b{color:var(--accent)} .kpi.a2 b{color:var(--accent-2)}
svg{display:block;width:100%;height:auto;overflow:visible}
svg text{fill:var(--ink-3);font-size:10px;font-family:inherit}
svg .tick line{stroke:var(--line)}
svg circle{fill:var(--accent-2);opacity:.55}
svg circle.conc{fill:var(--accent);opacity:.8}
svg .b-roots{fill:var(--accent-2);opacity:.78}
svg .b-words{fill:var(--accent);opacity:.78}
svg .blabel{font-size:9.5px}
.legend{display:flex;gap:18px;font-size:12px;color:var(--ink-3);margin-top:10px}
.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px}
.lad{display:grid;grid-template-columns:78px 1fr 54px 64px;gap:12px;align-items:center;padding:5px 0;font-size:13px}
.lad-rank{color:var(--ink-2);font-variant-numeric:tabular-nums}
.lad-bar{height:8px;background:var(--bg-2);border-radius:4px;overflow:hidden}
.lad-bar i{display:block;height:100%;background:linear-gradient(90deg,var(--accent-2),var(--accent));border-radius:4px}
.lad-pct{text-align:right;font-variant-numeric:tabular-nums;color:var(--ink)}
.lad-note{text-align:right;font-size:11px;color:var(--ink-3);font-variant-numeric:tabular-nums}
.bands{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.band{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.band.focus{border-color:rgba(232,146,74,.45);box-shadow:0 0 0 1px rgba(232,146,74,.12)}
.band header{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--line)}
.band header b{font-size:16px;color:var(--accent);font-variant-numeric:tabular-nums}
.band header span{font-size:11px;color:var(--ink-3)}
.band ul{list-style:none;margin:0;padding:0}
.band li{display:grid;grid-template-columns:auto 46px 1fr auto;gap:10px;align-items:baseline;padding:3px 0;font-size:12.5px}
.band li .n{color:var(--accent-2);font-variant-numeric:tabular-nums;text-align:right}
.band li .g{color:var(--ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.band li .s{color:var(--ink-3);font-size:11px;font-variant-numeric:tabular-nums}
.ties{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}
.tie{background:var(--bg-2);border:1px solid var(--line);border-radius:10px;padding:9px 13px;font-size:12px}
.tie b{color:var(--accent);font-variant-numeric:tabular-nums;margin-right:8px}
.tie-n{color:var(--ink-3);margin-right:10px}
.tie-m i{font-style:normal;margin-left:7px}
.tabs{display:flex;gap:8px;margin:0 0 16px;flex-wrap:wrap}
.tabs button{background:var(--bg-2);border:1px solid var(--line);color:var(--ink-2);border-radius:999px;padding:6px 16px;font:inherit;font-size:12.5px;cursor:pointer}
.tabs button[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:#2a1606}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;font-weight:500;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);padding:0 8px 8px;border-bottom:1px solid var(--line)}
th.n{text-align:right}
td{padding:6px 8px;border-bottom:1px solid rgba(198,222,230,.05)}
td.r{color:var(--ink-3);font-variant-numeric:tabular-nums;width:38px}
td.tl{color:var(--ink-3);font-size:11.5px;white-space:nowrap}
td.g{color:var(--ink-2)}
td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
td.dim{color:var(--ink-3)}
td.tier-l{color:var(--ink)}
td.bar{width:110px}
td.bar i{display:block;height:6px;background:var(--accent-2);border-radius:3px;opacity:.75}
tbody tr:hover{background:rgba(232,146,74,.06)}
tr.sep td{padding-top:18px;padding-bottom:6px;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);border-bottom:1px solid var(--line)}
tr.sep td span{color:var(--ink-3);letter-spacing:.06em}
tr.sep:hover{background:none}
footer{color:var(--ink-3);font-size:12px;border-top:1px solid var(--line);padding-top:20px;margin-top:8px;max-width:64ch}
@media(max-width:700px){.kpis{grid-template-columns:repeat(2,1fr)}.bands{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="wrap">
<header class="top">
  <span class="stamp">local prototype · not published</span>
  <h1>Root frequency in the Qur&rsquo;ān</h1>
  <p>${num(p.totals.roots)} roots across ${num(p.totals.words)} root-bearing words · built from the QAC morphology file on ${p.generated.slice(0, 10)}</p>
</header>

<section>
  <h2>Overview</h2>
  <div class="kpis">
    <div class="kpi ac"><b>${num(p.totals.roots)}</b><span>distinct roots</span></div>
    <div class="kpi"><b>${num(p.totals.words)}</b><span>root-bearing words</span></div>
    <div class="kpi a2"><b>${p.totals.median}×</b><span>median · mean ${p.totals.mean.toFixed(1)}×</span></div>
    <div class="kpi"><b>${num(p.totals.hapax)}</b><span>occur exactly once</span></div>
  </div>
  <div class="card" style="padding:16px 18px">
  <table>
    <thead><tr><th>Tier</th><th class="n">Ranks</th><th class="n">Words</th><th class="n">Share</th><th class="n">Counts</th></tr></thead>
    <tbody>${tierRows}</tbody>
  </table>
  </div>
</section>

<section>
  <h2>Leaderboard</h2>
  <h3>The most frequent roots, by tier</h3>
  <p class="lede">Every root carrying a ROOT tag in the corpus, ranked by the number of words built on it.
  <b>Count</b> is occurrences, <b>Sūr.</b> the number of sūrahs it appears in, <b>Cum.</b> the running share
  of all root-bearing words down to that rank.</p>
  <div class="tabs">${tabs}</div>
  <div class="card" style="padding:16px 18px">
  <table>
    <thead><tr><th>#</th><th>Root</th><th></th><th>Gloss</th><th class="n">Count</th><th class="n">Sūr.</th><th class="n">Verses</th><th></th><th class="n">Cum.</th></tr></thead>
    <tbody id="lb">${rows}</tbody>
  </table>
  </div>
</section>

<section>
  <h2>Coverage</h2>
  <h3>What the top N roots account for</h3>
  <p class="lede">Share of all root-bearing words carried by the N most frequent roots, and the occurrence
  count at that cut-off.</p>
  <div class="card">${ladder}</div>
</section>

<section>
  <h2>Ranked counts</h2>
  <h3>The top 500, rank against occurrences</h3>
  <p class="lede">Each of the 500 most frequent roots plotted at its rank and its count. Both axes are
  logarithmic.</p>
  <div class="card">
    <svg viewBox="0 0 ${zw} ${zh}" role="img" aria-label="Rank against occurrence count for the top 500 roots">
      <line x1="${zm.l}" y1="${zh - zm.b}" x2="${zw - zm.r}" y2="${zh - zm.b}" stroke="var(--line)"/>
      <line x1="${zm.l}" y1="${zm.t}" x2="${zm.l}" y2="${zh - zm.b}" stroke="var(--line)"/>
      ${zTicksX}${zTicksY}${curveDots}
      <text x="${zw / 2}" y="${zh - 4}" text-anchor="middle">rank →</text>
    </svg>
  </div>
</section>

<section>
  <h2>Frequency bands</h2>
  <h3>How many roots, how many words</h3>
  <p class="lede">For each band of occurrence counts: teal is that band&rsquo;s share of the
  <b>root inventory</b>, amber its share of the <b>running text</b>.</p>
  <div class="card">
    <svg viewBox="0 0 ${bw} ${bh}" role="img" aria-label="Share of roots and share of words by frequency band">
      <line x1="${bm.l}" y1="${bh - bm.b}" x2="${bw - bm.r}" y2="${bh - bm.b}" stroke="var(--line)"/>
      ${bucketBars}
      <text x="${bw / 2}" y="${bh - 6}" text-anchor="middle">occurrences per root</text>
    </svg>
    <div class="legend"><span><i style="background:var(--accent-2)"></i>share of roots</span><span><i style="background:var(--accent)"></i>share of words</span></div>
  </div>
</section>

<section>
  <h2>Shared counts</h2>
  <h3>Roots landing on nearly the same number</h3>
  <p class="lede">Windows of ±5% in which several roots share almost one count. The highlighted card is the
  266–294 band.</p>
  <div class="bands">${bandCards}</div>
  <h2 style="margin-top:28px">Exact ties</h2>
  <p class="lede">Groups of roots landing on precisely the same count.</p>
  <div class="ties">${tieCards}</div>
</section>

<section>
  <h2>Reach</h2>
  <h3>Occurrences against sūrah reach</h3>
  <p class="lede">Every root with 20 or more occurrences, plotted against the number of the 114 sūrahs it
  appears in. Amber marks roots with more than 15% of their occurrences inside a single sūrah.</p>
  <div class="card">
    <svg viewBox="0 0 ${sw} ${sh}" role="img" aria-label="Occurrences against number of surahs reached">
      <line x1="${sm.l}" y1="${sh - sm.b}" x2="${sw - sm.r}" y2="${sh - sm.b}" stroke="var(--line)"/>
      <line x1="${sm.l}" y1="${sm.t}" x2="${sm.l}" y2="${sh - sm.b}" stroke="var(--line)"/>
      ${sTicksX}${sTicksY}${dots}
      <text x="${sw / 2}" y="${sh - 4}" text-anchor="middle">occurrences (log scale)</text>
    </svg>
    <div class="legend"><span><i style="background:var(--accent-2)"></i>spread across sūrahs</span><span><i style="background:var(--accent)"></i>&gt;15% in one sūrah</span></div>
  </div>
</section>

<footer>
  Source: Quranic Arabic Corpus morphology 0.4 by Kais Dukes. Counts are root-bearing words — one per
  orthographic word carrying a ROOT tag — so particles and proper nouns without a root are excluded.
</footer>
</div>
<script>
(function(){
  var rows = Array.prototype.slice.call(document.querySelectorAll('#lb tr'));
  var btns = Array.prototype.slice.call(document.querySelectorAll('.tabs button'));
  function show(n){
    rows.forEach(function(tr){ tr.style.display = (+tr.dataset.rank <= n) ? '' : 'none'; });
    btns.forEach(function(b){ b.setAttribute('aria-pressed', String(+b.dataset.n === n)); });
  }
  btns.forEach(function(b){ b.addEventListener('click', function(){ show(+b.dataset.n); }); });
  show(+btns[0].dataset.n);
})();
</script>
</body>
</html>`;
}

// ═══ Gloss-gap worklist ════════════════════════════════════════════════════

/**
 * Every root with no English gloss, ranked by how much of the text it carries.
 * Committed to `docs/` because it is a contributor worklist, not build output —
 * the top of the list is what blocks shipping a public root leaderboard.
 */
function renderGlossGaps(roots: RootEntry[], totalWords: number): string {
  const missing = roots
    .map((r, i) => ({ ...r, rank: i + 1 }))
    .filter((r) => !r.gloss);
  const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
  const words = (rs: { count: number }[]) => rs.reduce((s, r) => s + r.count, 0);

  const GAP_TIERS: [string, number, number][] = [
    ["Tier 1 — top 100", 1, 100],
    ["Tier 2 — ranks 101–250", 101, 250],
    ["Tier 3 — ranks 251–500", 251, 500],
  ];
  const TAIL_FROM = 501;

  const summary = [...GAP_TIERS.map(([, lo, hi]) => [`${lo}–${hi}`, lo, hi] as [string, number, number]),
    [`${TAIL_FROM}+`, TAIL_FROM, roots.length] as [string, number, number]]
    .map(([label, lo, hi]) => {
      const band = roots.slice(lo - 1, hi);
      const gaps = band.filter((r) => !r.gloss);
      return `| ${label} | ${band.length} | ${gaps.length} | ${pct(gaps.length / band.length)} | ${words(gaps).toLocaleString("en-US")} | ${pct(words(gaps) / totalWords)} |`;
    })
    .join("\n");

  const table = (rows: typeof missing) =>
    [
      "| Rank | Root | Translit | Count | Sūrahs | Verses | First |",
      "| ---: | --- | --- | ---: | ---: | ---: | --- |",
      ...rows.map((r) =>
        `| ${r.rank} | ${r.bare} | ${r.translit} | ${r.count} | ${r.surahs} | ${r.verses} | ${r.first ? `${r.first.sura}:${r.first.ayah}` : "—"} |`),
    ].join("\n");

  const tierSections = GAP_TIERS.map(([title, lo, hi]) => {
    const rows = missing.filter((r) => r.rank >= lo && r.rank <= hi);
    if (!rows.length) return `### ${title}\n\nNone — fully glossed.`;
    return `### ${title}\n\n${rows.length} roots, ${words(rows).toLocaleString("en-US")} words (${pct(words(rows) / totalWords)} of the text).\n\n${table(rows)}`;
  }).join("\n\n");

  // The tail is too long to table row by row, and individual entries matter
  // less — group it by count band so a contributor can pick off a whole band.
  const tail = missing.filter((r) => r.rank >= TAIL_FROM);
  const TAIL_BANDS: [number, number][] = [[10, 99], [5, 9], [3, 4], [2, 2], [1, 1]];
  const tailSections = TAIL_BANDS.map(([lo, hi]) => {
    const rows = tail.filter((r) => r.count >= lo && r.count <= hi);
    if (!rows.length) return "";
    const label = lo === hi ? `${lo}×` : `${lo}–${hi}×`;
    return `**${label}** — ${rows.length} roots\n\n${rows.map((r) => `\`${r.bare}\``).join(" · ")}`;
  })
    .filter(Boolean)
    .join("\n\n");

  return `# Root gloss gaps

Generated worklist: every corpus root carrying no English gloss, ranked by how much
of the Qur'ānic text it accounts for. The top of this list is what blocks shipping a
public "most frequent roots" leaderboard — a table of 500 rows is not publishable when
two thirds of it reads "—".

Regenerate with \`npm run data:root-dist\`. Do not hand-edit.

_Generated ${new Date().toISOString().slice(0, 10)} from \`public/data/root-stats.json\` (QAC morphology 0.4)._

## Where a gloss comes from

\`scripts/build-root-stats.ts\` resolves each root in this order:

1. \`ROOT_GLOSSES\` in \`lib/data/rootGlosses.ts\`, keyed by the exact root string.
2. The same map after hamza-folding both sides.
3. \`EXTRA_GLOSSES\`, the stop-gap list inside \`scripts/build-root-stats.ts\`.

To close a gap, add the pair to \`ROOT_GLOSSES\` (the durable home — \`EXTRA_GLOSSES\`
exists only for roots the curated map spells differently), then re-run:

\`\`\`bash
npm run data:roots && npm run data:root-dist
\`\`\`

**Hamza gotcha.** Corpus root keys use plain alif (\`امن\`, \`امم\`) while curated lexicon
entries usually use hamza (\`ءمن\`, \`ءمم\`). Lookup folds \`[اأإآٱئؤ]\` → \`ء\` on both sides,
so either spelling resolves — but only through that fold. Never key a gloss off an
unfolded variant not in that character class.

Sources used for the existing entries: Lane's Lexicon, Hans Wehr, and the Quranic
Arabic Corpus. Keep new glosses in the same register — a short primary sense, not a
definition, \`verb / noun\` split by \` / \` where both readings are common.

## Coverage

${missing.length} of ${roots.length} roots (${pct(missing.length / roots.length)}) have no gloss, together
${words(missing).toLocaleString("en-US")} of ${totalWords.toLocaleString("en-US")} root-bearing words (${pct(words(missing) / totalWords)} of the text).

| Rank band | Roots | Missing | Missing % | Words affected | Share of text |
| --- | ---: | ---: | ---: | ---: | ---: |
${summary}

## Priority tiers

${tierSections}

### Tier 4 — the tail (ranks ${TAIL_FROM}+)

${tail.length} roots, ${words(tail).toLocaleString("en-US")} words (${pct(words(tail) / totalWords)} of the text).
Low individual impact; listed by frequency band so a contributor can clear one band at a time.

${tailSections}
`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
