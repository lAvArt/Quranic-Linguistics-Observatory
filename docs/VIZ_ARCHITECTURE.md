# Visualization Architecture

Reference map of the graph/visualization surface: routes, components, shell anatomy,
state, and the UX-debt ledger. Written so nobody has to re-derive this from the code.
Line numbers drift — anchor by symbol/class names when navigating.

_Last full audit: 2026-07-18 (branch `feature/viz-declutter`)._

## Routes & deep links

| Surface | URL pattern | Notes |
| --- | --- | --- |
| Observatory (full shell) | `/{locale}/?viz={mode}&surah=&ayah=&root=&lemma=&token=` | Home page becomes AppShell when viz/selection params present. Deep-link hydration in `AppShell.tsx` (`useSearchParams` → `handleSearchResultNavigate`). |
| Embeds (standalone) | `/embed/{mode}?surah=&root=&theme=` | `app/embed/[vizMode]/page.tsx` → `components/embed/EmbedClient.tsx`. postMessage protocol: `qcv:config`, `qcv:selection`, `qcv:ready`. Modes needing full corpus: `surah-distribution`, `corpus-architecture`, `knowledge-graph`. |

Example deep links: `/en?viz=radial-sura&surah=2`, `/en?viz=collocation-network&root=علم`
(URL-encode Arabic in scripts). Root params are corpus root keys — plain-alif forms,
see `docs/DATA_SOURCES.md` and the hamza-normalization note in `lib/corpus`.

| Root frequency | `/{locale}/frequency` | Not a viz mode and not on the rail — a standalone read-only page, linked from the landing page's "Did you know" line. `app/[locale]/frequency/page.tsx` → `components/frequency/RootFrequencyView.tsx` (Server Component) + `FrequencyCharts.tsx` (client, hover only). Data: `public/data/root-frequency.json`, imported at build, never shipped to the client. The Top-N / page control is CSS-only — hidden radios plus `:has()`, rows carrying a `.fq-r<tier>` and a `.fq-p<page>` class. |
| Search workspace | `/{locale}/search?q={query}` | `q` may carry the `near:`/`قرب:` operator (`?q=أب قرب:ابراهيم`) — the الجوار
panel then renders pair mode with every co-occurrence window. The home pair card's "see all results" CTA deep-links here. |

## The nine modes

All in `components/visualisations/`. Each renders its own left-panel cards through
the sidebar portal (see Shell anatomy).

| Mode id | Component | What it draws |
| --- | --- | --- |
| `radial-sura` | `RadialSuraMap.tsx` | Every word of one surah on a ring; per-ayah bars, root-connection curves, center annotation. Has zoom LOD (below). |
| `root-network` | `RootNetworkGraph.tsx` | Orbital system: root "planets" on canvas-scaled orbits (1 ring ≤24 roots, 2 frequency bands above) with lemma "moons" hugging their root; stellar-core center; sim pre-ticks before paint (no settle tangle); root-limit slider (advanced). |
| `arc-flow` | `ArcFlowDiagram.tsx` | Grouped arc fan (group by root/POS/ayah) with frequency bars; root-mode arcs = ayah co-occurrence (weight = shared verses, scope-normalized widths, hover tooltip). |
| `dependency-tree` | `AyahDependencyGraph.tsx` | Per-ayah syntax tree with labeled dependency arcs; surah/ayah stepper controls in sidebar. |
| `sankey-flow` | `RootFlowSankey.tsx` | Root → word-form ribbons for the scoped surah; on-canvas chips carry scope/coverage. |
| `surah-distribution` | `SurahDistributionGraph.tsx` | All 114 surahs, x = surah index, dot = surah (revelation place color, size = ayahs). |
| `corpus-architecture` | `CorpusArchitectureMap.tsx` | Corpus → surah → root structure map with root search. **Occurrence mode** (2026-09-05) when a root is selected and no surah is drilled: leaves become that root's AYAHS, one wire per occurrence, everything else hidden; surahs carrying it stay lit, the rest are dim ring markers. |
| `knowledge-graph` | `KnowledgeGraphViz.tsx` | Personal tracked-roots network; ghost/empty state when nothing tracked. |
| `collocation-network` | `CollocationNetworkGraph.tsx` | PMI-weighted collocates orbiting a target root; "Heuristic estimate" badge = derived, not corpus-annotated. Strongest default view of the nine. |

