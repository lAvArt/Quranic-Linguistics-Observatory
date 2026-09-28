/**
 * Corpus load timing on a phone profile: cold visit, then reloads in the same
 * context (IndexedDB warm). Counts Supabase requests and bytes per visit.
 *   npx tsx scripts/audit/corpus-timing.ts [--base http://localhost:3000] [--route /en?viz=radial-sura&surah=2] [--cpu 4]
 */
import { chromium, devices } from "@playwright/test";
import { EXPERIENCE_VERSION } from "../../lib/config/version";

const arg = (n: string, f: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : f;
};
const BASE = arg("base", "http://localhost:3000");
const ROUTE = arg("route", "/en?viz=radial-sura&surah=2");
const CPU = Number(arg("cpu", "4"));

async function main() {
  const browser = await chromium.launch({ args: ["--use-angle=d3d11"] });
  const context = await browser.newContext({ ...devices["iPhone 13"] });
  await context.addInitScript((v) => {
    try {
      localStorage.setItem("quran-corpus-onboarding", JSON.stringify({ version: v, showOnStartup: false, completed: true }));
    } catch {
      /* ignore */
    }
  }, EXPERIENCE_VERSION);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });

  let supa = 0;
  let bytes = 0;
  const logs: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("supabase.co")) supa++;
  });
  page.on("response", async (r) => {
    const len = Number(r.headers()["content-length"] ?? 0);
    bytes += len;
  });
  page.on("console", (m) => {
    const t = m.text();
    if (t.includes("[CorpusLoader]") || t.includes("[CorpusCache]")) logs.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${t.slice(0, 140)}`);
  });

  let t0 = Date.now();
  for (const visit of ["cold", "warm-1", "warm-2"]) {
    supa = 0;
    bytes = 0;
    logs.length = 0;
    t0 = Date.now();
    if (visit === "cold") await page.goto(`${BASE}${ROUTE}`, { waitUntil: "domcontentloaded" });
    else await page.reload({ waitUntil: "domcontentloaded" });
    const shell = Date.now() - t0;
    try {
      await page.waitForSelector('.status-bar-label[data-status="full"]', { timeout: 180000 });
    } catch {
      console.log(visit, "never reached full");
    }
    const full = Date.now() - t0;
    console.log(`${visit}: dom ${shell} ms · full corpus ${full} ms · supabase requests ${supa} · ~${(bytes / 1024).toFixed(0)} KB (content-length)`);
    for (const l of logs) console.log("   ", l);
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
