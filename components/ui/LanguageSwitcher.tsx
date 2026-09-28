"use client";

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useTransition } from "react";

export default function LanguageSwitcher() {
    const locale = useLocale();
    const router = useRouter();
    const pathname = usePathname();
    const [isPending, startTransition] = useTransition();

    const toggleLocale = (newLocale: 'ar' | 'en') => {
        if (newLocale === locale) return;
        // Keep where the reader is. The explore view lives on "/" plus its
        // query (?viz=…&surah=…&root=…), so switching with the bare pathname
        // dropped the query and landed on the home page. Read the query from
        // window.location, not useSearchParams: the shell and the viz modes
        // keep it current with history.replaceState.
        const { search, hash } = window.location;
        startTransition(() => {
            router.replace(`${pathname}${search}${hash}`, { locale: newLocale });
        });
    };

    return (
        <div className="header-button-group">
            <button
                type="button"
                className={`control-pill-btn ${locale === 'ar' ? 'active' : ''}`}
                onClick={() => toggleLocale('ar')}
                disabled={isPending}
            >
                عربي
            </button>
            <button
                type="button"
                className={`control-pill-btn ${locale === 'en' ? 'active' : ''}`}
                onClick={() => toggleLocale('en')}
                disabled={isPending}
            >
                EN
            </button>
        </div>
    );
}
