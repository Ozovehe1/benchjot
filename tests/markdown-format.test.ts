import { describe, expect, it } from "vitest";
import { applyFormat } from "@/lib/markdown-format";
import { MARKDOWN_FORMAT_CASES, MARKDOWN_FORMAT_EXPLICIT, parseCase } from "./fixtures/markdown-format";

describe("applyFormat", () => {
  it.each(MARKDOWN_FORMAT_CASES)("%s  %s  ->  %s", (input, format, want) => {
    const i = parseCase(input);
    expect(applyFormat(i.text, i.start, i.end, format)).toEqual(parseCase(want));
  });
  it.each(MARKDOWN_FORMAT_EXPLICIT.map((c) => [c.input.text, c.format, c] as const))("%j  %s", (_t, _f, c) => {
    expect(applyFormat(c.input.text, c.input.start, c.input.end, c.format)).toEqual(c.output);
  });
  it("is its own undo for every wrap", () => {
    for (const f of ["bold", "italic", "strike", "code", "math"] as const) {
      const once = applyFormat("a b c", 2, 3, f);
      expect(applyFormat(once.text, once.start, once.end, f)).toEqual({ text: "a b c", start: 2, end: 3 });
    }
  });
});
