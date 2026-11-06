// "Nothing washed out by the theme" (the user's rule, 2026-11-06): WCAG contrast for every colour
// pair the live editor and its format bar use, in both themes, read from globals.css.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BRAND } from "@/lib/brand";
import { LIVE_COLORS } from "@/lib/live-editor";

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
function theme(sel: string): Record<string, string> {
  const b = new RegExp(`${sel}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
  const vars = Object.fromEntries([...b.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, k, v]) => [k!, v!.trim()]));
  for (const k of Object.keys(vars)) vars[k] = vars[k]!.replace("var(--charcoal)", BRAND.charcoal).replace("var(--ash)", BRAND.ash);
  return vars;
}
function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
export function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

// [what, foreground token, background token, minimum ratio]
const PAIRS: [string, string, string, number][] = [
  ["body text", LIVE_COLORS.text, "bg", 4.5],
  ["markers on the active line", LIVE_COLORS.marker, "bg", 4.5],
  ["checked items", LIVE_COLORS.done, "bg", 4.5],
  ["quote text", LIVE_COLORS.quote, "bg", 4.5],
  ["quote rule", LIVE_COLORS.quoteRule, "bg", 3],
  ["wikilinks", LIVE_COLORS.wikilink, "bg", 4.5],
  ["links", LIVE_COLORS.link, "bg", 4.5],
  ["inline code / math on its chip", LIVE_COLORS.code, LIVE_COLORS.codeBg, 4.5],
  ["fence text on its band", LIVE_COLORS.code, LIVE_COLORS.codeBg, 4.5],
  ["markers inside code chips", LIVE_COLORS.marker, LIVE_COLORS.codeBg, 4.5],
  ["divider rule", LIVE_COLORS.divider, "bg", 3],
  ["checkbox outline", LIVE_COLORS.checkbox, "bg", 3],
  ["checkbox tick on the filled box", LIVE_COLORS.checkboxMark, LIVE_COLORS.checkbox, 4.5],
  ["bullets and numbers", LIVE_COLORS.bullet, "bg", 4.5],
  ["placeholder", LIVE_COLORS.placeholder, "bg", 3],
  // Format bar (format-bar.tsx: text-fg, disabled:text-faint, bg-fg text-bg chip, hover bg-tint)
  ["toolbar glyphs", "fg", "bg", 4.5],
  ["disabled glyphs", "faint", "bg", 3],
  ["active chip against the bar", "fg", "bg", 3],
  ["glyph on the active chip", "bg", "fg", 4.5],
  ["glyph on the pressed/hover chip", "fg", "tint", 4.5],
  ["link suggestion (selected)", "fg", "tint", 4.5],
  ["link suggestion", "muted", "bg", 4.5],
  ["insert sheet items", "fg", "bg", 4.5],
];

describe.each([
  ["dark", theme(":root,\\s*\\.dark")],
  ["light", theme("\\.light")],
])("contrast, %s theme", (_name, t) => {
  it.each(PAIRS)("%s (%s on %s) >= %d:1", (_what, fg, bg, min) => {
    expect(t[fg], fg).toMatch(/^#[0-9a-f]{6}$/i);
    expect(t[bg], bg).toMatch(/^#[0-9a-f]{6}$/i);
    expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(min);
  });
});

describe("format bar uses only tested tokens", () => {
  it("has no muted/faint glyphs except disabled", () => {
    const bar = readFileSync(new URL("../src/components/format-bar.tsx", import.meta.url), "utf8");
    const toolbar = bar.slice(bar.indexOf("function BarButton"), bar.indexOf("function usePhoneLayout"));
    expect(toolbar).not.toMatch(/text-muted/);
    expect(toolbar.match(/text-faint/g)).toEqual(["text-faint"]);
    expect(toolbar).toContain("disabled:text-faint");
  });
});
