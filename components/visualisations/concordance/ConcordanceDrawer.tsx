"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import {
  summarizeConcordance,
  type ConcordanceSelection,
  type SurahHit,
} from "@/lib/corpus/concordanceClient";

/**
 * What the concordance rings put in the details panel (the context drawer).
 *
 * With no ring selected: a table of how far each root reaches across the
 * corpus and how much the roots share, then the list of surahs where the
 * chosen roots meet, and the ayahs they meet in. The list is the rings' text
 * alternative, made visible rather than hidden under the canvas — each row
 * selects its ring.
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
  // Before the early returns: hooks must run on every render.
  const summary = useMemo(() => summarizeConcordance(selection), [selection]);

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
              <span>{t("inAyahs", { n: nf.format(selected.perRoot[i] ?? 0), m: selected.ayahCount })}</span>
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

  const several = selection.roots.length > 1;
  const pct = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });
  const cols = several ? 5 : 4;
  const rootLabel = (i: number) => (
    <span className="cr-stats-root">
      <i className="cr-dot" style={{ background: `var(--viz-root-${i + 1})` }} aria-hidden="true" />
      <span className="cr-root" dir="rtl" lang="ar">{selection.roots[i].bare}</span>
    </span>
  );

  return (
    <section className="cr-drawer" aria-label={t("tableCaption")}>
      <table className="cr-stats">
        <caption className="cr-drawer-h">{t("statsCaption")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("statsRoot")}</th>
            <th scope="col">{t("statsWords")}</th>
            <th scope="col">{t("statsAyahs")}</th>
            <th scope="col">{t("statsSurahs")}</th>
            {several ? <th scope="col">{t("statsShared")}</th> : null}
          </tr>
        </thead>
        <tbody>
          {selection.roots.map((r, i) => {
            const spread = summary.perRoot[i];
            return (
              <tr key={r.bare}>
                <th scope="row">{rootLabel(i)}</th>
                <td>{nf.format(r.count)}</td>
                <td>{nf.format(spread.ayahs)}</td>
                <td>{nf.format(spread.surahs)}</td>
                {several ? (
                  <td>{pct.format(spread.ayahs ? summary.together.ayahs / spread.ayahs : 0)}</td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
        {several ? (
          <tfoot>
            <tr>
              <td colSpan={cols}>
                {t("statsTogether", { ayahs: summary.together.ayahs, surahs: summary.together.surahs })}
              </td>
            </tr>
            <tr>
              <td colSpan={cols}>{t("statsAllPresent", { surahs: summary.allPresentSurahs })}</td>
            </tr>
            {summary.pairs.map((p) => (
              <tr key={`${p.a}-${p.b}`}>
                <td colSpan={cols}>
                  {rootLabel(p.a)}
                  {" + "}
                  {rootLabel(p.b)}
                  {": "}
                  {t("statsPair", { ayahs: p.ayahs, surahs: p.surahs })}
                </td>
              </tr>
            ))}
          </tfoot>
        ) : null}
      </table>
      <p className="cr-stats-note">
        {t("statsNote")}
        {several ? ` ${t("statsSharedNote")}` : null}
      </p>
      <h3 className="cr-drawer-h cr-drawer-h--next">{t("meetingsHeading")}</h3>
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
