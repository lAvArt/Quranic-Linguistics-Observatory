/**
 * UX review screenshot harness.
 *
 * Captures any set of routes across viewports and themes so visual passes
 * can be reviewed without clicking through the app by hand.
 *
 * Usage:
 *   npx tsx scripts/ux-shots.ts [--base http://localhost:3000] [--routes /en,/en/search]
 *     [--viewports desktop,mobile] [--themes light,dark] [--out .ux-shots] [--settle 3000]
 *
 * Output files: <out>/<route-slug>--<viewport>--<theme>.png
 */
import { chromium, type BrowserContext } from '@playwright/test';
import { EXPERIENCE_VERSION } from '../lib/config/version';
import { promises as fs } from 'fs';
import path from 'path';

const VIEWPORTS: Record<string, { width: number; height: number }> = {
    desktop: { width: 1440, height: 900 },
    laptop: { width: 1280, height: 800 },
    tablet: { width: 834, height: 1112 },
    mobile: { width: 390, height: 844 },
};

function arg(name: string, fallback: string): string {
    const idx = process.argv.indexOf(`--${name}`);
    return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const BASE = arg('base', 'http://localhost:3000').replace(/\/$/, '');
// Routes may be passed without a leading slash (recommended on Git Bash, where
// a leading "/" triggers MSYS path conversion and mangles the argument).
const ROUTES = arg('routes', 'en,en/search,en/study,en/quiz')
    .split(',')
    .map((r) => `/${r.trim().replace(/^\/+/, '')}`);
const VIEWPORT_NAMES = arg('viewports', 'desktop,mobile').split(',').map((v) => v.trim());
const THEMES = arg('themes', 'light,dark').split(',').map((t) => t.trim()) as Array<'light' | 'dark'>;
const OUT_DIR = arg('out', '.ux-shots');
const SETTLE_MS = Number(arg('settle', '3000'));

function slugify(route: string): string {
    return route.replace(/^\//, '').replace(/[/?=&]+/g, '_') || 'root';
}

function themeCookieValue(theme: 'light' | 'dark'): string {
    return encodeURIComponent(JSON.stringify({ theme, colorThemeId: 'teal-amber' }));
}

async function prepareContext(context: BrowserContext, theme: 'light' | 'dark'): Promise<void> {
    await context.addCookies([
        { name: 'quran-corpus-theme', value: themeCookieValue(theme), url: BASE },
    ]);
    // The onboarding version must be the current one (EXPERIENCE_VERSION), or
    // the first-run modal treats the seed as stale and covers every shot.
    await context.addInitScript(([t, version]) => {
        window.localStorage.setItem(
            'quran-corpus-onboarding',
            JSON.stringify({ version, showOnStartup: false, completed: true })
        );
        window.localStorage.setItem(
            'quran-corpus-viz-state',
            JSON.stringify({ theme: t, colorThemeId: 'teal-amber' })
        );
    }, [theme, EXPERIENCE_VERSION] as const);
}

async function launchBrowser() {
    // Prefer the bundled Playwright chromium; fall back to system Edge/Chrome
    // so the harness works on machines where the browser download is unavailable.
    const channels = [undefined, 'msedge', 'chrome'];
    let lastError: unknown;
    for (const channel of channels) {
        try {
            return await chromium.launch({ headless: true, channel });
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError;
}

async function run(): Promise<void> {
    await fs.mkdir(OUT_DIR, { recursive: true });
    const browser = await launchBrowser();
    const captured: string[] = [];
    const failed: string[] = [];

    for (const viewportName of VIEWPORT_NAMES) {
        const viewport = VIEWPORTS[viewportName];
        if (!viewport) {
            console.warn(`Unknown viewport "${viewportName}" (known: ${Object.keys(VIEWPORTS).join(', ')})`);
            continue;
        }
        for (const theme of THEMES) {
            const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
            await prepareContext(context, theme);
            const page = await context.newPage();

            for (const route of ROUTES) {
                const name = `${slugify(route)}--${viewportName}--${theme}.png`;
                const file = path.join(OUT_DIR, name);
                try {
                    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 60_000 });
                    await page.waitForTimeout(SETTLE_MS);
                    await page.screenshot({ path: file });
                    captured.push(file);
                    console.log(`ok  ${name}`);
                } catch (error) {
                    failed.push(`${name}: ${(error as Error).message.split('\n')[0]}`);
                    console.error(`ERR ${name}`);
                }
            }
            await context.close();
        }
    }

    await browser.close();
    console.log(`\n${captured.length} screenshots in ${OUT_DIR}${failed.length ? `; ${failed.length} failed` : ''}`);
    for (const f of failed) console.error(`  ${f}`);
    if (failed.length > 0) process.exitCode = 1;
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
