// Pieces of the note screen shared by the editor (entry-view.tsx) and the
// read-only preview (note-preview.tsx), so both look the same by construction.
import type { NoteRef } from "@/lib/links";
import { Markdown } from "./markdown";

/** The note title's type and spacing; the editor applies it to its textarea. */
export const NOTE_TITLE_CLASS = "mt-6 block w-full text-xl font-semibold leading-snug";

/** The note's metadata rows (project, parent, outcome): small muted type. */
export const NOTE_META_ROW_CLASS = "flex items-center gap-4 text-xs text-muted";

/**
 * The note body as rendered (the editor's Preview, and read-only views).
 * `reserve` keeps the editor's tap-to-type height; read-only views turn it off.
 */
export function RenderedBody({ value, notes, reserve = true }: { value: string; notes?: readonly NoteRef[]; reserve?: boolean }) {
  return <div className={reserve ? "mt-4 min-h-24" : "mt-4"}>{value.trim() ? <Markdown notes={notes}>{value}</Markdown> : <p className="text-faint">Nothing written.</p>}</div>;
}

/** Marks the landing's sample as an example (not site information, not the visitor's data). */
export function SampleNoteTag() {
  return <span className="inline-block rounded-full border border-line px-2 py-0.5 font-mono text-[11px] leading-4 text-muted">Sample note</span>;
}
