import { describe, expect, it } from "vitest";
import { codeHash, fromLastRun, MAX_SAVED_STREAM, toLastRun, truncate } from "@/lib/run/last-run";
import { lastRun, snippetPatch } from "@/lib/schemas";

describe("truncate", () => {
  it("leaves output under the cap alone", () => {
    expect(truncate("hello")).toBe("hello");
    expect(truncate("x".repeat(MAX_SAVED_STREAM))).toHaveLength(MAX_SAVED_STREAM);
  });
  it("keeps the first 64 KB and says how much was cut", () => {
    const out = truncate("y".repeat(200 * 1024));
    expect(out.startsWith("y".repeat(MAX_SAVED_STREAM) + "\n[output truncated")).toBe(true);
    expect(out).toContain("first 64 KB of 200 KB");
    expect(out.length).toBeLessThan(MAX_SAVED_STREAM + 200);
  });
});

describe("codeHash", () => {
  it("is stable and changes with the code", () => {
    expect(codeHash("print(1)")).toBe(codeHash("print(1)"));
    expect(codeHash("print(1)")).not.toBe(codeHash("print(2)"));
    expect(codeHash("print(1)")).not.toBe(codeHash("print(1) "));
    expect(codeHash("")).toMatch(/^[0-9a-f]+$/);
  });
});

describe("toLastRun / fromLastRun", () => {
  const chunks = [
    { stream: "stdout" as const, text: "a\n" },
    { stream: "stderr" as const, text: "warn\n" },
    { stream: "stdout" as const, text: "b\n" },
  ];
  const result = { outcome: "error" as const, error: { text: "ZeroDivisionError", line: 3 }, ms: 12.6 };

  it("splits streams, keeps the error and hashes the code", () => {
    const run = toLastRun(chunks, result, "browser", "code", new Date("2026-11-04T00:00:00Z"));
    expect(run).toMatchObject({ outcome: "error", stdout: "a\nb\n", stderr: "warn\n", error_line: "ZeroDivisionError", line: 3, ms: 13, where: "browser" });
    expect(run.ran_at).toBe("2026-11-04T00:00:00.000Z");
    expect(lastRun.safeParse(run).success).toBe(true);
    expect(snippetPatch.safeParse({ last_run: run }).success).toBe(true);
    expect(snippetPatch.safeParse({ last_run: null }).success).toBe(true);
  });

  it("caps each stream so the record always validates", () => {
    const big = toLastRun([{ stream: "stdout", text: "z".repeat(1_000_000) }], { outcome: "timeout", error: null, ms: 30000 }, "server", "x");
    expect(big.stdout.length).toBeLessThan(MAX_SAVED_STREAM + 200);
    expect(lastRun.safeParse(big).success).toBe(true);
  });

  it("round-trips to what RunOutput shows, and marks it stale after an edit", () => {
    const run = toLastRun(chunks, result, "server", "code");
    const { chunks: shown, result: r } = fromLastRun(run);
    expect(shown).toEqual([{ stream: "stdout", text: "a\nb\n" }, { stream: "stderr", text: "warn\n" }]);
    expect(r).toEqual({ outcome: "error", error: { text: "ZeroDivisionError", line: 3 }, ms: 13 });
    expect(run.code_hash).toBe(codeHash("code"));
    expect(run.code_hash).not.toBe(codeHash("code2"));
  });
});
