"use client";
// Data access: the only module that talks to Supabase tables.
// Every write validates its input against the zod contracts first. Reads and writes go to the
// server (nothing is kept in the browser beyond SWR's in-memory cache). Ids are made here, and
// writes are sent one at a time in the order they were made, so a quick run of autosaves can't
// land out of order. A failed write throws: autosave shows "Not saved" and tries again.
import { allRows } from "../web/pages";
import useSWR, { mutate as globalMutate } from "swr";
import type { z } from "zod";
import { supabase } from "./supabase/client";
import { searchTerms } from "./search";
import { FriendlyError } from "../ui/user-message";
import { plainExcerpt } from "../ui/format";
import { searchHit, type SearchHit } from "../notes/search-hit";
import type { SourcedLink } from "../notes/links";
import { linkedIds, OTHER_NOTES_MAX, rankOtherNotes, type OtherNote, type OtherNoteRow } from "../notes/other-notes";
import { DEFAULT_LANGUAGE } from "../code/languages";
import { savedTurn, type AssistantAnswer, type AssistantTask, type SavedTurn } from "../ai/assistant";
import { outcomeParam, type OutcomeFilter } from "../notes/outcome";
import {
  notePatch,
  firstIssue,
  NOTE_INDEX_COLUMNS,
  projectName,
  cellInput,
  cellPatch,
  type Note,
  type NoteListItem,
  type DeletedNote,
  type NotePatch,
  type LastRun,
  type NoteIndexItem,
  type NoteLinkRow,
  type Project,
  type Cell,
  type CellInput,
  type CellPatch,
} from "../notes/schemas";

/** A failed Supabase call; the raw error (code, details, HTTP status) is its cause. Shown only via userMessage. */
class DataError extends Error {}

function check<T>(res: { data: T | null; error: { message: string } | null; status?: number }): T {
  if (res.error) throw new DataError(res.error.message, { cause: { ...res.error, status: res.status } });
  if (res.data === null) throw new DataError("Not found", { cause: { code: "PGRST116", status: 404 } });
  return res.data;
}

/** A write's result: throws on an error (no data expected). */
function done(res: { error: { message: string } | null; status?: number }): void {
  if (res.error) throw new DataError(res.error.message, { cause: { ...res.error, status: res.status } });
}

function validate<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw new FriendlyError(firstIssue(r.error)); // the schema's own words
  return r.data;
}

const keys = {
  list: (q: string, scope: NoteScope) => ["note-list", q, scope.projectId ?? "", scope.unfiled ? 1 : 0, scope.outcome ?? "all"] as const,
  projects: ["projects"] as const,
  note: (id: string) => ["note", id] as const,
  cells: (noteId: string) => ["cells", noteId] as const,
  noteIndex: ["notes"] as const,
  recentlyDeleted: ["recently-deleted"] as const,
  noteLinks: ["note-links"] as const,
};

/** Revalidate every cached list (any search query), the note index, the links and what lists show under titles: once, a moment after a run of saves. */
let listTimer: ReturnType<typeof setTimeout> | null = null;
function refreshLists() {
  if (listTimer) clearTimeout(listTimer);
  listTimer = setTimeout(() => {
    listTimer = null;
    void globalMutate((key) => Array.isArray(key) && ["note-list", "notes", "note-links", "note-bodies", "recently-deleted"].includes(key[0] as string));
  }, 1500);
}

/** Writes go one at a time, in order. */
let writes: Promise<unknown> = Promise.resolve();
function write<T>(f: () => Promise<T>): Promise<T> {
  const next = writes.then(f, f);
  writes = next.catch(() => undefined);
  return next;
}

async function userId(): Promise<string> {
  const { data } = await supabase().auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new DataError("Sign in first", { cause: { status: 401 } });
  return id;
}

const nowIso = () => new Date().toISOString();

