import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import ar from "@/messages/ar.json";
import { VIZ_EXPLAINERS } from "./vizExplainers";

/** Every i18n key an explainer names, under `VizExplainer.`. */
function keysOf(mode: string): string[] {
  const e = VIZ_EXPLAINERS[mode as keyof typeof VIZ_EXPLAINERS];
  return [
    e.summaryKey,
    e.purposeKey,
    e.claimKey,
    ...e.legend.map((l) => l.labelKey),
    ...e.hintKeys,
    ...e.howToReadKeys,
    ...(e.readKeys ?? []),
  ];
}

function lookup(messages: Record<string, unknown>, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), messages);
}

describe("viz explainers", () => {
  // A missing key renders as its own dotted path in the explainer panel.
  it.each(Object.keys(VIZ_EXPLAINERS))("%s names only keys that exist in every locale", (mode) => {
    for (const [locale, messages] of [["en", en], ["ar", ar]] as const) {
      const missing = keysOf(mode).filter((key) => typeof lookup(messages.VizExplainer, key) !== "string");
      expect(missing, locale).toEqual([]);
    }
  });

  it("gives a view with reading notes its section headings and figure text", () => {
    for (const messages of [en, ar]) {
      expect(typeof messages.VizExplainer.readHeading).toBe("string");
      expect(typeof messages.VizExplainer.useHeading).toBe("string");
      expect(typeof messages.VizExplainer["concordance-rings"].figure.caption).toBe("string");
      expect(typeof messages.VizExplainer["concordance-rings"].figure.label).toBe("string");
    }
  });
});
