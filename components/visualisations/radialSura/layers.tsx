"use client";

/**
 * The Radial Surah map's heavy layers, memoised so hover and selection never
 * re-render them (docs/VIZ_ARCHITECTURE.md, "Radial Surah"). They take only
 * values that change on a deliberate act — the surah, the pinned root, a
 * selected ayah, a zoom threshold crossed — and stable handlers. Hover
 * emphasis is drawn on top by the component itself, from a handful of
 * elements.
 */
import { memo, useEffect, useRef, type MouseEvent, type PointerEvent } from "react";
import { motion } from "framer-motion";
import * as d3 from "@/lib/viz/d3";
import { SELECTION_RING } from "@/lib/schema/visualizationTypes";
import { motionSafeDuration, motionSafeStagger } from "@/lib/viz/motionPrefs";

export interface RootConnection {
  sourceAyah: number;
  targetAyah: number;
  root: string;
  count: number;
  color: string;
}

export interface AyahBar {
  ayah: number;
  tokenCount: number;
  angle: number;
  barHeight: number;
  dominantPOS: string;
  color: string;
}

export interface AyahRootEntry {
  root: string;
  count: number;
  globalCount: number;
  lemmas: string[];
}

export interface AyahRootNode extends AyahRootEntry {
  x: number;
  y: number;
  r: number;
  labelX: number;
  labelY: number;
  baseColor: string;
}

export interface BarGeometry {
  bar: AyahBar;
  angleRad: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  rootNodes: AyahRootNode[];
}

export interface OverviewTick {
  ayah: number;
  tokenCount: number;
  angleRad: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  color: string;
  isMatch: boolean;
}

/** Stable across renders: each forwards to the component's latest handler. */
export interface RadialHandlers {
  barHover: (ayah: number | null) => void;
  ayahClick: (ayah: number) => void;
  rootHover: (ayah: number | null, root: string | null) => void;
  rootClick: (event: MouseEvent<SVGCircleElement | SVGTextElement>, ayah: number, root: string) => void;
  connHover: (conn: RootConnection | null) => void;
  connClick: (event: MouseEvent<SVGPathElement>, conn: RootConnection) => void;
  tickMove: (event: PointerEvent<SVGCircleElement>) => void;
  tickLeave: () => void;
  tickClick: (event: MouseEvent<SVGCircleElement>) => void;
}

const DIM_OPACITY = 0.38;
const DIM_SATURATION_RETAIN = 0.4;

/** A quieter version of a hue: still that part of speech or root, clearly not the match. */
export function dimTone(color: string, opacity: number = DIM_OPACITY): string {
  const hsl = d3.hsl(color);
  hsl.s *= DIM_SATURATION_RETAIN;
  hsl.opacity = opacity;
  return hsl.toString();
}

/**
 * A root's arc colour in the default colour mode: one of the two accents,
 * fixed per root. The web used to stroke every arc with an SVG gradient
 * (amber → teal → amber across each arc's own box); the browser builds that
 * per path, and it was most of the cost of a zoom frame on a long surah. Two
 * solid tones keep the woven two-colour web at a fraction of the paint.
 */
export function twoTone(root: string, a: string, b: string): string {
  let h = 0;
  for (let i = 0; i < root.length; i++) h = (h * 31 + root.charCodeAt(i)) | 0;
  return h & 1 ? b : a;
}

/** Keys this layer instance has already drawn in, so an element animates once per surah, not on every remount. */
function useSeen() {
  const seen = useRef(new Set<string>());
  const pending = useRef<string[]>([]);
  useEffect(() => {
    for (const k of pending.current) seen.current.add(k);
    pending.current = [];
  });
  return (key: string) => {
    if (seen.current.has(key)) return true;
    pending.current.push(key);
    return false;
  };
}

/* ───────────────────────── detail: connections ───────────────────────── */

interface DetailConnectionsProps {
  connections: RootConnection[];
  paths: Map<string, string>;
  highlightRoot: string | null;
  lexicalTheme: boolean;
  accent: string;
  accentSecondary: string;
  /** Draw-in on first appearance; off for dense surahs. */
  animate: boolean;
  handlers: RadialHandlers;
}

