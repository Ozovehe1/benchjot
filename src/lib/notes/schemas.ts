// Validation contracts (zod) and row types. One authoritative place for both.
import { z } from "zod";
import { MAX_CELL_NOTE } from "./cell-notes";
import { LANGUAGE_IDS } from "../code/languages";
import { OUTCOMES, type Outcome } from "./outcome";
import { MAX_SAVED_STREAM } from "../run/last-run";
import { logged, savedOutputs } from "../run/outputs";

export const notePatch = z
  .object({
    title: z.string().max(200, "Title is over 200 characters"),
    notes: z.string().max(200_000, "Note is over 200k characters"),
    project_id: z.uuid().nullable(),
    parent_id: z.uuid().nullable(),
    outcome: z.enum(OUTCOMES).nullable(),
  })
  .partial();

export const projectName = z.string().trim().min(1, "Name the project").max(120, "Name is over 120 characters");
export type NotePatch = z.input<typeof notePatch>;

export const cellInput = z.object({
  filename: z.string().trim().max(200, "File name is over 200 characters"),
  language: z.enum(LANGUAGE_IDS),
  content: z.string().max(1_048_576, "Code is over 1 MB"),
});
export type CellInput = z.input<typeof cellInput>;

// A code block's latest run (cells.last_run); built by toLastRun in run/last-run.ts.
// Room for the truncation note on top of the 64 KB cap.
const savedText = z.string().max(MAX_SAVED_STREAM + 200);
export const lastRun = z.object({
  outcome: z.enum(["ok", "error", "timeout", "stopped"]),
  stdout: savedText,
  stderr: savedText,
  error_line: savedText.nullable(),
  line: z.number().int().nullable(),
  ms: z.number().int().nonnegative(),
  where: z.enum(["browser", "server"]),
  code_hash: z.string().min(1).max(32),
  ran_at: z.iso.datetime(),
  /** Figures, tables and charts (run/outputs.ts); absent on runs without any and on older runs. */
  outputs: savedOutputs.nullable().optional(),
  /** What the code logged with log() (experiment tracking); absent when it logged nothing. */
  logged: logged.optional(),
});
export type LastRun = z.output<typeof lastRun>;

/** A cell note ("Note before run" / "Note after run"), Markdown; the user's own words only. */
const cellNote = z.string().max(MAX_CELL_NOTE, "Cell note is over 100k characters");

export const cellPatch = cellInput
  .pick({ language: true, content: true })
  .extend({ last_run: lastRun.nullable(), note_before: cellNote, note_after: cellNote })
  .partial();
export type CellPatch = z.input<typeof cellPatch>;

/** First human-readable message from a zod error. */
export function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? "Invalid input";
}

export interface Project {
  id: string;
  name: string;
}

export interface Note {
  id: string;
  user_id: string;
  project_id: string | null;
  parent_id: string | null;
  /** The note this one is a new attempt of (set by new_attempt()); null otherwise. */
  derived_from: string | null;
  title: string;
  notes: string;
  outcome: Outcome | null;
  created_at: string;
  updated_at: string;
  /** When it was pinned (pinned notes come first); null when it isn't. */
  pinned_at: string | null;
  /** When it went to Recently Deleted (removed for good 30 days later); null when it hasn't. */
  deleted_at: string | null;
}

export type NoteListItem = Pick<Note, "id" | "title" | "outcome" | "parent_id" | "updated_at" | "pinned_at">;

/** A note in Recently Deleted. */
export type DeletedNote = Pick<Note, "id" | "title" | "deleted_at">;

/** Every note's id, title, parent, lineage and outcome: for links, the tree and the map. */
export type NoteIndexItem = Pick<Note, "id" | "title" | "parent_id" | "derived_from" | "outcome" | "project_id" | "created_at">;

/** The columns useNoteIndex selects; NoteIndexItem's keys. Android's Backend.noteIndex() selects the same. */
export const NOTE_INDEX_COLUMNS = "id, title, parent_id, derived_from, outcome, project_id, created_at";

/** One [[link]] in a note body, as note_links() returns it (target = the id it carries, if any). */
export interface NoteLinkRow {
  source: string;
  label: string;
  target: string | null;
}

export interface Cell {
  id: string;
  user_id: string;
  note_id: string;
  filename: string;
  language: string;
  content: string;
  position: number;
  last_run: LastRun | null;
  /** "Note before run", shown above the cell; '' when there is none. */
  note_before: string;
  /** "Note after run", shown below the cell's output; '' when there is none. */
  note_after: string;
  created_at: string;
  updated_at: string;
}
