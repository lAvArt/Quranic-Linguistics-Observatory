/**
 * The site's internal link graph.
 *
 * Why this exists: measured against production, the rendered HTML of every
 * page carried **zero** internal links — the footer's only anchors point at
 * GitHub, corpus.quran.com and the Quran API, all external. Every page was an
 * island whose only inbound reference was a line in sitemap.xml.
 *
 * A sitemap tells Google a URL exists. Links tell it the URL matters, and
 * Search Console showed exactly what that costs: nine URLs sitting in
 * "Discovered — currently not indexed", meaning Google had read them off the
 * sitemap and then declined to spend a crawl on them. That row was the one
 * trending upward.
 *
 * One list, rendered server-side on every page by `SiteNavMap`, so the graph
 * exists in the HTML rather than being assembled by React after hydration —
 * which is the only form of it a crawler will ever see.
 */
import { VIZ_GALLERY } from "@/lib/seo/vizGallery";

export interface SiteNavLink {
    /** Locale-relative path, no leading locale segment. */
    path: string;
    /** Key under the `SiteNav` message namespace. */
    labelKey: string;
}

/** The primary pages, in the order a reader would meet them. */
export const PRIMARY_NAV: readonly SiteNavLink[] = [
    { path: "", labelKey: "home" },
    { path: "/search", labelKey: "search" },
    { path: "/study", labelKey: "study" },
    { path: "/quiz", labelKey: "quiz" },
] as const;

/**
 * Gallery pages, derived from the same registry the sitemap reads, so a mode
 * added there is linked here without a second edit.
 *
 * These are the URLs that most needed a link: added by #128, listed in the
 * sitemap, and pointed at by nothing. Titles come from the existing
 * `Visualizations` namespace, so both locales are already covered.
 */
export const GALLERY_NAV: readonly { path: string; titleKey: string }[] =
    VIZ_GALLERY.map((entry) => ({
        path: `/viz/${entry.mode}`,
        titleKey: entry.titleKey,
    }));

/** Absolute in-app href for a nav entry under a locale. */
export function navHref(locale: string, path: string): string {
    return `/${locale}${path}`;
}