export const DetailConnections = memo(function DetailConnections({ connections, paths, highlightRoot, lexicalTheme, accent, accentSecondary, animate, handlers }: DetailConnectionsProps) {
  const seen = useSeen();
  // With a root pinned, the other roots' arcs dim further, so its own read
  // as the signal while the surah's web stays faintly present.
  const dimmedOpacity = highlightRoot ? 0.2 : 0.3;
  return (
    <g className="connections">
      {connections.map((conn, idx) => {
        const key = `${conn.sourceAyah}-${conn.targetAyah}-${conn.root}`;
        const isHighlighted = !!highlightRoot && conn.root === highlightRoot;
        const d = paths.get(`${conn.sourceAyah}-${conn.targetAyah}`) ?? "";
        const stroke = isHighlighted ? accent : lexicalTheme ? twoTone(conn.root, accent, accentSecondary) : conn.color;
        const drawIn = animate && !seen(key);
        return (
          <g key={key}>
            {animate ? (
              <motion.path
                d={d}
                className={`connection ${isHighlighted ? "highlighted" : ""}`}
                stroke={stroke}
                strokeWidth={isHighlighted ? 2.5 : 1.5}
                fill="none"
                pointerEvents="none"
                initial={drawIn ? { pathLength: 0, opacity: 0 } : false}
                animate={{ pathLength: 1, opacity: isHighlighted ? 1 : dimmedOpacity }}
                transition={{ duration: motionSafeDuration(1100) / 1000, delay: drawIn ? motionSafeStagger(idx, 12) / 1000 : 0 }}
                filter={isHighlighted ? "url(#glow)" : undefined}
              />
            ) : (
              <path
                d={d}
                className={`connection ${isHighlighted ? "highlighted" : ""}`}
                stroke={stroke}
                strokeWidth={isHighlighted ? 2.5 : 1.5}
                style={{ opacity: isHighlighted ? 1 : dimmedOpacity }}
                fill="none"
                pointerEvents="none"
                filter={isHighlighted ? "url(#glow)" : undefined}
              />
            )}
            <path
              d={d}
              className="rs-hit"
              stroke="transparent"
              strokeWidth={12}
              fill="none"
              pointerEvents="stroke"
              style={{ cursor: "pointer" }}
              onPointerDown={(event) => event.stopPropagation()}
              onMouseEnter={() => handlers.connHover(conn)}
              onMouseLeave={() => handlers.connHover(null)}
              onClick={(event) => handlers.connClick(event, conn)}
            />
          </g>
        );
      })}
    </g>
  );
});

/* ───────────────────────── detail: bars ───────────────────────── */

interface DetailBarsProps {
  bars: BarGeometry[];
  selectedAyah: number | null;
  highlightRoot: string | null;
  highlightAyahSet: Set<number>;
  maxRootsVisible: number;
  showContextRootLabels: boolean;
  showAllRootLabels: boolean;
  /** 0 = emphasised ayah numbers only, 1 = sparse, 2 = every ayah. */
  ayahLabelLevel: 0 | 1 | 2;
  ayahCount: number;
  compactLayout: boolean;
  barStrokeWidth: number;
  endpointRadius: number;
  innerRadius: number;
  centerX: number;
  centerY: number;
  dark: boolean;
  accent: string;
  animate: boolean;
  formatLemmaLabel: (lemmas: string[]) => string;
  handlers: RadialHandlers;
}

/** Which of an ayah's roots are drawn at rest: the first few, all of them for a focused ayah, plus the pinned root. */
export function visibleRootNodesFor(nodes: AyahRootNode[], focused: boolean, maxRootsVisible: number, highlightRoot: string | null): AyahRootNode[] {
  let visible = !focused && Number.isFinite(maxRootsVisible) ? nodes.slice(0, maxRootsVisible) : nodes;
  if (highlightRoot) {
    const pinned = nodes.find((n) => n.root === highlightRoot);
    if (pinned && !visible.includes(pinned)) visible = [...visible, pinned];
  }
  return visible;
}

export function sparseLabelInterval(ayahCount: number): number {
  return ayahCount > 180 ? 8 : ayahCount > 120 ? 6 : ayahCount > 80 ? 4 : ayahCount > 50 ? 3 : 2;
}

export function rootLabelFontSize(showAll: boolean, compact: boolean): number {
  return showAll ? (compact ? 7.6 : 8.2) : compact ? 6.8 : 7.2;
}