Mode switching: `components/ui/VisualizationSwitcher.tsx` (grouped by intent,
beginner/advanced toggle) inside `components/shell/GraphToolbar.tsx`.

## Shell anatomy (AppShell)

`components/shell/AppShell.tsx` composes, around `components/home/VisualizationViewport.tsx`:

- **TopBar** (`shell/TopBar.tsx`) — brand, CommandBar search, language, auth.
- **StatusBar** (`shell/StatusBar.tsx`) — corpus load state + breadcrumb pill (top center).
- **Left dock** (desktop ≥981px) — ONE glass container `.viz-dock` fusing two flex
  children: the JourneyRail spine (68px; `inDock` prop strips its standalone chrome)
  and the info column (`.viz-sidebar-stack`, ~256px; keeps that class — `fitToView`
  and portals depend on it). Spine groups: "Views" (Overview → surah-distribution,
  Roots → root-network, Surah → radial-sura) and "Pages" (Search/Study/Quiz links),
  each button with a `title` hint. A chevron at the spine bottom collapses the dock
  to spine-only; state persists in localStorage `quran-corpus-left-dock`.
  `lib/viz/fitToView.ts` measures `.viz-dock` (fallback `.viz-sidebar-stack`) for
  occlusion. Below 981px the dock is `display: contents`: the rail becomes the
  horizontal top strip and the panel is reached via MobileBottomBar, as before.
  JourneyRail is ALSO used standalone (no dock) by `ui/AppWorkspaceShell.tsx` on
  search/study/quiz pages — dock styling is scoped to `.in-dock`, don't leak it.
- **Info column content** — per-viz cards via portal target `#viz-sidebar-portal`.
  Each viz renders a `sidebarCards` block into it. Contract after the declutter pass:
  **≤1 functional card (real controls only) + 1 encoding-only legend (≤5 one-line rows)**.
  No interaction instructions, no Zoom % / token-count / scope rows duplicated elsewhere.
- **Right ContextDrawer** (`shell/ContextDrawer.tsx`) — tabs Explain / Inspect / Search / Index.
  Explain renders `ui/VizExplainer.tsx` (claim, legend, numbered hints, purpose) —
  the single home of "how to read this view". Inspect hosts
  `inspectors/MorphologyInspector.tsx`. Auto-switches to Inspect on token focus.
  Starts collapsed until a selection or explicit open (chip / edge handle).
- **GraphToolbar** (bottom, floating) — LexicalColorSwitch · VisualizationSwitcher ·
  DisplaySettingsPanel · VizExportMenu.
- **Intro chip** (`ui/VizIntroCard.tsx`) — small "How to read this view" pill under the
  breadcrumb; opens drawer → Explain. Per-mode dismissal in localStorage
  `quran-corpus-viz-intro`. (Was a center-screen overlay card before 2026-07;
  do not reintroduce overlays over the canvas.)
- **Mobile** (redesigned 2026-07-24): ONE floating bottom pill `ui/MobileVizBar.tsx`
  (VisualizationSwitcher + Overview/Roots/Surah quick-views + Legend/Tools toggles;
  fitToView measures `.mobile-viz-bar` as the bottom occluder). GraphToolbar and the
  in-dock rail strip are `display: none` ≤980px; `MobileBottomBar` is deleted. Search
  opens from a centered TopBar icon (`topbar-mobile-search-trigger`); Settings opens
  from the hamburger (`MobileNavMenu` → `setMobileSettingsOpen`, a controlled
  `DisplaySettingsPanel` instance in AppShell whose mobile section also hosts
  LexicalColorSwitch + VizExportMenu). MobileNavMenu also carries Search/Study/Quiz
  links. Marketing `ui/Footer.tsx` stays hidden on mobile for the observatory view.
- **Onboarding**: `onboarding/FirstRunMission.tsx` (intent selection; suppresses intro chip),
  `MissionChecklist.tsx`.

State: `VizControlContext` (mode, selection, panels, `isRightSidebarOpen`).
Theme cookie `quran-corpus-theme`; viz prefs localStorage `quran-corpus-viz-state`;
onboarding localStorage `quran-corpus-onboarding`.

## Cross-cutting mechanics

