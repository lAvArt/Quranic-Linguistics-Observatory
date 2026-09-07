import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/react";
import { Providers } from "./providers";
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '../../i18n/routing';
import { Footer } from "@/components/ui/Footer";
import { SiteNavMap } from "@/components/seo/SiteNavMap";
import { SITE_URL, SITE_NAME, languageAlternates } from "@/lib/seo/site";

function isRoutingLocale(locale: string): locale is (typeof routing.locales)[number] {
  return routing.locales.includes(locale as (typeof routing.locales)[number]);
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const isPseudo = locale === 'pseudo';
  const isAr = locale === 'ar';
  const t = await getTranslations({ locale: isPseudo ? 'en' : locale, namespace: 'Meta' });

  return {
    metadataBase: new URL(SITE_URL),
    title: {
      default: t('title'),
      template: `%s | ${t('title')}`
    },
    description: t('description'),
    keywords: isAr
      ? ["القرآن", "المدونة القرآنية", "جذور", "صرف", "لسانيات", "تصور بياني", "عربي"]
      : ["Quran", "Corpus", "Visualization", "Linguistics", "Arabic", "Islam", "Data Visualization", "Graph", "Roots", "Morphology"],
    authors: [{ name: SITE_NAME }],
    creator: SITE_NAME,
    publisher: SITE_NAME,
    robots: isPseudo
      ? { index: false, follow: false }
      : {
          index: true,
          follow: true,
          googleBot: {
            index: true,
            follow: true,
            'max-video-preview': -1,
            'max-image-preview': 'large',
            'max-snippet': -1,
          },
        },
    openGraph: isPseudo ? undefined : {
      type: "website",
      locale: isAr ? "ar_SA" : "en_US",
      alternateLocale: isAr ? "en_US" : "ar_SA",
      url: `${SITE_URL}/${locale}`,
      title: t('title'),
      description: t('ogDescription'),
      siteName: SITE_NAME,
      images: [
        {
          url: "/opengraph-image",
          width: 1200,
          height: 630,
          alt: t('ogImageAlt'),
        },
      ],
    },
    twitter: isPseudo ? undefined : {
      card: "summary_large_image",
      title: t('title'),
      description: t('ogDescription'),
      images: ["/twitter-image"],
      creator: "@pluragate",
    },
    // NOTE: no `canonical` here — layout metadata is inherited by every child
    // page, and a layout-level canonical made /search, /study, and /quiz all
    // claim the locale root as their canonical URL (deindexing themselves).
    // Each page declares its own canonical + hreflang via generateMetadata.
    alternates: {
      languages: languageAlternates(""),
    },
    manifest: "/manifest.webmanifest",
    icons: {
      // Both are listed on purpose. Google's favicon crawler is unreliable with
      // an SVG-only icon, and the .ico is the size it actually wants (>=48px,
      // a multiple of 48); browsers that prefer the sharper vector take the SVG.
      // Both carry the #0e161a plate — a transparent white-on-nothing mark
      // rendered invisible against Google's white results page.
      // favicon.svg is the app icon artwork (icon-any.svg) and favicon.ico is
      // generated from it by `npm run favicon:build`.
      icon: [
        { url: '/favicon.ico', sizes: '48x48', type: 'image/x-icon' },
        { url: '/favicon.svg', type: 'image/svg+xml' },
      ],
      shortcut: '/favicon.ico',
      apple: '/icon-any.svg',
    },
  };
}

export default async function RootLayout({
  children,
  params
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;

  // Ensure that the incoming `locale` is valid
  if (!isRoutingLocale(locale)) {
    notFound();
  }

  // Providing all messages to the client
  // side is the easiest way to get started
  const messages = await getMessages();
  const tMeta = await getTranslations({ locale: locale === 'pseudo' ? 'en' : locale, namespace: 'Meta' });

  const direction = locale === 'ar' ? 'rtl' : 'ltr';

  return (
    <>
      <NextIntlClientProvider messages={messages}>
        <Providers>
          <div dir={direction} lang={locale} className="locale-shell">
            {children}
            {/*
              Server-rendered internal links, outside <Footer /> on purpose.
              The footer is a client component whose anchors are all external,
              so the HTML a crawler receives carried no in-site links at all —
              and `.mhome-active .site-footer { display: none }` hides the
              footer on the immersive home, the page whose links matter most.
            */}
            <SiteNavMap locale={locale} />
            <Footer />
          </div>
        </Providers>
      </NextIntlClientProvider>
      <Analytics />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([
            {
              "@context": "https://schema.org",
              "@type": "WebSite",
              "name": SITE_NAME,
              "url": `${SITE_URL}/${locale}`,
              "inLanguage": locale === 'ar' ? 'ar' : 'en',
              "potentialAction": {
                "@type": "SearchAction",
                // SearchWorkspace hydrates its query from ?q= — this target is
                // a real, working deep link, not an aspirational one.
                "target": `${SITE_URL}/${locale}/search?q={search_term_string}`,
                "query-input": "required name=search_term_string"
              }
            },
            {
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              "name": SITE_NAME,
              "applicationCategory": "EducationalApplication",
              "operatingSystem": "Web",
              "url": `${SITE_URL}/${locale}`,
              "description": tMeta('description'),
              "inLanguage": locale === 'ar' ? 'ar' : 'en',
              "isAccessibleForFree": true,
              "license": "https://www.gnu.org/licenses/gpl-3.0.html",
              "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" }
            }
          ])
        }}
      />
    </>
  );
}
