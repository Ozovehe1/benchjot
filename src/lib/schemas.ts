// Validation contracts (zod) and row types. One authoritative place for both.
import { z } from "zod";
import { LANGUAGE_IDS } from "./languages";

export const entryPatch = z
  .object({
    title: z.string().max(200, "Title is over 200 characters"),
    notes: z.string().max(200_000, "Note is over 200k characters"),
  })
  .partial();
export type EntryPatch = z.input<typeof entryPatch>;

export const snippetPatch = z
  .object({
    language: z.enum(LANGUAGE_IDS),
    content: z.string().max(500_000, "Code is over 500k characters"),
  })
  .partial();
export type SnippetPatch = z.input<typeof snippetPatch>;

/** First human-readable message from a zod error. */
export function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? "Invalid input";
}

export interface Entry {
  id: string;
  user_id: string;
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
  language: string;
  content: string;
  position: number;
  created_at: string;
  updated_at: string;
}