- **Radial LOD** (`RadialSuraMap.tsx` top constants): surahs > `OVERVIEW_WORD_THRESHOLD`
  (800 words) render hairline per-ayah ticks; zooming past `DETAIL_ZOOM_THRESHOLD` (1.3×)
  swaps ticks → full word bars in place. Small surahs always render full detail.
  Initial fit-to-ring runs for **all** surah sizes (small-surah overflow was a bug, fixed).
  Only the bars/root dots are LOD-gated (2026-09-05): the root-connection mesh draws at
  EVERY zoom (overview = pair-deduped, dominant-roots-first, capped `OVERVIEW_MESH_ARC_CAP`)
  and hover/selection emphasis (hovered root, active ayah) is drawn from the full
  connection set on top, so wires and hover respond identically zoomed out or in.
  The ayah card (left panel) previews the HOVERED ayah in full — text, roots, matches —
  and a click pins it; hover text fetch is debounced 90ms.
- **Corpus data streams in — for real now.** `lib/corpus/sampleCorpus.ts` provides a
  tiny stub before real data lands, and `loadFullCorpus({ onBatch })` emits ~12 batches
  of WHOLE surahs (10/batch, ascending; never a partial surah — both Supabase and
  Quran.com paths; cache hits stay one-shot). `useCorpusData` streams `deepTokens`
  per batch and drives real loading progress. Consequences: any effect that measures
  geometry and then locks itself (entry fits, initial focus, one-shot layout) must
  gate on complete data (`isSurahDataComplete` in `RadialSuraMap.tsx`,
  `isScopeDataComplete` in `ArcFlowDiagram.tsx`), and components seeing the growing
  array re-render per batch — keep per-batch work cheap. Corollary: NEVER mutate
  user-chosen state from data-derived values (root-network's limit clamp ratcheted the
  slider to 5 because the surah-2 stub has 3 roots — clamp at use time via
  `Math.min(userValue, derivedMax)` instead). The structure map renders a
  static 114-surah skeleton (angles from `SURAH_NAMES`, fixed from first paint) and
  reveals root branches per batch with a CSS opacity stagger (once per arrival,
  tracked in a ref; instant under reduced motion).
- **Structure-map occurrence mode** (`CorpusArchitectureMap.tsx`, 2026-09-05). Selecting a
  root turns the map into "where does this word live across the whole Quran": occurrence
  leaves keep `type: "word_root"` and `originalId` = the root (so every geometry/color/
  label memo works unchanged) and carry an extra `ayah`. Rules learned building it:
  the surah-drill adoption of `selectedSurahId` is SKIPPED while a root is active and a
  NEW root clears an existing drill — otherwise arriving with a root landed on one
  focused surah with everything else at 0.05, the opposite of the cross-corpus view the
  map exists for. Occurrence wires ignore the rank/LOD gating (one root's wires ARE the
  content). Label admission exempts by NODE id here, not root identity — every leaf
  shares the root, so the root test would exempt them all and admit every label at once.
  The selected wire is read from the shared focused token (`focusedSura`/`focusedAyah`),
  never local state, so an ayah picked in the inspector's occurrence list lights the same
  wire. Hover previews the ayah (debounced 90ms verse fetch), click pins it.
- **Untangling the structure map** (2026-09-05, same pass). Three separate causes,
  all worth remembering: (1) `d3.linkRadial` derives control points from the SOURCE's
  own angle, and the corpus node has none — it sits at radius 0 where `getNodeAngle`
  falls back to 0 (straight up), so all 114 centre spokes left the middle heading north
  before curving back to their surah, piling into one knot. Centre spokes are now drawn
  as straight radial lines (`buildLinkPath`); straight spokes share only the origin and
  cannot cross. (2) The root fan spreads up to 120° while a surah's slot on the ring is
  ~3.2°, so in occurrence mode every surah's wires swept across ~38 neighbours.
  Occurrences separate on the RADIAL axis instead (stacked in ayah order, ~11px apart,
  band capped at 420px since `viewRadius` grows with the longest offset) and keep a
  ≤2.2° fan. (3) Label decluttering measured arc length (angle × radius), which is the
  right axis for a sideways fan and collapses to nothing for a radial stack near the top
  of the ring — `rootLabelAxisById` switches to radius in occurrence mode.
