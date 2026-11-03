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
  projectName,
  snippetInput,
  snippetPatch,
  type Entry,
  type EntryListItem,
  type EntryPatch,
  type Project,
  type Snippet,
  type SnippetInput,
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
  entries: (q: string, scope: EntryScope) => ["entries", q, scope.projectId ?? "", scope.unfiled ? 1 : 0] as const,
  projects: ["projects"] as const,
  entry: (id: string) => ["entry", id] as const,
  snippets: (entryId: string) => ["snippets", entryId] as const,
};

/** Revalidate every cached list (any search query). */
function refreshLists() {
  return globalMutate((key) => Array.isArray(key) && key[0] === "entries");
}

// ------------------------------------------------------------------ projects
export function useProjects() {
  return useSWR(keys.projects, async () => check(await supabase().from("projects").select("id, name").order("name")) as Project[]);
}

export async function createProject(name: string): Promise<Project> {
  const p = check(await supabase().from("projects").insert({ name: validate(projectName, name) }).select("id, name").single()) as Project;
  await globalMutate(keys.projects);
  return p;
}

export async function renameProject(id: string, name: string): Promise<void> {
  check(await supabase().from("projects").update({ name: validate(projectName, name) }).eq("id", id).select("id").single());
  await globalMutate(keys.projects);
}

/** Deletes the project; its entries stay, unfiled. */
export async function deleteProject(id: string): Promise<void> {
  check(await supabase().from("projects").delete().eq("id", id).select("id").single());
  await globalMutate(keys.projects);
  void globalMutate((key) => Array.isArray(key) && key[0] === "entry");
  void refreshLists();
}

// ------------------------------------------------------------------ entries
/** Which entries a list shows: one project's, only unfiled ones, or (default) all. */
export interface EntryScope {
  projectId?: string;
  unfiled?: boolean;
}

export function useEntries(query: string, scope: EntryScope = {}) {
  const terms = searchTerms(query);
  return useSWR(
    keys.entries(terms.join(" "), scope),
    async () =>
      check(
        await supabase()
          .rpc("search_entries", { terms, p_project: scope.projectId ?? null, p_unfiled: !!scope.unfiled })
          .select("id, title, updated_at"),
      ) as EntryListItem[],
    { keepPreviousData: true },
  );
}

export function useEntry(id: string) {
  return useSWR(keys.entry(id), async () => check(await supabase().from("entries").select("*").eq("id", id).maybeSingle()) as Entry);
}

export async function createEntry(title = "", projectId: string | null = null): Promise<Entry> {
  const row = validate(entryPatch, { title, project_id: projectId });
  const created = check(await supabase().from("entries").insert(row).select().single()) as Entry;
  void refreshLists();
  return created;
}

export async function updateEntry(id: string, patch: EntryPatch): Promise<void> {
  check(await supabase().from("entries").update(validate(entryPatch, patch)).eq("id", id).select("id").single());
  if ("project_id" in patch) void globalMutate(keys.entry(id));
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

/** Adds code blocks to an entry in one insert, positioned after `position`. */
export async function createSnippets(entryId: string, position: number, items: SnippetInput[]): Promise<void> {
  const rows = items.map((item, i) => ({ ...validate(snippetInput, item), entry_id: entryId, position: position + i }));
  check(await supabase().from("snippets").insert(rows).select("id"));
  await globalMutate(keys.snippets(entryId));
  void refreshLists();
}

export function createEmptySnippet(entryId: string, position: number): Promise<void> {
  return createSnippets(entryId, position, [{ filename: "", language: DEFAULT_LANGUAGE, content: "" }]);
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
