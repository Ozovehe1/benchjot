import { describe, expect, it } from "vitest";
import { experimentCreate, experimentPatch, parseTags, runInput, snippetInput, firstIssue } from "@/lib/schemas";

describe("experiment validation", () => {
  it("requires a non-blank title", () => {
    expect(experimentCreate.safeParse({ title: "  " }).success).toBe(false);
    expect(experimentCreate.parse({ title: "  LR sweep " }).title).toBe("LR sweep");
  });
  it("rejects unknown statuses", () => {
    expect(experimentPatch.safeParse({ status: "paused" }).success).toBe(false);
    expect(experimentPatch.safeParse({ status: "running" }).success).toBe(true);
  });
  it("rejects end dates before start dates", () => {
    const r = experimentPatch.safeParse({ started_on: "2026-11-03", ended_on: "2026-11-01" });
    expect(r.success).toBe(false);
    if (!r.success) expect(firstIssue(r.error)).toMatch(/End date/);
  });
  it("normalises and dedupes tags", () => {
    expect(parseTags("CNN, #mnist  cnn baseline")).toEqual(["cnn", "mnist", "baseline"]);
    expect(() => parseTags("bad tag!")).toThrow();
  });
});

describe("snippet validation", () => {
  it("accepts known languages only", () => {
    expect(snippetInput.safeParse({ filename: "a.py", language: "python", content: "" }).success).toBe(true);
    expect(snippetInput.safeParse({ filename: "a.rs", language: "cobol", content: "" }).success).toBe(false);
  });
});

describe("run validation", () => {
  const base = { name: "r1", params: {}, env: {}, metrics: {}, outcome: "", links: [], ran_at: "2026-11-03T10:00:00+01:00" };
  it("accepts a well-formed run", () => {
    expect(runInput.safeParse({ ...base, metrics: { acc: 0.93 } }).success).toBe(true);
  });
  it("rejects non-finite metrics and non-http links", () => {
    expect(runInput.safeParse({ ...base, metrics: { acc: Infinity } }).success).toBe(false);
    expect(runInput.safeParse({ ...base, links: [{ label: "x", url: "javascript:alert(1)" }] }).success).toBe(false);
  });
});
