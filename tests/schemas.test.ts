import { describe, expect, it } from "vitest";
import { entryPatch, firstIssue, projectName, snippetPatch } from "@/lib/schemas";

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

describe("projects", () => {
  it("entryPatch files an entry in a project or unfiles it", () => {
    expect(entryPatch.safeParse({ project_id: "3f1c9a1e-2b4d-4c8e-9f00-1a2b3c4d5e6f" }).success).toBe(true);
    expect(entryPatch.safeParse({ project_id: null }).success).toBe(true);
    expect(entryPatch.safeParse({ project_id: "not-a-uuid" }).success).toBe(false);
  });
  it("projectName trims and requires a name", () => {
    expect(projectName.parse("  ViT ablations ")).toBe("ViT ablations");
    expect(projectName.safeParse("   ").success).toBe(false);
    expect(projectName.safeParse("x".repeat(121)).success).toBe(false);
  });
});
