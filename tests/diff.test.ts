import { describe, expect, it } from "vitest";
import { lineDiff, withContext } from "@/lib/diff";

describe("lineDiff", () => {
  it("reports added and removed lines", () => {
    const d = lineDiff("a\nb\nc\n", "a\nB\nc\nd\n");
    expect(d.added).toBe(2);
    expect(d.removed).toBe(1);
    expect(d.lines.filter((l) => l.type === "del").map((l) => l.text)).toEqual(["b"]);
  });
  it("is empty for identical input", () => {
    const d = lineDiff("x = 1", "x = 1");
    expect(d.added + d.removed).toBe(0);
  });
  it("collapses unchanged stretches", () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n");
    const after = before.replace("l10", "L10");
    const hunks = withContext(lineDiff(before, after).lines, 2);
    expect(hunks[0]).toEqual({ type: "skip", count: 8 });
    expect(hunks.at(-1)).toEqual({ type: "skip", count: 7 }); // l13..l19
  });
});
