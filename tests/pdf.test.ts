import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { deflateRgb, imagePdf } from "@/lib/pdf";

describe("imagePdf", () => {
  it("writes a one-page PDF whose xref offsets point at each object", async () => {
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 0, 0, 0]); // red, transparent
    const deflated = await deflateRgb(rgba);
    expect([...inflateSync(deflated)]).toEqual([255, 0, 0, 255, 255, 255]);
    const pdf = imagePdf({ deflated, width: 2, height: 1, pageWidth: 150, pageHeight: 75 });
    const text = Buffer.from(pdf).toString("latin1");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("/MediaBox [0 0 150 75]");
    const xref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xref, xref + 4)).toBe("xref");
    const offsets = [...text.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(5);
    offsets.forEach((o, i) => expect(text.slice(o, o + 8)).toBe(`${i + 1} 0 obj\n`));
  });
  it("refuses an empty image", () => {
    expect(() => imagePdf({ deflated: new Uint8Array(), width: 0, height: 1, pageWidth: 1, pageHeight: 1 })).toThrow();
  });
});
