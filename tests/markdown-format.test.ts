import { describe, expect, it } from "vitest";
import { applyFormat } from "@/lib/markdown-format";
import { MARKDOWN_FORMAT_CASES, parseCase } from "./fixtures/markdown-format";

describe("applyFormat", () => {
  it.each(MARKDOWN_FORMAT_CASES)("%s  %s  ->  %s", (input, format, want) => {
    const i = parseCase(input);
    expect(applyFormat(i.text, i.start, i.end, format)).toEqual(parseCase(want));
  });
  it("is its own undo for every wrap", () => {
    for (const f of ["bold", "italic", "code", "math"] as const) {
      const once = applyFormat("a b c", 2, 3, f);
      expect(applyFormat(once.text, once.start, once.end, f)).toEqual({ text: "a b c", start: 2, end: 3 });
    }
  });
});

describe("format bar", () => {
  it("has a 48px button for each format, in order, and keeps the textarea focused", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/components/format-bar.tsx", import.meta.url), "utf8");
    expect(src).toContain("h-12 w-12");
    expect(src).toContain("onMouseDown={(e) => e.preventDefault()}");
    expect(src).toContain("sticky top-0");
    const body = readFileSync(new URL("../src/components/note-body.tsx", import.meta.url), "utf8");
    expect(body).toContain("{editing && <FormatBar onFormat={format} />}");
  });
});