export const DetailBars = memo(function DetailBars(props: DetailBarsProps) {
  const {
    bars,
    selectedAyah,
    highlightRoot,
    highlightAyahSet,
    maxRootsVisible,
    showContextRootLabels,
    showAllRootLabels,
    ayahLabelLevel,
    ayahCount,
    compactLayout,
    barStrokeWidth,
    endpointRadius,
    innerRadius,
    centerX,
    centerY,
    dark,
    accent,
    animate,
    formatLemmaLabel,
    handlers,
  } = props;
  const seen = useSeen();
  const sparse = sparseLabelInterval(ayahCount);
  const highlightedRootColor = dark ? SELECTION_RING : "#1f1c19";
  return (
    <g className="ayah-bars">
      {bars.map(({ bar, angleRad, startX, startY, endX, endY, rootNodes }, barIndex) => {
        const isSelected = selectedAyah === bar.ayah;
        const isFocusedAyah = isSelected || highlightAyahSet.has(bar.ayah);
        const visibleRootNodes = visibleRootNodesFor(rootNodes, isFocusedAyah, maxRootsVisible, highlightRoot);
        const labelAnchor = angleRad > Math.PI / 2 && angleRad < (3 * Math.PI) / 2 ? "end" : "start";

        const content = (
          <>
            <line
              x1={startX}
              y1={startY}
              x2={endX}
              y2={endY}
              className="bar colored"
              stroke={isSelected ? accent : bar.color}
              strokeWidth={isSelected ? barStrokeWidth + 1.4 : barStrokeWidth}
              strokeLinecap="round"
              filter={isSelected ? "url(#strongGlow)" : undefined}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => handlers.barHover(bar.ayah)}
              onMouseLeave={() => handlers.barHover(null)}
              onClick={(event) => {
                event.stopPropagation();
                handlers.ayahClick(bar.ayah);
              }}
            />
            {visibleRootNodes.map((node, nodeIndex) => {
              const isRootHighlighted = highlightRoot === node.root;
              const isDimmed = !!highlightRoot && node.root !== highlightRoot;
              const displayRadius = isRootHighlighted ? node.r + 0.7 : node.r;
              const tintColor = isDimmed ? dimTone(node.baseColor, 1) : node.baseColor;
              const showLabel =
                isRootHighlighted ||
                (showAllRootLabels && displayRadius >= 1.75) ||
                (showContextRootLabels && isFocusedAyah && displayRadius >= 1.55);
              const isLemmaLabel = isRootHighlighted && node.lemmas.length > 0;
              const perpDir = nodeIndex % 2 === 0 ? 1 : -1;
              const circlePerp = isLemmaLabel ? (compactLayout ? 6.5 : 8.5) : 0;
              const circleRadial = isLemmaLabel ? (compactLayout ? 2.6 : 3.4) : 0;
              const circleX = node.x + Math.cos(angleRad) * circleRadial + Math.cos(angleRad + Math.PI / 2) * perpDir * circlePerp;
              const circleY = node.y + Math.sin(angleRad) * circleRadial + Math.sin(angleRad + Math.PI / 2) * perpDir * circlePerp;
              const labelYOffset = showAllRootLabels ? (nodeIndex % 2 === 0 ? -0.75 : 0.75) : 0;
              const baseFont = rootLabelFontSize(showAllRootLabels, compactLayout);
              const fontSize = isLemmaLabel ? baseFont + (compactLayout ? 12.8 : 16.4) : baseFont;
              const labelPerp = isLemmaLabel ? (compactLayout ? 5.5 : 7.2) : 0;
              const labelX = isLemmaLabel
                ? circleX + Math.cos(angleRad) * (displayRadius + 4) + Math.cos(angleRad + Math.PI / 2) * perpDir * labelPerp
                : node.labelX;
              const labelY = isLemmaLabel
                ? circleY + Math.sin(angleRad) * (displayRadius + 4) + Math.sin(angleRad + Math.PI / 2) * perpDir * labelPerp
                : node.labelY;
              return (
                <g key={`${bar.ayah}-${node.root}`}>
                  <circle
                    cx={circleX}
                    cy={circleY}
                    r={displayRadius}
                    fill="transparent"
                    stroke={isRootHighlighted ? highlightedRootColor : tintColor}
                    strokeWidth={isRootHighlighted ? 2.5 : 1.8}
                    opacity={isDimmed ? 0.38 : 0.9}
                    filter={isRootHighlighted ? "url(#glow)" : undefined}
                    style={{ cursor: "pointer" }}
                    onMouseEnter={() => handlers.rootHover(bar.ayah, node.root)}
                    onMouseLeave={() => handlers.rootHover(null, null)}
                    onClick={(event) => handlers.rootClick(event, bar.ayah, node.root)}
                  />
                  {isRootHighlighted && (
                    <circle
                      cx={circleX}
                      cy={circleY}
                      r={displayRadius + 6}
                      fill="none"
                      stroke={SELECTION_RING}
                      strokeWidth={1.6}
                      opacity={0.95}
                      filter="url(#selectionGlow)"
                      pointerEvents="none"
                    />
                  )}
                  {showLabel && (
                    <text
                      x={labelX}
                      y={labelY + labelYOffset}
                      textAnchor={labelAnchor}
                      className="arabic-text"
                      fill={
                        isRootHighlighted
                          ? highlightedRootColor
                          : isDimmed
                            ? dark
                              ? "rgba(255,255,255,0.32)"
                              : "rgba(31, 28, 25, 0.32)"
                            : dark
                              ? "rgba(255,255,255,0.78)"
                              : "rgba(31, 28, 25, 0.78)"
                      }
                      fontSize={fontSize}
                      fontWeight={isRootHighlighted ? 600 : 500}
                      stroke={isLemmaLabel ? (dark ? "rgba(6, 9, 18, 0.9)" : "rgba(248, 246, 238, 0.92)") : "transparent"}
                      strokeWidth={isLemmaLabel ? 1.8 : 0}
                      paintOrder="stroke fill"
                      pointerEvents="none"
                    >
                      {isLemmaLabel ? formatLemmaLabel(node.lemmas) : node.root}
                    </text>
                  )}
                </g>
              );
            })}
            <circle cx={endX} cy={endY} r={isSelected ? endpointRadius + 1.5 : endpointRadius} fill={isSelected ? accent : bar.color} filter={isSelected ? "url(#glow)" : undefined} />
            {isSelected && (
              <circle cx={endX} cy={endY} r={endpointRadius + 7} fill="none" stroke={SELECTION_RING} strokeWidth={1.6} opacity={0.95} filter="url(#selectionGlow)" pointerEvents="none" />
            )}
            <circle
              cx={endX}
              cy={endY}
              r={12}
              fill="transparent"
              style={{ cursor: "pointer" }}
              onMouseEnter={() => handlers.barHover(bar.ayah)}
              onMouseLeave={() => handlers.barHover(null)}
              onClick={(event) => {
                event.stopPropagation();
                handlers.ayahClick(bar.ayah);
              }}
            />
            {(() => {
              const isEmphasized = highlightAyahSet.has(bar.ayah) || isSelected;
              // Numbers are the graph's orientation cue: sparse as soon as
              // detail appears, all of them a nudge of zoom later.
              const show = isEmphasized || ayahLabelLevel === 2 || (ayahLabelLevel === 1 && barIndex % sparse === 0);
              if (!show) return null;
              const labelRadius = innerRadius + bar.barHeight + (compactLayout ? 14 : 18);
              return (
                <text
                  x={centerX + Math.cos(angleRad) * labelRadius}
                  y={centerY + Math.sin(angleRad) * labelRadius}
                  textAnchor={labelAnchor}
                  fill={isEmphasized ? (dark ? "rgba(255,255,255,0.95)" : "rgba(31, 28, 25, 0.95)") : dark ? "rgba(255,255,255,0.22)" : "rgba(31, 28, 25, 0.36)"}
                  fontSize={isSelected ? (compactLayout ? "14.5" : "18.5") : isEmphasized ? (compactLayout ? "9.5" : "11.5") : compactLayout ? "8.5" : "10"}
                  fontWeight={isEmphasized ? 600 : 400}
                  style={{ pointerEvents: "none" }}
                >
                  {bar.ayah}
                </text>
              );
            })()}
          </>
        );

        const fadeIn = animate && !seen(String(bar.ayah));
        return animate ? (
          <motion.g
            key={bar.ayah}
            initial={fadeIn ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            transition={{ delay: fadeIn ? motionSafeStagger(bar.ayah, 12) / 1000 : 0 }}
          >
            {content}
          </motion.g>
        ) : (
          <g key={bar.ayah}>{content}</g>
        );
      })}
    </g>
  );
});

