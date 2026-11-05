import { describe, expect, it } from "vitest";
import { FOLD_LINES, foldLabel, folds, lineCount } from "@/lib/code-fold";
import { CODE_FOLD_CASES } from "./fixtures/code-fold";

describe("code fold", () => {
  it("folds only past 12 lines", () => {
    expect(FOLD_LINES).toBe(12);
    for (const c of CODE_FOLD_CASES) {
      expect(lineCount(c), JSON.stringify(c)).toBe(c.replace(/\n$/, "").split("\n").length);
      expect(folds(c)).toBe(lineCount(c) > 12);
    }
  });
  it("doesn't count a final newline as a line", () => {
    expect(lineCount("a\nb\n")).toBe(2);
    expect(lineCount("")).toBe(1);
  });
  it("labels the toggle", () => {
    expect(foldLabel("a\n".repeat(20), false)).toBe("Show all 20 lines");
    expect(foldLabel("a", true)).toBe("Show less");
  });
});
