# Data Sources

This project combines canonical linguistic data, runtime verse APIs, and normalized PostgreSQL derivatives.

## Primary Linguistic Source

### Quranic Arabic Corpus

- Provider: University of Leeds
- Website: <https://corpus.quran.com/>
- Repository: <https://github.com/kaisdukes/quranic-corpus>
- Usage: morphology, roots, lemmas, part-of-speech data, and dependency metadata
- Bundled file: `public/data/quranic-corpus-morphology-0.4.txt`
- Retrieval date for bundled file: 2026-02-06
- License note from source header: verbatim redistribution is allowed, modifications are not

## Runtime Text Source

### Quran.com API

- API docs: <https://api-docs.quran.com/>
- Usage in repo: chapter, verse, translation, and word-level text retrieval through `lib/api/quranApi.ts`
- Role: runtime display and enrichment source, not the internal UI contract

## Storage and Derivatives

Normalized corpus data is stored in Supabase/PostgreSQL and provisioned through `supabase/migrations/`.

The database currently contains:

- normalized token and ayah tables
- root embeddings for semantic search
- materialized collocation and cross-reference views
- user-state tables for tracked roots and quiz attempts

Derived analytics include:

- full-text search vectors
- trigram similarity indexes
- vector semantic search
- PMI-based collocation scores

### Precomputed files under `public/data/`

Built from the bundled QAC morphology file by scripts in `scripts/`, committed, and
read at build time. They are derived straight from the morphology source, so they do
**not** inherit the word-alignment drift that affects database-backed views.

| File | Built by | Used by |
| --- | --- | --- |
| `root-stats.json` | `npm run data:roots` | Landing page search and "today's root" |
| `root-frequency.json` | `npm run data:root-dist` | `/frequency` — tiers, leaderboard, coverage, charts |
| `name-stats.json` | `npm run data:names` | Proper-noun search |
| `form-index.json` | `npm run data:forms` | Surface-form lookup |
| `lemma-form-stats.json` | `npm run data:lemma-form` | Root → word → form drill-down |

`npm run data:root-dist` also regenerates `docs/ROOT-GLOSS-GAPS.md`, the worklist of
roots still missing an English gloss. Do not hand-edit either output.

## Search and AI-Assisted Helpers

Some product utilities may use model-backed helpers such as semantic search or image-assisted root extraction. These are convenience layers over canonical corpus data, not new source-of-truth content.

## Source Handling Policy

- Normalize upstream data into internal schema before UI consumption.
- Do not bind frontend components directly to upstream payload shapes.
- Preserve attribution in repository docs and product surfaces where source-derived data is rendered.
- Treat model-generated assistance as non-canonical unless backed by source data.

## Licensing and Redistribution

- Verify source terms before redistributing raw upstream payloads.
- Prefer shipping adapters, normalized schema code, and migration logic over repackaged raw exports.
- Include attribution and license context anywhere a raw source file is bundled.

## Citation Standard

Every source-backed feature should preserve:

- source name
- source URL
- version or retrieval date
- transformation notes when normalization or derivation occurs
