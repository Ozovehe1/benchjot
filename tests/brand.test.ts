import { describe, expect, it } from "vitest";
import { BRAND, MARK, logoSvg } from "@/lib/brand";

describe("logoSvg", () => {
  it("draws the tile in the accent and every glyph path in ink", () => {
    const svg = logoSvg();
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain(`rx="${MARK.radius}" fill="${BRAND.accent}"`);
    for (const d of MARK.paths) expect(svg).toContain(`d="${d}"`);
    expect(svg.match(new RegExp(`stroke="${BRAND.ink}"`, "g"))).toHaveLength(MARK.paths.length);
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
