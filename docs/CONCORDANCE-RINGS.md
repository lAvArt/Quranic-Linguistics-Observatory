# Concordance Rings

A proposed visualisation for the observatory: where two or three roots occur across the whole Quran, and where they occur together. It extends the ring language of `radial-sura` from one surah to many. Every surah becomes a ring, every ayah a tick on it, and the ticks light up where the chosen roots appear.

_Status: prototype proven; the data layer is now in the app, the mode itself is not yet built. Written 2026-09-28._

**Built so far.** `scripts/build-concordance.ts` (`npm run data:concordance`) emits
`public/data/concordance.json` — the per-ayah root map, 337 KB raw and 91 KB gzipped,
which settles the "bundle the ayah text?" question below: text would have added ~1.3 MB,
four times the rest, so it stays out and hover reads from the existing ayah source.
`lib/corpus/concordanceClient.ts` turns a root selection into rings, ticks and meetings;
its tests reproduce every preset count in the table below from the corpus.

![Concordance Rings, stacked view for خلق · سمو · ارض: 39 surah rings with coloured ticks and cream meetings, the control panel on the left](../public/docs/images/concordance-rings/01-stacked.png)

## Reading the rings

| Element | What it shows |
| --- | --- |
| Ring | One surah. Inside to outside follows the chosen order: mushaf order (114 → 1), length (short → long) or number of meetings. The ring's track is tinted by revelation place, cool for Makki and warm for Madani. |
| Tick | One ayah. Its angle is the ayah's position in the surah, normalised from 0 to 100 around the ring; a small gap at 12 o'clock holds the surah number. Its height follows the ayah's word count. |
| Coloured segment | Where a chosen root occurs in that ayah. Each root has its own colour and its own radial slot, the first innermost. On thin rings the tick takes the first root's colour. |
| Meeting | A cream tick where every chosen root occurs in the same ayah. |
| Thread | A faint line from each meeting to the nearest meeting on the next ring out, so drift in position between surahs is visible. |
| Outer scale and histogram | 0 to 100 through the surah, with a histogram of where meetings fall. |
| Centre | The chosen roots with their glosses, and the number of surahs and meetings. |

The **Roots meet in** switch sets which surahs qualify. With **one ayah**, a surah needs at least one meeting. With **one surah**, it only needs every root somewhere in it.

## Views

- **Stacked**, the default: only the surahs that qualify, one ring each (image above).
- **All 114**: the whole Quran, with the rings that don't qualify dimmed.
- **Overlaid**: every qualifying surah stretched onto one ring at normalised positions. Stacked bars count each root's occurrences by position, with meetings on top. Inside the ring, each surah's consecutive occurrences of a root are joined by chords, all surahs superimposed.
- **Align at first meeting**: every ring rotates, animated, until its first meeting sits under the marker at 12 o'clock. The meetings stack into one column, and later meetings can be compared as distances from the first.

