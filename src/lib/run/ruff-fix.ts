// Applying Ruff fix edits to source text. Pure, so it is unit-tested.

export interface Position {
  row: number; // 1-based
  column: number; // 1-based
}

export interface Edit {
  content: string | null;
  location: Position;
  end_location: Position;
}

/** Offset of a 1-based row/column in `text` (columns count UTF-16 units). */
export function offsetOf(text: string, pos: Position): number {
  let offset = 0;
  for (let row = 1; row < pos.row; row++) {
    const nl = text.indexOf("\n", offset);
    if (nl === -1) return text.length;
    offset = nl + 1;
  }
  return Math.min(text.length, offset + pos.column - 1);
}

/** Applies non-overlapping edits (later ones first); an edit overlapping one already applied is skipped. */
export function applyEdits(text: string, edits: Edit[]): string {
  const spans = edits
    .map((e) => ({ from: offsetOf(text, e.location), to: offsetOf(text, e.end_location), insert: e.content ?? "" }))
    .sort((a, b) => b.from - a.from || b.to - a.to);
  let out = text;
  let limit = Infinity;
  for (const s of spans) {
    if (s.to > limit) continue;
    out = out.slice(0, s.from) + s.insert + out.slice(s.to);
    limit = s.from;
  }
  return out;
}
