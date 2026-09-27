import * as d3 from "@/lib/viz/d3";
import { motionSafeDuration } from "@/lib/viz/motionPrefs";

export interface ViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FitOptions {
  padding?: number;
  duration?: number;
  minScale?: number;
  maxScale?: number;
}

/** Class name of the fixed left dock — spine (journey rail) + body
 *  (`#viz-sidebar-portal`'s legend/zoom/selection stack) fused into one
 *  glass container (see components/shell/AppShell.tsx, `.viz-dock`). Its
 *  rect is exactly the occluded band whether the body is expanded or
 *  collapsed: a collapsed body contributes zero width inside the dock, so
 *  the dock's own rect simply measures narrower. Preferred over
 *  `FLOATING_PANEL_SELECTOR` below when present with a real box. */
const DOCK_SELECTOR = ".viz-dock";

/** Class name of the legend/zoom/selection stack itself (see
 *  components/shell/AppShell.tsx, `.viz-sidebar-stack`) — the fallback
 *  occlusion target for contexts with no dock: mobile (`.viz-dock` is
 *  `display: contents` there, so it has no box of its own to measure) and
 *  embeds that render the panel without the rest of the app shell. Single
 *  constant so a future rename only needs updating here. */
const FLOATING_PANEL_SELECTOR = ".viz-sidebar-stack";

/** Class name of the right-edge contextual drawer (see
 *  components/shell/ContextDrawer.tsx, `.context-drawer`) — an inline
 *  occluder on the OPPOSITE edge from the dock/floating-panel pair above:
 *  it docks via `inset-inline-end`, so screen-right in LTR / screen-left in
 *  RTL. Measured independently rather than folded into the same
 *  "whichever is present" pair, because a dock AND the drawer can both be
 *  open at once (e.g. a root deep link opens the drawer while the dock
 *  stays put), occluding opposite edges simultaneously. */
const DRAWER_SELECTOR = ".context-drawer";

/** Class name of the floating breadcrumb/status pill (see
 *  components/shell/StatusBar.tsx, `.status-bar`) — always centred at the
 *  TOP of the canvas, so unlike the inline pair above it occludes a
 *  horizontal band measured from the SVG's own top edge rather than either
 *  inline edge. */
const STATUS_BAR_SELECTOR = ".status-bar";

/** Class name of the floating graph mode/colour toolbar (see
 *  components/shell/GraphToolbar.tsx, `.graph-toolbar`) — always centred at
 *  the BOTTOM of the canvas, the mirror image of the status pill above.
 *  Hidden entirely below 980px (see MOBILE_VIZ_BAR_SELECTOR below). */
const GRAPH_TOOLBAR_SELECTOR = ".graph-toolbar";

/** Class name of the floating mobile viz bar (see
 *  components/ui/MobileVizBar.tsx, `.mobile-viz-bar`) — the bottom-centred
 *  pill that replaces the graph toolbar below 980px. Never mounted at the
 *  same time as a visible `.graph-toolbar` (one hides exactly where the
 *  other shows), so their bottom occlusion is combined with `Math.max`
 *  rather than summed. */
const MOBILE_VIZ_BAR_SELECTOR = ".mobile-viz-bar";

/** Horizontal inline occlusion (dock + drawer combined, see
 *  `getInlineOcclusionInset`) never eats more than this fraction of the
 *  canvas width — keeps at least 40% free even with both open at once on a
 *  narrow viewport, instead of an extreme, unusable squeeze. Matches the
 *  ratio the original single-panel clamp used. */
const MAX_INLINE_INSET_FRACTION = 0.6;

/** Vertical edge occlusion (status pill + toolbar combined, see
 *  `getVerticalOcclusionInset`) never eats more than this fraction of the
 *  canvas height — keeps at least 55% free between them. */
const MAX_VERTICAL_INSET_FRACTION = 0.45;

/** First element matching `selector` that actually occupies space on
 *  screen. Elements that are absent, `display: none`/zero-size, or
 *  `display: contents` (no box of its own — e.g. the mobile `.viz-dock`)
 *  all report a zero-size `getBoundingClientRect()` and none of them should
 *  count as an occluding panel. */
function getOccludingElement(selector: string): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? el : null;
}

interface ElementOverlap {
  /** The occluding element's own on-screen rect (not clipped to the SVG). */
  rect: DOMRect;
  /** Overlap with the SVG's on-screen rect, in CSS pixels, per axis. */
  overlapX: number;
  overlapY: number;
}

/** An occluding element's own on-screen rect, plus how much of it overlaps
 *  the SVG's own on-screen rect (in CSS pixels, per axis) — the shared
 *  arithmetic behind every occlusion measurement below. `null` when the two
 *  don't overlap at all: an absent element, or one that's off-screen (e.g.
 *  collapsed/closed via a CSS transform), contributes no occlusion. */
