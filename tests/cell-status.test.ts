// A cell's state at a glance (lib/notes/cell-status.ts; Android: core CellStatus.kt).
import { describe, expect, it } from "vitest";
import { cellState, firstFailed } from "@/lib/notes/cell-status";
import { codeHash } from "@/lib/run/last-run";
import type { LastRun } from "@/lib/notes/schemas";

const run = (code: string, outcome: LastRun["outcome"]): LastRun => ({ outcome, stdout: "", stderr: "", error_line: null, line: null, ms: 1, where: "browser", code_hash: codeHash(code), ran_at: "2026-11-19T10:00:00.000Z" });

describe("cellState", () => {
  it("says how the last run ended, or that the code changed since", () => {
    expect(cellState({ content: "x", last_run: null })).toBe("never");
    expect(cellState({ content: "x", last_run: run("x", "ok") })).toBe("ok");
    expect(cellState({ content: "x", last_run: run("x", "error") })).toBe("failed");
    expect(cellState({ content: "x", last_run: run("x", "timeout") })).toBe("failed");
    expect(cellState({ content: "x", last_run: run("x", "stopped") })).toBe("stopped");
    expect(cellState({ content: "y", last_run: run("x", "error") })).toBe("stale");
  });
  it("finds the first failed cell", () => {
    expect(firstFailed(["ok", "stale", "failed", "failed"])).toBe(3);
    expect(firstFailed(["ok", "never"])).toBeNull();
  });
});
