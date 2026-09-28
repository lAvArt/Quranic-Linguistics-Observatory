"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import QuizCard from "@/components/quiz/QuizCard";
import { useKnowledge } from "@/lib/context/KnowledgeContext";
import { generateRootQuiz, extractQuizRoots } from "@/lib/quiz/personalizedQuiz";
import { useQuizProgressRecorder } from "@/lib/quiz/useQuizProgressRecorder";
import type { QuizCorpusData } from "@/lib/quiz/questionTemplates";

interface RootQuizProps {
  corpusData: QuizCorpusData;
  /** The root every question in this session is locked to. */
  root: string;
}

/**
 * Root-focused quiz session — reached from the inspector's "Quiz me on this
 * root" CTA. Modeled closely on ReviewQuiz, minus the tracked-roots mix:
 * every question here is about the same, single `root`. Completion offers a
 * Track CTA when the root isn't already tracked, closing the
 * explore -> quiz -> track loop.
 */
export default function RootQuiz({ corpusData, root }: RootQuizProps) {
  const t = useTranslations("Quiz");
  const tMi = useTranslations("MorphologyInspector.actions");
  const { roots, updateRoot, trackRoot, isTracked } = useKnowledge();
  const { recordSession } = useQuizProgressRecorder();
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  // Guards handleFinish against double-fire (fast double-click/tap, or a
  // second click landing before the disabled state re-renders): the ref
  // flips synchronously so a second invocation in the same tick still sees
  // it, unlike state. `isFinishing` mirrors it just to disable the button.
  const finishingRef = useRef(false);
  const [isFinishing, setIsFinishing] = useState(false);

  const questions = useMemo(
    () => generateRootQuiz(corpusData, root),
    [corpusData, root],
  );

  const [currentIndex, setCurrentIndex] = useState(0);
  const [finished, setFinished] = useState(false);
  const [selectedAnswers, setSelectedAnswers] = useState<Array<number | null>>([]);
  const [revealedAnswers, setRevealedAnswers] = useState<boolean[]>([]);

  useEffect(() => {
    setCurrentIndex(0);
    setFinished(false);
    setSelectedAnswers(questions.map(() => null));
    setRevealedAnswers(questions.map(() => false));
    finishingRef.current = false;
    setIsFinishing(false);
  }, [questions]);

  const goToIndex = useCallback((nextIndex: number) => {
    setCurrentIndex(Math.max(0, Math.min(nextIndex, questions.length - 1)));
  }, [questions.length]);

  const handleSelect = useCallback((index: number) => {
    setSelectedAnswers((current) => current.map((value, questionIndex) => (
      questionIndex === currentIndex ? index : value
    )));
  }, [currentIndex]);

  const handleSubmit = useCallback(() => {
    if (selectedAnswers[currentIndex] === null || revealedAnswers[currentIndex]) return;

    setRevealedAnswers((current) => current.map((value, questionIndex) => (
      questionIndex === currentIndex ? true : value
    )));
  }, [currentIndex, revealedAnswers, selectedAnswers]);

  const handleFinish = useCallback(async () => {
    // In-flight guard: a second click/tap before this settles (or before
    // the disabled-button re-render lands) must not run recordSession/
    // updateRoot twice.
    if (finishingRef.current) return;
    finishingRef.current = true;
    setIsFinishing(true);

    try {
      const reviewedRoots = extractQuizRoots(questions);
      const score = questions.reduce((total, question, index) => (
        revealedAnswers[index] && selectedAnswers[index] === question.correctIndex ? total + 1 : total
      ), 0);

      // updateRoot no-ops if `root` isn't tracked, so this is safe to call
      // unconditionally — mirrors ReviewQuiz's own finish handler.
      for (const reviewedRoot of reviewedRoots) {
        try {
          await updateRoot(reviewedRoot, { state: roots.get(reviewedRoot)?.state ?? "learning" });
        } catch {
          // Non-critical: quiz progress still completes.
        }
      }

      await recordSession({
        id: `study-root-${Date.now()}-${questions.map((question) => question.id).join("|")}`,
        sessionType: "study",
        score,
        total: questions.length,
        completedAt: Date.now(),
        reviewedRoots: reviewedRoots.length,
        usedTrackedRoots: reviewedRoots.some((reviewedRoot) => roots.has(reviewedRoot)),
      });
      setFinished(true);
    } finally {
      finishingRef.current = false;
      setIsFinishing(false);
    }
  }, [questions, recordSession, revealedAnswers, roots, selectedAnswers, updateRoot]);

  const handleTouchStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.changedTouches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  }, []);

  const handleTouchEnd = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    if (!start) return;

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    touchStartRef.current = null;

    if (Math.abs(deltaX) < 60 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) return;
    if (deltaX < 0) goToIndex(currentIndex + 1);
    else goToIndex(currentIndex - 1);
  }, [currentIndex, goToIndex]);

  if (finished) {
    const score = questions.reduce((total, question, index) => (
      revealedAnswers[index] && selectedAnswers[index] === question.correctIndex ? total + 1 : total
    ), 0);
    const tracked = isTracked(root);

    return (
      <div className="root-quiz-complete">
        <div className="root-quiz-complete-badge">{t("rootQuiz.badge")}</div>
        <h3 className="root-quiz-complete-title">{t("reviewComplete")}</h3>
        <p className="root-quiz-complete-score">
          {t("scoreDisplay", { score, total: questions.length })}
        </p>
        <p className="root-quiz-complete-root">
          <span lang="ar" dir="rtl">{root}</span>
        </p>
        {tracked ? (
          <p className="root-quiz-complete-tracked">
            <span aria-hidden="true">{"✓"}</span>
            {tMi("tracking")}
          </p>
        ) : (
          <button
            type="button"
            className="root-quiz-track-btn"
            onClick={() => {
              // Button state derives from `isTracked(root)` via context, so
              // there's no visual rollback needed on failure — just avoid an
              // unhandled promise rejection.
              void trackRoot(root).catch((error) => {
                console.warn("[RootQuiz] trackRoot failed", error);
              });
            }}
          >
            <span aria-hidden="true">{"+"}</span>
            {tMi("trackRoot")}
          </button>
        )}
        <style jsx>{`
          .root-quiz-complete {
            position: relative;
            overflow: hidden;
            text-align: center;
            padding: 32px 24px;
            max-width: 520px;
            margin: 0 auto;
            border: 1px solid rgba(17, 24, 39, 0.08);
            border-radius: 24px;
            background: var(--panel);
          }
          .root-quiz-complete::before {
            content: "";
            position: absolute;
            inset: 0 auto auto 0;
            width: 100%;
            height: 3px;
            background: linear-gradient(90deg, var(--accent), var(--accent-3), var(--accent-2));
          }
          .root-quiz-complete-badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-height: 2rem;
            padding: 0.35rem 0.8rem;
            margin-bottom: 14px;
            border-radius: 999px;
            border: 1px solid color-mix(in srgb, var(--accent-3), white 28%);
            background: color-mix(in srgb, var(--accent-3), transparent 88%);
            font-size: 0.74rem;
            font-weight: 700;
            letter-spacing: 0.1em;
            text-transform: uppercase;
          }
          .root-quiz-complete-title {
            font-size: 1.3rem;
            font-weight: 700;
            margin-bottom: 8px;
            color: var(--ink);
          }
          .root-quiz-complete-score {
            font-size: 1.1rem;
            font-weight: 600;
            color: var(--accent-3);
          }
          .root-quiz-complete-root {
            margin-top: 8px;
            font-size: 1.1rem;
            color: var(--ink-secondary);
          }
          .root-quiz-complete-tracked {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            margin-top: 18px;
            padding: 0.5rem 0.9rem;
            border-radius: 999px;
            background: var(--ui-success-bg);
            color: var(--ui-success-fg);
            font-size: 0.88rem;
            font-weight: 600;
          }
          .root-quiz-track-btn {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            margin-top: 18px;
            padding: 0.7rem 1.3rem;
            border: 1px solid color-mix(in srgb, var(--accent), white 18%);
            border-radius: 999px;
            background: color-mix(in srgb, var(--accent), black 6%);
            color: #fbf7f0;
            font-size: 0.92rem;
            font-weight: 600;
            cursor: pointer;
            box-shadow: 0 14px 28px color-mix(in srgb, var(--accent-glow), transparent 28%);
            transition: transform 0.15s ease, background 0.15s ease;
          }
          .root-quiz-track-btn:hover {
            transform: translateY(-1px);
            background: color-mix(in srgb, var(--accent), black 12%);
          }
          :global([data-theme="dark"] .root-quiz-complete) {
            background: var(--bg-1);
            border-color: rgba(255, 255, 255, 0.08);
          }
          :global([data-theme="dark"] .root-quiz-complete-badge) {
            color: var(--ink);
          }
          :global([data-theme="dark"] .root-quiz-complete-title) {
            color: var(--ink);
          }
          :global([data-theme="dark"] .root-quiz-complete-root) {
            color: rgba(226, 232, 240, 0.72);
          }
        `}</style>
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="quiz-empty-state" role="status">
        <strong className="quiz-empty-title">{t("rootQuiz.title", { root })}</strong>
        <p className="quiz-empty-copy">{t("rootQuizTooFew")}</p>
        <style jsx>{`
          .quiz-empty-state {
            max-width: 560px;
            margin: 0 auto;
            padding: 24px;
            border-radius: 20px;
            border: 1px dashed rgba(17, 24, 39, 0.14);
            background: rgba(255, 255, 255, 0.42);
            text-align: center;
          }
          .quiz-empty-title {
            display: block;
            margin-bottom: 0.35rem;
            font-size: 0.95rem;
            color: var(--ink);
          }
          .quiz-empty-copy {
            margin: 0;
            color: var(--ink-secondary);
            line-height: 1.55;
          }
          :global([data-theme="dark"] .quiz-empty-state) {
            background: rgba(255, 255, 255, 0.03);
            border-color: rgba(255, 255, 255, 0.1);
          }
          :global([data-theme="dark"] .quiz-empty-title) {
            color: var(--ink);
          }
          :global([data-theme="dark"] .quiz-empty-copy) {
            color: rgba(226, 232, 240, 0.76);
          }
        `}</style>
      </div>
    );
  }

  const question = questions[currentIndex];
  const answeredCount = revealedAnswers.filter(Boolean).length;
  const allAnswered = questions.length > 0 && answeredCount === questions.length;
  const selectedIndex = selectedAnswers[currentIndex] ?? null;
  const revealed = revealedAnswers[currentIndex] ?? false;
  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < questions.length - 1;

  return (
    <div className="root-quiz">
      <div className="root-quiz-progress">
        {questions.map((_, i) => (
          <button
            key={i}
            type="button"
            className={`root-quiz-dot ${i === currentIndex ? "active" : ""} ${revealedAnswers[i] ? "done" : ""}`}
            aria-label={t("questionOf", { current: i + 1, total: questions.length })}
            aria-current={i === currentIndex ? "step" : undefined}
            onClick={() => goToIndex(i)}
          />
        ))}
      </div>

      <div className="root-quiz-card-frame" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        <QuizCard
          question={question}
          questionNumber={currentIndex + 1}
          totalQuestions={questions.length}
          selectedIndex={selectedIndex}
          revealed={revealed}
          onSelect={handleSelect}
          onSubmit={handleSubmit}
        />
      </div>

      <div className="root-quiz-nav">
        <button type="button" className="root-quiz-nav-btn" onClick={() => goToIndex(currentIndex - 1)} disabled={!canGoPrev}>
          {t("previous")}
        </button>
        <p className="root-quiz-nav-hint">{t("swipeHint")}</p>
        <button type="button" className="root-quiz-nav-btn" onClick={() => goToIndex(currentIndex + 1)} disabled={!canGoNext}>
          {t("next")}
        </button>
      </div>

      {allAnswered ? (
        <div className="root-quiz-finish">
          <button type="button" className="root-quiz-next-btn" onClick={handleFinish} disabled={isFinishing}>
            {t("finish")}
          </button>
        </div>
      ) : null}

      <style jsx>{`
        .root-quiz {
          max-width: 760px;
          margin: 0 auto;
        }
        .root-quiz-progress {
          display: flex;
          gap: 10px;
          justify-content: center;
          margin-bottom: 18px;
        }
        .root-quiz-dot {
          width: 11px;
          height: 11px;
          border-radius: 50%;
          border: none;
          background: color-mix(in srgb, var(--ink) 25%, transparent);
          padding: 0;
          cursor: pointer;
          transition: background 0.2s, transform 0.2s ease;
        }
        .root-quiz-dot.active {
          background: var(--accent);
          transform: scale(1.15);
          box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent), transparent 85%);
        }
        .root-quiz-dot.done { background: var(--ui-success-fg); }
        .root-quiz-card-frame {
          touch-action: pan-y;
        }
        .root-quiz-nav {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          margin-top: 18px;
        }
        .root-quiz-nav-btn {
          min-width: 128px;
          padding: 0.78rem 1rem;
          border: 1px solid var(--line);
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.04);
          color: var(--ink);
          font-size: 0.92rem;
          font-weight: 600;
          cursor: pointer;
        }
        .root-quiz-nav-btn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .root-quiz-nav-hint {
          margin: 0;
          color: var(--ink-secondary);
          font-size: 0.84rem;
          text-align: center;
        }
        .root-quiz-finish {
          display: flex;
          justify-content: center;
          margin-top: 14px;
        }
        .root-quiz-next-btn {
          min-width: 180px;
          padding: 0.9rem 1.6rem;
          border: 1px solid color-mix(in srgb, var(--accent), white 18%);
          border-radius: 999px;
          background: color-mix(in srgb, var(--accent), black 6%);
          color: #fbf7f0;
          font-size: 0.96rem;
          font-weight: 600;
          cursor: pointer;
          box-shadow: 0 14px 28px color-mix(in srgb, var(--accent-glow), transparent 28%);
        }
        .root-quiz-next-btn:hover {
          background: color-mix(in srgb, var(--accent), black 12%);
        }
        .root-quiz-next-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        :global([data-theme="dark"] .root-quiz-nav-btn) {
          background: rgba(255, 255, 255, 0.03);
          border-color: rgba(255, 255, 255, 0.08);
          color: var(--ink);
        }
        :global([data-theme="dark"] .root-quiz-nav-hint) {
          color: rgba(226, 232, 240, 0.72);
        }
        @media (max-width: 720px) {
          .root-quiz-nav {
            flex-wrap: wrap;
            justify-content: center;
          }
          .root-quiz-nav-hint {
            order: 3;
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
}