function getElementOverlap(el: HTMLElement | null, svgRect: DOMRect): ElementOverlap | null {
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const overlapX = Math.min(rect.right, svgRect.right) - Math.max(rect.left, svgRect.left);
  const overlapY = Math.min(rect.bottom, svgRect.bottom) - Math.max(rect.top, svgRect.top);
  if (overlapX <= 0 || overlapY <= 0) return null;
  return { rect, overlapX, overlapY };
}

/** Turn one panel's overlap into a `start`/`end` inline inset, deciding
 *  which side from the panel's on-screen position relative to the viewport
 *  centre rather than `dir`/locale — side-agnostic on purpose, since a panel
 *  can dock via `inset-inline-start` OR `inset-inline-end`, either of which
 *  flips visual side under RTL. Shared by every inline (left/right) occluder
 *  below. */
function sideInsetFromOverlap(overlap: ElementOverlap, pxToUser: number): { start: number; end: number } {
  const overlapUser = overlap.overlapX * pxToUser;
  const viewportCenter = window.innerWidth / 2;
  const panelCenter = overlap.rect.left + overlap.rect.width / 2;
  return panelCenter < viewportCenter
    ? { start: overlapUser, end: 0 } // occluder sits on the screen-left edge
    : { start: 0, end: overlapUser }; // occluder sits on the screen-right edge (RTL)
}

/**
 * How much of the SVG's own on-screen width is covered by the two inline
 * (left/right) occluders — the left dock/legend stack and the right context
 * drawer — expressed in the SVG's user-space units (the same space `bounds`
 * is in) and split into a `start` (screen-left) and `end` (screen-right)
 * inset so a caller can shrink the "visible" width from whichever side(s)
 * are occluded. Both are measured and summed independently: unlike the
 * dock/floating-panel pair (only one of which is EVER mounted at once), the
 * dock and the drawer are two separate panels that can both be open at the
 * same time, occluding opposite edges simultaneously.
 *
 * The drawer only counts while it's actually acting as a side column (its
 * on-screen box covers more of the SVG's height than its width) — below its
 * own ~980px breakpoint it becomes a full-width BOTTOM sheet instead (see
 * ContextDrawer's mobile stylesheet), and treating that shape as an inline
 * inset would claim most of the canvas width for a panel that's really
 * occluding the bottom edge, not either side. A closed drawer (translated
 * fully off-screen on both breakpoints) already reports no overlap with the
 * SVG via `getElementOverlap`, so "closed" falls out of this for free.
 *
 * Returns zero on a given side when nothing occludes it there — every
 * candidate absent, hidden (zero-size), collapsed/closed off-screen, or
 * simply not overlapping this particular SVG (e.g. an embed rendered
 * without the app shell).
 */
function getInlineOcclusionInset(svg: Element, vw: number): { start: number; end: number } {
  const svgRect = svg.getBoundingClientRect();
  if (svgRect.width <= 0 || svgRect.height <= 0) return { start: 0, end: 0 };
  const pxToUser = vw / svgRect.width;

  const dockOverlap = getElementOverlap(
    getOccludingElement(DOCK_SELECTOR) ?? getOccludingElement(FLOATING_PANEL_SELECTOR),
    svgRect
  );
  const dockInset = dockOverlap ? sideInsetFromOverlap(dockOverlap, pxToUser) : { start: 0, end: 0 };

  const drawerOverlap = getElementOverlap(getOccludingElement(DRAWER_SELECTOR), svgRect);
  const drawerInset =
    drawerOverlap && drawerOverlap.overlapX / svgRect.width < drawerOverlap.overlapY / svgRect.height
      ? sideInsetFromOverlap(drawerOverlap, pxToUser) // taller than wide → a side column
      : { start: 0, end: 0 }; // wider than tall → the mobile bottom sheet, not a side column

  return { start: dockInset.start + drawerInset.start, end: dockInset.end + drawerInset.end };
}

/**
 * How much of the SVG's own on-screen height is covered by the two
 * edge-docked (top/bottom) occluders — the status/breadcrumb pill and the
 * graph mode/colour toolbar — expressed in the SVG's user-space units and
 * split into a `top` and `bottom` inset. Unlike the inline pair above,
 * neither of these ever changes which edge it docks to (both are always
 * centred horizontally, one pinned top, one pinned bottom), so there's no
 * side to "decide" — the inset is simply the band from the SVG's own edge
 * to the occluder's near edge.
 */