// ------------------------------------------------------------------ projects
export function useProjects() {
  return useSWR(keys.projects, async () => check(await supabase().from("projects").select("id, name").order("name")) as Project[]);
}

export async function createProject(name: string): Promise<Project> {
  const p: Project = { id: crypto.randomUUID(), name: validate(projectName, name) };
  await write(async () => done(await supabase().from("projects").insert(p)));
  await globalMutate(keys.projects);
  return p;
}

export async function renameProject(id: string, name: string): Promise<void> {
  const n = validate(projectName, name);
  await write(async () => done(await supabase().from("projects").update({ name: n }).eq("id", id)));
  await globalMutate(keys.projects);
}

/** Deletes the project; its notes stay, unfiled. */
export async function deleteProject(id: string): Promise<void> {
  await write(async () => done(await supabase().from("projects").delete().eq("id", id)));
  await globalMutate(keys.projects);
  void refreshLists();
}

// ------------------------------------------------------------------ notes
/** Which notes a list shows: one project's, only unfiled ones, or (default) all; optionally one outcome. */
interface NoteScope {
  projectId?: string;
  unfiled?: boolean;
  outcome?: OutcomeFilter;
}

export function useNotes(query: string, scope: NoteScope = {}) {
  const terms = searchTerms(query);
  return useSWR(
    keys.list(terms.join(" "), scope),
    () =>
      allRows<NoteListItem>((from, to) =>
        supabase()
          .rpc("search_notes", {
            terms,
            p_project: scope.projectId ?? null,
            p_unfiled: !!scope.unfiled,
            p_outcome: outcomeParam(scope.outcome ?? "all"),
          })
          .select("id, title, outcome, parent_id, updated_at, pinned_at")
          .range(from, to),
      ),
    { keepPreviousData: true },
  );
}

export function useNote(id: string) {
  return useSWR(keys.note(id), async () => check(await supabase().from("notes").select("*").eq("id", id).maybeSingle()) as Note);
}

/** What a list shows under each title: a line of the note, and how many code cells it has. */
interface NoteDetail {
  excerpt: string;
  cells: number;
}

type CellText = Pick<Cell, "id" | "note_id" | "position" | "created_at" | "filename" | "content" | "note_before" | "note_after">;
interface Bodies {
  notes: Map<string, string>;
  cells: Map<string, CellText[]>;
}

/** The text of the notes a list shows (their bodies and cells), read in groups of 100. */
async function noteBodies(ids: readonly string[]): Promise<Bodies> {
  const notes = new Map<string, string>();
  const cells = new Map<string, CellText[]>();
  for (let i = 0; i < ids.length; i += 100) {
    const part = ids.slice(i, i + 100);
    const [es, cs] = await Promise.all([
      allRows<{ id: string; notes: string }>((from, to) => supabase().from("notes").select("id, notes").in("id", part).order("id").range(from, to)),
      allRows<CellText>((from, to) =>
        supabase().from("cells").select("id, note_id, position, created_at, filename, content, note_before, note_after").in("note_id", part).order("note_id").order("position").order("created_at").order("id").range(from, to),
      ),
    ]);
    for (const e of es) notes.set(e.id, e.notes);
    for (const c of cs) cells.set(c.note_id, [...(cells.get(c.note_id) ?? []), c]);
  }
  return { notes, cells };
}

const useBodies = (ids: readonly string[]) => useSWR(ids.length ? ["note-bodies", ids.join(",")] : null, () => noteBodies(ids), { keepPreviousData: true });

/** What the list shows under each of these notes. */
export function useNoteDetails(ids: readonly string[]) {
  const { data, ...rest } = useBodies(ids);
  const details = data && new Map<string, NoteDetail>([...data.notes].map(([id, notes]) => [id, { excerpt: plainExcerpt(notes), cells: data.cells.get(id)?.length ?? 0 }]));
  return { ...rest, data: details };
}

