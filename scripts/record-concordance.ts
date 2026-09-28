/**
 * Records the concordance rings in motion as an animated WebP for the README
 * and docs/CONCORDANCE-RINGS.md.
 *
 * Frame-exact rather than screen-recorded: Playwright's clock replaces
 * performance.now and requestAnimationFrame, and every frame advances it by
 * exactly 1/FPS s before a screenshot. The rings read time only from those
 * (lib/viz/concordance/motion.ts), so the result is smooth however slowly the
 * machine renders — the "virtual clock" the spec describes.
 *
 * The sequence is the one the spec singles out: rings at rest, sorted by first
 * meeting so the meetings trace a spiral, then aligned so the spiral becomes a
 * column at 12 o'clock, then a hover on a meeting with its ayah.
 *
 * Requires `npm run dev` (or `npm start`) on BASE.
 * Run: npm run docs:record-rings [-- --base http://localhost:3000]
 */
import { chromium } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { EXPERIENCE_VERSION } from "../lib/config/version";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const BASE = arg("base", "http://localhost:3000").replace(/\/$/, "");
const OUT = path.join("public", "docs", "images", "concordance-rings", "rings-in-motion.webp");
const FPS = 25;
const SIZE = 760;
const ROOTS = encodeURIComponent("خلق,سمو,ارض");

async function main() {
  // Real GPU: headless Chromium otherwise renders WebGL on SwiftShader.
  const browser = await chromium.launch({ args: ["--use-angle=d3d11"] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1150 }, deviceScaleFactor: 2 });
  await context.addInitScript((version) => {
    try {
      localStorage.setItem("quran-corpus-onboarding", JSON.stringify({ version, showOnStartup: false, completed: true }));
      localStorage.setItem("quran-corpus-viz-intro", JSON.stringify({ "concordance-rings": true }));
    } catch {
      /* private mode: the shots will show the intro chip */
    }
  }, EXPERIENCE_VERSION);
  const page = await context.newPage();
  await page.clock.install();
  await page.goto(`${BASE}/en?viz=concordance-rings&roots=${ROOTS}&view=stacked`, { waitUntil: "domcontentloaded" });
  // Let time flow normally while the app loads and settles.
  await page.clock.resume();
  await page.waitForSelector(".cr-centre", { timeout: 60000 });
  await page.waitForTimeout(5000);

  const stage = (await page.locator(".cr-stage").boundingBox())!;
  const geom = await page.evaluate(() => {
    const c = document.querySelector<HTMLElement>(".cr-centre")!;
    const s = document.querySelector(".cr-stage")!.getBoundingClientRect();
    const status = document.querySelector(".status-bar")?.getBoundingClientRect();
    const cx = parseFloat(c.style.left);
    const cy = parseFloat(c.style.top);
    // The rings fill the visible area vertically: its top edge is the radius.
    const top = status ? status.bottom - s.top : 0;
    return { cx, cy, r: cy - top };
  });
  const clip = {
    x: stage.x + geom.cx - geom.r,
    y: stage.y + geom.cy - geom.r,
    width: geom.r * 2,
    height: geom.r * 2,
  };

  // Warm the hover text so the last scene's tooltip is not waiting on a fetch.
  await page.mouse.move(stage.x + geom.cx + geom.r * 0.4, stage.y + geom.cy);
  await page.waitForTimeout(1500);
  await page.mouse.move(stage.x + 4, stage.y + 4);
  await page.waitForTimeout(300);

  // Freeze time; from here every frame is one exact step.
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 50);

  const frames: Buffer[] = [];
  const shoot = async (seconds: number) => {
    const n = Math.round(seconds * FPS);
    for (let i = 0; i < n; i++) {
      await page.clock.runFor(1000 / FPS);
      const png = await page.screenshot({ clip });
      frames.push(await sharp(png).resize(SIZE, SIZE).png().toBuffer());
    }
  };

  await shoot(1.2); // at rest, mushaf order
  await page.locator(".cr-seg button", { hasText: "by first meeting" }).click();
  await shoot(2.4); // travel into the spiral
  await page.locator(".cr-align").click();
  await shoot(4.6); // expressive turn: the spiral becomes a column

  // Hover a meeting in the column at 12 o'clock.
  const hover = { x: stage.x + geom.cx, y: stage.y + geom.cy - geom.r * 0.5 };
  await page.mouse.move(hover.x, hover.y);
  await shoot(2.6);

  await browser.close();

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await sharp(frames, { join: { animated: true } })
    .webp({ quality: 80, effort: 6, loop: 0, delay: frames.map(() => Math.round(1000 / FPS)) })
    .toFile(OUT);

  const kb = (await fs.stat(OUT)).size / 1024;
  console.log(`${frames.length} frames at ${FPS} fps → ${OUT} (${kb.toFixed(0)} KB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
