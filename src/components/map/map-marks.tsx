// How the Research map draws: each note's outcome as a dot, and each kind of connection as a line.
// Shared by the map and the landing's showcase, so both look the same.
import type { EdgeKind, Mark } from "@/lib/notes/graph";

/** Links: a thin grey line; sub-notes: dashed; attempts (derived from a note): the strongest line. */
export const EDGE_STYLE: Record<EdgeKind, { stroke: string; width: number; dash?: string }> = {
  link: { stroke: "var(--muted)", width: 1 },
  parent: { stroke: "var(--faint)", width: 1, dash: "4 4" },
  derived: { stroke: "var(--fg)", width: 1.5 },
};

/** Outcome as a dot: filled (successful), red (failed), hollow (unmarked). */
export function NodeMark({ mark, r }: { mark: Mark; r: number }) {
  if (mark === "failed") return <circle r={r} fill="var(--fail)" />;
  if (mark === "success") return <circle r={r} fill="var(--fg)" />;
  return <circle r={r - 0.75} fill="var(--bg)" stroke="var(--fg)" strokeWidth={1.5} />;
}