/* ───────────────────────── overview: ticks ───────────────────────── */

interface OverviewTicksProps {
  ticks: OverviewTick[];
  ticksByAyah: Map<number, OverviewTick>;
  selectedAyah: number | null;
  ayahCount: number;
  innerRadius: number;
  centerX: number;
  centerY: number;
  bandOuter: number;
  accent: string;
  muted: string;
  handlers: RadialHandlers;
}

export function tickStrokeBase(innerRadius: number): number {
  return Math.max(1.6, innerRadius * 0.0035);
}

export const OverviewTicks = memo(function OverviewTicks({ ticks, ticksByAyah, selectedAyah, ayahCount, innerRadius, centerX, centerY, bandOuter, accent, muted, handlers }: OverviewTicksProps) {
  const base = tickStrokeBase(innerRadius);
  const step = ayahCount > 200 ? 25 : ayahCount > 80 ? 20 : 10;
  const milestones: number[] = [1];
  for (let a = step; a <= ayahCount; a += step) milestones.push(a);
  const labelRadius = innerRadius * 0.94;
  const fontSize = Math.max(9, innerRadius * 0.02);
  return (
    <g className="ayah-ticks">
      {ticks.map((tick) => {
        const isSelected = selectedAyah === tick.ayah;
        return (
          <line
            key={tick.ayah}
            x1={tick.startX}
            y1={tick.startY}
            x2={tick.endX}
            y2={tick.endY}
            stroke={isSelected ? accent : tick.color}
            strokeWidth={isSelected ? base * 2 : tick.isMatch ? base * 1.6 : base}
            strokeLinecap="round"
            filter={isSelected ? "url(#glow)" : undefined}
            pointerEvents="none"
          />
        );
      })}
      {/* Ayah-number milestones just inside the ring: which part of the surah am I looking at? */}
      {milestones.map((ayah) => {
        const tick = ticksByAyah.get(ayah);
        if (!tick) return null;
        return (
          <text
            key={`ayah-label-${ayah}`}
            x={centerX + Math.cos(tick.angleRad) * labelRadius}
            y={centerY + Math.sin(tick.angleRad) * labelRadius}
            textAnchor="middle"
            dominantBaseline="central"
            fill={muted}
            fontSize={fontSize}
            pointerEvents="none"
            style={{ opacity: 0.75, fontVariantNumeric: "tabular-nums" }}
          >
            {ayah}
          </text>
        );
      })}
      {/* One invisible hit band over the whole tick ring: the pointer's angle
          names the ayah. pointerdown is not stopped, so a drag here still pans. */}
      <circle
        className="ayah-tick-hit"
        cx={centerX}
        cy={centerY}
        r={innerRadius + bandOuter / 2}
        fill="none"
        stroke="transparent"
        strokeWidth={bandOuter + innerRadius * 0.08}
        pointerEvents="stroke"
        style={{ cursor: "pointer" }}
        onPointerMove={handlers.tickMove}
        onPointerLeave={handlers.tickLeave}
        onClick={handlers.tickClick}
      />
    </g>
  );
});

