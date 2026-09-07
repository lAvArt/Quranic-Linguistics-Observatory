import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import MinimalHome from "@/components/home/MinimalHome";
import { PageAbout } from "@/components/seo/PageAbout";
import { SiteNavMap } from "@/components/seo/SiteNavMap";
import { buildExploreOverviewPayload } from "@/lib/corpus/overviewData";
import { cookies } from "next/headers";
import { THEME_COOKIE_NAME, parseThemePreferenceCookie } from "@/lib/theme/themePreferences";
import { SITE_URL, languageAlternates } from "@/lib/seo/site";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    alternates: {
      canonical: `${SITE_URL}/${locale}`,
      languages: languageAlternates(""),
    },
  };
}

type SearchParams = Record<string, string | string[] | undefined>;

// The minimal, search-first home is the default landing. Entering the full
// Observatory is signalled by a deep-link param (the home's CTAs / "skip" push
// ?viz=&root=…, and AppShell hydrates the selection from those params).
export default async function HomePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const entered = Boolean(sp.viz || sp.root || sp.lemma || sp.surah || sp.ayah || sp.token || sp.app);

  if (!entered) {
    // Seed the search box from ?q= so Back into the home restores the last query.
    //
    // The prose rides with the minimal home only. This branch is the URL the
    // sitemap names and Google indexes; the AppShell branch below is reached
    // by deep-link params and is not a crawl target — MinimalHome rendered 37
    // words of server HTML, which is what the landing page was worth to a
    // crawler before this.
    return (
      <MinimalHome initialQuery={typeof sp.q === "string" ? sp.q : ""}>
        <PageAbout page="home" locale={locale} />
        <SiteNavMap locale={locale} />
      </MinimalHome>
    );
  }

  const initialCorpusData = buildExploreOverviewPayload();
  const cookieStore = await cookies();
  const initialThemePreference = parseThemePreferenceCookie(cookieStore.get(THEME_COOKIE_NAME)?.value);

  return <AppShell initialCorpusData={initialCorpusData} initialThemePreference={initialThemePreference} />;
}
