/**
 * Square, high-resolution videos of the graphs for Pinterest — one per scene
 * below, each with its title burned in, plus pins.md with every pin's title,
 * description, alt text and link.
 *
 * Only the graph is filmed: each frame is a square clip around it, so the
 * side panels never show. A card rendered in the app itself (its fonts, its
 * colours) carries the title above the graph and the address below; ffmpeg
 * lays the footage into the card, feathers its edges and fades in and out.
 *
 * Frame-exact, like scripts/record-concordance.ts: Playwright's clock stands
 * in for performance.now, requestAnimationFrame and timers, and each frame
 * advances it by exactly 1/FPS s before a screenshot. Motion driven from
 * those (d3 transitions, rAF loops) is smooth however slowly the machine
 * renders; CSS transitions are not, so scenes avoid relying on them.
 *
 * Requires the app running on BASE (`npm run dev` or `npm start`).
 * Run: npm run videos:pinterest [-- --base http://localhost:3000] [--only slug,slug]
 * Out: .ux-shots/pinterest/<slug>.mp4 and .ux-shots/pinterest/pins.md
 */
import { chromium, type Browser, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { EXPERIENCE_VERSION } from "../lib/config/version";

const require = createRequire(import.meta.url);
const FFMPEG = require("ffmpeg-static") as string;

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const BASE = arg("base", "http://localhost:3000").replace(/\/$/, "");
const ONLY = arg("only", "").split(",").filter(Boolean);
/** Re-compose from frames already filmed (after a card or layout change) instead of filming again. */
const REUSE = process.argv.includes("--reuse");
const OUT_DIR = path.join(".ux-shots", "pinterest");
const SITE = "https://www.quranobservatory.org";

const FPS = 30;
/** The card, in CSS px; everything is shot at 2× for a 2160 px square. */
const CARD = 1080;
const DPR = 2;
/** Where the graph sits in the card, in CSS px. */
const BOX = { x: 154, y: 244, size: 772 };
/**
 * The shell's floating chrome, hidden while filming. Visibility, not display:
 * clips measure some of it (the rings' radius runs to the status bar).
 */
const CHROME = [
  ".graph-toolbar",
  ".status-bar",
  ".viz-intro-chip",
  ".drawer-edge-handle",
  ".dock-left-handle",
  ".sm-centre-hint",
  ".cr-zoom-reset",
  ".mobile-viz-bar",
  "[data-sonner-toaster]",
  ".toast",
];
/**
 * Graph containers that paint their own vignette. Flattened to the page
 * colour while filming, so every graph sits on the same flat ground and melts
 * into the card instead of showing as a lighter square.
 */
const VIGNETTES = [".viz-container", ".structure-map"];
const FADE_IN = 0.6;
const FADE_OUT = 0.8;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Scene {
  slug: string;
  /** Path and query in the app, after the locale. */
  url: string;
  /**
   * The browser's size, when the default leaves the stage wider than tall: a
   * graph fits itself to the whole visible area, so a square area keeps it
   * inside the square that is filmed.
   */
  viewport?: { width: number; height: number };
  /**
   * How filming starts. `ready` lets the app load in real time, resolves once
   * the graph has settled, and time freezes from there. `entrance` instead
   * steps time a frame at a time from page load and films from the frame
   * this selector first matches — for animations that play only on arrival.
   */
  start: { ready: (page: Page) => Promise<void> } | { entrance: string };
  /** The square to film, in page CSS px — measured after the performance, once the graph has settled. */
  clip: (page: Page) => Promise<Box>;
  /** Burned into the card. */
  card: { eyebrow: string; title: string; sub?: string; subDir?: "rtl" | "ltr" };
  pin: { title: string; description: string; alt: string; link: string };
  /** The performance: interleave actions with shoot(seconds). */
  perform: (page: Page, shoot: (seconds: number) => Promise<void>) => Promise<void>;
}

// ── Shared helpers ─────────────────────────────────────────────────────────

/** A square of side `size` centred on (cx, cy). */
const square = (cx: number, cy: number, size: number): Box => ({ x: cx - size / 2, y: cy - size / 2, width: size, height: size });

/**
 * The largest square in the part of the stage the shell leaves visible —
 * between the dock and the drawer, the status bar and the toolbar — which is
 * the area every graph fits itself to.
 */
async function visibleSquare(page: Page): Promise<Box> {
  // No named functions inside evaluate: tsx wraps them in a __name() helper
  // that doesn't exist in the page.
  const a = await page.evaluate(() => {
    const [dock, drawerRect, status, inner, bar] = [".viz-dock", ".context-drawer", ".status-bar", ".graph-toolbar-inner", ".graph-toolbar"].map((sel) => {
      const b = document.querySelector(sel)?.getBoundingClientRect();
      return b && b.width && b.height ? { left: b.left, right: b.right, top: b.top, bottom: b.bottom } : null;
    });
    const drawer = document.querySelector(".context-drawer.open") ? drawerRect : null;
    const toolbar = inner ?? bar;
    return {
      left: dock ? dock.right : 0,
      right: drawer ? drawer.left : window.innerWidth,
      top: status ? status.bottom : 0,
      bottom: toolbar ? toolbar.top : window.innerHeight,
    };
  });
  const size = Math.min(a.right - a.left, a.bottom - a.top);
  return square((a.left + a.right) / 2, (a.top + a.bottom) / 2, size);
}

/**
 * A smooth zoom about the cursor: d3's wheel zoom applies each small delta at
 * once, so one small wheel step per frame films as a continuous glide.
 */
async function glide(page: Page, shoot: (seconds: number) => Promise<void>, seconds: number, deltaPerFrame: number) {
  for (let i = 0; i < Math.round(seconds * FPS); i++) {
    await page.mouse.wheel(0, deltaPerFrame);
    await shoot(1 / FPS);
  }
}


/** The concordance rings' square: centred on the centre label, radius to the top of the visible area. */
async function ringsClip(page: Page): Promise<Box> {
  const g = await page.evaluate(() => {
    const c = document.querySelector<HTMLElement>(".cr-centre")!;
    const s = document.querySelector(".cr-stage")!.getBoundingClientRect();
    const status = document.querySelector(".status-bar")?.getBoundingClientRect();
    const cx = s.left + parseFloat(c.style.left);
    const cy = s.top + parseFloat(c.style.top);
    const top = status ? status.bottom : s.top;
    return { cx, cy, r: cy - top };
  });
  return square(g.cx, g.cy, g.r * 2);
}

// ── Scenes ─────────────────────────────────────────────────────────────────

const ringsReady = async (page: Page) => {
  await page.waitForSelector(".cr-centre", { timeout: 90_000 });
  await page.waitForTimeout(4000);
};
const ringsControl = (page: Page, label: string) => page.locator(".cr-seg button", { hasText: label }).click();

const SCENES: Scene[] = [
  {
    slug: "concordance-rings-creation",
    url: `?viz=concordance-rings&roots=${encodeURIComponent("خلق,سمو,ارض")}&view=stacked`,
    start: { ready: ringsReady },
    clip: ringsClip,
    card: {
      eyebrow: "Concordance rings",
      title: "Where “create”, “heavens” and “earth” meet in the Quran",
      sub: "خلق · سمو · ارض",
      subDir: "rtl",
    },
    pin: {
      title: "Where “create”, “heavens” and “earth” meet across the Quran",
      description:
        "Every surah is a ring and every ayah a tick on it. The roots خلق (create), سمو (heavens) and ارض (earth) light up where they occur — and where all three share an ayah, it becomes a meeting. Sorted by first meeting, the meetings trace a spiral; aligned, they form a column. Explore it free at quranobservatory.org.",
      alt: "Concentric rings, one per surah of the Quran, with coloured ticks where the roots for create, heavens and earth occur; the rings turn until their meetings line up at the top.",
      link: `${SITE}/en/viz/concordance-rings`,
    },
    perform: async (page, shoot) => {
      await shoot(1.6); // at rest, in mushaf order
      await ringsControl(page, "by first meeting");
      await shoot(2.6); // the rings travel into a spiral
      await page.locator(".cr-align").click();
      await shoot(4.8); // they turn until the meetings form a column
      // Hover a meeting in the column at 12 o'clock and read its ayah.
      const c = await ringsClip(page);
      await page.mouse.move(c.x + c.width / 2, c.y + c.height * 0.25);
      await shoot(3.4);
    },
  },
  {
    slug: "concordance-rings-mercy",
    url: `?viz=concordance-rings&roots=${encodeURIComponent("غفر,رحم")}&view=stacked`,
    start: { ready: ringsReady },
    clip: ringsClip,
    card: {
      eyebrow: "Concordance rings",
      title: "Where “forgive” and “mercy” meet in the Quran",
      sub: "غفر · رحم",
      subDir: "rtl",
    },
    pin: {
      title: "Where “forgive” and “mercy” meet across the Quran",
      description:
        "The roots غفر (to forgive) and رحم (mercy) share an ayah 91 times, in 37 surahs. Every surah is a ring and every ayah a tick on it: first the surahs where the two meet, then all 114, sorted from shortest to longest, then folded onto one ring to show where in a surah they tend to fall. Explore it free at quranobservatory.org.",
      alt: "Concentric rings, one per surah of the Quran, with ticks lit where the roots for forgive and mercy occur; the rings expand to all 114 surahs, re-sort by length and fold onto a single ring.",
      link: `${SITE}/en?viz=concordance-rings&roots=${encodeURIComponent("غفر,رحم")}&view=stacked`,
    },
    perform: async (page, shoot) => {
      await shoot(1.4); // the surahs where they meet
      await ringsControl(page, "all 114");
      await shoot(2.8); // every surah joins, the rest dimmed
      await ringsControl(page, "short → long");
      await shoot(2.8); // re-sorted by length
      await ringsControl(page, "overlaid");
      await shoot(2.4); // folded onto one ring
      // Point at the busiest stretch, early in the surahs.
      const c = await ringsClip(page);
      await page.mouse.move(c.x + c.width * 0.66, c.y + c.height * 0.3);
      await shoot(2.8);
    },
  },
  {
    slug: "radial-ar-rahman",
    url: `?viz=radial-sura&surah=55&root=${encodeURIComponent("كذب")}`,
    // The connections draw in only when a surah first appears.
    start: { entrance: ".radial-sura-map .connections path" },
    clip: visibleSquare,
    card: {
      eyebrow: "Radial surah map",
      // A word joiner after the hyphen keeps "Ar-Rahman" on one line.
      title: "The refrain of Surah Ar-⁠Rahman, drawn as one thread",
      sub: "فَبِأَىِّ ءَالَاءِ رَبِّكُمَا تُكَذِّبَانِ",
      subDir: "rtl",
    },
    pin: {
      title: "The refrain of Surah Ar-Rahman, drawn as one thread",
      description:
        "“So which of the favours of your Lord would you deny?” returns 31 times in Surah Ar-Rahman. Here its 78 ayahs sit around a circle, and the 32 that hold the root كذب (to deny) are joined in order — the refrain's rhythm made visible. Explore any surah free at quranobservatory.org.",
      alt: "The 78 ayahs of Surah Ar-Rahman arranged in a circle, with orange arcs joining the 32 ayahs that contain the root meaning to deny, drawing themselves in around the ring.",
      link: `${SITE}/en?viz=radial-sura&surah=55&root=${encodeURIComponent("كذب")}`,
    },
    perform: async (page, shoot) => {
      await shoot(3.2); // the arcs draw themselves in
      // Then a slow push in, about the ring's centre, until it fills the frame.
      const g = await page.locator("svg.radial-sura-map > g").first().boundingBox();
      await page.mouse.move(g!.x + g!.width / 2, g!.y + g!.height / 2);
      await glide(page, shoot, 4.2, -1.5);
      await shoot(1.4);
    },
  },
  {
    slug: "structure-map",
    url: "?viz=corpus-architecture",
    // The drawer stays shut here, so narrow the window until the stage is square.
    viewport: { width: 1250, height: 1150 },
    start: {
      ready: async (page) => {
        await page.waitForFunction(() => document.querySelectorAll(".sm-arcs path").length >= 114, null, { timeout: 90_000 });
        await page.waitForTimeout(2500);
      },
    },
    clip: visibleSquare,
    card: {
      eyebrow: "Quran structure map",
      title: "All 114 surahs in one ring — then open one",
      sub: "يس",
      subDir: "rtl",
    },
    pin: {
      title: "All 114 surahs of the Quran in one ring",
      description:
        "Every surah of the Quran as an arc, green for Makki and orange for Madani, with a bar for its length. Open one — here Ya-Sin — and the ring makes room for all of its roots, each sized by how often it occurs. Explore the whole Quran free at quranobservatory.org.",
      alt: "A ring of 114 arcs, one per surah of the Quran, coloured by Makki or Madani revelation; one surah fans open into a wide sector filled with dots for its roots.",
      link: `${SITE}/en?viz=corpus-architecture`,
    },
    perform: async (page, shoot) => {
      await shoot(1.6); // the whole ring
      const arc = await page.locator(".sm-arcs path").nth(35).boundingBox();
      await page.mouse.click(arc!.x + arc!.width / 2, arc!.y + arc!.height / 2);
      await page.mouse.move(2, 2);
      await shoot(4.2); // Ya-Sin fans open and its roots fade in
      // Back to the whole ring through the centre.
      const svg = await page.locator("svg.viz-canvas").boundingBox();
      const centre = await page.locator(".sm-centre").boundingBox();
      await page.mouse.click(centre ? centre.x + centre.width / 2 : svg!.x + svg!.width / 2, centre ? centre.y + centre.height / 2 : svg!.y + svg!.height / 2);
      await page.mouse.move(2, 2);
      await shoot(3.2);
    },
  },
];

// ── Recording ──────────────────────────────────────────────────────────────

async function newPage(browser: Browser, viewport = { width: 1600, height: 1150 }): Promise<Page> {
  const context = await browser.newContext({ viewport, deviceScaleFactor: DPR });
  await context.addCookies([
    { name: "quran-corpus-theme", value: encodeURIComponent(JSON.stringify({ theme: "dark", colorThemeId: "teal-amber" })), url: BASE },
    { name: "NEXT_LOCALE", value: "en", url: BASE },
  ]);
  await context.addInitScript((version) => {
    try {
      localStorage.setItem("quran-corpus-onboarding", JSON.stringify({ version, showOnStartup: false, completed: true }));
      localStorage.setItem("quran-corpus-viz-state", JSON.stringify({ theme: "dark", colorThemeId: "teal-amber" }));
    } catch {
      /* private mode */
    }
  }, EXPERIENCE_VERSION);
  return context.newPage();
}

const frameName = (n: number) => `${String(n).padStart(5, "0")}.png`;

/**
 * Films one scene: whole-viewport frames first, then each cropped to the
 * scene's square once the performance is over and the graph has settled.
 * Returns the frame count and the colour behind the graph.
 */
async function film(browser: Browser, scene: Scene, dir: string): Promise<{ frames: number; bg: string }> {
  const page = await newPage(browser, scene.viewport);
  const raw = path.join(dir, "raw");
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(raw, { recursive: true });
  const hideChrome = () =>
    page.addStyleTag({
      // The side panels' shadows fall a few px into the stage; drop them too.
      content: `${CHROME.join(", ")} { visibility: hidden !important; } ${VIGNETTES.join(", ")} { background: var(--bg-0) !important; } .viz-dock, .context-drawer { box-shadow: none !important; }`,
    });
  // Pause a little ahead of the page's clock, which keeps running while we
  // ask — for longer on a busy page, hence the growing margin.
  const freeze = async () => {
    for (const margin of [50, 400, 2000]) {
      try {
        await page.clock.pauseAt((await page.evaluate(() => Date.now())) + margin);
        return;
      } catch {
        /* the clock passed it first; try further ahead */
      }
    }
    throw new Error(`${scene.slug}: could not pause the page clock`);
  };

  await page.clock.install();
  await page.goto(`${BASE}/en${scene.url}`, { waitUntil: "domcontentloaded" });
  if ("entrance" in scene.start) {
    // Frozen from the start; step until the graph's first mark appears.
    await freeze();
    await hideChrome();
    await page.mouse.move(2, 2);
    const limit = 120 * FPS;
    let i = 0;
    for (; i < limit; i++) {
      await page.clock.runFor(1000 / FPS);
      if (await page.locator(scene.start.entrance).count()) break;
    }
    if (i === limit) throw new Error(`${scene.slug}: ${scene.start.entrance} never appeared`);
  } else {
    // Real time while the app loads and settles; frozen time while filming.
    await page.clock.resume();
    await scene.start.ready(page);
    await hideChrome();
    await page.mouse.move(2, 2);
    await page.waitForTimeout(400);
    await freeze();
  }

  let n = 0;
  const shoot = async (seconds: number) => {
    const count = Math.round(seconds * FPS);
    for (let i = 0; i < count; i++) {
      await page.clock.runFor(1000 / FPS);
      await page.screenshot({ path: path.join(raw, frameName(++n)) });
    }
  };
  await scene.perform(page, shoot);
  const clip = await scene.clip(page);
  // The page's own ground colour, which the flattened stage shows everywhere.
  const bg = await page.evaluate(() => {
    const [r, g, b] = (getComputedStyle(document.body).backgroundColor.match(/\d+/g) ?? ["0", "0", "0"]).map(Number);
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  });
  await page.context().close();

  const crop = {
    left: Math.round(clip.x * DPR),
    top: Math.round(clip.y * DPR),
    width: Math.round(clip.width * DPR),
    height: Math.round(clip.width * DPR),
  };
  for (let i = 1; i <= n; i += 8) {
    await Promise.all(
      Array.from({ length: Math.min(8, n - i + 1) }, (_, k) =>
        sharp(path.join(raw, frameName(i + k))).extract(crop).png().toFile(path.join(dir, frameName(i + k))),
      ),
    );
  }
  await fs.rm(raw, { recursive: true, force: true });

  return { frames: n, bg };
}

/** The colour the graph sits on, from the first frame's corner. */
async function backgroundOf(dir: string): Promise<string> {
  const { data } = await sharp(path.join(dir, frameName(1))).extract({ left: 2, top: 2, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
  return `#${[data[0], data[1], data[2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** A scene filmed on an earlier run, for --reuse. */
async function filmed(dir: string): Promise<{ frames: number; bg: string }> {
  const frames = (await fs.readdir(dir).catch(() => [])).filter((f) => /^\d{5}\.png$/.test(f)).length;
  if (!frames) throw new Error(`--reuse: no frames in ${dir}; film the scene first`);
  return { frames, bg: await backgroundOf(dir) };
}

/** The card: title above the graph's box, address below, on the graph's own background. */
async function renderCard(browser: Browser, scene: Scene, bg: string, file: string) {
  const page = await newPage(browser);
  await page.setViewportSize({ width: CARD, height: CARD });
  // Any app page carries the fonts and colour tokens; the card covers it.
  await page.goto(`${BASE}/en/viz/concordance-rings`, { waitUntil: "networkidle" });
  await page.evaluate(
    ({ card, bg, box, size }) => {
      const el = document.createElement("div");
      el.style.cssText = `position:fixed;inset:0;z-index:2147483647;background:${bg};display:block;`;
      const top = document.createElement("div");
      top.style.cssText = `position:absolute;left:72px;right:72px;top:56px;text-align:center;`;
      const eyebrow = document.createElement("p");
      eyebrow.textContent = card.eyebrow;
      eyebrow.style.cssText =
        "margin:0 0 14px;font:600 17px/1 var(--font-sans),sans-serif;letter-spacing:.2em;text-transform:uppercase;color:var(--accent);";
      const title = document.createElement("h1");
      title.textContent = card.title;
      title.style.cssText =
        "margin:0;font:500 44px/1.15 var(--font-display),Georgia,serif;letter-spacing:-.01em;color:var(--ink);text-wrap:balance;";
      top.append(eyebrow, title);
      if (card.sub) {
        const sub = document.createElement("p");
        sub.textContent = card.sub;
        sub.dir = card.subDir ?? "ltr";
        sub.style.cssText = `margin:12px 0 0;font:400 26px/1.3 ${card.subDir === "rtl" ? "var(--font-arabic),serif" : "var(--font-sans),sans-serif"};color:var(--ink-secondary);`;
        top.append(sub);
      }
      const foot = document.createElement("p");
      foot.textContent = "quranobservatory.org";
      foot.style.cssText = `position:absolute;left:0;right:0;top:${box.y + box.size + 20}px;margin:0;text-align:center;font:500 20px/1 var(--font-sans),sans-serif;letter-spacing:.06em;color:var(--ink-muted);`;
      el.append(top, foot);
      document.body.append(el);
      void size;
    },
    { card: scene.card, bg, box: BOX, size: CARD },
  );
  await page.evaluate(() => document.fonts.ready);
  // The title must end above the graph's box.
  const bottom = await page.evaluate(() => {
    const h = document.querySelectorAll("body > div:last-child > div")[0].getBoundingClientRect();
    return h.bottom;
  });
  if (bottom > BOX.y - 8) console.warn(`  ! ${scene.slug}: the title runs ${Math.ceil(bottom - BOX.y + 8)} px into the graph's box`);
  await page.screenshot({ path: file });
  await page.context().close();
}

/** A soft-edged mask so the footage melts into the card. */
async function renderMask(file: string) {
  const s = BOX.size * DPR;
  const inset = 26 * DPR;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}">
    <filter id="f" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${12 * DPR}"/></filter>
    <rect width="${s}" height="${s}" fill="black"/>
    <rect x="${inset}" y="${inset}" width="${s - inset * 2}" height="${s - inset * 2}" rx="${40 * DPR}" fill="white" filter="url(#f)"/>
  </svg>`;
  await sharp(Buffer.from(svg)).grayscale().png().toFile(file);
}

function compose(frames: string, card: string, mask: string, count: number, bg: string, out: string) {
  const s = BOX.size * DPR;
  const colour = bg.replace("#", "0x");
  const seconds = count / FPS;
  execFileSync(
    FFMPEG,
    [
      "-y",
      "-loop", "1", "-framerate", String(FPS), "-i", card,
      "-framerate", String(FPS), "-i", path.join(frames, "%05d.png"),
      "-loop", "1", "-framerate", String(FPS), "-i", mask,
      "-filter_complex",
      [
        `[1:v]scale=${s}:${s}:flags=lanczos,format=rgba[g]`,
        `[2:v]format=gray,scale=${s}:${s}[m]`,
        // The card and mask loop forever; the footage decides the length.
        `[g][m]alphamerge=shortest=1[gm]`,
        `[0:v][gm]overlay=${BOX.x * DPR}:${BOX.y * DPR}:shortest=1,` +
          `fade=t=in:st=0:d=${FADE_IN}:color=${colour},` +
          `fade=t=out:st=${(seconds - FADE_OUT).toFixed(2)}:d=${FADE_OUT}:color=${colour},format=yuv420p[v]`,
      ].join(";"),
      "-map", "[v]",
      "-frames:v", String(count),
      "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-profile:v", "high", "-pix_fmt", "yuv420p",
      "-r", String(FPS), "-movflags", "+faststart",
      out,
    ],
    { stdio: "pipe" },
  );
}

function pinsMarkdown(done: Scene[]): string {
  const lines = [
    "# Pinterest pins",
    "",
    `Square ${CARD * DPR} × ${CARD * DPR} H.264 videos at ${FPS} fps, one per pin. Title up to 100 characters, description up to 500.`,
    "",
  ];
  for (const s of done) {
    lines.push(
      `## ${s.slug}.mp4`,
      "",
      `**Title** (${s.pin.title.length} chars): ${s.pin.title}`,
      "",
      `**Description** (${s.pin.description.length} chars): ${s.pin.description}`,
      "",
      `**Alt text:** ${s.pin.alt}`,
      "",
      `**Link:** ${s.pin.link}`,
      "",
    );
  }
  return lines.join("\n");
}

