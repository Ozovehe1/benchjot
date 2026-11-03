import { describe, expect, it } from "vitest";
import { BRAND, MARK, logoSvg } from "@/lib/brand";

describe("logoSvg", () => {
  it("draws ash glyphs on a rounded charcoal square, nothing else", () => {
    const svg = logoSvg();
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain(`rx="${MARK.radius}" fill="${BRAND.charcoal}"`);
    for (const d of MARK.paths) expect(svg).toContain(`d="${d}"`);
    expect(svg.match(new RegExp(`stroke="${BRAND.ash}"`, "g"))).toHaveLength(MARK.paths.length);
    const colours = new Set(svg.match(/#[0-9a-f]{6}/gi));
    expect(colours).toEqual(new Set([BRAND.charcoal, BRAND.ash])); // monochrome
  });

  it("uses a full-bleed square and shrinks the glyphs for maskable icons", () => {
    const svg = logoSvg({ padding: 0.12 });
    expect(svg).not.toContain("rx=");
    expect(svg).toContain("scale(0.76)");
  });

  it("rejects padding outside [0, 0.5)", () => {
    expect(() => logoSvg({ padding: 0.5 })).toThrow(RangeError);
    expect(() => logoSvg({ padding: -0.1 })).toThrow(RangeError);
  });
});