/* ───────────────────────── overview: arcs ───────────────────────── */

interface OverviewArcsProps {
  arcs: { key: string; d: string; conn: RootConnection }[];
  /** Mesh: the faint web; highlight: the pinned root's arcs. */
  variant: "mesh" | "highlight";
  strokeWidth: number;
  lexicalTheme: boolean;
  accent: string;
  accentSecondary: string;
  handlers: RadialHandlers;
}

export const OverviewArcs = memo(function OverviewArcs({ arcs, variant, strokeWidth, lexicalTheme, accent, accentSecondary, handlers }: OverviewArcsProps) {
  return (
    <g className={`overview-connections${variant === "mesh" ? " overview-mesh" : ""}`}>
      {arcs.map(({ key, d, conn }) => (
        <g key={key}>
          <path
            d={d}
            className="connection"
            stroke={variant === "highlight" ? accent : lexicalTheme ? twoTone(conn.root, accent, accentSecondary) : conn.color}
            strokeWidth={strokeWidth}
            fill="none"
            pointerEvents="none"
            style={{ opacity: variant === "highlight" ? 0.45 : 0.3 }}
          />
          {/* Invisible hit target, non-scaling so the hairline stays clickable when fitted out. */}
          <path
            d={d}
            className="rs-hit"
            stroke="transparent"
            strokeWidth={14}
            vectorEffect="non-scaling-stroke"
            fill="none"
            pointerEvents="stroke"
            style={{ cursor: "pointer" }}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseEnter={() => handlers.connHover(conn)}
            onMouseLeave={() => handlers.connHover(null)}
            onClick={(event) => handlers.connClick(event, conn)}
          />
        </g>
      ))}
    </g>
  );
});
