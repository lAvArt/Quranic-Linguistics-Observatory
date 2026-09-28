export type ColorThemeId = "teal-amber" | "ember-cyan" | "royal-gold" | "forest-rose" | "mono-azure" | "custom";
type PresetColorThemeId = Exclude<ColorThemeId, "custom">;

interface ColorThemeTokens {
  accent: string;
  accent2: string;
  accent3: string;
  accentGlow: string;
  accent2Glow: string;
}

export interface CustomColorThemePalette {
  accent: string;
  accent2: string;
  accent3: string;
  bg0: string;
  bg1: string;
  bg2: string;
}

export interface CustomColorTheme {
  light: CustomColorThemePalette;
  dark: CustomColorThemePalette;
}

export interface ColorThemePreset {
  id: PresetColorThemeId;
  labelKey: "tealAmber" | "emberCyan" | "royalGold" | "forestRose" | "monoAzure";
  preview: readonly [string, string, string];
  light: ColorThemeTokens;
  dark: ColorThemeTokens;
}

export const DEFAULT_COLOR_THEME_ID: ColorThemeId = "teal-amber";
export const DEFAULT_CUSTOM_COLOR_THEME: CustomColorTheme = {
  light: {
    // Teal, amber, violet: the dark theme's families, deepened for parchment.
    accent: "#0f766e",
    accent2: "#b45309",
    accent3: "#6d28d9",
    bg0: "#f7f3ea",
    bg1: "#efe6d6",
    bg2: "#e6dcc9",
  },
  dark: {
    // Observatory dark — cool slate-teal canvas (derived from the design
    // reference image) with warm amber + teal + violet accents.
    accent: "#e8924a",
    accent2: "#56a697",
    accent3: "#8e84cc",
    bg0: "#0e161a",
    bg1: "#142026",
    bg2: "#1c2a31",
  },
};

export const COLOR_THEME_PRESETS: readonly ColorThemePreset[] = [
  {
    id: "teal-amber",
    labelKey: "tealAmber",
    preview: ["#0f766e", "#b45309", "#6d28d9"],
    light: {
      accent: "#0f766e",
      accent2: "#b45309",
      accent3: "#6d28d9",
      accentGlow: "rgba(15, 118, 110, 0.4)",
      accent2Glow: "rgba(180, 83, 9, 0.45)",
    },
    dark: {
      // Observatory dark — warm amber primary, teal + violet secondaries.
      accent: "#e8924a",
      accent2: "#56a697",
      accent3: "#8e84cc",
      accentGlow: "rgba(232, 146, 74, 0.5)",
      accent2Glow: "rgba(86, 166, 151, 0.45)",
    },
  },
  {
    id: "ember-cyan",
    labelKey: "emberCyan",
    preview: ["#dc2626", "#0891b2", "#f97316"],
    light: {
      accent: "#dc2626",
      accent2: "#0891b2",
      accent3: "#f97316",
      accentGlow: "rgba(220, 38, 38, 0.38)",
      accent2Glow: "rgba(8, 145, 178, 0.4)",
    },
    dark: {
      accent: "#fb7185",
      accent2: "#67e8f9",
      accent3: "#fbbf24",
      accentGlow: "rgba(251, 113, 133, 0.5)",
      accent2Glow: "rgba(103, 232, 249, 0.45)",
    },
  },
  {
    id: "royal-gold",
    labelKey: "royalGold",
    preview: ["#4f46e5", "#ca8a04", "#0f766e"],
    light: {
      accent: "#4f46e5",
      accent2: "#ca8a04",
      accent3: "#0f766e",
      accentGlow: "rgba(79, 70, 229, 0.4)",
      accent2Glow: "rgba(202, 138, 4, 0.42)",
    },
    dark: {
      accent: "#a78bfa",
      accent2: "#facc15",
      accent3: "#5eead4",
      accentGlow: "rgba(167, 139, 250, 0.52)",
      accent2Glow: "rgba(250, 204, 21, 0.46)",
    },
  },
  {
    id: "forest-rose",
    labelKey: "forestRose",
    preview: ["#15803d", "#e11d48", "#0ea5e9"],
    light: {
      accent: "#15803d",
      accent2: "#e11d48",
      accent3: "#0ea5e9",
      accentGlow: "rgba(21, 128, 61, 0.36)",
      accent2Glow: "rgba(225, 29, 72, 0.38)",
    },
    dark: {
      accent: "#4ade80",
      accent2: "#fb7185",
      accent3: "#38bdf8",
      accentGlow: "rgba(74, 222, 128, 0.44)",
      accent2Glow: "rgba(251, 113, 133, 0.46)",
    },
  },
  {
    id: "mono-azure",
    labelKey: "monoAzure",
    preview: ["#1d4ed8", "#0ea5e9", "#38bdf8"],
    light: {
      accent: "#1d4ed8",
      accent2: "#0ea5e9",
      accent3: "#38bdf8",
      accentGlow: "rgba(29, 78, 216, 0.4)",
      accent2Glow: "rgba(14, 165, 233, 0.42)",
    },
    dark: {
      accent: "#60a5fa",
      accent2: "#22d3ee",
      accent3: "#a5b4fc",
      accentGlow: "rgba(96, 165, 250, 0.48)",
      accent2Glow: "rgba(34, 211, 238, 0.48)",
    },
  },
];

