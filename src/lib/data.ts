"use client";
// Data access: the only module that talks to Supabase tables.
// Every write validates its input against the zod contracts first.
import useSWR, { mutate as globalMutate } from "swr";
import type { z } from "zod";
import { supabase } from "./supabase/client";
import { searchTerms } from "./search";
import { DEFAULT_LANGUAGE } from "./languages";
import {
  entryPatch,
  firstIssue,
  snippetPatch,
  type Entry,
  type EntryListItem,
  type EntryPatch,
  type Snippet,
  type SnippetPatch,
} from "./schemas";

export class DataError extends Error {}

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new DataError(res.error.message);
  if (res.data === null) throw new DataError("Not found");
  return res.data;
}

function validate<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw new DataError(firstIssue(r.error));
  return r.data;
}

const keys = {
  entries: (q: string) => ["entries", q] as const,
  entry: (id: string) => ["entry", id] as const,
  snippets: (entryId: string) => ["snippets", entryId] as const,
};

/** Revalidate every cached list (any search query). */
function refreshLists() {
  return globalMutate((key) => Array.isArray(key) && key[0] === "entries");
}

// ------------------------------------------------------------------ entries
export function useEntries(query: string) {
  const terms = searchTerms(query);
  return useSWR(
    keys.entries(terms.join(" ")),
    async () => check(await supabase().rpc("search_entries", { terms }).select("id, title, updated_at")) as EntryListItem[],
    { keepPreviousData: true },
  );
}

export function useEntry(id: string) {
  return useSWR(keys.entry(id), async () => check(await supabase().from("entries").select("*").eq("id", id).maybeSingle()) as Entry);
}

export async function createEntry(): Promise<Entry> {
  const created = check(await supabase().from("entries").insert({}).select().single()) as Entry;
  void refreshLists();
  return created;
}

export async function updateEntry(id: string, patch: EntryPatch): Promise<void> {
  check(await supabase().from("entries").update(validate(entryPatch, patch)).eq("id", id).select("id").single());
  void refreshLists();
}

export async function deleteEntry(id: string): Promise<void> {
  check(await supabase().from("entries").delete().eq("id", id).select("id").single());
  void refreshLists();
}

// ------------------------------------------------------------------ snippets
export function useSnippets(entryId: string) {
  return useSWR(keys.snippets(entryId), async () => {
    const res = await supabase().from("snippets").select("*").eq("entry_id", entryId).order("position").order("created_at");
    return check(res) as Snippet[];
  });
}

export async function createSnippet(entryId: string, position: number, language: string = DEFAULT_LANGUAGE): Promise<void> {
  const row = validate(snippetPatch, { language, content: "" });
  check(await supabase().from("snippets").insert({ ...row, entry_id: entryId, position }).select("id").single());
  await globalMutate(keys.snippets(entryId));
  void refreshLists();
}

export async function updateSnippet(id: string, patch: SnippetPatch): Promise<void> {
  check(await supabase().from("snippets").update(validate(snippetPatch, patch)).eq("id", id).select("id").single());
  void refreshLists();
}

export async function deleteSnippet(snippet: Snippet): Promise<void> {
  check(await supabase().from("snippets").delete().eq("id", snippet.id).select("id").single());
  await globalMutate(keys.snippets(snippet.entry_id));
  void refreshLists();
}
