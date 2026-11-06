// Cell notes: per code cell, a "Note before run" (directly above the cell) and a "Note after run"
// (directly below its run output). Markdown, written only by the user, edited with the same live
// editor as the note body; stored in snippets.note_before / snippets.note_after
// (supabase/migrations/20261106200000_cell_notes.sql), where their [[links]] count for backlinks,
// the map and search like the body's. Cases shared with Android: tests/fixtures/cell-notes.ts.

export type CellNoteSide = "before" | "after";

/** The labels, exactly (the user's wording). */
export const CELL_NOTE_LABELS: Readonly<Record<CellNoteSide, string>> = { before: "Note before run", after: "Note after run" };

/** Same cap as the column's check constraint. */
export const MAX_CELL_NOTE = 100_000;

/** An empty note (nothing, or only spaces, tabs and newlines) shows as one compact "+ label" row. */
export function isCellNoteEmpty(text: string): boolean {
  return !/\S/.test(text);
}

/** How a cell is named to screen readers: its file name, else "Code N" like its code editor. */
export function cellName(filename: string, index: number): string {
  return filename.trim() || `Code ${index + 1}`;
}

/** Accessible name of one cell note: its label and the cell's name. */
export function cellNoteName(side: CellNoteSide, filename: string, index: number): string {
  return `${CELL_NOTE_LABELS[side]}, ${cellName(filename, index)}`;
}
