import { describe, expect, it } from "vitest";
import { entryPatch, firstIssue, snippetPatch } from "@/lib/schemas";

describe("entryPatch", () => {
  it("allows an empty title and partial patches", () => {
    expect(entryPatch.safeParse({ title: "" }).success).toBe(true);
    expect(entryPatch.safeParse({ notes: "# hi" }).success).toBe(true);
  });
  it("rejects over-long titles with a readable message", () => {
    const r = entryPatch.safeParse({ title: "x".repeat(201) });
    expect(r.success).toBe(false);
    if (!r.success) expect(firstIssue(r.error)).toMatch(/200/);
  });
});

describe("snippetPatch", () => {
  it("accepts known languages only", () => {
    expect(snippetPatch.safeParse({ language: "python", content: "" }).success).toBe(true);
    expect(snippetPatch.safeParse({ language: "cobol" }).success).toBe(false);
  });
});
