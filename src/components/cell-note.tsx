"use client";
// A code cell's "Note before run" / "Note after run" in the editor. Empty: one compact 48px
// "+ label" row, so a note without cell notes looks as it always did; tapping it opens the same
// live editor as the body, and leaving it empty collapses it again. The text is the user's own:
// it is saved by useCellNotes (autosave, like the body) and nothing else writes it.
import { useState } from "react";
import { useAutosave } from "@/lib/autosave";
import { CELL_NOTE_LABELS, cellNoteName, isCellNoteEmpty, type CellNoteSide } from "@/lib/cell-notes";
import { saveCellNotes } from "@/lib/data";
import type { NoteRef } from "@/lib/links";
import type { Snippet } from "@/lib/schemas";
import { cn } from "@/lib/format";
import { LiveTextBlock } from "./live-text-block";
import { CELL_NOTE_CLASS, CellNoteText } from "./note-parts";
import { TextButton } from "./ui";

/** Both cell notes of one cell, autosaved together; `flush` saves now (before the cell is removed). */
export function useCellNotes(snippet: Pick<Snippet, "id" | "entry_id" | "note_before" | "note_after">) {
  const [before, setBefore] = useState(snippet.note_before);
  const [after, setAfter] = useState(snippet.note_after);
  const { flush } = useAutosave({ note_before: before, note_after: after }, (v) => saveCellNotes(snippet, v), {
    baseline: { note_before: snippet.note_before, note_after: snippet.note_after },
  });
  return { before, setBefore, after, setAfter, flush };
}

interface Props {
  side: CellNoteSide;
  value: string;
  onChange: (value: string) => void;
  /** The cell's file name and position, for the accessible name. */
  filename: string;
  index: number;
  /** For [[link]] suggestions, as in the body. */
  notes: readonly NoteRef[];
  selfId: string;
  /** The note's Preview: rendered read-only. */
  preview?: boolean;
}

export function CellNote({ side, value, onChange, filename, index, notes, selfId, preview = false }: Props) {
  const label = CELL_NOTE_LABELS[side];
  const name = cellNoteName(side, filename, index);
  // Open while the user is in it, so erasing the text doesn't collapse it mid-edit.
  const [open, setOpen] = useState(false);

  if (preview) return <CellNoteText side={side} value={value} filename={filename} index={index} notes={notes} />;

  if (!open && isCellNoteEmpty(value)) {
    return (
      <TextButton onClick={() => setOpen(true)} aria-label={name} className="w-full justify-start">
        <span aria-hidden className="mr-1.5">+</span>
        {label}
      </TextButton>
    );
  }
  return (
    <section aria-label={name} className={cn(CELL_NOTE_CLASS, "min-h-12")} onFocus={() => setOpen(true)}>
      <LiveTextBlock
        value={value}
        onChange={onChange}
        notes={notes}
        selfId={selfId}
        label={label}
        name={name}
        autoFocus={open}
        // Leaving it empty collapses it back to the compact row.
        onBlur={() => setOpen(false)}
        // One line tall when short: the body's tap-to-type height (6rem) is for the body only.
        className="block w-full [&_.cm-content]:!min-h-0"
      />
    </section>
  );
}
