import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { SITE_URL, SITE_NAME, languageAlternates } from "@/lib/seo/site";
import { routing } from "@/i18n/routing";
import { VIZ_EXPLAINERS } from "@/lib/config/vizExplainers";
import type { VisualizationMode } from "@/lib/schema/visualizationTypes";
import {
  findGalleryEntry,
  graphImagePath,
  GALLERY_MODES,
  GRAPH_IMAGE_WIDTH,
  GRAPH_IMAGE_HEIGHT,
} from "@/lib/seo/vizGallery";

/**
 * A crawlable page per gallery visualization.
 *
 * Its entire job is to give one graph a real URL, a real <img>, and enough
 * surrounding prose for Google to understand what the image shows. The live
 * graph stays where it always was — this page links into it and changes
 * nothing about it.
 *
 * All copy is reused from the existing `Visualizations` and `VizExplainer`
 * namespaces, so both locales are already covered.
 */

interface VizPageProps {
  params: Promise<{ locale: string; mode: string }>;
}

/**
 * Enumerates the only params this route serves, so an unknown mode is rejected
 * by routing rather than rendered.
 *
 * Caveat, measured rather than assumed: an unknown mode still answers HTTP 200
 * while rendering the not-found UI -- a soft 404. The cause is upstream of this
 * file (the `[locale]` segment's own not-found boundary inside a dynamic
 * layout; the same `notFound()` under `app/embed/` correctly answers 404), so
 * fixing it means changing shared not-found handling. It is left alone because
 * the practical exposure is nil: Next injects `<meta name="robots" noindex>` on
 * that response, nothing links to an invalid mode, and the sitemap lists only
 * the three real ones.
 */
export const dynamicParams = false;

export function generateStaticParams(): Array<{ locale: string; mode: string }> {
  return routing.locales.flatMap((locale) =>
    GALLERY_MODES.map((mode) => ({ locale, mode }))
  );
}

/** Shared resolver so metadata and the page body agree on the same strings. */
async function resolve(locale: string, mode: string) {
  const entry = findGalleryEntry(mode);
  if (!entry) return null;

  const tViz = await getTranslations({ locale, namespace: "Visualizations" });
  const tExp = await getTranslations({ locale, namespace: "VizExplainer" });

  return {
    entry,
    title: tViz(`${entry.titleKey}.title`),
    summary: tExp(`${mode}.summary`),
    purpose: tExp(`${mode}.purpose`),
    claim: tExp(`${mode}.claim`),
    read: (VIZ_EXPLAINERS[mode as VisualizationMode]?.readKeys ?? []).map((key) => tExp(key)),
  };
}

export async function generateMetadata({ params }: VizPageProps): Promise<Metadata> {
  const { locale, mode } = await params;
  const data = await resolve(locale, mode);
  if (!data) return {};

  const path = `/viz/${mode}`;
  const image = `${SITE_URL}${graphImagePath(mode)}`;

  return {
    title: `${data.title} — ${SITE_NAME}`,
    description: data.summary,
    alternates: {
      canonical: `${SITE_URL}/${locale}${path}`,
      languages: languageAlternates(path),
    },
    openGraph: {
      title: data.title,
      description: data.summary,
      url: `${SITE_URL}/${locale}${path}`,
      images: [
        {
          url: image,
          width: GRAPH_IMAGE_WIDTH,
          height: GRAPH_IMAGE_HEIGHT,
          alt: data.claim,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: data.title,
      description: data.summary,
      images: [image],
    },
  };
}

export default async function VizGalleryPage({ params }: VizPageProps) {
  const { locale, mode } = await params;
  const data = await resolve(locale, mode);
  if (!data) notFound();

  const t = await getTranslations({ locale, namespace: "VizGallery" });
  const image = graphImagePath(mode);
  const liveHref = `/${locale}?${data.entry.liveQuery}`;

  return (
    <main className="viz-gallery-page">
      <article>
        <h1>{data.title}</h1>
        <p className="viz-gallery-claim">{data.claim}</p>

        {/*
          A real <img> with a real src is the whole point: this is the only
          form of the graph that Google can index.

          Intentionally NOT next/image. That would serve the picture from
          /_next/image?url=…&w=…, so the URL on the page would no longer match
          the one named by the sitemap's <image:loc> and by ImageObject's
          contentUrl below — Google wants those to agree. next/image also
          lazy-loads by default, which is weaker for the page's primary image.
        */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image}
          alt={`${data.title} — ${data.claim}`}
          width={GRAPH_IMAGE_WIDTH}
          height={GRAPH_IMAGE_HEIGHT}
          className="viz-gallery-image"
        />

        <section>
          <h2>{t("whatItShows")}</h2>
          <p>{data.summary}</p>
        </section>

        {data.read.length ? (
          <section>
            <h2>{t("howToRead")}</h2>
            <ul>
              {data.read.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <section>
          <h2>{t("whatItIsFor")}</h2>
          <p>{data.purpose}</p>
        </section>

        <p className="viz-gallery-cta">
          <a href={liveHref}>{t("openLive", { title: data.title })}</a>
        </p>
      </article>

      {/*
        ImageObject tells Google what the picture is rather than leaving it to
        infer from surrounding text — the difference between an indexed image
        and an ignored one.
      */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "ImageObject",
            contentUrl: `${SITE_URL}${image}`,
            url: `${SITE_URL}/${locale}/viz/${mode}`,
            name: data.title,
            description: data.summary,
            caption: data.claim,
            width: GRAPH_IMAGE_WIDTH,
            height: GRAPH_IMAGE_HEIGHT,
            inLanguage: locale === "ar" ? "ar" : "en",
            isPartOf: { "@type": "WebSite", name: SITE_NAME, url: `${SITE_URL}/${locale}` },
            license: "https://www.gnu.org/licenses/gpl-3.0.html",
          }),
        }}
      />
    </main>
  );
}
