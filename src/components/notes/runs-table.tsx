"use client";
// Experiment tracking in the note: every run whose code called log(), side by side. The columns are
// the names the runs logged; tap a column to sort by it; pick a number column to see how it moved
// across runs; tick two runs to see what differs. Only what the code logged: nothing inferred.
import { deleteRun, useRuns } from "@/lib/data/experiments";
import { Notice } from "../ui";
import { RunsView } from "./runs-view";

type CellRef = { id: string; filename?: string | null; content: string; language: string };

export function RunsTable({ noteId, cells, onGoToCell }: { noteId: string; cells: readonly CellRef[]; onGoToCell?: (id: string) => void }) {
  const { data: runs, error, mutate } = useRuns(noteId);
  if (error) return <Notice className="mt-10" actions={[{ label: "Try again", onClick: () => void mutate() }]}>Couldn’t load this note’s runs.</Notice>;
  if (!runs) return null;
  if (!runs.length) {
    if (!cells.some((c) => c.language === "python")) return null;
    return (
      <section aria-label="Runs" className="mt-12">
        <h2 className="eyebrow mb-1.5">Runs</h2>
        <p className="text-sm text-muted">
          Track a run: add <code className="font-mono text-[13px] text-fg">log(accuracy=acc, lr=lr)</code> to a cell. Each run that logs shows here, side by side, so you can see what changed.
        </p>
      </section>
    );
  }
  return <RunsView runs={runs} cells={cells} onGoToCell={onGoToCell} onRemove={(id) => void deleteRun(noteId, id)} />;
}