- **`fitBoundsToView` ignored the viewBox ORIGIN** (fixed 2026-09-05). Every viz draws
  with a `0 0 w h` viewBox except the structure map, which centres its own coordinate
  system (`-r -r 2r 2r`) for polar geometry. The helper computed its target centre as an
  offset from zero, so every fit on that map — the Focus button included — was shifted by
  `r` and pushed the graph almost entirely off-screen. It now adds `vb.x`/`vb.y`; a no-op
  for the other ten. Any new viz with a centred viewBox depends on this.
- **Nothing may change the visualization mode but the user.** The inspector's surah rows
  used to pass `"radial-sura"` to `onSelectSurah`, yanking users out of whatever view
  they were in; its ayah chips are now buttons (`onSelectAyah` → focus that word, scope
  to its surah, root untouched). List clicks change SELECTION, never the mode — the mode
  is chosen in the visualization switcher.
- **Fit-to-view** (`lib/viz/fitToView.ts`) — shared fit helper, chrome-aware on all four
  sides: left dock (`.viz-dock`/`.viz-sidebar-stack`), right ContextDrawer when open
  (`.context-drawer`, aspect-ratio-guarded so the mobile bottom-sheet variant doesn't
  count as an inline inset), StatusBar pill top, GraphToolbar bottom. LTR/RTL aware;
  joint clamps keep ≥40% width / ≥55% height free. Any new viz should use this rather
  than raw viewport math.
- **Per-tick geometry must be plain SVG** (the collocation pattern). Anything whose
  transform/`d` changes every simulation tick renders as plain `<g>`/`<path>` — React
  patches them in one fast commit. framer-motion is reserved for decorative elements
  whose geometry doesn't tick (pulse rings, sun breathing) and for ONE layer-level
  entrance/settle fade per layer (keyed by topology, namespaced sibling keys). Wrapping
  each node/edge in `motion.g` caused bursty frame pacing users read as "wires lagging"
  (measured: 78.6%→94.4% frame-advance under 2× CPU throttle after the fix).
- **Never `transition: all` on classes applied to SVG geometry.** In Chromium, `d`,
  `cx/cy`, `x/y` are CSS-animatable presentation attributes, so `all` makes the browser
  EASE every per-tick geometry write — DOM attributes update instantly (probes reading
  attributes see 0 gap) while the render trails by the transition duration (users see
  rubber-band wires; measured 8px sustained gap in 86% of drag frames before the fix,
  0.00px after). Use explicit property lists (stroke, stroke-width, fill, opacity,
  filter, transform-for-hover) — see `.edge`/`.node-circle`/`.radial-arc` in
  `styles/dark-theme.css`. Key edges by pair identity, never array index.
