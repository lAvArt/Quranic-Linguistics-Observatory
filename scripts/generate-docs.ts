import { chromium } from '@playwright/test';
import { promises as fs } from 'fs';
import path from 'path';
import { EXPERIENCE_VERSION } from '../lib/config/version';

const BASE = 'http://localhost:3000';

// The search-first landing (MinimalHome) is now the default at `/`. It is the
// real first impression, so it leads the README as the hero image. The full
// Observatory (AppShell) only mounts when a deep-link param is present, which
// is why the viz loop below navigates to `?viz=…` instead of `/`.
const HERO_TARGET = {
    id: 'HOME',
    filename: 'home-observatory.png',
    alt: 'Quranic Linguistics Observatory – search-first landing'
};

const VIZ_TARGETS = [
    {
        id: 'CONCORDANCE_RINGS',
        vizMode: 'concordance-rings',
        switcherLabel: 'Concordance Rings',
        filename: 'concordance-rings.png',
        alt: 'Concordance Rings — خلق · سمو · ارض across all 114 surahs: every ayah a tick, every meeting in cream',
        // The spec's headline phrase, خلق السماوات والأرض: 39 surahs, 59 meetings.
        extraParams: '&roots=%D8%AE%D9%84%D9%82%2C%D8%B3%D9%85%D9%88%2C%D8%A7%D8%B1%D8%B6&view=stacked'
    },
    {
        id: 'COLLOCATION_NETWORK',
        vizMode: 'collocation-network',
        switcherLabel: 'Collocation Network',
        filename: 'collocation-network.png',
        alt: 'Collocation Network — roots that stand together, weighted by PMI',
        // A real neighborhood beats the seeded example: علم has 76 shared
        // occurrences and fills the canvas.
        extraParams: '&root=%D8%B9%D9%84%D9%85'
    },
    {
        id: 'RADIAL_SURA',
        vizMode: 'radial-sura',
        switcherLabel: 'Radial Sura',
        filename: 'radial-sura.png',
        alt: 'Quranic Linguistics Observatory – Radial Surah Map'
    },
    {
        id: 'ROOT_NETWORK',
        vizMode: 'root-network',
        switcherLabel: 'Root Network',
        filename: 'root-network.png',
        alt: 'Root Network Graph'
    },
    {
        id: 'KNOWLEDGE_GRAPH',
        vizMode: 'knowledge-graph',
        switcherLabel: 'Knowledge Graph',
        filename: 'knowledge-graph.png',
        alt: 'Knowledge Graph Visualization'
    },
    {
        id: 'SURAH_DISTRIBUTION',
        vizMode: 'surah-distribution',
        switcherLabel: 'Surah Distribution',
        filename: 'surah-distribution.png',
        alt: 'Surah Distribution'
    },
    {
        id: 'ARC_FLOW',
        vizMode: 'arc-flow',
        switcherLabel: 'Arc Flow',
        filename: 'arc-flow.png',
        alt: 'Arc Flow Diagram'
    },
    {
        id: 'DEPENDENCY_TREE',
        vizMode: 'dependency-tree',
        switcherLabel: 'Dependency',
        filename: 'dependency-tree.png',
        alt: 'Ayah Dependency Graph'
    },
    {
        id: 'SANKEY_FLOW',
        vizMode: 'sankey-flow',
        switcherLabel: 'Sankey Flow',
        filename: 'sankey-flow.png',
        alt: 'Root Flow Sankey'
    },
    {
        id: 'CORPUS_ARCHITECTURE',
        vizMode: 'corpus-architecture',
        switcherLabel: 'Corpus Architecture',
        filename: 'corpus-architecture.png',
        alt: 'Corpus Architecture Map'
    }
];

