"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import type { ConcordanceSelection, SurahHit } from "@/lib/corpus/concordanceClient";

/**
 * What the concordance rings put in the details panel (the context drawer).
 *
 * With no ring selected: the list of surahs where the chosen roots meet, and
 * the ayahs they meet in. This is the rings' text alternative, made visible
 * rather than hidden under the canvas — each row selects its ring.
 *
 * With a ring selected: the surah card from the spec (figure 05) — how many
 * ayahs hold each root, where they meet, and a way into that surah's radial
 * view.
 */
interface Props {
  selection: ConcordanceSelection;
  selected: SurahHit | null;
  onSelect: (surah: number | null) => void;
}

export default function ConcordanceDrawer({ selection, selected, onSelect }: Props) {
  const t = useTranslations("Visualizations.ConcordanceRings");
  const locale = useLocale();
  const nf = new Intl.NumberFormat(locale);

  if (selected) {
    const meetingAyahs = selected.meetings.map((m) => m.ayah);
    return (
      <section className="cr-drawer" aria-label={t("surahCard", { surah: selected.name })}>
        <header className="cr-drawer-head">
          <div>
            <p className="cr-drawer-title">
              <span className="cr-drawer-n">{nf.format(selected.n)}</span>
              <span className="cr-root" dir="rtl" lang="ar">{selected.arabic}</span>
            </p>
            <p className="cr-drawer-sub">
              {t("surahMeta", {
                name: selected.name,
                place: t(`place.${selected.revelationPlace === "madinah" ? "madinah" : "makkah"}`),
                ayahs: nf.format(selected.ayahCount),
              })}
            </p>
          </div>
          <button type="button" className="cr-x" aria-label={t("closeCard")} onClick={() => onSelect(null)}>
            ×
          </button>
        </header>
        <ul className="cr-drawer-roots">
          {selection.roots.map((r, i) => (
            <li key={r.bare}>
              <i className="cr-dot" style={{ background: `var(--viz-root-${i + 1})` }} aria-hidden="true" />
              <span className="cr-root" dir="rtl" lang="ar">{r.bare}</span>
              <span>{t("inAyahs", { n: selected.perRoot[i] ?? 0 })}</span>
            </li>
          ))}
        </ul>
        <p className="cr-drawer-meet">
          {meetingAyahs.length
            ? t("allMeetIn", { count: meetingAyahs.length, ayahs: meetingAyahs.map((a) => nf.format(a)).join(", ") })
            : t("neverMeet")}
        </p>
        <Link className="cr-drawer-link" href={`/?viz=radial-sura&surah=${selected.n}`}>
          {t("openRadial")}
        </Link>
      </section>
    );
  }

  if (!selection.roots.length) return null;

  return (
    <section className="cr-drawer" aria-label={t("tableCaption")}>
      <h3 className="cr-drawer-h">{t("meetingsHeading")}</h3>
      <p className="cr-drawer-sub">
        {t("meetingsSummary", {
          surahs: nf.format(selection.qualifying.length),
          meetings: nf.format(selection.totalMeetings),
        })}
      </p>
      <ol className="cr-meetings">
        {selection.qualifying.map((s) => (
          <li key={s.n}>
            <button type="button" onClick={() => onSelect(s.n)}>
              <span className="cr-meetings-n">{nf.format(s.n)}</span>
              <span className="cr-meetings-name">
                <span className="cr-root" dir="rtl" lang="ar">{s.arabic}</span>
                <span className="cr-meetings-en">{s.name}</span>
              </span>
              <span className="cr-meetings-refs" dir="ltr">
                {s.meetings.length
                  ? s.meetings.map((m) => m.ayah).join(", ")
                  : t("everyRootPresent")}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