export function isValidColorThemeId(value: unknown): value is ColorThemeId {
  return (
    value === "custom" ||
    (typeof value === "string" && COLOR_THEME_PRESETS.some((preset) => preset.id === value))
  );
}

export function getColorThemePreset(id: PresetColorThemeId): ColorThemePreset {
  const preset = COLOR_THEME_PRESETS.find((entry) => entry.id === id);
  if (preset) return preset;
  return COLOR_THEME_PRESETS[0];
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.trim().replace(/^#/, "");
  const safe = /^[0-9a-fA-F]{6}$/.test(normalized) ? normalized : "000000";
  const r = Number.parseInt(safe.slice(0, 2), 16);
  const g = Number.parseInt(safe.slice(2, 4), 16);
  const b = Number.parseInt(safe.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function isValidHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

export function isValidCustomColorTheme(value: unknown): value is CustomColorTheme {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CustomColorTheme>;
  if (!candidate.light || !candidate.dark) return false;

  const isPaletteValid = (palette: Partial<CustomColorThemePalette> | undefined) =>
    Boolean(
      palette &&
      isValidHexColor(palette.accent) &&
      isValidHexColor(palette.accent2) &&
      isValidHexColor(palette.accent3) &&
      isValidHexColor(palette.bg0) &&
      isValidHexColor(palette.bg1) &&
      isValidHexColor(palette.bg2)
    );

  return isPaletteValid(candidate.light) && isPaletteValid(candidate.dark);
}

export function resolveColorThemeCssVariables(
  id: ColorThemeId,
  appearance: "light" | "dark",
  customTheme: CustomColorTheme = DEFAULT_CUSTOM_COLOR_THEME
): Record<string, string> {
  const tokens =
    id === "custom"
      ? {
          accent: customTheme[appearance].accent,
          accent2: customTheme[appearance].accent2,
          accent3: customTheme[appearance].accent3,
          accentGlow: hexToRgba(customTheme[appearance].accent, appearance === "dark" ? 0.52 : 0.42),
          accent2Glow: hexToRgba(customTheme[appearance].accent2, appearance === "dark" ? 0.5 : 0.45),
        }
      : appearance === "dark"
        ? getColorThemePreset(id).dark
        : getColorThemePreset(id).light;

  const cssVariables: Record<string, string> = {
    "--accent": tokens.accent,
    "--accent-2": tokens.accent2,
    "--accent-3": tokens.accent3,
    "--accent-glow": tokens.accentGlow,
    "--accent-2-glow": tokens.accent2Glow,
  };

  if (id === "custom") {
    cssVariables["--bg-0"] = customTheme[appearance].bg0;
    cssVariables["--bg-1"] = customTheme[appearance].bg1;
    cssVariables["--bg-2"] = customTheme[appearance].bg2;
  }

  return cssVariables;
}

function clearCustomBackgroundOverrides(root: HTMLElement): void {
  root.style.removeProperty("--bg-0");
  root.style.removeProperty("--bg-1");
  root.style.removeProperty("--bg-2");
}

export function applyColorTheme(
  id: ColorThemeId,
  appearance: "light" | "dark",
  customTheme: CustomColorTheme = DEFAULT_CUSTOM_COLOR_THEME
): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  const cssVariables = resolveColorThemeCssVariables(id, appearance, customTheme);

  root.setAttribute("data-color-theme", id);
  root.style.setProperty("--accent", cssVariables["--accent"]);
  root.style.setProperty("--accent-2", cssVariables["--accent-2"]);
  root.style.setProperty("--accent-3", cssVariables["--accent-3"]);
  root.style.setProperty("--accent-glow", cssVariables["--accent-glow"]);
  root.style.setProperty("--accent-2-glow", cssVariables["--accent-2-glow"]);

  if (id === "custom") {
    root.style.setProperty("--bg-0", cssVariables["--bg-0"]);
    root.style.setProperty("--bg-1", cssVariables["--bg-1"]);
    root.style.setProperty("--bg-2", cssVariables["--bg-2"]);
  } else {
    clearCustomBackgroundOverrides(root);
  }
}
