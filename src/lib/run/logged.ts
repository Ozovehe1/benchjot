// Experiment tracking, pure: how logged values read, and how a note's runs become a table (the
// columns are the names the runs logged; numbers line up and can be charted). No I/O.
import type { Logged } from "./outputs";

type Value = Logged[string];

/** A logged value as shown: numbers to 4 significant digits (whole numbers as they are), true/false, text. */
export function formatLogged(v: Value | undefined): string {
  if (v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") return v;
  if (Number.isInteger(v)) return v.toLocaleString("en-US");
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-4 || a >= 1e6)) return v.toExponential(3);
  return String(Number(v.toPrecision(4)));
}

/** The table's columns: every name the runs logged, newest run's order first, then older names as they appear. */
export function loggedColumns(runs: readonly { logged: Logged }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of runs) for (const k of Object.keys(r.logged)) if (!seen.has(k)) (seen.add(k), out.push(k));
  return out;
}

/** True for a column every run that has it logged as a number: it lines up right and can be charted. */
export function numericColumn(runs: readonly { logged: Logged }[], column: string): boolean {
  const vs = runs.map((r) => r.logged[column]).filter((v) => v !== undefined);
  return vs.length > 0 && vs.every((v) => typeof v === "number");
}

/** A numeric column's values in run order (oldest first) for a chart; runs without it are skipped. */
export function series(runs: readonly { ranAt: string; logged: Logged }[], column: string): { at: string; value: number }[] {
  return [...runs]
    .filter((r) => typeof r.logged[column] === "number")
    .sort((a, b) => a.ranAt.localeCompare(b.ranAt))
    .map((r) => ({ at: r.ranAt, value: r.logged[column] as number }));
}

/** Sorts runs by a column (numbers by value, text alphabetically); runs without it go last. */
export function sortRuns<T extends { ranAt: string; logged: Logged }>(runs: readonly T[], column: string | null, descending: boolean): T[] {
  if (!column) return [...runs].sort((a, b) => (descending ? b.ranAt.localeCompare(a.ranAt) : a.ranAt.localeCompare(b.ranAt)));
  return [...runs].sort((a, b) => {
    const x = a.logged[column];
    const y = b.logged[column];
    if (x === undefined && y === undefined) return b.ranAt.localeCompare(a.ranAt);
    if (x === undefined) return 1;
    if (y === undefined) return -1;
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return descending ? -c : c;
  });
}

/** What changed between two runs: the names whose values differ (or that only one has). */
export function differences(a: Logged, b: Logged): string[] {
  return loggedColumns([{ logged: a }, { logged: b }]).filter((k) => a[k] !== b[k]);
}

const RESULT_NAME = /acc|loss|f1|auc|score|error|err\b|rmse|mse|mae|r2|precision|recall|perplexity|bleu|reward|metric|val/i;

/** The column a chart opens on: a result (accuracy, loss, f1…) rather than a setting (lr, epochs); else the first. */
export function chartDefault(numericColumns: readonly string[]): string | null {
  return numericColumns.find((c) => RESULT_NAME.test(c)) ?? numericColumns[0] ?? null;
}
