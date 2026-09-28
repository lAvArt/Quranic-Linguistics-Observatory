"use client";

import { useTranslations } from "next-intl";
import type { LexicalColorMode } from "@/lib/theme/lexicalColoring";

interface LexicalColorSwitchProps {
  mode: LexicalColorMode;
  onChange: (mode: LexicalColorMode) => void;
}

/** Short segment labels; the full descriptive label is the tooltip/aria-label. */
const MODES: { id: LexicalColorMode; short: string }[] = [
  { id: "theme", short: "POS" },
  { id: "frequency", short: "Freq" },
  { id: "identity", short: "Root" },
];

/**
 * Surfaced color-encoding switch — the three analytical lenses (by part of
 * speech / by root frequency / by root family) that recolor the graph. Lives
 * in the graph toolbar so the encoding is one click away, not buried in ⚙.
 */
export default function LexicalColorSwitch({ mode, onChange }: LexicalColorSwitchProps) {
  const t = useTranslations("DisplaySettings");

  return (
    <div className="lex-switch" role="group" aria-label={t("coloring.title")}>
      <span className="lex-switch-dots" aria-hidden="true">
        {/* Three hues of the data spectrum (CATEGORY_COLORS) — the old app's
            blue / green / pink before. */}
        <i style={{ background: "#e8924a" }} />
        <i style={{ background: "#56a697" }} />
        <i style={{ background: "#d06a86" }} />
      </span>
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          className={`lex-switch-btn ${mode === m.id ? "active" : ""}`}
          onClick={() => onChange(m.id)}
          title={t(`coloring.options.${m.id}`)}
          aria-label={t(`coloring.options.${m.id}`)}
          aria-pressed={mode === m.id}
        >
          {m.short}
        </button>
      ))}

      <style jsx>{`
        .lex-switch {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 5px 3px 7px;
          border-radius: var(--radius-pill);
          border: 1px solid var(--line);
          background: color-mix(in srgb, var(--bg-2, rgba(255, 255, 255, 0.04)) 60%, transparent);
          flex-shrink: 0;
        }

        .lex-switch-dots {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          margin-inline-end: 2px;
        }

        .lex-switch-dots i {
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }

        .lex-switch-btn {
          border: none;
          background: transparent;
          color: var(--ink-muted);
          font-family: inherit;
          font-size: 0.68rem;
          font-weight: 600;
          letter-spacing: 0.02em;
          padding: 3px 8px;
          border-radius: var(--radius-pill);
          cursor: pointer;
          transition: color 0.15s ease, background 0.15s ease;
          white-space: nowrap;
        }

        .lex-switch-btn:hover {
          color: var(--ink);
        }

        /* Quiet active state (matches the rail): reserved selection tint, not a
           saturated accent fill — accent stays for data. */
        .lex-switch-btn.active {
          background: color-mix(in srgb, var(--selection) 14%, transparent);
          color: var(--selection);
        }

        .lex-switch-btn:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 1px;
        }

        @media (max-width: 980px) {
          .lex-switch {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}
