// What the landing's film and sections show, all taken from the sample note's real run
// (lib/sample-note.ts): the first experiment's progress lines, how long it ran and where, a narrower
// view of its results table, and its figure. Pure, so tests can check it against the run.
import type { LastRun } from "./notes/schemas";
import type { Manifest, TableOutput } from "./run/outputs";

/** The run's own "… done" lines, in order. */
export function progressLines(run: LastRun | null | undefined): string[] {
  return (run?.stdout ?? "").split("\n").filter((l) => / done\b/.test(l));
}

/** How long the code ran, as m:ss. */
export function ranFor(run: LastRun | null | undefined): string {
  const s = Math.round((run?.ms ?? 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The results table with only these columns (by name; the index columns stay), and the figures: what fits the film's window. */
export function filmOutputs(manifest: Manifest | null | undefined, keep: readonly string[]): Manifest | null {
  if (!manifest) return null;
  const table = manifest.items.find((i): i is TableOutput => i.kind === "table");
  const figure = manifest.items.find((i) => i.kind === "image");
  if (!table) return null;
  const at = table.columns.map((c, i) => (i < table.index_columns || keep.includes(c) ? i : -1)).filter((i) => i >= 0);
  const narrow: TableOutput = { ...table, columns: at.map((i) => table.columns[i]!), rows: table.rows.map((r) => at.map((i) => r[i] ?? null)), total_columns: at.length - table.index_columns };
  return { version: 1, notes: [], items: figure ? [narrow, figure] : [narrow] };
}
