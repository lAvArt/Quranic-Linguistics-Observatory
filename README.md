<div align="center">

# Quranic Linguistics Observatory

Interactive exploration of Quranic linguistic structure, morphology, search, and study workflows.

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript)](https://www.typescriptlang.org/)
[![CI](https://github.com/lAvArt/Quranic-Linguistics-Observatory/actions/workflows/ci.yml/badge.svg)](https://github.com/lAvArt/Quranic-Linguistics-Observatory/actions/workflows/ci.yml)
[![Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?logo=vercel)](https://www.quranobservatory.org)

[Live Demo](https://www.quranobservatory.org) | [Report Bug](https://github.com/lAvArt/Quranic-Linguistics-Observatory/issues/new?template=bug_report.md) | [Request Feature](https://github.com/lAvArt/Quranic-Linguistics-Observatory/issues/new?template=feature_request.md)

</div>

---

<!-- HERO:HOME -->
<img width="2560" height="1260" alt="Quranic Linguistics Observatory – search-first landing" src="public/docs/images/home-observatory.png" />
<!-- END:HERO -->

Quranic Linguistics Observatory is a Next.js application for exploring the Quran through normalized corpus data, D3-based visualizations, search tools, study workflows, and authenticated progress tracking. The app is built around four main product surfaces:

- `Explore`: interactive visualizations and inspectors
- `Search`: dedicated search workspace with recovery-friendly states
- `Study`: tracked roots, notes, migration, and resume flows
- `Quiz`: experimental daily and adaptive review quizzes backed by local progress and optional Supabase sync

## Key Capabilities

### Visual exploration

<table>
<tr>
<td width="50%" valign="top">
<!-- GRAPH:RADIAL_SURA -->
<img width="2560" height="1260" alt="Quranic Linguistics Observatory – Radial Surah Map" src="public/docs/images/radial-sura.png" />
<!-- END:GRAPH -->
<div align="center"><sub><b>Radial Surah Map</b> — verse structure with root connections</sub></div>
</td>
<td width="50%" valign="top">
<!-- GRAPH:CORPUS_ARCHITECTURE -->
<img width="2560" height="1260" alt="Corpus Architecture Map" src="public/docs/images/corpus-architecture.png" />
<!-- END:GRAPH -->
<div align="center"><sub><b>Corpus Architecture</b> — global structure across all 114 surahs</sub></div>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<!-- GRAPH:ROOT_NETWORK -->
<img width="2560" height="1260" alt="Root Network Graph" src="public/docs/images/root-network.png" />
<!-- END:GRAPH -->
<div align="center"><sub><b>Root Network</b> — shared roots as a force-directed graph</sub></div>
</td>
<td width="50%" valign="top">
<!-- GRAPH:KNOWLEDGE_GRAPH -->
<img width="2560" height="1260" alt="Knowledge Graph Visualization" src="public/docs/images/knowledge-graph.png" />
<!-- END:GRAPH -->
<div align="center"><sub><b>Knowledge Graph</b> — entities and their relations</sub></div>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<!-- GRAPH:SURAH_DISTRIBUTION -->
<img width="2560" height="1260" alt="Surah Distribution" src="public/docs/images/surah-distribution.png" />
<!-- END:GRAPH -->
<div align="center"><sub><b>Surah Distribution</b> — Makki/Madani split and root frequency</sub></div>
</td>
<td width="50%" valign="top">
<!-- GRAPH:SANKEY_FLOW -->
<img width="2560" height="1260" alt="Root Flow Sankey" src="public/docs/images/sankey-flow.png" />
<!-- END:GRAPH -->
<div align="center"><sub><b>Root Flow Sankey</b> — how roots flow across surahs</sub></div>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<!-- GRAPH:COLLOCATION_NETWORK -->
<img width="2560" height="1260" alt="Collocation Network — roots that stand together, weighted by PMI" src="public/docs/images/collocation-network.png" />
<!-- END:GRAPH -->
<div align="center"><sub><b>Collocation Network</b> — roots that stand together, weighted by PMI</sub></div>
</td>
<td width="50%" valign="top">
<!-- GRAPH:ARC_FLOW -->
<img width="2560" height="1260" alt="Arc Flow Diagram" src="public/docs/images/arc-flow.png" />
<!-- END:GRAPH -->
<div align="center"><sub><b>Arc Flow</b> — linear ayah sequence with connecting arcs</sub></div>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<!-- GRAPH:DEPENDENCY_TREE -->
<img width="2560" height="1260" alt="Ayah Dependency Graph" src="public/docs/images/dependency-tree.png" />
<!-- END:GRAPH -->
<div align="center"><sub><b>Ayah Dependency Graph</b> — syntactic dependencies within an ayah</sub></div>
</td>
</tr>
</table>

- Radial Surah Map, Root Network, Collocation Network, Knowledge Graph, Surah Distribution, Arc Flow, Ayah Dependency Graph, Root Flow Sankey, and Corpus Architecture views
- Shared inspectors, breadcrumbs, explainer content, export options, and embed support
- Shell-ready and deep-data-ready loading states so the app remains usable before the full corpus finishes loading

### Search and analysis

<!-- SEARCH:RESULT -->
<img width="2560" height="1260" alt="Search result — occurrence count, spread across surahs, and drill-down" src="public/docs/images/search-result.png" />
<!-- END:SEARCH -->

The landing page is the search box. Type, and the answer resolves as you go:

- **Suggestions from the first letter**, ranked by frequency, with a chooser when the
  query is ambiguous (`اسم` → the root سمو, 381x, or the name إسماعيل, 12x)
- **Three levels of counting** for any hit — the root (`رحمة` → ر-ح-م, 339x), the word
  across all its inflections (114x), and the exact written form (35x)
- **Modern spelling finds Uthmani rasm.** The corpus omits the medial long alef and
  writes hamza its own way, so `صالح`, `قرآن`, `قران`, `قرءان` — and `quran` — all
  resolve to what the text actually spells
- **Proper nouns are searchable and countable.** They carry no root in the corpus, so
  they are indexed separately, with spelling variants, multi-word compounds
  (`ذو القرنين`), and partial matching (`اسماع` → إسماعيل)
- **Correlation search (الجوار)** — proximity as a first-class question, on two surfaces:
  - The Search workspace answers *"what stands out near this word?"* with a collocation
    panel: salience-ranked neighbours (`إنسان` → `يَئُوس`, `كَفُور`, `نُّطْفَة` — words the
    user never typed), a names-only filter, window pills (same ayah / ±5 / ±10 words),
    exact-form vs word-family anchoring with a ⇄ switch, and click-to-open ayah previews
    with previous/next navigation
  - `near:` / `قرب:` query operators scope the panel to one companion —
    `لأبيه قرب:يوسف` → يُوسُف ×1 at 12:4 (قرب: is the first Arabic operator in the
    query language)
  - The home result card pairs with a companion word (the ⇄ button): the same card
    re-renders scoped to the ayahs both words share — count, tiles, histogram and
    carousel — with windows for same-ayah, ±5 words, or ± 1–10 adjacent verses, and a
    "see all results" deep link into the Search workspace
- Verse carousel per result, highlighting the searched word by content rather than by
  word position
- Dedicated Search workspace with grouped results, a paginated root dossier, a surah
  dossier, and explicit fallback messaging
- Morphological filters by root, lemma, part of speech, and ayah
- Semantic and collocation queries through Supabase/PostgreSQL functions
- Optional image-assisted root extraction and OCR-assisted utilities for search entry

### Study and learning

- Tracked roots with learning and learned states, notes, import/export, and migration flows
- Auth-backed sync for tracked roots through Supabase Row Level Security
- Experimental quiz route with a daily puzzle, adaptive review sessions, local history, and per-user `quiz_attempts` sync
- Study hub and profile flows designed to complement exploration instead of replacing it

### Product UX

- English, Arabic, and pseudo-localized message sets
- Responsive shell with desktop and mobile navigation patterns
- First-run mission chooser and contextual guidance for new users
- Theme, display, and export controls shared across the app shell
- Vercel Analytics instrumentation for readiness, recovery, performance, and core engagement events

## Getting Started

### Prerequisites

- Node.js 22.22.2+ (required by `jsdom` and `@testing-library/jest-dom`; CI runs Node 22)
- npm
- A [Supabase](https://supabase.com) project
- [Supabase CLI](https://supabase.com/docs/guides/cli) for local migration workflows

### Installation

1. Clone the repository.

   ```bash
   git clone https://github.com/lAvArt/Quranic-Linguistics-Observatory.git
   cd Quranic-Linguistics-Observatory
   ```

2. Install dependencies.

   ```bash
   npm install
   ```

3. Copy the environment template.

   ```bash
   cp .env.example .env.local
   ```

4. Fill in at minimum:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

5. Apply the database migrations.

   ```bash
   supabase db push
   ```

   The current migration set is `001` through `007`, including the `quiz_attempts` table used for synced quiz history.

6. Optional setup:

- Seed normalized corpus data:

  ```bash
  npm run db:seed
  ```

- Fetch the local morphology file for offline development:

  ```bash
  npm run fetch:morphology
  ```

- Generate embeddings if you are working on semantic search infrastructure:

  ```bash
  npx tsx scripts/generate-embeddings.ts
  ```

7. Start the development server.

   ```bash
   npm run dev
   ```

## Common Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start the local Next.js dev server |
| `npm run lint` | Run ESLint across app sources |
| `npm run typecheck` | Run TypeScript without emitting |
| `npm test` | Run Vitest |
| `npm run test:e2e` | Run Playwright end-to-end tests |
| `npm run test:a11y-smoke` | Run the accessibility smoke suite |
| `npm run verify` | Lint, typecheck, unit test, and build |
| `npm run verify:release` | Full release verification including Playwright suites |
| `npm run i18n:check` | Check translation coverage |
| `npm run i18n:pseudo` | Regenerate pseudo-localized messages |
| `npm run docs:generate` | Regenerate screenshot-backed docs assets |

## Tech Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Supabase / PostgreSQL 17
- D3.js
- Framer Motion
- next-intl
- Vercel Analytics

## Project Structure

```text
app/                 App Router pages, metadata routes, API routes, and localized workspaces
components/
  auth/              Auth forms and flows
  onboarding/        First-run mission and onboarding UI
  quiz/              Quiz cards, daily puzzle, and review quiz surfaces
  search/            Search workspace and command/search UI
  shell/             Shared app shell, journey rail, and shell navigation
  study/             Study hub and related dashboard components
  ui/                Shared UI building blocks
  visualisations/    D3-based graph and visualization components
lib/
  analytics/         Product telemetry helpers
  cache/             IndexedDB-backed local persistence
  context/           Auth and knowledge providers
  corpus/            Corpus loading, readiness, and overview data
  quiz/              Quiz generation, progress, and personalization logic
  search/            Search parsing, indexes, ranking, and recovery helpers
  supabase/          Supabase clients, generated types, and data services
messages/            Translation files
public/              Static assets and bundled morphology source data
scripts/             Seed, docs, i18n, and data utility scripts
supabase/            SQL migrations and local Supabase metadata
docs/                Product, schema, roadmap, and release documentation
```

## Architecture Notes

- Localized layouts own the shared shell, providers, metadata, and route-level workspaces.
- Supabase is the primary structured corpus and user-state backend; local caches keep the product resilient during cold starts and offline-ish flows.
- Search is split between fast client-side affordances and database-backed semantic or relational queries.
- Study state is hybrid: local persistence is available without auth, then migrates to Supabase when a user signs in.
- Quiz progress follows the same pattern: local history first, optional Supabase sync second.

## Release Workflow

- Run `npm run verify` during normal development.
- Run `npm run verify:release` before a release candidate.
- Use [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md) for manual release checks.
- Use [docs/OBSERVABILITY.md](docs/OBSERVABILITY.md) for telemetry review.
- Use [docs/ROADMAP_STATUS.md](docs/ROADMAP_STATUS.md) for current delivery status.

## Additional Documentation

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [DEPLOYMENT.md](DEPLOYMENT.md)
- [SECURITY.md](SECURITY.md)
- [docs/SCHEMA.md](docs/SCHEMA.md)
- [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md)
- [docs/EMBEDDING.md](docs/EMBEDDING.md)
- [docs/ROADMAP.md](docs/ROADMAP.md)
- [docs/ROOT-GLOSS-GAPS.md](docs/ROOT-GLOSS-GAPS.md) — generated worklist of roots
  still missing an English gloss, ranked by share of the text (`npm run data:root-dist`)

## Attribution

This project uses source data and metadata derived from the Quranic Arabic Corpus and Quran.com APIs.

- Quranic Arabic Corpus: [https://corpus.quran.com](https://corpus.quran.com)
- Source repository: [https://github.com/kaisdukes/quranic-corpus](https://github.com/kaisdukes/quranic-corpus)
- Quran.com API docs: [https://api-docs.quran.com](https://api-docs.quran.com/)

Please see [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) for source handling and attribution details.

## Security

Please report vulnerabilities according to [SECURITY.md](SECURITY.md).

## License

This project is licensed under the GNU General Public License v3.0. See [LICENSE](LICENSE).
