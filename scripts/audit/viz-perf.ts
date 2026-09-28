/**
 * Frame rate and main-thread blocking for an SVG viz mode: first render once
 * the corpus is in, then a hover sweep, a wheel-zoom burst and a drag-pan.
 * Desktop or phone profile, CPU throttled.
 *
 * Between load and the first gesture it waits for the main thread to go quiet
 * (6 s without a long task, at most 30 s), so work the app defers to idle time
 * after a load — the search index is built 3 s after the corpus lands — isn't
 * billed to the gesture. Pass --quiet 0 to skip that. Run it with nothing else
 * busy on the machine: a lint, a test run or any heavy app in parallel makes
 * long tasks of its own, and the numbers stop meaning anything.
 *
 *   npx tsx scripts/audit/viz-perf.ts --route "/en?viz=radial-sura&surah=2" [--base http://localhost:3200]
 *     [--device desktop|phone] [--cpu 4] [--label name] [--quiet 0]
 */
import { chromium, devices, type CDPSession, type Page } from "@playwright/test";
import { EXPERIENCE_VERSION } from "../../lib/config/version";

const arg = (n: string, f: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : f;
};
const BASE = arg("base", "http://localhost:3200");
const ROUTE = arg("route", "/en?viz=radial-sura&surah=2");
const DEVICE = arg("device", "desktop");
const CPU = Number(arg("cpu", "4"));
const LABEL = arg("label", ROUTE);
const QUIET = arg("quiet", "1") !== "0";

// Strings, not functions: tsx wraps named inner functions in __name(), which
// doesn't exist in the page.
//
// One frame loop and one long-task observer per page, installed once; START
// only zeroes the counters. (Installing them on every START left the earlier
// loops and observers running, so each later phase counted its frames and
// long tasks two, three, four times over.)
const START = `(() => {
  const w = window;
  if (!w.__perf) {
    w.__perf = { frames: 0, long: 0, longMs: 0, worst: 0, running: false, last: performance.now(), maxGap: 0 };
    const tick = () => {
      const p = w.__perf;
      const now = performance.now();
      if (p.running) {
        p.maxGap = Math.max(p.maxGap, now - p.last);
        p.frames++;
      }
      p.last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    try {
      new PerformanceObserver((list) => {
        const p = w.__perf;
        for (const e of list.getEntries()) {
          if (!p.running) continue;
          p.long++; p.longMs += e.duration; p.worst = Math.max(p.worst, e.duration);
        }
      }).observe({ type: "longtask", buffered: false });
    } catch (e) {}
  }
  Object.assign(w.__perf, { frames: 0, long: 0, longMs: 0, worst: 0, maxGap: 0, last: performance.now(), running: true });
})()`;
const STOP = `(() => { const p = window.__perf; p.running = false; return { ...p }; })()`;
const QUIET_WATCH = `(() => {
  const w = window;
  w.__quiet = { last: performance.now() };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__quiet.last = Math.max(w.__quiet.last, e.startTime + e.duration);
    }).observe({ type: "longtask", buffered: false });
  } catch (e) {}
})()`;
const QUIET_FOR = `(() => performance.now() - window.__quiet.last)()`;
const NODES = `(() => {
  const svgs = Array.from(document.querySelectorAll(".immersive-dashboard svg"));
  const main = svgs.sort((a, b) => b.querySelectorAll("*").length - a.querySelectorAll("*").length)[0];
  const r = main ? main.getBoundingClientRect() : null;
  return { nodes: main ? main.querySelectorAll("*").length : 0, dom: document.querySelectorAll("*").length,
    box: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null };
})()`;

async function measure(page: Page, label: string, act: () => Promise<void>) {
  await page.evaluate(START);
  const t0 = Date.now();
  await act();
  const ms = Date.now() - t0;
  const r = (await page.evaluate(STOP)) as { frames: number; long: number; longMs: number; worst: number; maxGap: number };
  console.log(
    `  ${label.padEnd(7)} ${String(ms).padStart(5)} ms · ${(r.frames / (ms / 1000)).toFixed(0).padStart(3)} fps · worst frame ${Math.round(r.maxGap)} ms · ${r.long} long tasks (${Math.round(r.longMs)} ms, worst ${Math.round(r.worst)})`,
  );
}

