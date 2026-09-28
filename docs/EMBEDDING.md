# Embedding Visualizations

Quranic Linguistics Observatory supports embedding individual visualizations in external websites, blogs, or documentation via iframes.

## Quick Start

```html
<iframe
  src="https://quranobservatory.org/embed/root-network?surah=3&theme=dark"
  width="800"
  height="600"
  style="border:0;border-radius:8px"
  loading="lazy"
  allowfullscreen
></iframe>
```

## URL Format

```
https://quranobservatory.org/embed/{vizMode}?surah={number}&theme={light|dark}&root={root}
```

## Available Visualization Modes

| Mode | Description |
|---|---|
| `radial-sura` | Radial Surah Map |
| `root-network` | Root Network Graph |
| `arc-flow` | Arc Flow |
| `dependency-tree` | Ayah Dependency Tree |
| `sankey-flow` | Root Flow Sankey |
| `surah-distribution` | Surah Distribution |
| `corpus-architecture` | Corpus Architecture |
| `knowledge-graph` | Knowledge Graph |
| `collocation-network` | Collocation Network |
| `concordance-rings` | Concordance Rings |
| `heatmap` | Heatmap |

## Query Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `surah` | number | `1` | Surah number (1-114) |
| `theme` | string | `light` | `light` or `dark` |
| `root` | string | — | Optional Arabic root to focus on |

`concordance-rings` spans all 114 surahs, so it ignores `surah` and takes its own
parameters, the same ones its deep links in the app carry:

| Parameter | Type | Default | Description |
|---|---|---|---|
| `roots` | string | — | Two or three roots, comma-separated and URL-encoded, e.g. `خلق,سمو,ارض` |
| `view` | string | `stacked` | `stacked`, `all` (all 114 rings) or `overlaid` |
| `meet` | string | `ayah` | `ayah`: a surah qualifies when the roots share an ayah; `surah`: when each occurs anywhere in it |
| `order` | string | `mushaf` | Ring order, inside to out: `mushaf`, `length`, `meetings` or `firstMeeting` |

## Examples

### Root Network for Surah Al Imran (dark theme)

```html
<iframe
  src="https://quranobservatory.org/embed/root-network?surah=3&theme=dark"
  width="800"
  height="600"
  style="border:0;border-radius:8px"
  loading="lazy"
  allowfullscreen
></iframe>
```

### Radial Surah Map (light theme)

```html
<iframe
  src="https://quranobservatory.org/embed/radial-sura?surah=36&theme=light"
  width="800"
  height="600"
  style="border:0;border-radius:8px"
  loading="lazy"
  allowfullscreen
></iframe>
```

### Sankey Flow for Surah Al-Baqarah

```html
<iframe
  src="https://quranobservatory.org/embed/sankey-flow?surah=2&theme=dark"
  width="800"
  height="600"
  style="border:0;border-radius:8px"
  loading="lazy"
  allowfullscreen
></iframe>
```

## Responsive Embedding

For responsive layouts, wrap the iframe in a container:

```html
<div style="position:relative;width:100%;padding-bottom:75%;overflow:hidden">
  <iframe
    src="https://quranobservatory.org/embed/root-network?surah=3&theme=dark"
    style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;border-radius:8px"
    loading="lazy"
    allowfullscreen
  ></iframe>
</div>
```