/** Where a search found each of these notes (the matching line and its cell). */
export function useSearchHits(query: string, ids: readonly string[]) {
  const terms = searchTerms(query);
  const { data, ...rest } = useBodies(terms.length ? ids : []);
  const hits = data && new Map<string, SearchHit | null>(ids.map((id) => [id, data.notes.has(id) ? searchHit({ notes: data.notes.get(id)! }, data.cells.get(id) ?? [], terms) : null]));
  return { ...rest, data: hits };
}

/** Every note (NOTE_INDEX_COLUMNS) not in Recently Deleted, most recently edited first. */
export function useNoteIndex() {
  return useSWR(keys.noteIndex, () =>
    allRows<NoteIndexItem>((from, to) =>
      supabase().from("notes").select(NOTE_INDEX_COLUMNS).is("deleted_at", null).order("updated_at", { ascending: false }).order("id").range(from, to),
    ),
  );
}

/** Recently Deleted: the notes waiting to be removed for good, most recently deleted first. */
export function useRecentlyDeleted() {
  return useSWR(keys.recentlyDeleted, () =>
    allRows<DeletedNote>((from, to) =>
      supabase().from("notes").select("id, title, deleted_at").not("deleted_at", "is", null).order("deleted_at", { ascending: false }).order("id").range(from, to),
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

export async function createNote(title = "", projectId: string | null = null, parentId: string | null = null): Promise<Note> {
  const row = validate(notePatch, { title, project_id: projectId, parent_id: parentId });
  const at = nowIso();
  const created: Note = { id: crypto.randomUUID(), user_id: await userId(), project_id: row.project_id ?? null, parent_id: row.parent_id ?? null, derived_from: null, title: row.title ?? "", notes: "", outcome: null, created_at: at, updated_at: at, pinned_at: null, deleted_at: null };
  await write(async () => done(await supabase().from("notes").insert({ id: created.id, title: created.title, notes: created.notes, project_id: created.project_id, parent_id: created.parent_id })));
  await globalMutate(keys.note(created.id), created, { revalidate: false });
  await globalMutate(keys.cells(created.id), [], { revalidate: false });
  void refreshLists();
  return created;
}

/**
 * A new attempt of a note: new_attempt() (SQL) copies its title as "<title> (attempt N)",
 * body, project, parent and code cells (not their runs or the outcome) and sets
 * derived_from, in one transaction. Returns the new note's id.
 */
export async function newAttempt(fromId: string): Promise<string> {
  const id = await write(async () => check(await supabase().rpc("new_attempt", { p_from: fromId })) as string);
  void refreshLists();
  return id;
}

export async function updateNote(id: string, patch: NotePatch): Promise<void> {
  const fields = validate(notePatch, patch);
  await write(async () => done(await supabase().from("notes").update(fields).eq("id", id)));
  // What's shown keeps what was saved (the editor may already be further on); the lists catch up.
  await globalMutate(keys.note(id), (e: Note | undefined) => (e ? { ...e, ...fields, updated_at: nowIso() } : e), { revalidate: false });
  void refreshLists();
}

/** Pins or unpins a note (pinned notes come first in the lists). Not an edit: its date stays. */
export async function setPinned(id: string, pinned: boolean): Promise<void> {
  const pinned_at = pinned ? nowIso() : null;
  await write(async () => done(await supabase().from("notes").update({ pinned_at }).eq("id", id)));
  await globalMutate(keys.note(id), (e: Note | undefined) => (e ? { ...e, pinned_at } : e), { revalidate: false });
  void refreshLists();
}

/** Moves a note to Recently Deleted: out of the lists, kept 30 days, restorable until then. */
export async function deleteNote(id: string): Promise<void> {
  const deleted_at = nowIso();
  await write(async () => done(await supabase().from("notes").update({ deleted_at }).eq("id", id)));
  await globalMutate(keys.note(id), (e: Note | undefined) => (e ? { ...e, deleted_at } : e), { revalidate: false });
  void refreshLists();
}

/** Brings a note back from Recently Deleted. */
export async function restoreNote(id: string): Promise<void> {
  await write(async () => done(await supabase().from("notes").update({ deleted_at: null }).eq("id", id)));
  await globalMutate(keys.note(id), (e: Note | undefined) => (e ? { ...e, deleted_at: null } : e), { revalidate: false });
  void refreshLists();
}

/** Deletes notes for good, now (from Recently Deleted): their cells and shares go too. */
export async function deleteNotesForever(ids: readonly string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 100) {
    const part = ids.slice(i, i + 100);
    await write(async () => done(await supabase().from("notes").delete().in("id", part)));
  }
  for (const id of ids) await globalMutate(keys.note(id), undefined, { revalidate: false });
  void refreshLists();
}

// ------------------------------------------------------------------ cells
export function useCells(noteId: string) {
  return useSWR(keys.cells(noteId), async () => check(await supabase().from("cells").select("*").eq("note_id", noteId).order("position").order("created_at")) as Cell[]);
}

/** The note's code cells fresh from the database (the cache is updated too): for a read on a tap. */
export function fetchCells(noteId: string): Promise<Cell[] | undefined> {
  return globalMutate<Cell[]>(keys.cells(noteId));
}

export { endPosition } from "../notes/positions";

/** Adds code blocks to a note in one insert, positioned after `position`; their ids, in order. */
export async function createCells(noteId: string, position: number, items: CellInput[]): Promise<string[]> {
  const uid = await userId();
  const at = nowIso();
  const rows: Cell[] = items.map((item, i) => {
    const v = validate(cellInput, item);
    return { id: crypto.randomUUID(), user_id: uid, note_id: noteId, filename: v.filename, language: v.language, content: v.content, position: position + i, last_run: null, note_before: "", note_after: "", created_at: at, updated_at: at } as Cell;
  });
  await write(async () =>
    done(await supabase().from("cells").insert(rows.map((s) => ({ id: s.id, note_id: s.note_id, position: s.position, filename: s.filename, language: s.language, content: s.content })))),
  );
  await globalMutate(keys.cells(noteId));
  void refreshLists();
  return rows.map((r) => r.id);
}

export async function createEmptyCell(noteId: string, position: number): Promise<void> {
  await createCells(noteId, position, [{ filename: "", language: DEFAULT_LANGUAGE, content: "" }]);
}

/**
 * Saves a patch (code, language, or the latest run) and merges it into the
 * cached list, so reopening the note in-app shows what was saved.
 */
export async function updateCell(cell: Pick<Cell, "id" | "note_id">, patch: CellPatch): Promise<void> {
  const fields = validate(cellPatch, patch);
  await write(async () => done(await supabase().from("cells").update(fields).eq("id", cell.id)));
  await globalMutate(keys.cells(cell.note_id), (list: Cell[] | undefined) => list?.map((s) => (s.id === cell.id ? ({ ...s, ...fields, updated_at: nowIso() } as Cell) : s)), { revalidate: false });
}

/** Saves a cell's "Note before run" / "Note after run" (the user's text; nothing else writes it). */
export function saveCellNotes(cell: Pick<Cell, "id" | "note_id">, notes: Pick<Cell, "note_before" | "note_after">): Promise<void> {
  return updateCell(cell, notes);
}

/** Stores (or, with null, clears) a code block's latest run. */
export function saveLastRun(cell: Pick<Cell, "id" | "note_id">, run: LastRun | null): Promise<void> {
  return updateCell(cell, { last_run: run });
}

export async function deleteCell(cell: Cell): Promise<void> {
  await write(async () => done(await supabase().from("cells").delete().eq("id", cell.id)));
  await globalMutate(keys.cells(cell.note_id), (list: Cell[] | undefined) => list?.filter((s) => s.id !== cell.id), { revalidate: false });
  void refreshLists();
}

// ------------------------------------------------------------- background server runs
/** A cell's latest background run that still needs the page: going, or done with a result not yet saved. */
export async function pendingServerRun(cellId: string): Promise<import("../run/server-client").BackgroundRun | null> {
  const { data, error } = await supabase()
    .from("server_runs")
    .select("id, status, started_at, limit_sec, notice, result, error")
    .eq("cell_id", cellId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  if (!(data.status === "running" || (data.status === "done" && data.result))) return null;
  return {
    id: data.id,
    status: data.status,
    startedAt: data.started_at,
    limitSec: data.limit_sec,
    ...(data.notice ? { notice: data.notice } : {}),
    ...(data.result ? { result: data.result } : {}),
    ...(data.error ? { error: data.error } : {}),
  };
}

/** Drops a background run's stored result once the cell saved it as its last run. */
export async function clearServerRunResult(id: string): Promise<void> {
  const { error } = await supabase().from("server_runs").update({ result: null }).eq("id", id);
  if (error) throw error;
}

// ------------------------------------------------------------------ other notes, for the Assistant

/** How long search by meaning may take before find_notes goes on with the word search alone. */
const MEANING_MS = 8_000;

/**
 * The user's notes closest in meaning (the note-search Edge Function: gte-small embeddings in
 * pgvector, kept up to date as it goes), closest first. [] when it can't answer in time (offline, a
 * new account still being embedded): find_notes then uses the word search alone.
 */
async function closeInMeaning(body: { query?: string; note: string }): Promise<string[]> {
  const ask = supabase()
    .functions.invoke("note-search", { body })
    .then(({ data, error }) => (error ? [] : (((data as { matches?: { id: string }[] } | null)?.matches ?? []).map((m) => m.id))))
    .catch(() => [] as string[]);
  return Promise.race([ask, new Promise<string[]>((done) => setTimeout(() => done([]), MEANING_MS))]);
}

/** The rows of these notes (not in Recently Deleted). */
async function otherRows(ids: readonly string[]): Promise<OtherNoteRow[]> {
  return ids.length ? (check(await supabase().from("notes").select(OTHER_COLUMNS).in("id", [...ids]).is("deleted_at", null)) as OtherNoteRow[]) : [];
}

/**
 * The user's other notes for find_notes (lib/notes/other-notes.ts orders them). With words: those
 * matching the words (the same search as the notes list) fused with those close in meaning. With no
 * words: the notes this one links to, its parent and children, those close in meaning to it, then
 * the most recently edited. Never Recently Deleted.
 */
export async function findOtherNotes(query: string, from: { id: string; parent_id: string | null; body: string }): Promise<OtherNote[]> {
  const terms = searchTerms(query);
  if (terms.length) {
    const [words, similar] = await Promise.all([
      supabase().rpc("search_notes", { terms, p_project: null, p_unfiled: false, p_outcome: outcomeParam("all") }).select(OTHER_COLUMNS).limit(OTHER_NOTES_MAX + 1),
      closeInMeaning({ query: query.trim(), note: from.id }),
    ]);
    const rows = check(words) as OtherNoteRow[];
    const extra = (await otherRows(similar.filter((id) => !rows.some((r) => r.id === id)))).map((r) => ({ ...r, matched: false }));
    return rankOtherNotes(from, [...rows, ...extra], true, OTHER_NOTES_MAX, similar);
  }
  const near = [...linkedIds(from.body), ...(from.parent_id ? [from.parent_id] : [])];
  const [close, children, recent, similar] = await Promise.all([
    otherRows(near),
    supabase().from("notes").select(OTHER_COLUMNS).eq("parent_id", from.id).is("deleted_at", null).order("updated_at", { ascending: false }).limit(OTHER_NOTES_MAX),
    supabase().from("notes").select(OTHER_COLUMNS).is("deleted_at", null).order("updated_at", { ascending: false }).limit(OTHER_NOTES_MAX + 1),
    closeInMeaning({ note: from.id }),
  ]);
  const rows = [...close, ...(check(children) as OtherNoteRow[]), ...(check(recent) as OtherNoteRow[])];
  const more = await otherRows(similar.filter((id) => !rows.some((r) => r.id === id)));
  return rankOtherNotes(from, [...rows, ...more], false, OTHER_NOTES_MAX, similar);
}
const OTHER_COLUMNS = "id, title, outcome, updated_at, parent_id";

/** Another note as saved, for the Assistant to read (never to change); null when it's gone or deleted. */
export async function openOtherNote(id: string): Promise<{ title: string; body: string; cells: Cell[]; outcome: "success" | "failed" | null; parent_id: string | null } | null> {
  const row = check(await supabase().from("notes").select("title, notes, outcome, parent_id, deleted_at").eq("id", id).maybeSingle()) as { title: string; notes: string; outcome: "success" | "failed" | null; parent_id: string | null; deleted_at: string | null } | null;
  if (!row || row.deleted_at) return null;
  // Not fetchCells: that refreshes only a note whose cells are on screen.
  const cells = check(await supabase().from("cells").select("*").eq("note_id", id).order("position").order("created_at")) as Cell[];
  return { title: row.title, body: row.notes, cells, outcome: row.outcome, parent_id: row.parent_id };
}

// ------------------------------------------------------------------ assistant history
// The note's saved assistant turns (assistant_turns) and the summary the database condensed from older
// ones (assistant_summaries). Owner only (RLS). The assistant writes only these, never the note.

/** The note's summary ('' when none) and its saved turns, oldest first. Unreadable rows are skipped. */
export async function loadAssistantHistory(noteId: string): Promise<{ summary: string; turns: SavedTurn[] }> {
  const [rows, summary] = await Promise.all([
    allRows<unknown>((from, to) =>
      supabase().from("assistant_turns").select("id, task, request, answer, created_at").eq("note_id", noteId).order("created_at").order("id").range(from, to),
    ),
    supabase().from("assistant_summaries").select("summary").eq("note_id", noteId).maybeSingle(),
  ]);
  if (summary.error) check(summary);
  const turns = rows.flatMap((r) => {
    const t = savedTurn.safeParse(r);
    return t.success ? [t.data] : [];
  });
  return { summary: (summary.data?.summary as string | undefined) ?? "", turns };
}

/** Saves one answered turn with the note; returns its row id. */
export async function saveAssistantTurn(noteId: string, turn: { task: AssistantTask; request: string; answer: AssistantAnswer }): Promise<string> {
  const row = check(await supabase().from("assistant_turns").insert({ note_id: noteId, task: turn.task, request: turn.request, answer: turn.answer }).select("id").single()) as { id: string };
  return row.id;
}

/**
 * Saves a turn again with a new answer (Undo marks it undone), keeping when it was asked; turns are
 * never edited in place, so the new row goes in first and the old one goes. Returns the new id.
 */
export async function resaveAssistantTurn(noteId: string, turn: SavedTurn, answer: AssistantAnswer): Promise<string> {
  const row = check(await supabase().from("assistant_turns").insert({ note_id: noteId, task: turn.task, request: turn.request, answer, created_at: turn.created_at }).select("id").single()) as { id: string };
  await deleteAssistantTurn(turn.id).catch(() => {}); // a leftover copy is shown once, never lost
  return row.id;
}

/** Clear: deletes one saved turn. */
export async function deleteAssistantTurn(id: string): Promise<void> {
  check(await supabase().from("assistant_turns").delete().eq("id", id).select("id"));
}

/** Clear conversation: deletes every saved turn of the note and its summary, in two requests however many there are. */
export async function clearAssistant(noteId: string): Promise<void> {
  done(await supabase().from("assistant_turns").delete().eq("note_id", noteId));
  done(await supabase().from("assistant_summaries").delete().eq("note_id", noteId));
}
