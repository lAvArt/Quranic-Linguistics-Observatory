import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import SearchWorkspace from "@/components/search/SearchWorkspace";
import { PageAbout } from "@/components/seo/PageAbout";
import { buildExploreOverviewPayload } from "@/lib/corpus/overviewData";
import { SITE_URL, languageAlternates } from "@/lib/seo/site";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Meta" });
  return {
    title: t("searchTitle"),
    description: t("searchDescription"),
    alternates: {
      canonical: `${SITE_URL}/${locale}/search`,
      languages: languageAlternates("/search"),
    },
  };
}

export default async function SearchPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const initialCorpusData = buildExploreOverviewPayload();

  return (
    <>
      <SearchWorkspace initialCorpusData={initialCorpusData} />
      <PageAbout page="search" locale={locale} />
    </>
  );
}