async function main() {
  const scenes = SCENES.filter((s) => !ONLY.length || ONLY.includes(s.slug));
  for (const s of SCENES) {
    if (s.pin.title.length > 100) throw new Error(`${s.slug}: pin title is ${s.pin.title.length} chars (max 100)`);
    if (s.pin.description.length > 500) throw new Error(`${s.slug}: pin description is ${s.pin.description.length} chars (max 500)`);
  }
  await fs.mkdir(OUT_DIR, { recursive: true });
  // Real GPU: headless Chromium otherwise renders WebGL on SwiftShader.
  const browser = await chromium
    .launch({ args: ["--use-angle=d3d11"] })
    .catch(() => chromium.launch({ channel: "msedge", args: ["--use-angle=d3d11"] }));
  const mask = path.join(OUT_DIR, "mask.png");
  await renderMask(mask);

  for (const scene of scenes) {
    const t0 = Date.now();
    const frames = path.join(OUT_DIR, "frames", scene.slug);
    const { frames: n, bg } = REUSE ? await filmed(frames) : await film(browser, scene, frames);
    const card = path.join(OUT_DIR, `${scene.slug}.card.png`);
    await renderCard(browser, scene, bg, card);
    const out = path.join(OUT_DIR, `${scene.slug}.mp4`);
    compose(frames, card, mask, n, bg, out);
    const mb = (await fs.stat(out)).size / 1024 / 1024;
    console.log(`${scene.slug}: ${n} frames, ${(n / FPS).toFixed(1)} s → ${out} (${mb.toFixed(1)} MB) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  await browser.close();

  const md = path.join(OUT_DIR, "pins.md");
  // Every pin, not just this run's: the file is the whole set's copy sheet.
  await fs.writeFile(md, pinsMarkdown(SCENES), "utf8");
  console.log(`pins: ${md}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
