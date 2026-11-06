"use client";
// Data access: the only module that talks to Supabase tables.
// Every write validates its input against the zod contracts first.
import { allRows } from "./pages";
import useSWR, { mutate as globalMutate } from "swr";
import type { z } from "zod";
import { supabase } from "./supabase/client";
import { searchTerms } from "./search";
import { FriendlyError } from "./user-message";
import type { SourcedLink } from "./links";
import { DEFAULT_LANGUAGE } from "./languages";
import { asPlan, type Plan } from "./plan";
import { outcomeParam, type OutcomeFilter } from "./outcome";
import {
  entryPatch,
  firstIssue,
  NOTE_INDEX_COLUMNS,
  projectName,
  snippetInput,
  snippetPatch,
  type Entry,
  type EntryListItem,
  type EntryPatch,
  type LastRun,
  type NoteIndexItem,
  type NoteLinkRow,
  type Project,
  type Snippet,
  type SnippetInput,
  type SnippetPatch,
} from "./schemas";

/** A failed Supabase call; the raw error (code, details, HTTP status) is its cause. Shown only via userMessage. */
export class DataError extends Error {}

function check<T>(res: { data: T | null; error: { message: string } | null; status?: number }): T {
  if (res.error) throw new DataError(res.error.message, { cause: { ...res.error, status: res.status } });
  if (res.data === null) throw new DataError("Not found", { cause: { code: "PGRST116", status: 404 } });
  return res.data;
}

function validate<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw new FriendlyError(firstIssue(r.error)); // the schema's own words
  return r.data;
}

const keys = {
  entries: (q: string, scope: EntryScope) => ["entries", q, scope.projectId ?? "", scope.unfiled ? 1 : 0, scope.outcome ?? "all"] as const,
  projects: ["projects"] as const,
  entry: (id: string) => ["entry", id] as const,
  snippets: (entryId: string) => ["snippets", entryId] as const,
  noteIndex: ["notes"] as const,
  noteLinks: ["note-links"] as const,
};

/** Revalidate every cached list (any search query), the note index and the links. */
function refreshLists() {
  return globalMutate((key) => Array.isArray(key) && (key[0] === "entries" || key[0] === "notes" || key[0] === "note-links"));
}

// ------------------------------------------------------------------ projects
/** The signed-in user's plan, for showing the right controls (the server enforces it). */
export function usePlan(): Plan | undefined {
  const { data } = useSWR("plan", async () => {
    const res = await supabase().from("profiles").select("plan").maybeSingle();
    return asPlan(res.data?.plan);
  });
  return data;
}

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
/** Which entries a list shows: one project's, only unfiled ones, or (default) all; optionally one outcome. */
export interface EntryScope {
  projectId?: string;
  unfiled?: boolean;
  outcome?: OutcomeFilter;
}

export function useEntries(query: string, scope: EntryScope = {}) {
  const terms = searchTerms(query);
  return useSWR(
    keys.entries(terms.join(" "), scope),
    () =>
      allRows<EntryListItem>((from, to) =>
        supabase()
          .rpc("search_entries", {
            terms,
            p_project: scope.projectId ?? null,
            p_unfiled: !!scope.unfiled,
            p_outcome: outcomeParam(scope.outcome ?? "all"),
          })
          .select("id, title, outcome, parent_id, updated_at")
          .range(from, to),
      ),
    { keepPreviousData: true },
  );
}

export function useEntry(id: string) {
  return useSWR(keys.entry(id), async () => check(await supabase().from("entries").select("*").eq("id", id).maybeSingle()) as Entry);
}

/** Every note (NOTE_INDEX_COLUMNS), most recently edited first. */
export function useNoteIndex() {
  return useSWR(keys.noteIndex, () =>
    allRows<NoteIndexItem>((from, to) =>
      supabase().from("entries").select(NOTE_INDEX_COLUMNS).order("updated_at", { ascending: false }).order("id").range(from, to),
    ),
  );
}

/** Every [[link]] in the user's notes, derived by note_links() from the bodies and the cell notes. */
export function useNoteLinks() {
  return useSWR(keys.noteLinks, async (): Promise<SourcedLink[]> => {
    const rows = check(await supabase().rpc("note_links")) as NoteLinkRow[];
    return rows.map((r) => ({ source: r.source, label: r.label.trim(), id: r.target }));
  });
}

export async function createEntry(title = "", projectId: string | null = null, parentId: string | null = null): Promise<Entry> {
  const row = validate(entryPatch, { title, project_id: projectId, parent_id: parentId });
  const created = check(await supabase().from("entries").insert(row).select().single()) as Entry;
  void refreshLists();
  return created;
}

/**
 * A new attempt of a note: new_attempt() (SQL) copies its title as "<title> (attempt N)",
 * body, project, parent and code cells (not their runs or the outcome) and sets
 * derived_from, in one transaction. Returns the new note's id.
 */
export async function newAttempt(fromId: string): Promise<string> {
  const id = check(await supabase().rpc("new_attempt", { p_from: fromId })) as string;
  void refreshLists();
  return id;
}

export async function updateEntry(id: string, patch: EntryPatch): Promise<void> {
  const row = validate(entryPatch, patch);
  check(await supabase().from("entries").update(row).eq("id", id).select("id").single());
  // Keep the cached note current so reopening it in-app shows what was saved.
  await globalMutate(keys.entry(id), (e?: Entry) => (e ? { ...e, ...row } : e), { revalidate: false });
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

/** The note's code cells fresh from the database (the cache is updated too): for a read on a tap. */
export function fetchSnippets(entryId: string): Promise<Snippet[] | undefined> {
  return globalMutate<Snippet[]>(keys.snippets(entryId));
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

/**
 * Saves a patch (code, language, or the latest run) and merges it into the
 * cached list, so reopening the note in-app shows what was saved.
 */
export async function updateSnippet(snippet: Pick<Snippet, "id" | "entry_id">, patch: SnippetPatch): Promise<void> {
  const row = validate(snippetPatch, patch);
  check(await supabase().from("snippets").update(row).eq("id", snippet.id).select("id").single());
  await globalMutate(
    keys.snippets(snippet.entry_id),
    (list?: Snippet[]) => list?.map((s) => (s.id === snippet.id ? { ...s, ...row } : s)),
    { revalidate: false },
  );
  // A saved run isn't an edit: the list order and search don't change. Code and cell notes are
  // searched, and cell notes' [[links]] count for backlinks and the map.
  if ("content" in row || "language" in row || "note_before" in row || "note_after" in row) void refreshLists();
}

/** Saves a cell's "Note before run" / "Note after run" (the user's text; nothing else writes it). */
export function saveCellNotes(snippet: Pick<Snippet, "id" | "entry_id">, notes: Pick<Snippet, "note_before" | "note_after">): Promise<void> {
  return updateSnippet(snippet, notes);
}

/** Stores (or, with null, clears) a code block's latest run. */
export function saveLastRun(snippet: Pick<Snippet, "id" | "entry_id">, run: LastRun | null): Promise<void> {
  return updateSnippet(snippet, { last_run: run });
}

export async function deleteSnippet(snippet: Snippet): Promise<void> {
  check(await supabase().from("snippets").delete().eq("id", snippet.id).select("id").single());
  await globalMutate(keys.snippets(snippet.entry_id));
  void refreshLists();
}
