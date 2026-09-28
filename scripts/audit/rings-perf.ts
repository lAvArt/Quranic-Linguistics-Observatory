/**
 * Concordance rings on a phone profile at 4x CPU: frames delivered and long
 * tasks while a finger scrubs across the rings and while two fingers pinch.
 *   npx tsx scripts/audit/rings-perf.ts --base https://www.quranobservatory.org [--view stacked|overlaid] [--cpu 4]
 */
import { chromium, devices, type Page } from "@playwright/test";
import { EXPERIENCE_VERSION } from "../../lib/config/version";

const arg = (n: string, f: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : f;
};
const BASE = arg("base", "http://localhost:3200");
const VIEW = arg("view", "stacked");
const CPU = Number(arg("cpu", "4"));
const ROOTS = encodeURIComponent("خلق,سمو,ارض");

async function measure(page: Page, label: string, act: () => Promise<void>) {
  // A string, not a function: tsx wraps named inner functions in __name(),
  // which doesn't exist in the page.
  await page.evaluate(`(() => {
    const w = window;
    w.__perf = { frames: 0, long: 0, longMs: 0, running: true };
    const tick = () => { if (!w.__perf.running) return; w.__perf.frames++; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) { if (!w.__perf.running) continue; w.__perf.long++; w.__perf.longMs += e.duration; }
      }).observe({ type: "longtask", buffered: false });
    } catch (e) {}
  })()`);
  const t0 = Date.now();
  await act();
  const ms = Date.now() - t0;
  const r = await page.evaluate(() => {
    const w = window as unknown as { __perf: { frames: number; long: number; longMs: number; running: boolean } };
    w.__perf.running = false;
    return w.__perf;
  });
  console.log(`${label.padEnd(8)} ${ms} ms · ${r.frames} frames → ${(r.frames / (ms / 1000)).toFixed(1)} fps · ${r.long} long tasks (${Math.round(r.longMs)} ms)`);
}

async function main() {
  const browser = await chromium.launch({ args: ["--use-angle=d3d11"] });
  const context = await browser.newContext({ ...devices["iPhone 13"] });
  await context.addInitScript((v) => {
    try {
      localStorage.setItem("quran-corpus-onboarding", JSON.stringify({ version: v, showOnStartup: false, completed: true }));
      localStorage.setItem("quran-corpus-viz-intro", JSON.stringify({ "concordance-rings": true }));
    } catch {
      /* ignore */
    }
  }, EXPERIENCE_VERSION);
  const page = await context.newPage();
  await page.goto(`${BASE}/en?viz=concordance-rings&roots=${ROOTS}&view=${VIEW}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".cr-centre", { timeout: 90000 });
  // Let the corpus finish, so its load isn't what we're timing.
  await page.waitForSelector('.status-bar-label[data-status="full"]', { timeout: 240000 }).catch(() => {});
  await page.waitForTimeout(4000);
  const c = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".cr-centre")!;
    const s = document.querySelector(".cr-stage")!.getBoundingClientRect();
    return { x: parseFloat(el.style.left) + s.left, y: parseFloat(el.style.top) + s.top };
  });
  const cdp = await context.newCDPSession(page);
  if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });

  const steps = 60;
  await measure(page, "scrub", async () => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: c.x - 150, y: c.y - 20 }] });
    for (let i = 1; i <= steps; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: c.x - 150 + (300 * i) / steps, y: c.y - 20 + 40 * Math.sin(i / 6) }] });
      await page.waitForTimeout(16);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(300);
  });

  await measure(page, "pinch", async () => {
    const pts = (d: number) => [
      { x: c.x - d, y: c.y, id: 1 },
      { x: c.x + d, y: c.y, id: 2 },
    ];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(30) });
    for (let i = 1; i <= steps; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(30 + (120 * i) / steps) });
      await page.waitForTimeout(16);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(600);
  });
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
