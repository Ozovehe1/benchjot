import { describe, expect, it } from "vitest";
import { notePatch, firstIssue, projectName, cellPatch } from "@/lib/notes/schemas";

describe("notePatch", () => {
  it("allows an empty title and partial patches", () => {
    expect(notePatch.safeParse({ title: "" }).success).toBe(true);
    expect(notePatch.safeParse({ notes: "# hi" }).success).toBe(true);
  });
  it("rejects over-long titles with a readable message", () => {
    const r = notePatch.safeParse({ title: "x".repeat(201) });
    expect(r.success).toBe(false);
    if (!r.success) expect(firstIssue(r.error)).toMatch(/200/);
  });
});

describe("cellPatch", () => {
  it("accepts known languages only", () => {
    expect(cellPatch.safeParse({ language: "python", content: "" }).success).toBe(true);
    expect(cellPatch.safeParse({ language: "cobol" }).success).toBe(false);
  });
});

describe("projects", () => {
  it("notePatch files a note in a project or unfiles it", () => {
    expect(notePatch.safeParse({ project_id: "3f1c9a1e-2b4d-4c8e-9f00-1a2b3c4d5e6f" }).success).toBe(true);
    expect(notePatch.safeParse({ project_id: null }).success).toBe(true);
    expect(notePatch.safeParse({ project_id: "not-a-uuid" }).success).toBe(false);
  });
  it("projectName trims and requires a name", () => {
    expect(projectName.parse("  ViT ablations ")).toBe("ViT ablations");
    expect(projectName.safeParse("   ").success).toBe(false);
    expect(projectName.safeParse("x".repeat(121)).success).toBe(false);
  });
});
