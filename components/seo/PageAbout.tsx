import { getTranslations } from "next-intl/server";

/**
 * A few paragraphs of real, server-rendered prose about the page it sits on.
 *
 * Why: measured against production, the four main pages carried almost nothing
 * for a crawler. `/study` rendered **14 words**, and they were "Your Profile
 * Loading…" — `StudyHub` is a client component that returns a loading state
 * while auth resolves, so the loading state is what the server emits and what
 * Google indexes. The home was 37 words, `/search` opened with "Loading...".
 *
 * Search Console's verdict followed exactly: three URLs "Crawled — currently
 * not indexed", nine more "Discovered — currently not indexed". Google read
 * the pages, found a spinner, and stopped spending crawls on the site.
 *
 * This adds the missing text rather than touching any of the apps — the same
 * approach #128 took for the graphs. The copy is genuine description of what
 * each tool does, not padding: a page that games a word count and says
 * nothing is the thing "Crawled — currently not indexed" is for.
 *
 * Placed after the interactive app in the flow, visible and scrollable. Never
 * hidden: text a reader cannot reach is cloaking, and it would be a worse
 * problem than the one being fixed.
 */
export type AboutPageKey = "home" | "search" | "study" | "quiz";

export async function PageAbout({
    page,
    locale,
}: {
    page: AboutPageKey;
    locale: string;
}) {
    const t = await getTranslations({ locale, namespace: "PageAbout" });

    return (
        <section className="page-about" aria-labelledby={`page-about-${page}`}>
            <div className="page-about-inner">
                <h2 id={`page-about-${page}`}>{t(`${page}.heading`)}</h2>
                <p>{t(`${page}.p1`)}</p>
                <p>{t(`${page}.p2`)}</p>
            </div>
        </section>
    );
}
