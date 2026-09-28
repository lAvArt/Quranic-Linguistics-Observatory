import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getLocale } from "next-intl/server";
import { EmbedProviders } from "@/components/embed/EmbedProviders";

export const metadata = {
  robots: { index: false, follow: false },
};

export default async function EmbedLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  // Same rule as app/[locale]/layout.tsx's .locale-shell: <html> carries lang
  // but never dir, so without this Arabic embed copy renders left-to-right.
  const direction = locale === "ar" ? "rtl" : "ltr";

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <EmbedProviders>
        <div className="embed-shell" dir={direction}>{children}</div>
      </EmbedProviders>
    </NextIntlClientProvider>
  );
}