- **Selection is global and bidirectional.** `useSelectionState` (via
  `useHomePageController`) owns surah/ayah/root/lemma; every mode ADOPTS the shared
  root/surah when the prop changes (ref-track the previous prop; adoption never calls
  the write-back) and WRITES BACK explicit user picks (click/blur/Enter/change only —
  never hover) via `onRootSelect`-style callbacks. Explicit picks re-lock
  `searchLockedRoot` (they are authoritative). **The selected root is pinned**
  (2026-09-05): clicking empty canvas, toggling a wire off, or focusing a token
  (an ayah-bar click focuses the ayah's first word for the inspector) never
  clears or swaps it — only another explicit root pick or the breadcrumb does.
  `useSelectionState.selectedRootValue` therefore prefers `selectedRoot` over the
  focused token's root (lemma likewise, only adopted within the pinned root). The URL mirrors
  `{viz, surah, ayah, root, lemma}` via debounced `window.history.replaceState`
  (never `token`), gated on deep-link hydration completing; the controller's own URL
  writes are deduped against Next's `useSearchParams` echo via
  `lastAppliedParamsRef` — keep that guard when touching either side.
- **Category colors must be theme-stable.** Never bind categorical encodings to
  `--accent`/`--accent-2`: those swap hues between light and dark themes.
  Use dedicated tokens (`--viz-cat-makki`, `--viz-cat-madani` — teal family / amber family
  in both themes; light values in `app/[locale]/globals.css` :root, dark in
  `styles/dark-theme.css`). Add new `--viz-cat-*` tokens for any future categorical scale.
- **Screenshot harness**: `npx tsx scripts/ux-shots.ts --base http://localhost:PORT
  --routes "en?viz=radial-sura&surah=2,..." --viewports desktop,mobile --themes dark
  --out .ux-shots/NAME` — quote the routes arg (contains `&`), no leading slashes,
  URL-encode Arabic. Sets theme cookie + suppresses onboarding automatically.
- **i18n**: every viz string is a next-intl key (en + ar). Explainer copy:
  `VizExplainer.{mode}.*` in `messages/en.json` / `ar.json`; how-to-read step keys listed
  in `lib/vizExplainers.ts`. Interaction hints must say "hover **or tap**" (touch).

## Cognitive-load ladder (2026-07-18)

Search-to-graph escalation is deliberately staged; keep new features on a rung:

1. **Home root profile** (`MinimalHome` ResultPanel) — count, gloss, 114-bar
   strip, top-5 surahs. Primary CTA "See it in context" → radial-sura scoped
   to the root's top surah; network is the explicit secondary CTA.
2. **Calm entry** — home root CTAs append `entry=calm`; AppShell's deep-link
   hydration collapses the left dock to its spine (one-shot, NOT persisted —
   `skipNextDockPersistRef`) and skips the drawer auto-open
   (`actionTarget.calmEntry` through `handleSearchResultNavigate`). The flag
   is consumed on arrival; the controller's URL mirror drops it.
3. **Focused root-network** — arriving with a `highlightRoot` renders only
   that root + its 8 strongest verse-mates (`isFocusEntry` in
   `RootNetworkGraph`; ayah co-occurrence within scope). Escalation is the
   always-visible "Show full network N/M" pill (fixed bottom-center — the
   sidebar focus card is hidden while the dock is collapsed) with a one-shot
   `qcv-attention-pulse` (globals.css). Re-arms per new highlighted root.
4. **Full field** — the root-limit slider (default 30). A highlighted root
   outside the top-N slice is force-included so search never points at nothing.

Related mechanics added the same day:

- **Staged overview LOD (radial)** — RETIRED 2026-09-05 (user feedback: wires
  and hover must show at every zoom). The mesh is now always on (see Radial LOD
  above); highlighted-root arcs + count-scaled match ticks + ayah milestones
  remain at every zoom. Bars/root dots are still the only zoom-gated layer.
- **Sticky node drag (root-network)**: d3-drag subject carries node x/y (grab
  offset), drop keeps fx/fy (no orbit snap-back), dblclick unpins. Never null
  fx/fy on drag end while a strong radial force exists.
- **Streaming honesty**: inspector occurrence card shows a pulsing "still
  counting" cue while `isLoadingCorpus` (prop chain AppShell → ContextDrawer →
  MorphologyInspector); StatusBar shows N/114 · % with a sheen.
- **TopBar geometry**: banner + centered search slot share one explicit height
  (58px, pill capped 46px). Never let the two grow independently from content.
  The centered dock widens to min(680px, 32vw) at ≥1800px viewports.

## UX-debt ledger

Findings from the 2026-07-11 all-modes audit (screenshots in `.ux-shots/`, gitignored).

Fixed in `feature/viz-declutter`:

- Center intro overlay covered every canvas on entry (incl. `surah=` deep links — the old
  suppression only checked `root`/`token`) → replaced by the intro chip + drawer Explain.
- Left-panel text walls: duplicated titles/eyebrows, Zoom %/token-count debug rows,
  interaction-state legend rows, sankey scope stats duplicated against canvas chips.
- Right drawer opened by default as an empty 380px column ("What am I seeing?" collapsed).
- Mobile: mode-select label hidden ≤420px (icon-only primary control); marketing footer
  stacked a third bottom bar; "hover" copy on touch.
- Makki/Madani colors flipped semantics between themes (bound to accent tokens).
- Radial small-surah ring overflowed (no entry fit); dependency tree clipped under the
  floating panel (fitToView ignored it).
- Inspector led with "Translation not available for this form" as the hero subtitle;
  demoted to a muted row in the morphology grid.
- Icon rail and info panel were two disconnected floating boxes; rail mislabeled its
  view-switchers (e.g. "Ayah" opened the surah-level radial) and mixed them with page
  links unlabeled → unified left dock with "Views"/"Pages" groups, honest labels
  (Overview/Roots/Surah), tooltips, and a spine-collapse replacing the edge handle.
