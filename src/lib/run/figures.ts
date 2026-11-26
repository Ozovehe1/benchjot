// Every visual of every experiment, in one place (the Figures page): a still for each figure, image,
// animation or chart a cell's last run made, newest first, with where it came from. Pure.
import type { SavedOutputs } from "./outputs";
import { outputPath } from "./outputs";

export type FigureKind = "figure" | "image" | "animation" | "chart";
export type Figure = {
  key: string;
  noteId: string;
  cellId: string;
  index: number;
  kind: FigureKind;
  title: string;
  /** What the Assistant saw in it, when it looked. */
  seen?: string;
  /** The stored file to show (its path in the outputs bucket). */
  path: string;
  ranAt: string;
};

type CellRow = { id: string; note_id: string; last_run: { ran_at?: string; outputs?: SavedOutputs | null } | null };

/** The visuals of these cells' last runs, newest run first; tables aren't pictures and are left out. */
export function figuresOf(cells: readonly CellRow[]): Figure[] {
  const out: Figure[] = [];
  for (const c of cells) {
    const o = c.last_run?.outputs;
    if (!o?.dir) continue;
    o.items.forEach((item, index) => {
      if (item.kind === "table") return;
      const f = item.files as Partial<Record<string, string>>;
      const file = item.kind === "chart" ? f.png : (f.png ?? f.jpg ?? f.webp ?? f.gif);
      if (!file) return;
      const kind: FigureKind = item.kind === "chart" ? "chart" : f.gif && !f.png ? "animation" : item.source === "matplotlib" ? "figure" : "image";
      out.push({ key: `${c.id}:${index}`, noteId: c.note_id, cellId: c.id, index, kind, title: item.title, ...(item.seen ? { seen: item.seen } : {}), path: outputPath(o.dir, file), ranAt: c.last_run?.ran_at ?? "" });
    });
  }
  return out.sort((a, b) => (a.ranAt < b.ranAt ? 1 : a.ranAt > b.ranAt ? -1 : 0));
}
