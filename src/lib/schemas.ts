// Validation contracts (zod) and row types. One authoritative place for both.
import { z } from "zod";
import { LANGUAGE_IDS } from "./languages";

export const entryPatch = z
  .object({
    title: z.string().max(200, "Title is over 200 characters"),
    notes: z.string().max(200_000, "Note is over 200k characters"),
    project_id: z.uuid().nullable(),
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

export const snippetPatch = snippetInput.pick({ language: true, content: true }).partial();
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
  created_at: string;
  updated_at: string;
}

export type EntryListItem = Pick<Entry, "id" | "title" | "updated_at">;

export interface Snippet {
  id: string;
  user_id: string;
  entry_id: string;
  filename: string;
  language: string;
  content: string;
  position: number;
  created_at: string;
  updated_at: string;
}