function getVerticalOcclusionInset(svg: Element, vh: number): { top: number; bottom: number } {
  const svgRect = svg.getBoundingClientRect();
  if (svgRect.width <= 0 || svgRect.height <= 0) return { top: 0, bottom: 0 };
  const pxToUser = vh / svgRect.height;

  const statusBarOverlap = getElementOverlap(getOccludingElement(STATUS_BAR_SELECTOR), svgRect);
  const top = statusBarOverlap ? Math.max(0, statusBarOverlap.rect.bottom - svgRect.top) * pxToUser : 0;

  const toolbarOverlap = getElementOverlap(getOccludingElement(GRAPH_TOOLBAR_SELECTOR), svgRect);
  const toolbarBottom = toolbarOverlap ? Math.max(0, svgRect.bottom - toolbarOverlap.rect.top) * pxToUser : 0;

  // The mobile viz bar occupies the same edge the graph toolbar would on
  // desktop — the two never coexist, so Math.max (not a sum) gives the
  // correct combined inset regardless of which one is actually on screen.
  const mobileVizBarOverlap = getElementOverlap(getOccludingElement(MOBILE_VIZ_BAR_SELECTOR), svgRect);
  const mobileVizBarBottom = mobileVizBarOverlap
    ? Math.max(0, svgRect.bottom - mobileVizBarOverlap.rect.top) * pxToUser
    : 0;

  const bottom = Math.max(toolbarBottom, mobileVizBarBottom);

  return { top, bottom };
}

/**
 * Scale a pair of opposite-edge insets down (preserving their ratio) so
 * their sum never exceeds `maxTotal` — the two-sided generalisation of a
 * simple `Math.min(inset, cap)` clamp. Needed now that opposite edges can
 * each be occluded by a DIFFERENT piece of chrome at once (the left dock and
 * the right drawer; the top status pill and the bottom toolbar), so a
 * single-sided clamp alone could no longer guarantee any free space left in
 * between. Reduces to the original single-sided clamp whenever only one side
 * of the pair is non-zero.
 */
function clampInsetPair(a: number, b: number, maxTotal: number): { a: number; b: number } {
  const total = a + b;
  if (total <= maxTotal || total <= 0) return { a, b };
  const scale = maxTotal / total;
  return { a: a * scale, b: b * scale };
}

/**
 * Raw inline occlusion inset (see `getInlineOcclusionInset`), clamped so the
 * free band between the dock and the drawer can never collapse below 40% of
 * `vw` (see `MAX_INLINE_INSET_FRACTION`) — on a narrow viewport with both
 * pinned open, that keeps whatever consults this landing a legible (if
 * tighter) result instead of an extreme, unusable squeeze.
 *
 * Exported separately from `fitBoundsToView` so call sites that position
 * content WITHOUT going through a zoom-to-fit — e.g. a fixed-scale initial
 * centering that only translates, never scales, like
 * AyahDependencyGraph's default tree layout — can still steer clear of the
 * floating chrome using the exact same measurement + clamp `fitBoundsToView`
 * itself relies on.
 */
/**
 * The part of an element's own box that shell chrome does not cover, in CSS
 * pixels relative to that element — the dock, the context drawer, the status
 * pill and the graph toolbar, measured and clamped exactly as fitGraphToView
 * does. The canvas counterpart of that function, for modes that draw to a
 * <canvas> instead of a zoomable SVG and so have no viewBox to fit.
 */
export function getVisibleArea(el: Element): { x: number; y: number; width: number; height: number } {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0, width: rect.width, height: rect.height };
  const inline = getInlineOcclusionInset(el, rect.width);
  const vertical = getVerticalOcclusionInset(el, rect.height);
  const h = clampInsetPair(inline.start, inline.end, rect.width * MAX_INLINE_INSET_FRACTION);
  const v = clampInsetPair(vertical.top, vertical.bottom, rect.height * MAX_VERTICAL_INSET_FRACTION);
  return { x: h.a, y: v.a, width: rect.width - h.a - h.b, height: rect.height - v.a - v.b };
}

export function getPanelAdjustedWidth(
  svg: SVGSVGElement | null,
  vw: number
): { insetStart: number; insetEnd: number; availableWidth: number } {
  if (!svg || !vw) return { insetStart: 0, insetEnd: 0, availableWidth: vw };
  const rawInset = getInlineOcclusionInset(svg, vw);
  const { a: insetStart, b: insetEnd } = clampInsetPair(rawInset.start, rawInset.end, vw * MAX_INLINE_INSET_FRACTION);
  return { insetStart, insetEnd, availableWidth: vw - insetStart - insetEnd };
}

/**
 * Frame an explicit region (in the graph's own user-space coordinates) within
 * an SVG's viewport, centring it with a little breathing room instead of
 * resetting to the identity transform.
 *
 * This is the primitive `fitGraphToView` builds on: that function always
 * measures the *entire* rendered graph via `getBBox()`, while this one lets a
 * caller pass a specific region to frame instead — e.g. just the content
 * relevant to an initial deep-linked focus, so some unrelated far-flung part
 * of the graph can't drag the shot wide and leave the interesting bit cropped.
 */
