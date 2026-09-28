/**
 * Phone audit: iPhone-class emulation (390×844 @3x, touch, mobile UA) of every
 * surface, plus the menu flows. Used for docs/MOBILE-AUDIT.md.
 *   npx tsx scripts/audit/mobile-shots.ts [--base http://localhost:3000] [--out dir] [--only name,name]
 */
import { chromium, devices, type BrowserContext, type Page } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { EXPERIENCE_VERSION } from "../../lib/config/version";

const arg = (n: string, f: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : f;
};
const BASE = arg("base", "http://localhost:3000");
const OUT = arg("out", ".ux-shots/mobile");
const ONLY = arg("only", "").split(",").filter(Boolean);
const ROOTS = encodeURIComponent("خلق,سمو,ارض");

type Scene = { name: string; route: string; theme?: "dark" | "light"; act?: (p: Page) => Promise<void>; settle?: number };

const scenes: Scene[] = [
  { name: "home", route: "/en" },
  { name: "home-ar", route: "/ar" },
  { name: "home-light", route: "/en", theme: "light" },
  { name: "cr-default", route: "/en?viz=concordance-rings", settle: 5000 },
  { name: "cr-stacked", route: `/en?viz=concordance-rings&roots=${ROOTS}&view=stacked`, settle: 5000 },
  { name: "cr-all", route: `/en?viz=concordance-rings&roots=${ROOTS}&view=all`, settle: 5000 },
  { name: "cr-ar", route: `/ar?viz=concordance-rings&roots=${ROOTS}&view=stacked`, settle: 5000 },
  { name: "cr-light", route: `/en?viz=concordance-rings&roots=${ROOTS}&view=stacked`, theme: "light", settle: 5000 },
  {
    name: "cr-tap-tick",
    route: `/en?viz=concordance-rings&roots=${ROOTS}&view=stacked`,
    settle: 5000,
    act: async (p) => {
      const c = await centre(p);
      await p.touchscreen.tap(c.x + c.r * 0.55, c.y);
      await p.waitForTimeout(1500);
    },
  },
  {
    name: "legend-open",
    route: `/en?viz=concordance-rings&roots=${ROOTS}&view=stacked`,
    settle: 4000,
    act: async (p) => {
      await p.getByTestId("mobile-viz-bar-legend").tap();
      await p.waitForTimeout(900);
    },
  },
  {
    name: "tools-open",
    route: `/en?viz=concordance-rings&roots=${ROOTS}&view=stacked`,
    settle: 4000,
    act: async (p) => {
      await p.getByTestId("mobile-viz-bar-tools").tap();
      await p.waitForTimeout(900);
    },
  },
  {
    name: "tools-closed-again",
    route: `/en?viz=concordance-rings&roots=${ROOTS}&view=stacked`,
    settle: 4000,
    act: async (p) => {
      await p.getByTestId("mobile-viz-bar-tools").tap();
      await p.waitForTimeout(900);
      await p.getByTestId("mobile-viz-bar-tools").tap();
      await p.waitForTimeout(900);
    },
  },
  {
    name: "edge-swipe-rtl",
    route: `/en?viz=radial-sura&surah=2`,
    settle: 4000,
    act: async (p) => {
      await swipe(p, 385, 420, 250, 425);
      await p.waitForTimeout(900);
    },
  },
  {
    name: "edge-swipe-ltr",
    route: `/en?viz=radial-sura&surah=2`,
    settle: 4000,
    act: async (p) => {
      await swipe(p, 5, 420, 150, 425);
      await p.waitForTimeout(900);
    },
  },
  {
    name: "hamburger",
    route: `/en?viz=radial-sura&surah=2`,
    settle: 3000,
    act: async (p) => {
      const b = p.locator(".mobile-nav-trigger, [data-testid='mobile-nav-trigger'], button[aria-label*='menu' i]").first();
      await b.tap();
      await p.waitForTimeout(900);
    },
  },
  {
    name: "switcher-open",
    route: `/en?viz=radial-sura&surah=2`,
    settle: 3000,
    act: async (p) => {
      await p.locator(".mobile-viz-bar .mvb-switcher button").first().tap();
      await p.waitForTimeout(900);
    },
  },
  {
    name: "cr-pinch",
    route: `/en?viz=concordance-rings&roots=${ROOTS}&view=stacked`,
    settle: 5000,
    act: async (p) => {
      const c = await centre(p);
      await pinch(p, c.x, c.y - 40, 30, 120);
      await p.waitForTimeout(700);
    },
  },
  {
    name: "cr-doubletap",
    route: `/en?viz=concordance-rings&roots=${ROOTS}&view=stacked`,
    settle: 5000,
    act: async (p) => {
      const c = await centre(p);
      await p.touchscreen.tap(c.x + 60, c.y - 60);
      await p.waitForTimeout(120);
      await p.touchscreen.tap(c.x + 60, c.y - 60);
      await p.waitForTimeout(900);
    },
  },
  {
    name: "cr-tap-twice-select",
    route: `/en?viz=concordance-rings&roots=${ROOTS}&view=stacked`,
    settle: 5000,
    act: async (p) => {
      const c = await centre(p);
      await p.touchscreen.tap(c.x + c.r * 0.55, c.y);
      await p.waitForTimeout(700);
      await p.touchscreen.tap(c.x + c.r * 0.55, c.y);
      await p.waitForTimeout(1200);
    },
  },
  {
    name: "legend-hide-reopen",
    route: `/en?viz=concordance-rings&roots=${ROOTS}&view=stacked`,
    settle: 4000,
    act: async (p) => {
      await p.getByTestId("mobile-viz-bar-legend").tap();
      await p.waitForTimeout(800);
      await p.locator(".viz-left-collapse").tap();
      await p.waitForTimeout(800);
      await p.getByTestId("mobile-viz-bar-legend").tap();
      await p.waitForTimeout(900);
    },
  },
  {
    name: "sheet-drag-close",
    route: `/en?viz=concordance-rings&roots=${ROOTS}&view=stacked`,
    settle: 4000,
    act: async (p) => {
      await p.getByTestId("mobile-viz-bar-tools").tap();
      await p.waitForTimeout(900);
      const b = (await p.locator(".drawer-sheet-head").boundingBox())!;
      await swipe(p, b.x + b.width / 2, b.y + 10, b.x + b.width / 2, b.y + 200);
      await p.waitForTimeout(900);
    },
  },
  { name: "radial", route: "/en?viz=radial-sura&surah=2" },
  { name: "radial-light", route: "/en?viz=radial-sura&surah=2", theme: "light" },
  { name: "root-network", route: "/en?viz=root-network&surah=2" },
  { name: "collocation", route: `/en?viz=collocation-network&root=${encodeURIComponent("علم")}` },
  { name: "distribution", route: "/en?viz=surah-distribution" },
  { name: "arc-flow", route: "/en?viz=arc-flow&surah=2" },
  { name: "sankey", route: "/en?viz=sankey-flow&surah=2" },
  { name: "dependency", route: "/en?viz=dependency-tree&surah=1" },
  { name: "architecture", route: "/en?viz=corpus-architecture" },
  { name: "knowledge", route: "/en?viz=knowledge-graph" },
  { name: "frequency", route: "/en/frequency" },
  { name: "search", route: `/en/search?q=${encodeURIComponent("كتب")}` },
  { name: "study", route: "/en/study" },
  { name: "quiz", route: "/en/quiz" },
];