async function generateDocumentationScreenshots() {
    console.log('Starting Playwright screenshot generation...');
    // Drive the system-installed Google Chrome (channel: 'chrome') so docs
    // generation doesn't depend on Playwright's bundled Chromium download.
    const browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const context = await browser.newContext({
        viewport: { width: 2560, height: 1260 },
        deviceScaleFactor: 1,
    });

    const page = await context.newPage();

    // 1. Establish origin so we can seed localStorage (dismiss onboarding).
    await page.goto(`${BASE}/en`);

    // 2. Set LocalStorage State for onboarding to be completed
    await page.evaluate((version) => {
        localStorage.setItem('quran-corpus-viz-state', JSON.stringify({
            vizMode: 'radial-sura',
            theme: 'dark',
            selectedSurahId: 1
        }));
        // The version must match the app's, or onboarding treats the stored
        // state as stale and the first-run modal covers every screenshot.
        localStorage.setItem('quran-corpus-onboarding', JSON.stringify({
            version,
            showOnStartup: false,
            completed: true
        }));
        // Suppress the per-mode "How to read this view" intro chip on every graph
        // so the docs screenshots show the clean canvas.
        localStorage.setItem('quran-corpus-viz-intro', JSON.stringify({
            'corpus-architecture': true, 'surah-distribution': true, 'radial-sura': true,
            'root-network': true, 'arc-flow': true, 'dependency-tree': true,
            'sankey-flow': true, 'collocation-network': true, 'knowledge-graph': true,
            'concordance-rings': true,
        }));
    }, EXPERIENCE_VERSION);

    // 3. HERO — capture the search-first landing in its resting state.
    console.log('Capturing home landing (hero)...');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.mhome', { state: 'visible', timeout: 180000 });
    await page.waitForSelector('.mhome-chip', { state: 'visible', timeout: 30000 });
    await page.waitForTimeout(1800); // let the atmosphere + entrance settle
    const heroPath = path.join(process.cwd(), 'public', 'docs', 'images', HERO_TARGET.filename);
    if (!process.argv.includes('--only')) await page.screenshot({ path: heroPath, fullPage: false });
    console.log(`Saved hero screenshot to ${heroPath}`);

    // 4. Enter the Observatory (AppShell) via a deep-link param, then wait for
    //    the graph container. `/` alone now renders MinimalHome, not the shell.
    await page.goto(`${BASE}/en?viz=radial-sura&surah=1`);
    await page.waitForSelector('.immersive-viewport', { state: 'visible' });

    // 5. Wait for the FULL corpus to finish streaming in. The status pill flips
    //    to data-status="full" only when all 114 surahs are loaded; screenshotting
    //    before that yields sparse, half-populated graphs.
    console.log(`Waiting for full corpus to stream in (this may take a bit on first run)...`);
    await page.waitForSelector('.status-bar-label[data-status="full"]', { state: 'attached', timeout: 300000 });
    console.log(`Full corpus ready!`);

    const only = process.argv.includes('--only')
        ? process.argv[process.argv.indexOf('--only') + 1]
        : null;

    for (const target of VIZ_TARGETS) {
        if (only && target.vizMode !== only) continue;
        console.log(`Processing ${target.vizMode}...`);

        // Select the mode via the deep-link param — AppShell hydrates `?viz=`
        // reactively, which is far more robust than driving the switcher UI
        // (whose modes can hide behind collapsed "show more" groups).
        await page.goto(`${BASE}/en?viz=${target.vizMode}&surah=1${(target as { extraParams?: string }).extraParams ?? ''}`);
        await page.waitForSelector('.immersive-viewport', { state: 'visible' });
        // Re-navigation restarts the corpus stream from cache — wait for it to
        // reach "full" again so every graph is fully populated, not mid-load.
        await page.waitForSelector('.status-bar-label[data-status="full"]', { state: 'attached', timeout: 180000 });

        // Wait for the new graph to enter the DOM and its animations to settle
        console.log(`Waiting for ${target.vizMode} layout to stabilize...`);
        await page.waitForTimeout(4500);

        // 6. Take screenshot
        const imagePath = path.join(process.cwd(), 'public', 'docs', 'images', target.filename);
        await page.screenshot({ path: imagePath, fullPage: false });
        console.log(`Saved screenshot to ${imagePath}`);
    }

    await browser.close();

    // 7. Update README.md
    console.log('Updating README.md with generated screenshots...');
    const readmePath = path.join(process.cwd(), 'README.md');
    let readme = await fs.readFile(readmePath, 'utf-8');

    // Hero (home landing)
    const heroRegex = new RegExp(`<!-- HERO:${HERO_TARGET.id} -->[\\s\\S]*?<!-- END:HERO -->`, 'g');
    const heroMarkdown = `<!-- HERO:${HERO_TARGET.id} -->\n<img width="2560" height="1260" alt="${HERO_TARGET.alt}" src="public/docs/images/${HERO_TARGET.filename}" />\n<!-- END:HERO -->`;
    readme = readme.replace(heroRegex, heroMarkdown);

    for (const target of VIZ_TARGETS) {
        const regex = new RegExp(`<!-- GRAPH:${target.id} -->[\\s\\S]*?<!-- END:GRAPH -->`, 'g');
        const newImageMarkdown = `<!-- GRAPH:${target.id} -->\n<img width="2560" height="1260" alt="${target.alt}" src="public/docs/images/${target.filename}" />\n<!-- END:GRAPH -->`;
        readme = readme.replace(regex, newImageMarkdown);
    }

    await fs.writeFile(readmePath, readme);
    console.log('README.md successfully updated!');
}

generateDocumentationScreenshots().catch(console.error);
