import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import StudyHub from "@/components/study/StudyHub";
import { PageAbout } from "@/components/seo/PageAbout";
import { SITE_URL, languageAlternates } from "@/lib/seo/site";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Meta" });
  return {
    title: t("studyTitle"),
    description: t("studyDescription"),
    alternates: {
      canonical: `${SITE_URL}/${locale}/study`,
      languages: languageAlternates("/study"),
    },
  };
}

export default async function StudyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // StudyHub is a client component that returns a loading state until auth
  // resolves, so the server emitted 14 words — "Your Profile Loading…" — and
  // that is what Google indexed. The prose below is the page describing
  // itself in a form a crawler can read; the hub above is untouched.
  return (
    <>
      <StudyHub />
      <PageAbout page="study" locale={locale} />
    </>
  );
}