- root-network was a clumped ring hairball (radial pin at fixed 80/150px, invisible
  edges, all-nodes labels) → orbital planets/moons redesign; sim pre-ticks before
  paint so no wire tangle; blurry center blob → 48px eased-gradient stellar core;
  perceived wire-drag lag root-caused to per-element framer-motion wrappers on all
  per-tick geometry → plain SVG + layer-level fades (see the plain-SVG rule above).
- arc-flow drew zero arcs: links were "roots sharing a lemma", impossible in this
  corpus (a lemma belongs to one root) → ayah co-occurrence links (audited exact:
  surah 12 top pair اله|قول = 25 shared verses; corpus-wide 514); saturating
  width cap → scope-normalized sqrt widths; weights exposed via hover tooltip/aria.
- Fits ignored top/bottom/right chrome → fitToView now measures all four sides
  (breadcrumb pill, graph toolbar, open drawer).
- Selection was inconsistent across graphs (arc-flow/collocation kept stale local
  roots, sankey/knowledge-graph siloed, explicit clicks swallowed by the search lock,
  URL never reflected in-app picks) → global bidirectional selection + URL mirroring
  (see the "Selection is global" rule above).
- Structure map zoom stalled (155-204ms frames, p95 up to 2s, focused) → zoom-state
  commits quantized (0.25 scale buckets + 120ms floor; transform stays imperative
  per tick) and root labels admitted by screen-space separation (rank-priority
  greedy, ≥15px along the fan, hovered/selected exempt-as-blockers; more labels
  admitted as zoom deepens) → 20-30ms avg, overlap-free labels. Pattern to reuse:
  never re-render per zoom tick; commit LOD state on settle/threshold only.
- Structure map was one-shot and heavy → static 114-surah skeleton paints in ~1.2s
  (was 35-65s to first structure on cold loads), root branches stream in per batch
  with a staggered reveal; hover sets memoized, labels view-culled, token-reference
  churn stabilized (−21% frame time at overview pre-streaming). True overview element
  count is ~8,810 (5,604 is the focused-surah state — earlier probes measured focus
  due to a phantom unfocus click, since fixed).

Fixed 2026-07-18 (same branch; verify suite green, data-audit agent re-confirmed all
displayed counts against fresh recomputation from the raw morphology file):

- knowledge-graph embed crash → `components/embed/EmbedProviders.tsx` ("use client",
  AuthProvider→KnowledgeProvider, same nesting as app/[locale]/providers.tsx) mounted in
  app/embed/layout.tsx; guest/IndexedDB path, verified live (ghost network + empty state).
- MorphologyInspector light theme → all ~57 hardcoded dark colors tokenized
  (var(--ink/--accent/--panel/--line) + color-mix tiers; component-scoped --mi-* props
  with [data-theme="light"] overrides for lavender/error tones). Verified legible.
- seed-corpus.ts aligned to first-root-wins (matches morphologyLoader; the one
  divergent word 20:94:2 now resolves identically in both pipelines).
- VizExplainer legend chips localized: `LegendItem.label` → `labelKey`
  (`VizExplainer.<mode>.legend.*` in en+ar). Same pass: the Makki/Madani drawer
  swatches were bound to --accent/--accent-2 (theme-unstable) → now --viz-cat-*.
  Also removed a DUPLICATE top-level "VizExplainer" JSON block in both message files
  (first block was dead — later key wins on parse).
- ar.json hygiene: 9 mojibake strings ("???") restored, 15 untranslated-English
  strings translated (collocation controls, GlobalSearch aria), CommandBar +
  SemanticSearchPanel placeholders wrap Latin prefix operators in LRI/PDI isolates
  (⁦…⁩) so RTL ordering stays sane.
- Stale "Structural Map" heading bleed → RadialSuraMap's legacy `panel-head` +
  `viz-controls` blocks removed (RootNetworkGraph had already dropped its own);
  breadcrumb/center annotation/Explain drawer carry that content. Verified mobile+RTL.
- sankey ribbons → sqrt width scale [1.5,16]px + deterministic per-root hue tint
  (base opacity 0.4, emphasis 0.85/dim 0.15) in the default color mode; node chips
  strengthened. Verified.
- arc-flow baseline "swoosh" (64px decorative var(--line) stroke, zero encoding)
  removed. Verified.
