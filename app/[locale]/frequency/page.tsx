import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import RootFrequencyView from "@/components/frequency/RootFrequencyView";
import { SITE_URL, languageAlternates } from "@/lib/seo/site";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Meta" });
  return {
    title: t("frequencyTitle"),
    description: t("frequencyDescription"),
    alternates: {
      canonical: `${SITE_URL}/${locale}/frequency`,
      languages: languageAlternates("/frequency"),
    },
  };
}

export default async function FrequencyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <RootFrequencyView locale={locale} />;
}
