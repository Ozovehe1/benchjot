import { describe, expect, it } from "vitest";
import { diffHunks, fixMessages, FIX_LIMITS, lineDiff, parseFixAnswer } from "@/lib/fix";
import { asPlan } from "@/lib/plan";

describe("lineDiff", () => {
  it("marks only the changed line", () => {
    const ops = lineDiff("a\nb\nc", "a\nB\nc");
    expect(ops).toEqual([
      { kind: "same", text: "a" },
      { kind: "del", text: "b" },
      { kind: "add", text: "B" },
      { kind: "same", text: "c" },
    ]);
  });
  it("handles added and removed lines", () => {
    expect(lineDiff("a\nc", "a\nb\nc").filter((o) => o.kind !== "same")).toEqual([{ kind: "add", text: "b" }]);
    expect(lineDiff("a\nb\nc", "a\nc").filter((o) => o.kind !== "same")).toEqual([{ kind: "del", text: "b" }]);
  });
  it("reports no changes for identical code", () => {
    expect(diffHunks(lineDiff("x\ny", "x\ny"))).toEqual([]);
  });
});

describe("diffHunks", () => {
  it("keeps one line of context and marks gaps between hunks", () => {
    const before = ["1", "2", "3", "4", "5", "6", "7", "8"].join("\n");
    const after = ["1", "two", "3", "4", "5", "6", "seven", "8"].join("\n");
    const h = diffHunks(lineDiff(before, after));
    expect(h.map((x) => (x ? `${x.kind}:${x.text}:${x.line}` : "gap"))).toEqual([
      "same:1:1", "del:2:2", "add:two:2", "same:3:3", "gap", "same:6:6", "del:7:7", "add:seven:7", "same:8:8",
    ]);
  });
});

describe("fix prompt and answer", () => {
  it("sends the code and the tail of a long error", () => {
    const error = "x".repeat(FIX_LIMITS.maxErrorChars) + "TAIL";
    const [system, user] = fixMessages({ language: "c", code: "int main(){}", error });
    expect(system!.content).toContain("as few lines as possible");
    expect(user!.content).toContain("int main(){}");
    expect(user!.content).toContain("TAIL");
    expect(user!.content.length).toBeLessThan(FIX_LIMITS.maxErrorChars + 200);
  });
  it("reads plain or fenced JSON and rejects anything else", () => {
    expect(parseFixAnswer('{"code":"a\\r\\nb","summary":"s"}')).toEqual({ code: "a\nb", summary: "s" });
    expect(parseFixAnswer('```json\n{"code":"x"}\n```')).toEqual({ code: "x", summary: "" });
    expect(() => parseFixAnswer("Sure! Here is the fix")).toThrow();
  });
});

describe("asPlan", () => {
  it("treats anything but 'pro' as free", () => {
    expect(asPlan("pro")).toBe("pro");
    expect(asPlan("free")).toBe("free");
    expect(asPlan(undefined)).toBe("free");
    expect(asPlan("admin")).toBe("free");
  });
});
