import { describe, expect, it } from "vitest";
import { fixMessages, fixRequest } from "@/lib/fix";
import { isOutcome, OUTCOME_CHOICES, OUTCOME_FILTERS, outcomeContext, outcomeParam } from "@/lib/outcome";
import { entryPatch } from "@/lib/schemas";

describe("outcome values", () => {
  it("knows only success and failed", () => {
    expect(isOutcome("success")).toBe(true);
    expect(isOutcome("failed")).toBe(true);
    expect(isOutcome("unmarked")).toBe(false);
    expect(isOutcome(null)).toBe(false);
  });
  it("offers unmarked, Successful, Failed on the note page", () => {
    expect(OUTCOME_CHOICES.map((c) => c.label)).toEqual(["—", "Successful", "Failed"]);
    expect(OUTCOME_CHOICES[0]!.value).toBeNull();
  });
});

describe("entryPatch outcome", () => {
  it("sets, clears and rejects unknown outcomes", () => {
    expect(entryPatch.safeParse({ outcome: "success" }).success).toBe(true);
    expect(entryPatch.safeParse({ outcome: null }).success).toBe(true);
    expect(entryPatch.safeParse({ outcome: "maybe" }).success).toBe(false);
  });
});

describe("list filter", () => {
  it("maps to the search_entries argument; All means no filter", () => {
    expect(OUTCOME_FILTERS).toEqual(["all", "success", "failed", "unmarked"]);
    expect(outcomeParam("all")).toBeNull();
    expect(outcomeParam("unmarked")).toBe("unmarked");
    expect(outcomeParam("failed")).toBe("failed");
  });
});

describe("Fix context", () => {
  const base = { language: "python", code: "1/0", error: "ZeroDivisionError" };
  it("tells the model the note's outcome when it is marked", () => {
    const req = fixRequest.parse({ ...base, outcome: "failed" });
    expect(fixMessages(req)[1]!.content).toContain(outcomeContext("failed"));
    expect(outcomeContext("success")).toMatch(/successful/);
  });
  it("adds nothing when unmarked, and old clients without the field still validate", () => {
    expect(outcomeContext(null)).toBe("");
    const req = fixRequest.parse(base);
    expect(fixMessages(req)[1]!.content).not.toContain("marked this experiment");
    expect(fixRequest.safeParse({ ...base, outcome: "meh" }).success).toBe(false);
  });
});
