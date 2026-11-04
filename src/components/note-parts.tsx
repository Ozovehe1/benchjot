// Pieces of the note screen shared by the editor (entry-view.tsx) and the
// read-only preview (note-preview.tsx), so both look the same by construction.
import type { NoteRef } from "@/lib/links";
import { Markdown } from "./markdown";

/** The note title's type and spacing; the editor applies it to its textarea. */
export const NOTE_TITLE_CLASS = "mt-6 block w-full text-xl font-semibold leading-snug";

/** The note body as rendered (the editor's Preview, and read-only views). */
export function RenderedBody({ value, notes }: { value: string; notes?: readonly NoteRef[] }) {
  return <div className="mt-4 min-h-24">{value.trim() ? <Markdown notes={notes}>{value}</Markdown> : <p className="text-faint">Nothing written.</p>}</div>;
}
