"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  MAX_ROOTS,
  suggestRoots,
  type ConcordancePayload,
  type ConcordanceRoot,
  type MeetIn,
  type RingOrder,
} from "@/lib/corpus/concordanceClient";
import type { View } from "@/lib/viz/concordance/geometry";

/** Recurring phrases from the spec, as one-click presets. */
export const PRESETS: { key: string; roots: string[] }[] = [
  { key: "creationOfHeavensEarth", roots: ["خلق", "سمو", "ارض"] },
  { key: "believeAndDoGood", roots: ["امن", "عمل", "صلح"] },
  { key: "gardensRivers", roots: ["جنن", "جري", "نهر"] },
  { key: "waterFromSky", roots: ["نزل", "سمو", "موه"] },
  { key: "forgivingMerciful", roots: ["غفر", "رحم"] },
  { key: "worldlyLife", roots: ["حيي", "دنو"] },
  { key: "painfulPunishment", roots: ["عذب", "الم"] },
  { key: "sunAndMoon", roots: ["شمس", "قمر"] },
];

export interface Toggles {
  threads: boolean;
  tint: boolean;
  histogram: boolean;
}

interface Props {
  payload: ConcordancePayload | null;
  roots: ConcordanceRoot[];
  meetIn: MeetIn;
  view: View;
  order: RingOrder;
  toggles: Toggles;
  aligned: boolean;
  onAddRoot: (root: ConcordanceRoot) => void;
  onRemoveRoot: (index: number) => void;
  onPreset: (roots: string[]) => void;
  onMeetIn: (m: MeetIn) => void;
  onView: (v: View) => void;
  onOrder: (o: RingOrder) => void;
  onToggle: (key: keyof Toggles) => void;
  onAlign: () => void;
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className={options.length > 3 ? "cr-seg is-grid" : "cr-seg"} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? "is-on" : undefined}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function ConcordanceControls(p: Props) {
  const t = useTranslations("Visualizations.ConcordanceRings");
  const [query, setQuery] = useState("");
  const suggestions = useMemo(
    () => (p.payload && query.trim() ? suggestRoots(p.payload, query, 6) : []),
    [p.payload, query],
  );
  const chosen = p.roots.map((r) => r.bare).join(" ");

  return (
    <div className="cr-panel">
      <section className="cr-card">
        <h3>{t("rootsLabel")}</h3>
        <ul className="cr-chosen">
          {p.roots.map((r, i) => (
            <li key={r.bare}>
              <i className="cr-dot" style={{ background: `var(--viz-root-${i + 1})` }} aria-hidden="true" />
              <span className="cr-root" dir="rtl" lang="ar">{r.bare}</span>
              <span className="cr-meta">
                {r.gloss ? <span dir="ltr">{r.gloss}</span> : null}
                <span className="cr-count">{t("occurrences", { n: r.count })}</span>
              </span>
              <button type="button" className="cr-x" aria-label={t("removeRoot", { root: r.bare })} onClick={() => p.onRemoveRoot(i)}>
                ×
              </button>
            </li>
          ))}
        </ul>
        {p.roots.length < MAX_ROOTS ? (
          <div className="cr-add">
            <input
              className="cr-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && suggestions[0]) {
                  p.onAddRoot(suggestions[0]);
                  setQuery("");
                }
              }}
              placeholder={t("rootPlaceholder")}
              aria-label={t("rootPlaceholder")}
              spellCheck={false}
              autoComplete="off"
            />
            {suggestions.length ? (
              <ul className="cr-suggest" role="listbox" aria-label={t("rootPlaceholder")}>
                {suggestions.map((r) => (
                  <li key={r.bare}>
                    <button
                      type="button"
                      onClick={() => {
                        p.onAddRoot(r);
                        setQuery("");
                      }}
                    >
                      <span className="cr-root" dir="rtl" lang="ar">{r.bare}</span>
                      <span className="cr-meta" dir="ltr">{r.gloss ?? r.bw}</span>
                      <span className="cr-count">{r.count}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="cr-card">
        <h3>{t("presetsLabel")}</h3>
        <ul className="cr-presets">
          {PRESETS.map((pr) => (
            <li key={pr.key}>
              <button
                type="button"
                dir="rtl"
                lang="ar"
                aria-pressed={pr.roots.join(" ") === chosen}
                className={pr.roots.join(" ") === chosen ? "is-on" : undefined}
                onClick={() => p.onPreset(pr.roots)}
              >
                {t(`presets.${pr.key}` as "presets.sunAndMoon")}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="cr-card">
        <h3>{t("meetInLabel")}</h3>
        <Segmented
          label={t("meetInLabel")}
          value={p.meetIn}
          onChange={p.onMeetIn}
          options={[
            { value: "ayah", label: t("meetIn.ayah") },
            { value: "surah", label: t("meetIn.surah") },
          ]}
        />

        <h3>{t("viewLabel")}</h3>
        <Segmented
          label={t("viewLabel")}
          value={p.view}
          onChange={p.onView}
          options={[
            { value: "stacked", label: t("view.stacked") },
            { value: "all", label: t("view.all") },
            { value: "overlaid", label: t("view.overlaid") },
          ]}
        />

        <h3>{t("orderLabel")}</h3>
        <Segmented
          label={t("orderLabel")}
          value={p.order}
          onChange={p.onOrder}
          options={[
            { value: "mushaf", label: t("order.mushaf") },
            { value: "length", label: t("order.length") },
            { value: "meetings", label: t("order.meetings") },
            { value: "firstMeeting", label: t("order.firstMeeting") },
          ]}
        />

        <div className="cr-switches">
          {(["threads", "tint", "histogram"] as (keyof Toggles)[]).map((key) => (
            <button
              key={key}
              type="button"
              role="switch"
              aria-checked={p.toggles[key]}
              className="cr-switch"
              disabled={p.view === "overlaid"}
              onClick={() => p.onToggle(key)}
            >
              <i aria-hidden="true" />
              {t(`toggle.${key}` as "toggle.threads")}
            </button>
          ))}
        </div>

        <button type="button" className="cr-align" onClick={p.onAlign} disabled={p.view === "overlaid"}>
          {p.aligned ? t("resetRotation") : t("alignFirstMeeting")}
        </button>
      </section>
    </div>
  );
}