export function fitBoundsToView(
  svg: SVGSVGElement | null,
  bounds: ViewBounds | null | undefined,
  // d3's ZoomBehavior is generic over the element type; callers pass their own.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  zoom: d3.ZoomBehavior<any, unknown> | null | undefined,
  opts: FitOptions = {}
): void {
  const { padding = 0.88, minScale = 0.1, maxScale = 8 } = opts;
  // Reduced motion wins even over an explicit caller duration — callers pass
  // *intent* ("animated glide"), but the user preference decides whether that
  // intent renders as a glide or an instant jump. Non-reduced behavior is
  // unchanged (motionSafeDuration is the identity there).
  const duration = motionSafeDuration(opts.duration ?? 750);
  if (!svg || !zoom || !bounds || bounds.width === 0 || bounds.height === 0) return;

  // Prefer the SVG's user-space viewBox; fall back to its pixel size (assume 1:1).
  const vb = svg.viewBox?.baseVal;
  const vw = vb && vb.width ? vb.width : svg.clientWidth;
  const vh = vb && vb.height ? vb.height : svg.clientHeight;
  if (!vw || !vh) return;
  // The viewBox ORIGIN, which is not always 0,0. Every viz here draws with a
  // top-left origin except the corpus structure map, which centres its own
  // coordinate system ("-r -r 2r 2r") so polar geometry can be written around
  // 0,0. `bounds` and `getBBox()` are in that same user space, and the
  // translate computed below has to land the framed centre at a user-space
  // coordinate — so the target point must be measured FROM the viewBox origin,
  // not from zero. Omitting these shifted that map's every fit by `r`, which
  // pushed the graph almost entirely off-screen. A no-op for the 0,0 cases.
  const vbx = vb && vb.width ? vb.x : 0;
  const vby = vb && vb.height ? vb.y : 0;

  // Floating chrome sits ON TOP of the canvas (fixed, docked to an edge), not
  // beside it — a fit centred on the FULL canvas can seat content half-hidden
  // underneath it. Frame within whatever rectangle is actually free of all of
  // it instead; zero on a given side when the chrome occluding it is absent,
  // hidden, or collapsed/closed off-screen (mobile, embeds).
  const { insetStart, availableWidth } = getPanelAdjustedWidth(svg, vw);

  // Same treatment on the vertical axis — the status pill (top) and the
  // graph toolbar (bottom) — clamped jointly the same way (see
  // `clampInsetPair`) since both are mounted essentially all the time and
  // would otherwise be free to eat an unbounded amount of height between them.
  const rawVerticalInset = getVerticalOcclusionInset(svg, vh);
  const { a: insetTop, b: insetBottom } = clampInsetPair(
    rawVerticalInset.top,
    rawVerticalInset.bottom,
    vh * MAX_VERTICAL_INSET_FRACTION
  );
  const availableHeight = vh - insetTop - insetBottom;

  const scale = Math.max(
    minScale,
    Math.min(maxScale, padding * Math.min(availableWidth / bounds.width, availableHeight / bounds.height))
  );
  const visibleCenterX = insetStart + availableWidth / 2;
  const visibleCenterY = insetTop + availableHeight / 2;
  const tx = vbx + visibleCenterX - scale * (bounds.x + bounds.width / 2);
  const ty = vby + visibleCenterY - scale * (bounds.y + bounds.height / 2);
  const transform = d3.zoomIdentity.translate(tx, ty).scale(scale);

  d3.select<SVGSVGElement, unknown>(svg)
    .transition()
    .duration(duration)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .call((zoom as any).transform, transform);
}

/**
 * Frame an ENTIRE D3 graph within its SVG viewport — a true zoom-to-fit.
 *
 * Works for any visualization that drives pan/zoom through a `d3.zoom` behavior
 * applied to `svg`, transforming the inner `g`. It measures the rendered
 * content's bounding box and centres it with a little breathing room, instead of
 * resetting to the identity transform (which can crop the graph or zoom into its
 * middle when the drawing is larger than the viewport).
 *
 * Shared by the `useZoom` hook and the force-directed graphs that manage their
 * own zoom behavior, so every "Focus" control behaves identically.
 */
export function fitGraphToView(
  svg: SVGSVGElement | null,
  g: SVGGElement | null,
  // d3's ZoomBehavior is generic over the element type; callers pass their own.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  zoom: d3.ZoomBehavior<any, unknown> | null | undefined,
  opts: FitOptions = {}
): void {
  if (!svg || !g || !zoom) return;

  let bbox: DOMRect;
  try {
    bbox = g.getBBox();
  } catch {
    return;
  }
  if (!bbox || bbox.width === 0 || bbox.height === 0) return;

  fitBoundsToView(svg, bbox, zoom, opts);
}
