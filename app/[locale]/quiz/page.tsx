import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { buildExploreOverviewPayload } from "@/lib/corpus/overviewData";
import QuizWorkspace from "./QuizWorkspace";
import { PageAbout } from "@/components/seo/PageAbout";
import { SITE_URL, languageAlternates } from "@/lib/seo/site";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Meta" });
  return {
    title: t("quizTitle"),
    description: t("quizDescription"),
    alternates: {
      canonical: `${SITE_URL}/${locale}/quiz`,
      languages: languageAlternates("/quiz"),
    },
  };
}

export default async function QuizPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const initialCorpusData = buildExploreOverviewPayload();
  return (
    // QuizWorkspace reads ?root= via useSearchParams (for the root-focused
    // quiz deep link from the inspector) — Next requires a Suspense
    // boundary around any component using it so this route can still be
    // statically prerendered.
    <>
      <Suspense fallback={null}>
        <QuizWorkspace initialCorpusData={initialCorpusData} />
      </Suspense>
      <PageAbout page="quiz" locale={locale} />
    </>
  );
}