- dependency-tree initial placement migrated to shared fitGraphToView (chrome-aware),
  gated on surah-data completeness, refits on ayah/surah nav only; user pan/zoom no
  longer reset by resize. Long-ayah caveat below.
- Dictionary links: root badges now fold every alif/hamza carrier to أ
  (`toCitationRoot` in MorphologyInspector) before linking — hamza-family roots
  (امن→أمن) land on real Almaany/Doha pages; lemmas keep true orthography.
- d3 imports: all viz files + fitToView/useZoom now import from the curated barrel
  `lib/viz/d3.ts` (12 submodules re-exported; d3-transition side-effect included).
  RULE: never `import * as d3 from "d3"` again — add missing submodules to the barrel.
- Dead deps removed: tesseract.js, @use-gesture/react (zero imports).

Fixed 2026-07-24 (branch `feature/mobile-polish`, mobile 390px pass; before/after in
`.ux-shots/mobile-audit` vs `.ux-shots/mobile-after*`):

- MinimalHome mobile header collision (lang pill over wordmark, buried skip pill) →
  ≤640px hides `.mhome-mark` entirely, top-right row nowrap + ellipsized skip pill;
  short search placeholder via `Home.placeholderShort` picked by SSR-safe matchMedia.
- Workspace pages (search/study/quiz): standalone JourneyRail strip overlapped the
  page header → `.ui-workspace-railed` mobile padding-top 68px→118px offset.
- `.viz-intro-chip` sat ON the mobile rail strip (top +40px vs rail +48px) → +108px.
- Footer credit clipped to "…Kais D" at 390px → ≤680px hides the Quran API link,
  credit 0.72rem + flex-shrink:0, links overflow:visible; ≤480px feedback icon-only.
  Kais Dukes credit now always fully legible (standing rule).
- Study guest banner: Sign In stretched full card height (flex align-items default)
  → center + wrap ≤480px.
- Search quick-filter chips: English placeholders in dir="rtl" inputs rendered
  scrambled BiDi → `::placeholder { unicode-bidi: plaintext }`; POS select clipped
  mid-letter → filters row wraps, controls flex-basis 48%.
- PWA: `viewportFit: "cover"` added to the root viewport export (safe-area env()
  insets were no-ops on notched phones without it).

Fixed 2026-07-24 later pass (branch `feature/ar-mobile-redesign`, AR/mobile audit;
before `.ux-shots/ar-mobile-audit`, after `.ux-shots/mobile-final`):

- **Portal-fallback canvas starvation (mobile).** AppShell mounts
  `#viz-sidebar-portal` only while the mobile legend sheet is open, and
  RootFlowSankey + AyahDependencyGraph fell back to rendering `sidebarCards`
  INLINE inside the canvas wrapper when the target was absent — ~770px of
  invisible cards starved sankey's SVG to 18px (users saw only the background
  glow) and squashed the dependency tree. Fallback is now `null`, matching the
  other seven vizzes. RULE: sidebar cards are portal-or-nothing — never inline.
- **Arc-flow drawn for a phantom 900px canvas.** ArcFlowDiagram clamped its
  measured width to `Math.max(width, 900)` (height 700), so a 390px phone drew
  a 900-wide layout squeezed to 43% by the viewBox. Floors lowered to 320/480
  (only guarding against mid-layout zero rects); the fan now fills the phone
  viewport.
- **Logical-vs-physical centering trap (the rail clip).** The CSS compiler
  (Lightning CSS) rewrites `inset-inline-*` into `:lang()`-guarded physical
  rules at HIGHER specificity (0,3,0) than the plain class rule that carried
  them — so a later `left: 50%` (0,2,0) in JourneyRail's mobile block silently
  lost to the base rule's `inset-inline-start: 8px`, and the strip hung half
  off-screen (visually obvious in RTL, actually broken in BOTH directions).
  Fix: center via `inset-inline-start: 50%` (same compiled specificity) +
  `[dir="rtl"]`-scoped `translateX(50%)` flip. RULE: never mix a physical
  override against a logical base property in this codebase — same property
  group, but the compiled logical side wins on specificity.
- Workspace pages ≤600px hid the LanguageSwitcher (`.header-button-group
  { display: none }`) — language was unswitchable on search/study/quiz mobile.
  Now compacted instead of hidden.
- /ar study page h1 was hardcoded English (`<StudyHub title="Study" />`);
  drops to the localized Profile.title fallback.
