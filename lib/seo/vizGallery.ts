/**
 * The indexable visualization gallery.
 *
 * Why this exists: the nine graphs are inline SVG that D3 builds inside
 * `useEffect`, so Google can never index them — there is no image resource to
 * crawl, and an <svg> element in the DOM is markup, not an image. This registry
 * backs a build step that snapshots each graph to a real PNG, plus a landing
 * page per graph that carries the PNG as an <img> on a crawlable URL.
 *
 * One list, three consumers: `scripts/build-graph-images.ts` renders from it,
 * `app/[locale]/viz/[mode]/page.tsx` renders pages from it, and `app/sitemap.ts`
 * lists those pages (with their images) from it. Adding a mode here is the only
 * edit needed to extend the gallery.
 *
 * Deliberately a SUBSET of the ten modes, and the subset is forced, not
 * chosen: a mode earns a place only once it actually paints in a headless
 * capture, because an empty graph is worse than no page at all.
 *
 * Re-probed 2026-09-27 against a production build with a 9s settle, and the
 * only thing that settles the question is LOOKING at the PNG. Counting SVG
 * marks does not: collocation-network reports ~122 marks and is nonetheless
 * blank, because the count is its decorative starfield, not one node of the
 * graph. Do not re-admit a mode on a mark count alone.
 *
 *   radial-sura, sankey-flow, arc-flow, dependency-tree   -> in
 *   collocation-network   blank starfield; the PMI fetch returns nothing
 *                         inside an embed, exactly as before
 *   root-network          paints 4 of 18 nodes and bakes in the
 *                         "show full network" control — the force layout is
 *                         still paginating when the shutter falls. Worth
 *                         retrying with a much longer settle.
 *   surah-distribution, corpus-architecture, knowledge-graph, heatmap
 *                         render no <svg> at all; these fetch the whole
 *                         corpus rather than one surah.
 */
import type { VisualizationMode } from "@/lib/schema/visualizationTypes";

export interface VizGalleryEntry {
    /** Visualization mode id — also the URL slug and the image basename. */
    mode: VisualizationMode;
    /** Key under the `Visualizations` message namespace holding `.title`. */
    titleKey: string;
    /**
     * Query string appended to `/embed/{mode}` when snapshotting. Modes that
     * need a subject (a root, a surah) get a representative one so the capture
     * shows a populated graph rather than an empty state.
     */
    embedQuery: string;
    /** Params for the live deep link into the full shell, per docs/VIZ_ARCHITECTURE.md. */
    liveQuery: string;
}

/** Rendered image dimensions. 1200x630 doubles as a valid Open Graph size. */
export const GRAPH_IMAGE_WIDTH = 1200;
export const GRAPH_IMAGE_HEIGHT = 630;

export const VIZ_GALLERY: readonly VizGalleryEntry[] = [
    {
        // The signature view, and by far the densest capture (~1500 marks).
        mode: "radial-sura",
        titleKey: "RadialSura",
        // Al-Baqarah: the longest surah, so the ring is fully populated.
        embedQuery: "surah=2",
        liveQuery: "viz=radial-sura&surah=2",
    },
    {
        mode: "sankey-flow",
        titleKey: "RootFlow",
        embedQuery: "surah=2",
        liveQuery: "viz=sankey-flow&surah=2",
    },
    {
        mode: "arc-flow",
        titleKey: "ArcFlow",
        embedQuery: "surah=2",
        liveQuery: "viz=arc-flow&surah=2",
    },
    {
        // One ayah's parse; Al-Fatihah 1:1 is short enough to read at 1200px.
        mode: "dependency-tree",
        titleKey: "AyahDependency",
        embedQuery: "surah=1&ayah=1",
        liveQuery: "viz=dependency-tree&surah=1&ayah=1",
    },
] as const;

export const GALLERY_MODES: readonly string[] = VIZ_GALLERY.map((e) => e.mode);

export function findGalleryEntry(mode: string): VizGalleryEntry | undefined {
    return VIZ_GALLERY.find((e) => e.mode === mode);
}

/** Public path of a mode's rendered PNG (site-root relative). */
export function graphImagePath(mode: string): string {
    return `/graphs/${mode}.png`;
}
