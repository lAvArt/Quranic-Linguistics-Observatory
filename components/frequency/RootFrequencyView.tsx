import { Fragment } from "react";
import { getTranslations } from "next-intl/server";
import AppWorkspaceShell from "@/components/ui/AppWorkspaceShell";
import { resolveGloss } from "@/lib/data/rootGloss";
import { ROOT_FREQUENCY, tierOf, type RootFrequencyReport } from "@/lib/data/rootFrequency";

/**
 * The root-frequency page: what the corpus counts say, and nothing about why.
 *
 * Deliberately descriptive. Every heading and caption states an observation —
 * "these roots occur most often", "these land on the same count" — and stops
 * there. No distribution names, no model fits, no causal framing. If a future
 * change wants to explain the shape, that is a different page.
 *
 * A Server Component on purpose: the 138 KB of aggregates stay on the server
 * and only rendered HTML ships. The "Top N" filter is therefore CSS-only —
 * hidden radios plus `:has()` — rather than React state, which would force the
 * whole table into the client bundle. Charts are static inline SVG for the
 * same reason.
 */

/** Charts are numeric; they stay ltr in both locales rather than mirroring. */
const CHART_DIR = "ltr" as const;

export default async function RootFrequencyView({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: "Frequency" });
  const d: RootFrequencyReport = ROOT_FREQUENCY;

  const nf = new Intl.NumberFormat(locale);
  const n = (v: number) => nf.format(v);
  const pct = (v: number, digits = 1) =>
    new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v);
  const times = (v: number) => t("times", { n: n(v) });

  const peak = d.leaderboard[0].count;

  // Controls: cumulative "Top N" up to 100, then fixed pages of 100 beyond it.
  // A 400-row dump past rank 100 is unreadable, and every row is in the HTML
  // either way — paging is what makes the tail usable without client JS.
  const PAGE_SIZE = 100;
  const cuts = d.tiers.filter((tier) => tier.hi <= PAGE_SIZE);
  const pageCount = Math.ceil(d.leaderboard.length / PAGE_SIZE);
  const pages = Array.from({ length: pageCount - 1 }, (_, i) => {
    const page = i + 2;
    return { page, lo: (page - 1) * PAGE_SIZE + 1, hi: Math.min(page * PAGE_SIZE, d.leaderboard.length) };
  });
  const pageOf = (rank: number) => Math.ceil(rank / PAGE_SIZE);

  return (
    <AppWorkspaceShell
      kicker={t("kicker")}
      title={t("title")}
      description={t("subtitle", { roots: n(d.totals.roots), words: n(d.totals.words) })}
      panelWidth="wide"
    >
      {/* ── Overview ──────────────────────────────────────────────────── */}
      <section className="fq-section" aria-labelledby="fq-overview">
        <h2 className="fq-h2" id="fq-overview">{t("overviewHeading")}</h2>
        <div className="fq-kpis">
          <div className="fq-kpi fq-kpi--accent">
            <b>{n(d.totals.roots)}</b>
            <span>{t("statRoots")}</span>
          </div>
          <div className="fq-kpi">
            <b>{n(d.totals.words)}</b>
            <span>{t("statWords")}</span>
          </div>
          <div className="fq-kpi fq-kpi--alt">
            <b>{times(d.totals.median)}</b>
            <span>{t("statMedian", { mean: n(Math.round(d.totals.mean * 10) / 10) })}</span>
          </div>
          <div className="fq-kpi">
            <b>{n(d.totals.hapax)}</b>
            <span>{t("statOnce")}</span>
          </div>
        </div>

        <div className="fq-card fq-card--table">
          <table className="fq-table">
            <caption className="fq-sr">{t("tiersHeading")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("colTier")}</th>
                <th scope="col" className="fq-num">{t("colRanks")}</th>
                <th scope="col" className="fq-num">{t("colWords")}</th>
                <th scope="col" className="fq-num">{t("colShare")}</th>
                <th scope="col" className="fq-num">{t("colCounts")}</th>
              </tr>
            </thead>
            <tbody>
              {d.tiers.map((tier, i) => (
                <tr key={tier.hi}>
                  <th scope="row" className="fq-tier-name">{t(`tier${i + 1}` as "tier1")}</th>
                  <td className="fq-num fq-dim" dir={CHART_DIR}>{n(tier.lo)}–{n(tier.hi)}</td>
                  <td className="fq-num">{n(tier.words)}</td>
                  <td className="fq-num">{pct(tier.share)}</td>
                  <td className="fq-num fq-dim">{t("floorAndUp", { n: n(tier.floor) })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Leaderboard ───────────────────────────────────────────────── */}
      <section className="fq-section" aria-labelledby="fq-board">
        <h2 className="fq-h2" id="fq-board">{t("boardHeading")}</h2>
        <p className="fq-lede">{t("boardLede")}</p>

        <div className="fq-board">
          <fieldset className="fq-cuts">
            <legend className="fq-sr">{t("cutsLegend")}</legend>
            {cuts.map((tier, i) => (
              <span className="fq-cut-opt" key={tier.hi}>
                <input
                  type="radio"
                  name="fq-cut"
                  id={`fq-cut-${tier.hi}`}
                  className="fq-cut"
                  defaultChecked={i === 0}
                />
                <label htmlFor={`fq-cut-${tier.hi}`}>{t("cut", { n: n(tier.hi) })}</label>
              </span>
            ))}
            <span className="fq-cut-div" aria-hidden="true" />
            {pages.map((pg) => (
              <span className="fq-cut-opt" key={pg.page}>
                <input type="radio" name="fq-cut" id={`fq-page-${pg.page}`} className="fq-cut" />
                <label htmlFor={`fq-page-${pg.page}`} dir={CHART_DIR}>
                  {t("pageRange", { lo: n(pg.lo), hi: n(pg.hi) })}
                </label>
              </span>
            ))}
          </fieldset>

          <div className="fq-card fq-card--table fq-board-table">
            <table className="fq-table fq-table--board">
              <caption className="fq-sr">{t("boardHeading")}</caption>
              <thead>
                <tr>
                  <th scope="col" className="fq-num">{t("colRank")}</th>
                  <th scope="col">{t("colRoot")}</th>
                  <th scope="col" className="fq-hide-sm" />
                  <th scope="col">{t("colGloss")}</th>
                  <th scope="col" className="fq-num">{t("colCount")}</th>
                  <th scope="col" className="fq-num fq-hide-sm">{t("colSurahs")}</th>
                  <th scope="col" className="fq-num fq-hide-sm">{t("colVerses")}</th>
                  <th scope="col" className="fq-hide-sm" />
                  <th scope="col" className="fq-num">{t("colCum")}</th>
                </tr>
              </thead>
              <tbody>
                {d.leaderboard.map((row) => {
                  const tierIndex = tierOf(row.rank, d.tiers);
                  const pageClass = `fq-r${tierIndex} fq-p${pageOf(row.rank)}`;
                  const tier = d.tiers.find((x) => x.lo === row.rank);
                  const gloss = resolveGloss(locale, row.bare, row.gloss);
                  return (
                    <Fragment key={row.bare}>
                      {tier ? (
                        <tr className={`fq-sep ${pageClass}`}>
                          <td colSpan={9}>
                            {t(`tier${tierIndex}` as "tier1")}
                            <span>
                              {" · "}
                              {t("tierRange", { lo: n(tier.lo), hi: n(tier.hi), share: pct(tier.share) })}
                            </span>
                          </td>
                        </tr>
                      ) : null}
                      <tr className={pageClass}>
                        <td className="fq-num fq-dim">{n(row.rank)}</td>
                        <td className="fq-root" dir="rtl" lang="ar">{row.bare}</td>
                        <td className="fq-translit fq-hide-sm" dir={CHART_DIR}>{row.translit}</td>
                        <td className="fq-gloss">
                          {gloss ? (
                            <span dir={gloss.isAr ? "rtl" : "ltr"} lang={gloss.isAr ? "ar" : "en"}>
                              {gloss.text}
                            </span>
                          ) : (
                            <span className="fq-dim">{t("noGloss")}</span>
                          )}
                        </td>
                        <td className="fq-num">{n(row.count)}</td>
                        <td className="fq-num fq-dim fq-hide-sm">{n(row.surahs)}</td>
                        <td className="fq-num fq-dim fq-hide-sm">{n(row.verses)}</td>
                        <td className="fq-barcell fq-hide-sm">
                          <span className="fq-bar" style={{ width: `${((row.count / peak) * 100).toFixed(2)}%` }} />
                        </td>
                        <td className="fq-num fq-dim">{pct(row.cumShare)}</td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Coverage ──────────────────────────────────────────────────── */}
      <section className="fq-section" aria-labelledby="fq-coverage">
        <h2 className="fq-h2" id="fq-coverage">{t("coverageHeading")}</h2>
        <p className="fq-lede">{t("coverageLede")}</p>
        <div className="fq-card">
          <ul className="fq-ladder">
            {d.coverage.map((c) => (
              <li key={c.rank}>
                <span className="fq-ladder-rank">{t("cut", { n: n(c.rank) })}</span>
                <span className="fq-ladder-track">
                  <i style={{ width: `${(100 * c.share).toFixed(2)}%` }} />
                </span>
                <span className="fq-ladder-pct">{pct(c.share)}</span>
                <span className="fq-ladder-note">{t("atLeast", { n: n(c.minCount) })}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Ranked counts ─────────────────────────────────────────────── */}
      <section className="fq-section" aria-labelledby="fq-curve">
        <h2 className="fq-h2" id="fq-curve">{t("curveHeading")}</h2>
        <p className="fq-lede">{t("curveLede")}</p>
        <div className="fq-card">
          <div className="fq-chart" dir={CHART_DIR}>
            <RankChart rows={d.leaderboard} label={t("curveAlt")} axis={t("curveAxis")} fmt={n} />
          </div>
        </div>
      </section>

      {/* ── Frequency bands ───────────────────────────────────────────── */}
      <section className="fq-section" aria-labelledby="fq-bands">
        <h2 className="fq-h2" id="fq-bands">{t("bandsHeading")}</h2>
        <p className="fq-lede">{t("bandsLede")}</p>
        <div className="fq-card">
          <div className="fq-chart" dir={CHART_DIR}>
            <BandsChart
              buckets={d.buckets}
              totals={d.totals}
              label={t("bandsAlt")}
              axis={t("bandsAxis")}
              fmt={n}
              pctFmt={pct}
            />
          </div>
          <ul className="fq-legend">
            <li><i className="fq-swatch fq-swatch--alt" />{t("legendRoots")}</li>
            <li><i className="fq-swatch fq-swatch--accent" />{t("legendWords")}</li>
          </ul>
        </div>
      </section>

      {/* ── Shared counts ─────────────────────────────────────────────── */}
      <section className="fq-section" aria-labelledby="fq-shared">
        <h2 className="fq-h2" id="fq-shared">{t("sharedHeading")}</h2>
        <p className="fq-lede">{t("sharedLede")}</p>
        <div className="fq-bands">
          {d.bands.map((band) => (
            <div className={`fq-card fq-band ${band.focus ? "is-focus" : ""}`} key={`${band.lo}-${band.hi}`}>
              <header>
                <b dir={CHART_DIR}>{n(band.lo)}–{times(band.hi)}</b>
                <span>{t("bandMembers", { n: n(band.members.length) })}</span>
              </header>
              <ul>
                {band.members.map((m) => {
                  const gloss = resolveGloss(locale, m.bare, m.gloss);
                  return (
                    <li key={m.bare}>
                      <span className="fq-root" dir="rtl" lang="ar">{m.bare}</span>
                      <span className="fq-band-n">{times(m.count)}</span>
                      <span className="fq-band-g">
                        {gloss ? (
                          <span dir={gloss.isAr ? "rtl" : "ltr"} lang={gloss.isAr ? "ar" : "en"}>{gloss.text}</span>
                        ) : (
                          t("noGloss")
                        )}
                      </span>
                      <span className="fq-band-s">{t("inSurahs", { n: n(m.surahs) })}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        <h3 className="fq-h3">{t("tiesHeading")}</h3>
        <p className="fq-lede">{t("tiesLede")}</p>
        <ul className="fq-ties">
          {d.ties.slice(0, 8).map((tie) => (
            <li className="fq-tie" key={tie.count}>
              <b>{times(tie.count)}</b>
              <span className="fq-tie-n">{t("tieRoots", { n: n(tie.n) })}</span>
              <span className="fq-tie-m" dir="rtl" lang="ar">
                {tie.members.map((m) => (
                  <i key={m.bare} className="fq-root">{m.bare}</i>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Reach ─────────────────────────────────────────────────────── */}
      <section className="fq-section" aria-labelledby="fq-reach">
        <h2 className="fq-h2" id="fq-reach">{t("reachHeading")}</h2>
        <p className="fq-lede">{t("reachLede")}</p>
        <div className="fq-card">
          <div className="fq-chart" dir={CHART_DIR}>
            <ReachChart points={d.scatter} peak={peak} label={t("reachAlt")} axis={t("reachAxis")} fmt={n} />
          </div>
          <ul className="fq-legend">
            <li><i className="fq-swatch fq-swatch--alt" />{t("legendSpread")}</li>
            <li><i className="fq-swatch fq-swatch--accent" />{t("legendConcentrated")}</li>
          </ul>
        </div>
      </section>

      {/* Method note only. The Kais Dukes / Quranic Arabic Corpus credit is a
          standing rule on every page, but AppWorkspaceShell already renders
          the site footer that carries it — repeating it here would print the
          same attribution twice within one screen. */}
      <p className="fq-source">{t("source")}</p>
    </AppWorkspaceShell>
  );
}

/* ─── Charts ──────────────────────────────────────────────────────────────
   Static inline SVG. Every mark carries a <title> so the values are
   reachable by pointer and by screen reader without any client JS. */

const W = 720;

function RankChart({
  rows,
  label,
  axis,
  fmt,
}: {
  rows: RootFrequencyReport["leaderboard"];
  label: string;
  axis: string;
  fmt: (v: number) => string;
}) {
  const H = 360;
  const m = { t: 16, r: 16, b: 40, l: 54 };
  const maxRank = Math.log10(rows.length);
  const maxCount = Math.log10(rows[0].count);
  const x = (rank: number) => m.l + (Math.log10(rank) / maxRank) * (W - m.l - m.r);
  const y = (count: number) => H - m.b - (Math.log10(count) / maxCount) * (H - m.t - m.b);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="fq-svg">
      <line x1={m.l} y1={H - m.b} x2={W - m.r} y2={H - m.b} className="fq-axis" />
      <line x1={m.l} y1={m.t} x2={m.l} y2={H - m.b} className="fq-axis" />
      {[1, 10, 100, 500].map((v) => (
        <g key={v} className="fq-tick">
          <line x1={x(v)} y1={H - m.b} x2={x(v)} y2={H - m.b + 5} />
          <text x={x(v)} y={H - m.b + 18} textAnchor="middle">{fmt(v)}</text>
        </g>
      ))}
      {[10, 100, 1000].map((v) => (
        <g key={v} className="fq-tick">
          <line x1={m.l - 5} y1={y(v)} x2={m.l} y2={y(v)} />
          <text x={m.l - 9} y={y(v) + 4} textAnchor="end">{fmt(v)}</text>
        </g>
      ))}
      {rows.map((r) => (
        <circle key={r.bare} cx={x(r.rank).toFixed(1)} cy={y(r.count).toFixed(1)} r={1.7} className="fq-dot">
          <title>{`${r.bare} — #${fmt(r.rank)} · ${fmt(r.count)}`}</title>
        </circle>
      ))}
      <text x={W / 2} y={H - 4} textAnchor="middle" className="fq-axis-label">{axis}</text>
    </svg>
  );
}

function BandsChart({
  buckets,
  totals,
  label,
  axis,
  fmt,
  pctFmt,
}: {
  buckets: RootFrequencyReport["buckets"];
  totals: RootFrequencyReport["totals"];
  label: string;
  axis: string;
  fmt: (v: number) => string;
  pctFmt: (v: number, d?: number) => string;
}) {
  const H = 264;
  const m = { t: 14, r: 14, b: 48, l: 48 };
  const max = Math.max(...buckets.map((b) => Math.max(b.roots / totals.roots, b.words / totals.words)));
  const slot = (W - m.l - m.r) / buckets.length;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="fq-svg">
      <line x1={m.l} y1={H - m.b} x2={W - m.r} y2={H - m.b} className="fq-axis" />
      {buckets.map((b, i) => {
        const left = m.l + i * slot;
        const hRoots = ((b.roots / totals.roots) / max) * (H - m.t - m.b);
        const hWords = ((b.words / totals.words) / max) * (H - m.t - m.b);
        const tick = b.hi === null ? `${fmt(b.lo)}+` : b.lo === b.hi ? fmt(b.lo) : `${fmt(b.lo)}–${fmt(b.hi)}`;
        return (
          <g key={b.lo}>
            <rect
              x={(left + slot * 0.12).toFixed(1)}
              y={(H - m.b - hRoots).toFixed(1)}
              width={(slot * 0.34).toFixed(1)}
              height={hRoots.toFixed(1)}
              className="fq-bar-alt"
            />
            <rect
              x={(left + slot * 0.5).toFixed(1)}
              y={(H - m.b - hWords).toFixed(1)}
              width={(slot * 0.34).toFixed(1)}
              height={hWords.toFixed(1)}
              className="fq-bar-accent"
            />
            <text x={(left + slot / 2).toFixed(1)} y={H - m.b + 16} textAnchor="middle" className="fq-tick-sm">
              {tick}
            </text>
            <title>{`${tick} · ${fmt(b.roots)} / ${pctFmt(b.roots / totals.roots)} · ${fmt(b.words)} / ${pctFmt(b.words / totals.words)}`}</title>
          </g>
        );
      })}
      <text x={W / 2} y={H - 6} textAnchor="middle" className="fq-axis-label">{axis}</text>
    </svg>
  );
}

function ReachChart({
  points,
  peak,
  label,
  axis,
  fmt,
}: {
  points: RootFrequencyReport["scatter"];
  peak: number;
  label: string;
  axis: string;
  fmt: (v: number) => string;
}) {
  const H = 340;
  const m = { t: 16, r: 16, b: 44, l: 54 };
  const lo = Math.log10(20);
  const hi = Math.log10(peak);
  const x = (count: number) => m.l + ((Math.log10(count) - lo) / (hi - lo)) * (W - m.l - m.r);
  const y = (surahs: number) => H - m.b - (surahs / 114) * (H - m.t - m.b);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="fq-svg">
      <line x1={m.l} y1={H - m.b} x2={W - m.r} y2={H - m.b} className="fq-axis" />
      <line x1={m.l} y1={m.t} x2={m.l} y2={H - m.b} className="fq-axis" />
      {[20, 50, 100, 300, 1000, peak].map((v) => (
        <g key={v} className="fq-tick">
          <line x1={x(v)} y1={H - m.b} x2={x(v)} y2={H - m.b + 5} />
          <text x={x(v)} y={H - m.b + 18} textAnchor="middle">{fmt(v)}</text>
        </g>
      ))}
      {[0, 30, 60, 90, 114].map((v) => (
        <g key={v} className="fq-tick">
          <line x1={m.l - 5} y1={y(v)} x2={m.l} y2={y(v)} />
          <text x={m.l - 9} y={y(v) + 4} textAnchor="end">{fmt(v)}</text>
        </g>
      ))}
      {points.map((p) => (
        <circle
          key={p.bare}
          cx={x(p.count).toFixed(1)}
          cy={y(p.surahs).toFixed(1)}
          r={(2 + Math.min(4, p.count / 250)).toFixed(1)}
          className={p.topShare > 0.15 ? "fq-dot fq-dot--concentrated" : "fq-dot"}
        >
          <title>{`${p.bare} — ${fmt(p.count)} · ${fmt(p.surahs)}`}</title>
        </circle>
      ))}
      <text x={W / 2} y={H - 4} textAnchor="middle" className="fq-axis-label">{axis}</text>
    </svg>
  );
}
