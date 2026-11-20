// Where a search found a note, to show under it in the list: the matching line and the cell it's in.
import type { Note, Cell } from "./schemas";

/** What a search reads of a cell; the cells in their order in the note. */
type CellText = Pick<Cell, "id" | "filename" | "content" | "note_before" | "note_after">;

/** Where a search found a note, to show under it: the line, and the cell it's in (null: the note's own text). */
export interface SearchHit {
  where: "code" | "note" | "cell note";
  cellId: string | null;
  /** 1-based position of the cell in the note. */
  cell: number | null;
  filename: string;
  /** 1-based line within the code or text. */
  lineNo: number;
  /** The line (trimmed, and cut around the word when long). */
  line: string;
}

const HIT_MAX = 120;
function cutAround(line: string, at: number): string {
  const t = line.trim();
  if (t.length <= HIT_MAX) return t;
  const start = Math.max(0, Math.min(at - 30, t.length - HIT_MAX));
  return `${start > 0 ? "…" : ""}${t.slice(start, start + HIT_MAX).trim()}${start + HIT_MAX < t.length ? "…" : ""}`;
}

/**
 * Where a search matched a note (web and Android alike): the first line with one of the words in
 * the code cells (what people search code for), else in the note, else in a cell's notes. Null when
 * only the title matched (the title is already shown). Words match in any case.
 */
export function searchHit(e: Pick<Note, "notes"> | undefined, cells: readonly CellText[], terms: readonly string[]): SearchHit | null {
  const words = terms.map((t) => t.toLowerCase()).filter(Boolean);
  if (!e || !words.length) return null;
  const find = (text: string): { lineNo: number; line: string } | null => {
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const low = lines[i]!.toLowerCase();
      const at = Math.min(...words.map((w) => low.indexOf(w)).filter((n) => n >= 0));
      if (Number.isFinite(at)) return { lineNo: i + 1, line: cutAround(lines[i]!, at - (lines[i]!.length - lines[i]!.trimStart().length)) };
    }
    return null;
  };
  for (const [i, s] of cells.entries()) {
    const h = find(s.content);
    if (h) return { where: "code", cellId: s.id, cell: i + 1, filename: s.filename, ...h };
  }
  const n = find(e.notes);
  if (n) return { where: "note", cellId: null, cell: null, filename: "", ...n };
  for (const [i, s] of cells.entries()) {
    const h = find(`${s.note_before}\n${s.note_after}`);
    if (h) return { where: "cell note", cellId: s.id, cell: i + 1, filename: s.filename, ...h };
  }
  return null;
}

