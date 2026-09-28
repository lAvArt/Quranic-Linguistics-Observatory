export type LexicalColorMode = "theme" | "frequency" | "identity";

const LEXICAL_COLOR_MODES: readonly LexicalColorMode[] = ["theme", "frequency", "identity"];

// Rare → frequent, from a recessive slate up through the data spectrum's teal,
// yellow and amber to coral, so the commonest roots are the warmest. The old
// ramps were stock Tailwind rainbows (blue → cyan → green → amber → rose).
const LIGHT_FREQUENCY_STOPS = ["#b3c0bf", "#0f766e", "#a16207", "#b45309", "#b8431f"] as const;
const DARK_FREQUENCY_STOPS = ["#3d5862", "#56a697", "#e6c24e", "#e8924a", "#dd6a47"] as const;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function channelToHex(channel: number): string {
  return Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0");
}

function parseHexColor(color: string): { r: number; g: number; b: number } {
  const normalized = color.trim().replace(/^#/, "");
  const safe = /^[0-9a-fA-F]{6}$/.test(normalized) ? normalized : "000000";
  return {
    r: Number.parseInt(safe.slice(0, 2), 16),
    g: Number.parseInt(safe.slice(2, 4), 16),
    b: Number.parseInt(safe.slice(4, 6), 16),
  };
}

function mixColors(colorA: string, colorB: string, t: number): string {
  const ratio = clamp01(t);
  const a = parseHexColor(colorA);
  const b = parseHexColor(colorB);
  return `#${channelToHex(a.r + (b.r - a.r) * ratio)}${channelToHex(a.g + (b.g - a.g) * ratio)}${channelToHex(a.b + (b.b - a.b) * ratio)}`;
}

function sampleGradient(stops: readonly string[], ratio: number): string {
  const t = clamp01(ratio);
  if (stops.length === 0) return "#000000";
  if (stops.length === 1) return stops[0];

  const scaled = t * (stops.length - 1);
  const startIdx = Math.floor(scaled);
  const endIdx = Math.min(stops.length - 1, startIdx + 1);
  const localT = scaled - startIdx;
  return mixColors(stops[startIdx], stops[endIdx], localT);
}

function hashToUnit(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

export function isValidLexicalColorMode(value: unknown): value is LexicalColorMode {
  return typeof value === "string" && LEXICAL_COLOR_MODES.includes(value as LexicalColorMode);
}

export function getFrequencyColor(ratio: number, theme: "light" | "dark"): string {
  const stops = theme === "dark" ? DARK_FREQUENCY_STOPS : LIGHT_FREQUENCY_STOPS;
  return sampleGradient(stops, ratio);
}

export function getIdentityColor(seed: string, theme: "light" | "dark"): string {
  const unit = hashToUnit(seed);
  const hue = Math.round(unit * 360);
  const saturation = theme === "dark" ? 74 : 66;
  const lightness = theme === "dark" ? 60 : 44;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}
