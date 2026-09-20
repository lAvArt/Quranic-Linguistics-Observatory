import { MetadataRoute } from 'next';
import { SITE_URL, LOCALES } from '@/lib/seo/site';
import { VIZ_GALLERY, graphImagePath } from '@/lib/seo/vizGallery';

const PAGES = [
    { path: '',              changeFrequency: 'daily'   as const, priority: 1.0 },
    { path: '/search',       changeFrequency: 'weekly'  as const, priority: 0.9 },
    { path: '/study',        changeFrequency: 'weekly'  as const, priority: 0.8 },
    { path: '/quiz',         changeFrequency: 'weekly'  as const, priority: 0.7 },
    { path: '/frequency',    changeFrequency: 'monthly' as const, priority: 0.8 },
    { path: '/auth/login',   changeFrequency: 'monthly' as const, priority: 0.3 },
];

// NOTE: /embed/* routes are deliberately NOT listed — app/embed/layout.tsx
// sets robots noindex on them (they're iframe payloads, not landing pages),
// and a sitemap that lists noindexed URLs generates Search Console errors.

export default function sitemap(): MetadataRoute.Sitemap {
    const now = new Date();
    const entries: MetadataRoute.Sitemap = [];

    for (const locale of LOCALES) {
        for (const page of PAGES) {
            entries.push({
                url: `${SITE_URL}/${locale}${page.path}`,
                lastModified: now,
                changeFrequency: page.changeFrequency,
                priority: page.priority,
                // hreflang cross-links so Google treats en/ar as one page in
                // two languages instead of duplicate content.
                alternates: {
                    languages: {
                        en: `${SITE_URL}/en${page.path}`,
                        ar: `${SITE_URL}/ar${page.path}`,
                    },
                },
            });
        }
    }

    // Gallery pages: one indexable URL per visualization, each carrying the
    // rendered PNG. `images` emits <image:image> so Google Images can discover
    // a graph that is otherwise client-built inline SVG and therefore
    // invisible to it. Requires public/graphs/*.png — run `npm run graphs:build`.
    for (const locale of LOCALES) {
        for (const entry of VIZ_GALLERY) {
            const path = `/viz/${entry.mode}`;
            entries.push({
                url: `${SITE_URL}/${locale}${path}`,
                lastModified: now,
                changeFrequency: 'monthly',
                priority: 0.6,
                images: [`${SITE_URL}${graphImagePath(entry.mode)}`],
                alternates: {
                    languages: {
                        en: `${SITE_URL}/en${path}`,
                        ar: `${SITE_URL}/ar${path}`,
                    },
                },
            });
        }
    }

    return entries;
}
