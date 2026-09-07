import { getTranslations } from "next-intl/server";
import { PRIMARY_NAV, GALLERY_NAV, navHref } from "@/lib/seo/siteNav";

/**
 * The site's internal link graph, rendered on the server on every page.
 *
 * A server component on purpose, and that is the entire point of it. The
 * existing footer is `"use client"` and its links are all external, so the
 * HTML Google receives contained no in-site anchors at all — measured, not
 * assumed. React building a nav after hydration is invisible to a crawler
 * that never runs the bundle; these anchors are in the markup as it leaves
 * the server.
 *
 * Plain `<a>` rather than next/link's client navigation: this exists to be
 * crawled, and an anchor is the thing being crawled. Client-side routing on
 * a link a reader may also click is not worth the trade here.
 *
 * Rendered by `app/[locale]/layout.tsx` outside `.site-footer`, deliberately:
 * `.mhome-active .site-footer { display: none }` hides the footer on the
 * immersive home, which is precisely the page whose links matter most.
 */
export async function SiteNavMap({ locale }: { locale: string }) {
    const t = await getTranslations({ locale, namespace: "SiteNav" });
    const tViz = await getTranslations({ locale, namespace: "Visualizations" });

    return (
        <nav className="site-nav-map" aria-label={t("heading")}>
            <div className="site-nav-map-inner">
                <p className="site-nav-map-blurb">{t("blurb")}</p>

                <div className="site-nav-map-groups">
                    <div className="site-nav-map-group">
                        <h2 className="site-nav-map-heading">{t("heading")}</h2>
                        <ul>
                            {PRIMARY_NAV.map((link) => (
                                <li key={link.path || "home"}>
                                    <a href={navHref(locale, link.path)}>
                                        {t(link.labelKey)}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </div>

                    <div className="site-nav-map-group">
                        <h2 className="site-nav-map-heading">{t("graphs")}</h2>
                        <ul>
                            {GALLERY_NAV.map((entry) => (
                                <li key={entry.path}>
                                    <a href={navHref(locale, entry.path)}>
                                        {tViz(`${entry.titleKey}.title`)}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            </div>
        </nav>
    );
}
