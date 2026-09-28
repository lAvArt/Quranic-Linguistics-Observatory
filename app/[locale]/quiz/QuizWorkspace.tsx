"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/i18n/routing";
import AppWorkspaceShell from "@/components/ui/AppWorkspaceShell";
import DailyPuzzle from "@/components/quiz/DailyPuzzle";
import ReviewQuiz from "@/components/quiz/ReviewQuiz";
import RootQuiz from "@/components/quiz/RootQuiz";
import { useCorpusData } from "@/lib/hooks/useCorpusData";
import { calculateRootFrequencies } from "@/lib/search/collocation";
import { ROOT_GLOSSES } from "@/lib/data/rootGlosses";
import { SURAH_NAMES } from "@/lib/data/surahData";
import type { PartOfSpeech } from "@/lib/schema/types";
import type { CorpusOverviewData } from "@/lib/corpus/overviewData";
import type { QuizCorpusData } from "@/lib/quiz/questionTemplates";

interface QuizWorkspaceProps {
  initialCorpusData?: CorpusOverviewData;
}

export default function QuizWorkspace({ initialCorpusData }: QuizWorkspaceProps) {
  const locale = useLocale();
  const t = useTranslations("Quiz");
  const tPos = useTranslations("MorphologyInspector.featuresMap.pos");
  const searchParams = useSearchParams();
  const router = useRouter();
  const { allTokens, isLoadingCorpus, readiness } = useCorpusData(initialCorpusData);
  // Deep link from the inspector's "Quiz me on this root" CTA — when
  // present, this page shows ONLY a root-focused quiz instead of the
  // regular daily puzzle + study session pair.
  const rootParam = searchParams.get("root");

  const quizLocale = locale.startsWith("ar") ? "ar" : "en";
  const corpusData: QuizCorpusData = useMemo(() => ({
    tokens: allTokens,
    freqData: calculateRootFrequencies(allTokens),
    glosses: ROOT_GLOSSES,
    surahNames: SURAH_NAMES,
    locale: quizLocale,
    glossLocale: "en",
    formatNumber: (value: number) => new Intl.NumberFormat(quizLocale).format(value),
    formatSurahName: (surahId: number) => {
      const surah = SURAH_NAMES[surahId];
      if (!surah) return t("surahFallback", { id: surahId });
      return quizLocale === "ar" ? surah.arabic : surah.name;
    },
    formatPosLabel: (pos: PartOfSpeech) => {
      switch (pos) {
        case "N":
          return tPos("N");
        case "V":
          return tPos("V");
        case "P":
          return tPos("P");
        case "ADJ":
          return tPos("ADJ");
        case "PRON":
          return tPos("PRON");
        default:
          return pos;
      }
    },
  }), [allTokens, quizLocale, t, tPos]);

  const isPreparingQuiz = isLoadingCorpus && !readiness.deepDataReady;

  return (
    <AppWorkspaceShell
      kicker={t("kicker")}
      title={t("title")}
      description={t("description")}
      backgroundVariant="study"
      panelWidth="wide"
      status={
        rootParam ? undefined : (
          <span
            className="quiz-experimental-badge"
            title={t("experimentalDesc")}
            aria-label={`${t("experimentalTitle")} — ${t("experimentalDesc")}`}
          >
            {t("experimentalBadge")}
          </span>
        )
      }
    >
      {rootParam ? (
        <>
          <button
            type="button"
            className="quiz-back-link"
            onClick={() => router.replace("/quiz")}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            {t("allQuizzes")}
          </button>

          <section className="quiz-section ui-card ui-section-card">
            <div className="quiz-section-head">
              <div>
                <h2 className="quiz-section-heading">{t("rootQuiz.title", { root: rootParam })}</h2>
                <p className="quiz-section-desc">{t("rootQuiz.description")}</p>
              </div>
              <span className="quiz-section-badge">{t("rootQuiz.badge")}</span>
            </div>
            {isPreparingQuiz ? (
              <div className="quiz-pending">
                <h3 className="quiz-pending-title">{t("preparingTitle")}</h3>
                <p className="quiz-pending-copy">{t("preparingDesc")}</p>
              </div>
            ) : (
              <RootQuiz corpusData={corpusData} root={rootParam} />
            )}
          </section>
        </>
      ) : (
        <>
          <section className="quiz-section ui-card ui-section-card">
            <div className="quiz-section-head">
              <div>
                <h2 className="quiz-section-heading">{t("dailyPuzzleHeading")}</h2>
                <p className="quiz-section-desc">{t("dailyPuzzleDesc")}</p>
              </div>
              <span className="quiz-section-badge">{t("dailyBadge")}</span>
            </div>
            {isPreparingQuiz ? (
              <div className="quiz-pending">
                <h3 className="quiz-pending-title">{t("preparingTitle")}</h3>
                <p className="quiz-pending-copy">{t("preparingDesc")}</p>
              </div>
            ) : (
              <DailyPuzzle corpusData={corpusData} />
            )}
          </section>

          <section className="quiz-section quiz-section-review ui-card ui-section-card">
            <div className="quiz-section-head">
              <div>
                <h2 className="quiz-section-heading">{t("reviewHeading")}</h2>
                <p className="quiz-section-desc">{t("reviewDesc")}</p>
              </div>
              <span className="quiz-section-badge quiz-section-badge-secondary">{t("adaptiveBadge")}</span>
            </div>
            {isPreparingQuiz ? (
              <div className="quiz-pending">
                <h3 className="quiz-pending-title">{t("preparingTitle")}</h3>
                <p className="quiz-pending-copy">{t("preparingDesc")}</p>
              </div>
            ) : (
              <ReviewQuiz corpusData={corpusData} />
            )}
          </section>
        </>
      )}

      <style jsx>{`
        .quiz-back-link {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 1rem;
          padding: 0.4rem 0;
          border: none;
          background: none;
          color: var(--ink-secondary);
          font-size: 0.88rem;
          font-weight: 600;
          cursor: pointer;
          transition: color 0.15s;
        }
        .quiz-back-link:hover {
          color: var(--ink);
        }
        :global([dir="rtl"] .quiz-back-link svg) {
          transform: scaleX(-1);
        }
        .quiz-experimental-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 2rem;
          padding: 0.35rem 0.8rem;
          border-radius: 999px;
          border: 1px solid rgba(245, 158, 11, 0.4);
          background: rgba(245, 158, 11, 0.12);
          font-size: 0.74rem;
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          white-space: nowrap;
          cursor: help;
        }
        .quiz-section {
          padding: 1.25rem;
        }
        .quiz-section + .quiz-section {
          margin-top: 24px;
        }
        .quiz-section-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 1rem;
          margin-bottom: 1.1rem;
          padding-bottom: 0.95rem;
          border-bottom: 1px solid rgba(17, 24, 39, 0.08);
        }
        .quiz-section-heading {
          margin: 0;
          font-size: 1.28rem;
          font-weight: 700;
          letter-spacing: -0.02em;
        }
        .quiz-section-desc {
          margin: 0.35rem 0 0;
          font-size: 0.95rem;
          color: var(--ink-secondary);
          max-width: 60ch;
          line-height: 1.55;
        }
        .quiz-section-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 2rem;
          padding: 0.38rem 0.8rem;
          border-radius: 999px;
          border: 1px solid color-mix(in srgb, var(--accent), white 32%);
          background: color-mix(in srgb, var(--accent), transparent 88%);
          color: var(--ink);
          font-size: 0.78rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .quiz-section-badge-secondary {
          border-color: color-mix(in srgb, var(--accent-2), white 32%);
          background: color-mix(in srgb, var(--accent-2), transparent 88%);
        }
        .quiz-pending {
          max-width: 680px;
          margin: 0 auto;
          padding: 24px;
          border: 1px solid rgba(17, 24, 39, 0.08);
          border-radius: 20px;
          background: rgba(255, 255, 255, 0.48);
        }
        .quiz-pending-title {
          margin: 0 0 0.4rem;
          font-size: 1rem;
          font-weight: 700;
        }
        .quiz-pending-copy {
          margin: 0;
          font-size: 0.95rem;
          color: var(--ink-secondary);
          line-height: 1.5;
        }
        :global([data-theme="dark"] .quiz-experimental-badge) {
          color: var(--ink);
          background: rgba(245, 158, 11, 0.14);
          border-color: rgba(245, 158, 11, 0.32);
        }
        :global([data-theme="dark"] .quiz-section-head) {
          border-bottom-color: rgba(255, 255, 255, 0.08);
        }
        :global([data-theme="dark"] .quiz-section-badge) {
          color: var(--ink);
        }
        :global([data-theme="dark"] .quiz-pending) {
          background: rgba(255, 255, 255, 0.03);
          border-color: rgba(255, 255, 255, 0.08);
        }
        @media (max-width: 720px) {
          .quiz-section {
            padding: 1rem;
          }
          .quiz-section-head {
            flex-direction: column;
          }
        }
      `}</style>
    </AppWorkspaceShell>
  );
}