| Aligned at first meeting | All 114 | Overlaid |
| --- | --- | --- |
| ![Every ring rotated so its first meeting sits at 12 o'clock, forming a vertical column](../public/docs/images/concordance-rings/02-aligned.png) | ![All 114 surah rings, non-matching ones dimmed](../public/docs/images/concordance-rings/03-all-114.png) | ![All 39 surahs on one ring with stacked bars and superimposed chords](../public/docs/images/concordance-rings/04-overlaid.png) |

## Interactions

- **Choosing roots.** Up to three roots, typed in Arabic (insensitive to hamza and alif forms), in Buckwalter, or as an English gloss. Suggestions are ranked by frequency.
- **Recurring phrases** as one-click presets. Counts are surahs where the roots meet in at least one ayah:

  | Phrase | Roots | Surahs |
  | --- | --- | --- |
  | آمنوا وعملوا الصالحات | امن · عمل · صلح | 41 |
  | عذاب أليم | عذب · الم | 41 |
  | خلق السماوات والأرض | خلق · سمو · ارض | 39 |
  | غفور رحيم | غفر · رحم | 37 |
  | الحياة الدنيا | حيي · دنو | 34 |
  | جنات تجري من تحتها الأنهار | جنن · جري · نهر | 25 |
  | أنزل من السماء ماء | نزل · سمو · موه | 21 |
  | الشمس والقمر | شمس · قمر | 18 |

- **Hovering a tick** shows the surah, the ayah reference and the full ayah text, with the words carrying the chosen roots coloured. In the overlaid view, hovering a position lists the ayahs that fall there.
- **Clicking a ring** dims the others and draws that surah's own root wiring inside it, as `radial-sura` does for one surah. A card lists how many ayahs hold each root and where they meet, and links to the surah's radial view.

![A selected ring with its internal wiring, the surah card, and an ayah tooltip with the chosen roots coloured](../public/docs/images/concordance-rings/05-selected-ring.png)

## Data and method

- **Source.** The Quranic Arabic Corpus morphology file (v0.4, Kais Dukes), read offline, as `scripts/build-root-stats.ts` does. The `corpus_tokens` database table is not used, which avoids its known word-alignment issue.
- **Counting.** Each word counts once, with its stem's root: 77,429 words, of which 49,967 carry one of 1,642 roots. For matching, hamza and alif forms inside a root are folded together.
- **Normalised position.** Ayah *i* of a surah with *N* ayahs sits at (*i* − ½) / *N*.
- **Meeting.** An ayah containing every chosen root.
- **Tick height.** The ayah's word count, relative to the longest ayah in the same surah.
- **Payload.** Per surah and ayah: the ayah text and the root index of each word, about 1 MB as JSON. The root indices alone are a fraction of that, since the app already has a source for ayah text.

## Rendering and performance

The prototype runs at 60 fps for hovering and for the rotation, at 2× pixel density. What got it there applies to any ring view in the app:

- **Layered canvases.** Scale, histogram and centre are drawn once; tracks and threads sit under the ticks; meetings, selection and labels sit above them; hover gets a layer of its own. Hovering never repaints the rings.
- **Ticks in WebGL.** Chrome's GPU-backed 2D canvas slows to 4–12 fps when it redraws thousands of tiny anti-aliased shapes every frame. Drawing the ticks as one instanced WebGL2 call, with the ring sector cut exactly in the fragment shader, restores 60 fps with no visible change: pixel diffs against the 2D rendering average 0.1/255.
- **Fallback.** Where WebGL2 is missing or software-emulated (`failIfMajorPerformanceCaveat`), the ticks fall back to one small `Path2D` per tick on the 2D canvas.

Measured with Playwright under GPU rasterisation at 2× density:

| | Before | After |
| --- | --- | --- |
| Hover, stacked / all 114 / overlaid | 11 / 4 / 36 fps | 60 / 60 / 60 fps |
| Rotation, stacked / all 114 | 12 / 5 fps | 60 / 60 fps |

`radial-sura` redraws a similar number of small shapes; if it ever animates, the same approach applies.

## Proposed integration

- **Mode.** A tenth viz mode, `concordance-rings`, grouped with `radial-sura`. Deep link: `/{locale}?viz=concordance-rings&roots=خلق,سمو,ارض&view=stacked`, where root params are plain-alif corpus keys, as elsewhere.
- **Data.** An offline build script (proposed: `scripts/build-concordance.ts`) emitting the per-ayah root indices to `public/data/`, loaded lazily when the mode opens. Ayah text comes from the existing text source.
- **Shell.** Controls render into the sidebar portal. The selected-ring card moves into the context drawer, and root colours use the theme-stable `--viz-cat-*` tokens instead of the prototype's hex values. Toggles and sliders use the custom control skin (see `VIZ_ARCHITECTURE.md`).
- **Accessibility.** Keyboard steps between rings and ticks. A text alternative lists the meeting ayahs as a table. With `prefers-reduced-motion`, the rings align without animating.
- **Mobile.** Below about 700 px rings get too thin to read, so open in the overlaid view or cap the ring count.
- **Credit.** The footer credits Kais Dukes and the Quranic Arabic Corpus, as on every page.

## Open questions

- **Name.** "Concordance Rings" is a working title, after the classical concordance. An Arabic name is still needed.
- **Threads.** The nearest-meeting rule is a display choice; linking by surah order, or not linking at all, are alternatives worth trying.
- ~~**Ayah text.** Bundle it with the payload, or fetch per hover?~~ Settled: fetch per hover. Bundling costs ~1.3 MB against a 337 KB payload.
- **Scope.** Should the mode accept one or two roots only, or allow more than three with a different colour scheme?
