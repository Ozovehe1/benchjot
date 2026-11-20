// A code cell's state at a glance (the cells bar above a note's cells, and each cell's edge), from
// what is saved: how its last run ended, and whether its code changed since (Android: core
// CellStatus.kt). A note's cells as a run order for Run all: only cells that can run.
import { codeHash } from "../run/last-run";
import type { LastRun } from "./schemas";

type CellState = "ok" | "failed" | "stopped" | "stale" | "never";

/** ok / failed (an error or a timeout) / stopped, or stale when the code changed since that run, never before a first run. */
export function cellState(cell: { content: string; last_run: LastRun | null }): CellState {
  const r = cell.last_run;
  if (!r) return "never";
  if (codeHash(cell.content) !== r.code_hash) return "stale";
  return r.outcome === "ok" ? "ok" : r.outcome === "stopped" ? "stopped" : "failed";
}

/** The first failed cell, by position (1-based), for "Go to cell N"; null when none failed. */
export function firstFailed(states: readonly CellState[]): number | null {
  const i = states.indexOf("failed");
  return i < 0 ? null : i + 1;
}
