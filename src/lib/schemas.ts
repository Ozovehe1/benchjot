// Validation contracts (zod) and row types. One authoritative place for both.
import { z } from "zod";
import { LANGUAGE_IDS } from "./languages";
import { OUTCOMES, type Outcome } from "./outcome";
import { MAX_SAVED_STREAM } from "./run/last-run";

export const entryPatch = z
  .object({
    title: z.string().max(200, "Title is over 200 characters"),
    notes: z.string().max(200_000, "Note is over 200k characters"),
    project_id: z.uuid().nullable(),
    outcome: z.enum(OUTCOMES).nullable(),
  })
  .partial();

export const projectName = z.string().trim().min(1, "Name the project").max(120, "Name is over 120 characters");
export type EntryPatch = z.input<typeof entryPatch>;

export const snippetInput = z.object({
  filename: z.string().trim().max(200, "File name is over 200 characters"),
  language: z.enum(LANGUAGE_IDS),
  content: z.string().max(1_048_576, "Code is over 1 MB"),
});
export type SnippetInput = z.input<typeof snippetInput>;

// A code block's latest run (snippets.last_run); built by toLastRun in run/last-run.ts.
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
});
export type LastRun = z.output<typeof lastRun>;

export const snippetPatch = snippetInput
  .pick({ language: true, content: true })
  .extend({ last_run: lastRun.nullable() })
  .partial();
export type SnippetPatch = z.input<typeof snippetPatch>;

/** First human-readable message from a zod error. */
export function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? "Invalid input";
}

export interface Project {
  id: string;
  name: string;
}

export interface Entry {
  id: string;
  user_id: string;
  project_id: string | null;
  title: string;
  notes: string;
  outcome: Outcome | null;
  created_at: string;
  updated_at: string;
}

export type EntryListItem = Pick<Entry, "id" | "title" | "outcome" | "updated_at">;

export interface Snippet {
  id: string;
  user_id: string;
  entry_id: string;
  filename: string;
  language: string;
  content: string;
  position: number;
  last_run: LastRun | null;
  created_at: string;
  updated_at: string;
}
