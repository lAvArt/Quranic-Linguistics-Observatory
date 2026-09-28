"use client";

import { useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { VIZ_EXPLAINERS } from "@/lib/config/vizExplainers";
import type { VisualizationMode } from "@/lib/schema/visualizationTypes";
import ConcordanceAnatomy from "./ConcordanceAnatomy";

const FIGURES = {
  "concordance-anatomy": ConcordanceAnatomy,
} as const;

interface VizExplainerProps {
  vizMode: VisualizationMode;
}

/**
 * Collapsible "What am I seeing?" panel placed below the graph toolbar.
 * Content is driven by the centralized vizExplainers config.
 * Available to all users (not just first-run).
 */
export default function VizExplainer({ vizMode }: VizExplainerProps) {
  // Defaults to expanded: this panel is the single home for "how to read
  // this view" (the old floating intro card is gone), so the Explain tab
  // must never land as a lone collapsed header in an empty column.
  const [isOpen, setIsOpen] = useState(true);
  const t = useTranslations("VizExplainer");
  const explainer = VIZ_EXPLAINERS[vizMode];

  if (!explainer) return null;
  const Figure = explainer.figure ? FIGURES[explainer.figure] : null;
  const readKeys = explainer.readKeys ?? [];

  return (
    <div className="viz-explainer-panel" data-open={isOpen}>
      <button
        type="button"
        className="viz-explainer-toggle"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-controls="viz-explainer-content"
      >
        <span className="viz-explainer-icon" aria-hidden="true">i</span>
        <span>{t("helpLabel")}</span>
      </button>

      {isOpen && (
        <div
          id="viz-explainer-content"
          className="viz-explainer-body"
          role="region"
          aria-label={t("helpLabel")}
        >
          <p className="viz-explainer-summary">
            {t(explainer.summaryKey)}
          </p>

          {Figure ? <Figure /> : null}

          <div className="viz-explainer-legend">
            {explainer.legend.map((item, i) => (
              <div
                key={i}
                className="viz-explainer-legend-item"
                style={{ "--viz-explainer-accent": item.color } as CSSProperties}
              >
                <span
                  className={`viz-explainer-swatch viz-explainer-swatch--${item.shape}`}
                  aria-hidden="true"
                />
                <span className="viz-explainer-legend-label">{t(item.labelKey)}</span>
              </div>
            ))}
          </div>

          {/* A view with reading notes gets two headed sections — reading the
              picture, then working the controls; the rest keep one hint list. */}
          {readKeys.length ? (
            <>
              <h4 className="viz-explainer-heading">{t("readHeading")}</h4>
              <ul className="viz-explainer-read">
                {readKeys.map((key) => (
                  <li key={key}>{t(key)}</li>
                ))}
              </ul>
              <h4 className="viz-explainer-heading">{t("useHeading")}</h4>
            </>
          ) : null}

          <ul className="viz-explainer-hints">
            {explainer.hintKeys.map((hintKey) => (
              <li key={hintKey}>{t(hintKey)}</li>
            ))}
          </ul>

          <p className="viz-explainer-purpose">
            {t(explainer.purposeKey)}
          </p>
        </div>
      )}

      <style jsx>{`
        .viz-explainer-panel {
          display: grid;
          gap: 12px;
        }

        .viz-explainer-toggle {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          width: fit-content;
          max-width: 100%;
          padding: 0;
          border: 0;
          background: transparent;
          color: var(--ink);
          font: inherit;
          font-weight: 700;
          letter-spacing: -0.01em;
          cursor: pointer;
          transition: transform 0.18s ease, color 0.18s ease;
        }

        .viz-explainer-toggle:hover,
        .viz-explainer-toggle:focus-visible {
          color: var(--accent);
        }

        .viz-explainer-toggle:focus-visible {
          outline: none;
        }

        .viz-explainer-icon {
          display: inline-grid;
          place-items: center;
          width: 30px;
          height: 30px;
          border-radius: 10px;
          background: rgba(255, 179, 64, 0.16);
          border: 1px solid rgba(255, 179, 64, 0.28);
          color: #ffd399;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.08),
            0 10px 24px rgba(255, 179, 64, 0.12);
          font-weight: 800;
        }

        .viz-explainer-body {
          display: grid;
          gap: 14px;
          animation: viz-explainer-reveal 180ms cubic-bezier(0.16, 1, 0.3, 1);
        }

        .viz-explainer-summary,
        .viz-explainer-purpose {
          margin: 0;
        }

        .viz-explainer-summary {
          padding: 16px 18px;
          border-radius: 18px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(255, 179, 64, 0.08);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
          font-size: 1.04rem;
          line-height: 1.5;
          font-weight: 650;
        }

        .viz-explainer-legend {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: 10px;
        }

        .viz-explainer-legend-item {
          --viz-explainer-accent: var(--ink-muted);
          position: relative;
          display: flex;
          align-items: center;
          gap: 12px;
          min-height: 54px;
          padding: 12px 14px;
          border-radius: 16px;
          border: 1px solid color-mix(in srgb, var(--viz-explainer-accent) 38%, rgba(255, 255, 255, 0.08));
          background: color-mix(in srgb, var(--viz-explainer-accent) 12%, rgba(255, 255, 255, 0.025));
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.04);
        }

        .viz-explainer-swatch {
          position: relative;
          z-index: 1;
          flex: 0 0 auto;
          width: 14px;
          height: 14px;
          border-radius: 999px;
          background: var(--viz-explainer-accent);
          box-shadow:
            0 0 0 4px color-mix(in srgb, var(--viz-explainer-accent) 16%, transparent),
            0 0 18px color-mix(in srgb, var(--viz-explainer-accent) 34%, transparent);
        }

        .viz-explainer-swatch--rect {
          border-radius: 4px;
        }

        .viz-explainer-swatch--line {
          width: 22px;
          height: 3px;
          border-radius: 999px;
        }

        .viz-explainer-swatch--arc {
          width: 18px;
          height: 18px;
          background: transparent;
          border: 3px solid var(--viz-explainer-accent);
          border-right-color: transparent;
          border-bottom-color: transparent;
          box-shadow: none;
          transform: rotate(-35deg);
        }

        .viz-explainer-legend-label {
          position: relative;
          z-index: 1;
          font-size: 0.92rem;
          line-height: 1.3;
          font-weight: 700;
          color: color-mix(in srgb, var(--viz-explainer-accent) 72%, white 28%);
          text-wrap: balance;
        }

        .viz-explainer-heading {
          margin: 6px 0 -4px;
          font-size: 0.8rem;
          font-weight: 700;
          color: var(--ink-muted);
        }

        .viz-explainer-read {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: 9px;
        }

        .viz-explainer-read li {
          position: relative;
          padding-inline-start: 16px;
          color: var(--ink-secondary);
          line-height: 1.5;
        }

        .viz-explainer-read li::before {
          content: "";
          position: absolute;
          inset-inline-start: 2px;
          top: 0.62em;
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: rgba(255, 179, 64, 0.7);
        }

        .viz-explainer-hints {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: 10px;
          counter-reset: explainer-step;
        }

        .viz-explainer-hints li {
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 12px;
          align-items: start;
          padding: 11px 13px;
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.06);
          background: rgba(255, 255, 255, 0.025);
          color: var(--ink-secondary);
          line-height: 1.45;
        }

        .viz-explainer-hints li::before {
          counter-increment: explainer-step;
          content: counter(explainer-step);
          display: inline-grid;
          place-items: center;
          width: 1.55rem;
          height: 1.55rem;
          border-radius: 999px;
          background: rgba(255, 179, 64, 0.12);
          border: 1px solid rgba(255, 179, 64, 0.24);
          color: #ffbe67;
          font-size: 0.78rem;
          font-weight: 800;
          line-height: 1;
        }

        .viz-explainer-purpose {
          padding: 14px 16px 14px 18px;
          border-inline-start: 3px solid rgba(255, 179, 64, 0.52);
          border-radius: 0 16px 16px 0;
          background: rgba(255, 179, 64, 0.08);
          color: var(--ink);
          line-height: 1.5;
          font-weight: 600;
        }

        :global([data-theme="light"]) .viz-explainer-summary {
          border-color: rgba(15, 23, 42, 0.1);
          background: rgba(245, 158, 11, 0.1);
        }

        :global([data-theme="light"]) .viz-explainer-legend-item,
        :global([data-theme="light"]) .viz-explainer-hints li {
          border-color: rgba(15, 23, 42, 0.08);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.52);
        }

        :global([data-theme="light"]) .viz-explainer-purpose {
          background: rgba(245, 158, 11, 0.1);
        }

        @keyframes viz-explainer-reveal {
          from {
            opacity: 0;
            transform: translateY(-4px);
          }

          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
