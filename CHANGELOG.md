# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Server-rendered prose on the four main pages (`PageAbout`) and a
  server-rendered internal link map on every page (`SiteNavMap`), both locales.
  Measured against production, the rendered HTML carried almost nothing for a
  crawler: `/study` emitted **14 words** — "Your Profile Loading…", because
  `StudyHub` is a client component that returns a loading state until auth
  resolves — the home 37, and **no page carried a single internal link**, the
  footer's anchors all being external. Search Console answered with nine URLs
  in "Discovered — currently not indexed" and three in "Crawled — currently
  not indexed": twelve of a sixteen-URL sitemap. The worked pages now render
  101–391 words and seven in-site links each, including the first inbound
  links the `/viz/*` gallery pages have ever had.
- Correlation search (الجوار): a collocation panel in the Search workspace with
  salience-ranked neighbours, names-only filter, window controls (same ayah /
  ±5 / ±10 words), exact-form vs word-family anchoring, and inline ayah
  previews with prev/next navigation.
- `near:` / `قرب:` query operators — proximity as part of the query language;
  `قرب:` is the first Arabic field operator.
- Home correlation (⇄): the result card re-renders scoped to the ayahs both
  words share (count, tiles, histogram, carousel), with same-ayah / ±5-word /
  adjacent-verse windows (adjacency adjustable ± 1–10 verses) and a "see all
  results" deep link into the Search workspace via `قرب:`.
- `/api/corpus/cooccurrence` — server-side pair intersection powering the home
  correlation (the offline indexes cap refs at 10 per entry, so client-side
  intersection cannot answer pairs).
- Experimental `Quiz` workspace with a daily puzzle and adaptive review flow.
- Local quiz history storage plus summary helpers in `lib/quiz/quizProgress.ts`.
- Supabase-backed quiz attempt sync through `lib/supabase/quizService.ts`.
- Database migration `007_quiz_attempts.sql` for per-user quiz history with RLS.
- Quiz-focused test coverage for question templates, progress summaries, and Supabase sync.

### Changed

- Journey rail navigation now includes the `Quiz` route alongside Explore, Search, and Study.
- First-run guidance has shifted toward intent-driven mission selection and updated workspace copy.
- Search, shell, study, and quiz UI text has been refreshed across English, Arabic, and pseudo-localized message sets.
- Documentation has been refreshed to reflect the current route tree, schema, release flow, and migration set.

### Fixed

- Correlation matching across Uthmani orthography: rasm-folded lemma comparison
  (typed ابراهيم now matches إِبْرَٰهِيم), restored small combining letters in
  highlighting (إِبْرَٰهِـۧمَ at 2:133), and dual-spelling matching against the
  database's full-alif lemma normalization.
- A latent carousel crash: a stale index into an in-place-shortened verses
  array read past the end and dropped the whole result card.
- Documentation drift around migration counts, directory layout, and release verification steps.

## [0.5.0] - 2026-02-21

### Added

- Knowledge Graph visualization with force and flow layouts.
- Knowledge Tracker with local persistence, learning states, notes, and import/export.
- Knowledge context provider for app-wide tracked-root state.
- Display settings controls for knowledge stats and import/export actions.
- Arabic translations for knowledge and settings surfaces.

## [0.4.0] - 2026-02-15

### Added

- Onboarding overlay with persistent startup preference.
- Replay onboarding action in display settings.
- Lexical coloring controls across visualizations.
- Export scope options and multi-format export menu.
- Custom theme editing with persistence.

## [0.3.0] - 2025-02-14

### Added

- Radial Surah Map.
- Root Network Graph.
- Surah Distribution Graph.
- Corpus Architecture Map.
- Root Flow Sankey.
- Arc Flow Diagram.
- Ayah Dependency Graph.
- Morphology Inspector.
- Global Search and Semantic Search panel.
- English and Arabic localization.
- Theme switching and mobile-responsive layout.
- Feedback dialog and Vercel Analytics integration.
- IndexedDB caching and metadata routes.

## [0.2.0] - 2025-01-15

### Added

- Better indexing and query UX.
- Comparative root-context views.
- Performance and cache hardening.

## [0.1.0] - 2024-12-01

### Added

- Initial MVP release.
- RootFlowSankey visualization.
- AyahDependencyGraph single-ayah focus.
- MorphologyInspector hover and focus interactions.
- Phase-1 semantic search for root, lemma, part of speech, and exact ayah.