- Old-palette stragglers tokenized: embed spinner #3b82f6, DisplaySettingsPanel
  toggle fallback #6366f1, VizExplainer legend accent #94a3b8.
- Collocation "Heuristic estimate" badge sat under the mobile intro chip →
  dropped to header+152px; knowledge-graph empty-state CTA clipped by the
  bottom toolbar → `.kg-empty-overlay` mobile padding-block-end clears
  toolbar + tools-bar.

Known, deliberately deferred (next iterations):

- Lemma glosses missing for many forms ("Translation not available") — data gap, see
  hamza normalization note in `docs/DATA_SOURCES.md`; affects inspector hero content.
- The "How to read this view" chip can transiently overlap sankey's canvas scope pills
  (both sit top-center; chip auto-fades after 8 s).
- Light theme: the "Selected / contains selected root" legend swatch is near-identical
  to the Makki teal — selected state relies on the canvas ring/glow to disambiguate.
- **Unscoped (entire-Quran) arc-flow/root-network views are unreachable**: `selectedSurahId`
  is a non-nullable number defaulting to 1 everywhere (`useSelectionState`, embeds), though
  components support a null scope. Decide whether to expose a corpus scope.
  (Corollary: the corpus-wide 514 اله|قول arc weight is computed correctly but never
  reachable through the UI.)
- Arc weights are never shown numerically beyond the hover tooltip.
- Dependency-tree on very long ayahs (2:255, 50 tokens): the shared fit is bounded by
  the zoom scaleExtent floor (0.4), so the token row still overflows horizontally and
  needs panning — full fix is a wrapped/multi-row layout, not a smaller scale (text
  would be illegible). Deep links with `ayah=` intentionally focus the ayah's first
  token (resolveFocusedTokenIdForSelection) so the Inspect drawer has content — that
  root chip in the breadcrumb is by design, not a stray write-back.
- Embed knowledge-graph empty-state card uses a light panel on the dark embed theme —
  legible but washed; tokenize if embeds get a theme pass.
- The learning loop is real (2026-07): inspector "Track this root" is a state-aware
  toggle on useKnowledge() (tracked → success outline, click to untrack); "Quiz me on
  this root" navigates to /quiz?root=… which renders a root-scoped quiz
  (generateRootQuiz, lockedRoot option, template-type dedupe, bounded distractor
  loops — a hapax root used to hard-freeze the tab) with a Track CTA on completion.
  Knowledge-graph empty state has i18n copy + Browse-roots/Open-Study CTAs (CTAs only
  when onExploreRoots is wired — hidden in embeds), legend suppressed only when
  !loading && empty. NOTE: knowledge-graph was missing from BEGINNER_PRIMARY_MODES
  (useVizModeState.ts) — the mode silently snapped back to radial-sura for beginner
  users; fixed. Quiz Finish buttons are in-flight-guarded (double-fire recorded
  sessions twice).
- Dictionary links (Almaany/Doha, restored into the inspector) pass the raw corpus
  root form (plain alif) — both sites land on their search page for non-citation
  forms; if lookups miss for hamza-family roots (امن vs أمن), consider mapping to
  citation orthography before linking.
- Sankey on mobile now renders (post portal-fix) but pins to the top of the
  scroll area under the rail/status chrome (`preserveAspectRatio="xMidYMin"` +
  no initial vertical fit) — needs a chrome-aware initial centering like the
  other vizzes. Dependency-tree mobile still leaves dead space above the tree.
- Mobile leftovers (2026-07-24 pass): the Ayah quick-filter placeholder still clips
  ("Ayah (e.g") at 390px; surah-distribution chart renders small with dead space on
  mobile (needs a viz-level responsive margin pass); the 900px (VizControlContext
  MOBILE_QUERY) vs 980/981px (CSS) breakpoint mismatch means 900–980px gets desktop
  drawer state with mobile layout — unify when touching shell state next.

## Review checklist for viz changes

Both themes (categorical colors identical semantics), RTL `/ar`, reduced motion,
mobile 390px (toolbar fits, no third bottom bar), no canvas-covering overlays,
legend = encodings only, any displayed count traceable to `lib/corpus`/`lib/search`
(when in doubt run the `data-auditor` agent), re-run `scripts/ux-shots.ts` before/after.