async function main() {
  const browser = await chromium.launch({ args: ["--use-angle=d3d11"] });
  const context = await browser.newContext(DEVICE === "phone" ? { ...devices["iPhone 13"] } : { viewport: { width: 1440, height: 900 } });
  await context.addInitScript((v) => {
    try {
      localStorage.setItem("quran-corpus-onboarding", JSON.stringify({ version: v, showOnStartup: false, completed: true }));
      localStorage.setItem("quran-corpus-viz-intro", JSON.stringify({ "radial-sura": true, "corpus-architecture": true }));
    } catch {
      /* ignore */
    }
  }, EXPERIENCE_VERSION);
  const page = await context.newPage();
  const cdp: CDPSession = await context.newCDPSession(page);

  // Warm the corpus cache unthrottled, then measure a throttled load.
  await page.goto(`${BASE}${ROUTE}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('.status-bar-label[data-status="full"]', { timeout: 240000 }).catch(() => {});
  if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  const t0 = Date.now();
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
  await page.evaluate(START);
  await page.evaluate(QUIET_WATCH);
  // First content: the main SVG past 200 nodes, i.e. the drawing itself, not a placeholder.
  let firstContent = -1;
  const firstPoll = (async () => {
    while (firstContent < 0 && Date.now() - t0 < 120000) {
      const n = ((await page.evaluate(NODES)) as { nodes: number }).nodes;
      if (n > 200) firstContent = Date.now() - t0;
      else await page.waitForTimeout(100);
    }
  })();
  await page.waitForSelector('.status-bar-label[data-status="full"]', { timeout: 240000 }).catch(() => {});
  // Settled = the main SVG's node count stops changing for 1.5 s.
  let last = -1;
  let stableSince = Date.now();
  while (Date.now() - stableSince < 1500 && Date.now() - t0 < 120000) {
    const n = ((await page.evaluate(NODES)) as { nodes: number }).nodes;
    if (n !== last) {
      last = n;
      stableSince = Date.now();
    }
    await page.waitForTimeout(250);
  }
  const settled = Date.now() - t0 - 1500;
  await firstPoll;
  const load = (await page.evaluate(STOP)) as { long: number; longMs: number; worst: number };
  const info = (await page.evaluate(NODES)) as { nodes: number; dom: number; box: { x: number; y: number; w: number; h: number } | null };
  console.log(`${LABEL} [${DEVICE}, ${CPU}x CPU]`);
  console.log(`  load    first content ${firstContent} ms · settled in ${settled} ms · ${info.nodes} SVG nodes, ${info.dom} DOM · ${load.long} long tasks after reload (${Math.round(load.longMs)} ms, worst ${Math.round(load.worst)})`);
  if (QUIET) {
    const q0 = Date.now();
    while (Date.now() - q0 < 30000 && ((await page.evaluate(QUIET_FOR)) as number) < 6000) await page.waitForTimeout(250);
    console.log(`  quiet   after ${Date.now() - q0} ms more`);
  }

  const box = info.box ?? { x: 0, y: 0, w: 800, h: 600 };
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const steps = 60;

  if (DEVICE === "phone") {
    await measure(page, "pan", async () => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx - 80, y: cy }] });
      for (let i = 1; i <= steps; i++) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx - 80 + (160 * i) / steps, y: cy + 30 * Math.sin(i / 8) }] });
        await page.waitForTimeout(16);
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(400);
    });
    await measure(page, "pinch", async () => {
      const pts = (d: number) => [
        { x: cx - d, y: cy, id: 1 },
        { x: cx + d, y: cy, id: 2 },
      ];
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(30) });
      for (let i = 1; i <= steps; i++) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(30 + (100 * i) / steps) });
        await page.waitForTimeout(16);
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(600);
    });
  } else {
    await measure(page, "hover", async () => {
      for (let i = 0; i <= steps; i++) {
        await page.mouse.move(cx - box.w * 0.35 + (box.w * 0.7 * i) / steps, cy - box.h * 0.2 + (box.h * 0.4 * i) / steps);
        await page.waitForTimeout(16);
      }
      await page.waitForTimeout(300);
    });
    await measure(page, "zoom", async () => {
      await page.mouse.move(cx, cy);
      for (let i = 0; i < 24; i++) {
        await page.mouse.wheel(0, i < 12 ? -120 : 120);
        await page.waitForTimeout(30);
      }
      await page.waitForTimeout(600);
    });
    await measure(page, "pan", async () => {
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      for (let i = 1; i <= steps; i++) {
        await page.mouse.move(cx + 150 * Math.sin(i / 10), cy + 90 * Math.cos(i / 10));
        await page.waitForTimeout(16);
      }
      await page.mouse.up();
      await page.waitForTimeout(400);
    });
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