async function centre(p: Page) {
  return p.evaluate(() => {
    const c = document.querySelector<HTMLElement>(".cr-centre")!;
    const s = document.querySelector(".cr-stage")!.getBoundingClientRect();
    const cx = parseFloat(c.style.left) + s.left;
    const cy = parseFloat(c.style.top) + s.top;
    return { x: cx, y: cy, r: Math.min(cx, window.innerWidth - cx) };
  });
}

async function swipe(p: Page, x0: number, y0: number, x1: number, y1: number) {
  const cdp = await p.context().newCDPSession(p);
  const steps = 8;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps;
    const y = y0 + ((y1 - y0) * i) / steps;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
    await p.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** Two fingers spreading horizontally about (x, y), from gap d0 to d1. */
async function pinch(p: Page, x: number, y: number, d0: number, d1: number) {
  const cdp = await p.context().newCDPSession(p);
  const steps = 10;
  const pts = (d: number) => [
    { x: x - d, y, id: 1 },
    { x: x + d, y, id: 2 },
  ];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(d0) });
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(d0 + ((d1 - d0) * i) / steps) });
    await p.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function prepare(context: BrowserContext, theme: "dark" | "light") {
  await context.addCookies([
    { name: "quran-corpus-theme", value: encodeURIComponent(JSON.stringify({ theme, colorThemeId: "teal-amber" })), url: BASE },
  ]);
  await context.addInitScript(
    ([t, v]) => {
      try {
        localStorage.setItem("quran-corpus-onboarding", JSON.stringify({ version: v, showOnStartup: false, completed: true }));
        localStorage.setItem("quran-corpus-viz-state", JSON.stringify({ theme: t, colorThemeId: "teal-amber" }));
      } catch {
        /* ignore */
      }
    },
    [theme, EXPERIENCE_VERSION],
  );
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ["--use-angle=d3d11"] });
  const report: Record<string, unknown>[] = [];
  for (const s of scenes) {
    if (ONLY.length && !ONLY.includes(s.name)) continue;
    const context = await browser.newContext({ ...devices["iPhone 13"], locale: s.route.startsWith("/ar") ? "ar" : "en-US" });
    await prepare(context, s.theme ?? "dark");
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));
    try {
      await page.goto(`${BASE}${s.route}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(s.settle ?? 3500);
      if (s.act) await s.act(page);
      const meta = await page.evaluate(() => {
        const vw = window.innerWidth;
        const overflowX = document.documentElement.scrollWidth > vw + 1;
        const c = document.querySelector<HTMLElement>(".cr-centre");
        const st = document.querySelector(".cr-stage")?.getBoundingClientRect();
        return {
          overflowX,
          scrollW: document.documentElement.scrollWidth,
          docH: document.documentElement.scrollHeight,
          vh: window.innerHeight,
          crCentre: c && st ? { x: Math.round(parseFloat(c.style.left) + st.left), y: Math.round(parseFloat(c.style.top) + st.top) } : null,
          crView: document.querySelector(".cr-seg [aria-checked='true'], .cr-seg .is-active")?.textContent ?? null,
          drawerOpen: !!document.querySelector(".context-drawer.open"),
          status: document.querySelector(".status-bar-label")?.getAttribute("data-status") ?? null,
        };
      });
      await page.screenshot({ path: path.join(OUT, `${s.name}.png`) });
      report.push({ scene: s.name, ...meta, errors });
      console.log(s.name, JSON.stringify(meta), errors.length ? errors : "");
    } catch (e) {
      console.log(s.name, "FAILED", (e as Error).message.slice(0, 200));
    } finally {
      await context.close();
    }
  }
  await fs.writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
