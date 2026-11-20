"use client";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAutosave, useSaveStatus } from "@/lib/ui/autosave";
import {
  createEmptyCell,
  createNote,
  createCells,
  endPosition,
  deleteNote,
  deleteNotesForever,
  deleteCell,
  restoreNote,
  setPinned,
  fetchCells,
  findOtherNotes,
  openOtherNote,
  updateCell,
  newAttempt,
  updateNote,
  useNote,
  useNoteIndex,
  useNoteLinks,
  useProjects,
  useCells,
} from "@/lib/data";
import { cn, daysLeftText, displayTitle } from "@/lib/ui/format";
import { mapHref } from "@/lib/notes/graph";
import { latestRun } from "@/lib/ai/assistant";
import { backlinksTo } from "@/lib/notes/links";
import { OUTCOME_CHOICES, type Outcome } from "@/lib/notes/outcome";
import { afterDeletePath } from "@/lib/web/paths";
import type { Note, NoteIndexItem, Cell } from "@/lib/notes/schemas";
import { ancestors, childrenOf } from "@/lib/notes/tree";
import { useAutosize } from "@/lib/ui/use-autosize";
import { CellNote, useCellNotes } from "./cell-note";
import { FilePicker } from "../code/file-picker";
import { FormatBarProvider, FormatBarSlot } from "./format-bar";
import { AssistantPanel } from "./assistant-panel";
import { ExportNoteDialog, type ExportNoteHandle } from "./export-note";
import { ShareSheet, type ShareSheetHandle } from "../share/share-sheet";
import { useShare } from "@/lib/data/shares";
import type { ExportNote } from "@/lib/files/note-export";
import { LiveTextBlock, type TextBlockHandle } from "./live-text-block";
import { NOTE_META_ROW_CLASS, NOTE_TITLE_CLASS, RenderedBody } from "./note-parts";
import { ParentPicker } from "./parent-picker";
import { SaveIndicator } from "./save-indicator";
import { CellBlock, type CellControls } from "../code/cell-block";
import type { AgentNote } from "@/lib/ai/agent";
import { toSee, withSeen } from "@/lib/run/outputs";
import { ProposalProvider, type ApplyProposal } from "./proposal-context";
import { placeNoteText } from "@/lib/ai/assistant";
import { Column, MoreMenu, Segmented, TextButton, TextLink, TopBar, Notice, Button, IconBranch, IconEye, IconFolder, IconPen, IconChat, IconLink, IconPlay, IconStop, Working } from "../ui";
import { cellState, firstFailed } from "@/lib/notes/cell-status";
import { runsInBrowser } from "@/lib/run/types";
import { runsOnServer } from "@/lib/run/server-languages";
import { userMessage } from "@/lib/ui/user-message";

const NO_NOTES: NoteIndexItem[] = [];

/** A control in the note's place-and-verdict row (project, parent): plain text with its icon. */
const META_CHIP =
  "inline-flex h-9 items-center gap-2 rounded-md px-1 text-sm text-muted transition-colors hover:text-fg focus-within:ring-2 focus-within:ring-fg/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/40";

/** Placeholder and accessible name of the note body. */
const NOTE_LABEL = "Experiment note";

export function NoteView({ id: routeId }: { id: string }) {
  // The note is the one in the address bar (a page restored for another address shows the right one).
  const [id, setId] = useState(routeId);
  useEffect(() => {
    const m = /^\/n\/([^/?#]+)/.exec(window.location.pathname);
    if (m?.[1] && m[1] !== routeId) setId(decodeURIComponent(m[1]));
  }, [routeId]);
  const { data: note, error, isLoading } = useNote(id);
  const { data: projects } = useProjects();
  const project = projects?.find((p) => p.id === note?.project_id);
  const back = project ? <TextLink href={`/p/${project.id}`}>{project.name}</TextLink> : <TextLink href="/">All notes</TextLink>;

  if (isLoading) return <Column><TopBar left={back} /></Column>;
  if (error || !note) {
    return (
      <Column>
        <TopBar left={back} />
        <p className="py-10 text-sm text-muted">This note doesn’t exist.</p>
      </Column>
    );
  }
  if (note.deleted_at) return <DeletedNote note={note} back={back} />;
  return <Editor note={note} back={back} />;
}

/** A note in Recently Deleted, opened by its address: not editable; Restore or Delete now. */
function DeletedNote({ note, back }: { note: Note; back: React.ReactNode }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act(f: () => Promise<void>, action: "restore" | "delete_note", then?: string) {
    setBusy(true);
    setError(null);
    try {
      await f();
      if (then) router.replace(then);
    } catch (e) {
      setError(userMessage(e, action));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Column>
      <TopBar left={back} />
      <h1 className={cn(NOTE_TITLE_CLASS, !note.title.trim() && "italic text-muted")}>{displayTitle(note.title)}</h1>
      <p className="mt-4 text-sm leading-relaxed text-muted">This note is in Recently Deleted ({daysLeftText(note.deleted_at!)}). Restore it to open and edit it again.</p>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Button onClick={() => void act(() => restoreNote(note.id), "restore")} loading={busy}>Restore</Button>
        <TextButton
          onClick={() => window.confirm("Delete this note and its code for good? This can’t be undone.") && void act(() => deleteNotesForever([note.id]), "delete_note", "/deleted")}
          disabled={busy}
          className="!text-fail"
        >
          Delete now
        </TextButton>
      </div>
      {error && <Notice className="mt-4" onDismiss={() => setError(null)}>{error}</Notice>}
    </Column>
  );
}

function Editor({ note, back }: { note: Note; back: React.ReactNode }) {
  const router = useRouter();
  const { flushAll } = useSaveStatus();
  const [title, setTitle] = useState(note.title);
  const [notes, setNotes] = useState(note.notes);
  const [preview, setPreview] = useState(false);
  const [assistant, setAssistant] = useState(false);
  const assistantButton = useRef<HTMLButtonElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState(note.project_id ?? "");
  const [moveError, setMoveError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(note.outcome ?? null);
  const [outcomeError, setOutcomeError] = useState<string | null>(null);

  async function mark(next: Outcome | null) {
    const previous = outcome;
    setOutcome(next);
    setOutcomeError(null);
    try {
      await updateNote(note.id, { outcome: next });
    } catch (e) {
      setOutcome(previous);
      setOutcomeError(userMessage(e, "outcome"));
    }
  }
  const { data: projects } = useProjects();
  const notesIndex = useNoteIndex().data ?? NO_NOTES;
  const { data: links } = useNoteLinks();
  const [parentId, setParentId] = useState<string | null>(note.parent_id ?? null);
  const [picking, setPicking] = useState(false);
  const [parentError, setParentError] = useState<string | null>(null);
  // The tree as it is now, with this note's parent as just chosen.
  const tree = notesIndex.map((n) => (n.id === note.id ? { ...n, parent_id: parentId } : n));
  const path = ancestors(note.id, tree);
  const parent = path.at(-1);
  const subNotes = childrenOf(note.id, tree);
  const linkedFrom = links ? backlinksTo(note.id, links, notesIndex) : [];
  const origin = notesIndex.find((n) => n.id === note.derived_from);
  const attempts = notesIndex.filter((n) => n.derived_from === note.id);
  const [attemptError, setAttemptError] = useState<string | null>(null);
  const [attempting, setAttempting] = useState(false);

  async function startAttempt() {
    setAttempting(true);
    setAttemptError(null);
    try {
      await flushAll(); // the copy takes the body and code as saved
      const id = await newAttempt(note.id);
      router.push(`/n/${id}`);
    } catch (e) {
      setAttemptError(userMessage(e, "new_attempt"));
      setAttempting(false);
    }
  }

  async function reparent(next: string | null) {
    const previous = parentId;
    setPicking(false);
    setParentId(next);
    setParentError(null);
    try {
      await updateNote(note.id, { parent_id: next });
    } catch (e) {
      setParentId(previous);
      setParentError(userMessage(e, "parent"));
    }
  }

  async function newSubNote() {
    await flushAll();
    const child = await createNote("", projectId || null, note.id);
    router.push(`/n/${child.id}`);
  }

  async function move(next: string) {
    const previous = projectId;
    setProjectId(next);
    setMoveError(null);
    try {
      await updateNote(note.id, { project_id: next || null });
    } catch (e) {
      setProjectId(previous);
      setMoveError(userMessage(e, "move"));
    }
  }
  const titleRef = useAutosize(title);
  const bodyRef = useRef<TextBlockHandle>(null);
  const { data: cells } = useCells(note.id);
  const exportDialog = useRef<ExportNoteHandle>(null);
  const shareSheet = useRef<ShareSheetHandle>(null);
  const { data: shared } = useShare(note.id);

  useAutosave({ title, notes }, (v) => updateNote(note.id, v), { baseline: { title: note.title, notes: note.notes } });

  // A brand-new note starts with the cursor in the title.
  useEffect(() => {
    if (!note.title && !note.notes) titleRef.current?.focus();
  }, [note.title, note.notes, titleRef]);

  // Ctrl/Cmd+S saves now instead of waiting for the debounce.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void flushAll();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flushAll]);

  /** The whole note for Export: pending edits saved first, then each cell with its run's files (the kept matplotlib figure left out). */
  async function readForExport(): Promise<ExportNote> {
    await flushAll();
    const fresh = (await fetchCells(note.id)) ?? cells ?? [];
    const { fetchOutput } = await import("@/lib/run/output-store");
    return {
      title: displayTitle(title),
      body: notes,
      outcome,
      exportedAt: new Date().toISOString(),
      cells: await Promise.all(
        fresh.map(async (c) => {
          const o = c.last_run?.outputs;
          const names = o ? o.items.flatMap((i) => Object.entries(i.files).filter(([k]) => k !== "mpl" && k !== "strip").map(([, n]) => n as string)) : [];
          const files = o ? Object.fromEntries(await Promise.all(names.map(async (n) => [n, await fetchOutput(o, n)] as const))) : {};
          return { filename: c.filename, language: c.language, code: c.content, noteBefore: c.note_before, noteAfter: c.note_after, run: c.last_run, files };
        }),
      ),
    };
  }

  // The voice agent works on the cells through the same controls the user's taps use (CellControls,
  // handed over by each shown cell). A cell it adds is ready once the page shows it.
  const controls = useRef(new Map<string, CellControls>());
  const waiting = useRef(new Map<string, () => void>());
  const onControls = useCallback((id: string, c: CellControls | null) => {
    if (!c) return void controls.current.delete(id);
    controls.current.set(id, c);
    waiting.current.get(id)?.();
    waiting.current.delete(id);
  }, []);
  const shown = (id: string) =>
    controls.current.has(id)
      ? Promise.resolve()
      : new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => (waiting.current.delete(id), reject(new Error("the new cell didn't appear"))), 15_000);
          waiting.current.set(id, () => (clearTimeout(t), resolve()));
        });
  const cellControl = (id: string) => {
    const c = controls.current.get(id);
    if (!c) throw new Error("that cell isn't on the page");
    return c;
  };
  const agentNote: AgentNote = {
    read: async () => {
      await flushAll();
      return { title: displayTitle(title), body: notes, cells: (await fetchCells(note.id)) ?? cells ?? [], outcome };
    },
    add: async (language, code) => {
      const [id] = await createCells(note.id, endPosition((await fetchCells(note.id)) ?? cells ?? []), [{ filename: "", language, content: code }]);
      if (!id) throw new Error("the cell wasn't added");
      await shown(id);
      setAgentAt({ id, doing: "writing" });
      return id;
    },
    setCode: (id, code) => (setAgentAt({ id, doing: "writing" }), cellControl(id).setCode(code)),
    run: async (id, where) => {
      setAgentAt({ id, doing: "running" });
      await cellControl(id).run(where);
    },
    setBody: async (text) => {
      notesNow.current = text;
      setNotes(text);
    },
    others: {
      find: (query, from) => findOtherNotes(query, from ?? { id: note.id, parent_id: note.parent_id, body: notesNow.current }),
      open: openOtherNote,
    },
    see: async (id, signal) => {
      const cell = ((await fetchCells(note.id)) ?? []).find((s) => s.id === id);
      const run = cell?.last_run;
      const items = toSee(run?.outputs);
      if (!cell || !run?.outputs || !items.length) return;
      const { requestSee } = await import("@/lib/run/server-client");
      const reply = await requestSee({ dir: run.outputs.dir, items, title: displayTitle(title).slice(0, 300), code: cell.content.slice(0, 3000), printed: run.stdout.slice(-1500) }, signal).catch(() => null);
      if (!reply?.seen.length || signal.aborted) return;
      // Kept with that run only: a run made meanwhile has pictures the seer didn't look at.
      const now = ((await fetchCells(note.id)) ?? []).find((s) => s.id === id);
      if (!now?.last_run?.outputs || now.last_run.ran_at !== run.ran_at) return;
      await updateCell(now, { last_run: { ...now.last_run, outputs: withSeen(now.last_run.outputs, reply.seen) } }).catch(() => {});
    },
    remove: async (id) => {
      const cell = ((await fetchCells(note.id)) ?? []).find((s) => s.id === id);
      if (!cell) return;
      controls.current.get(id)?.stop();
      await deleteCell(cell);
      if (cell.last_run?.outputs) void import("@/lib/run/output-store").then((m) => m.deleteOutputs(cell.last_run!.outputs!)).catch(() => {});
    },
  };
  const stopCells = () => controls.current.forEach((c) => c.stop());
  /** A change the Assistant proposed to another note, applied on the user's tap (never twice). */
  const applyProposal: ApplyProposal = async (p) => {
    const other = await openOtherNote(p.noteId);
    if (!other) throw new Error("That note is gone.");
    if (other.body.includes(p.text.trim())) return "already";
    await updateNote(p.noteId, { notes: placeNoteText(other.body, { text: p.text, after: p.after }).body });
    return "applied";
  };
  useCellFromAddress(!!cells?.length);

  // Run all: every cell that can run, in order, stopping at the first that fails (as most
  // notebooks do), with Stop for the whole queue; then it says where it stopped.
  const [runAll, setRunAll] = useState<{ at: number; of: number } | null>(null);
  const [runAllFailed, setRunAllFailed] = useState<{ id: string; n: number } | null>(null);
  const cancelRunAll = useRef(false);
  async function runAllCells() {
    const order = (cells ?? []).map((s, i) => ({ s, n: i + 1 })).filter(({ s }) => runsInBrowser(s.language) || runsOnServer(s.language));
    if (!order.length) return;
    cancelRunAll.current = false;
    setRunAllFailed(null);
    for (const [k, { s, n }] of order.entries()) {
      if (cancelRunAll.current) break;
      setRunAll({ at: k + 1, of: order.length });
      const c = controls.current.get(s.id);
      if (!c) continue;
      const ended = await c.run().catch(() => "error" as const);
      if (ended === "error" || ended === "timeout") {
        setRunAllFailed({ id: s.id, n });
        break;
      }
      if (ended === "stopped") break;
    }
    setRunAll(null);
  }
  function stopRunAll() {
    cancelRunAll.current = true;
    stopCells();
  }

  /** The note's text as of now, for the assistant's writes (a request outlives many renders). */
  const notesNow = useRef(notes);
  notesNow.current = notes;
  /** The cell the assistant is working on, and what it's doing there (shown on the cell). */
  const [agentAt, setAgentAt] = useState<{ id: string; doing: "writing" | "running" } | null>(null);

  const [pinned, setPinnedState] = useState(!!note.pinned_at);
  async function togglePin() {
    const next = !pinned;
    setPinnedState(next);
    try {
      await setPinned(note.id, next);
    } catch (e) {
      setPinnedState(!next);
      setUploadError(userMessage(e, "pin"));
    }
  }

  function closeAssistant() {
    setAssistant(false);
    assistantButton.current?.focus();
  }

  // Deleting asks nothing: the note waits 30 days in Recently Deleted and can be restored there.
  async function remove() {
    await flushAll();
    await deleteNote(note.id);
    // A note filed in a project (sub-notes included, they carry their own project_id) returns to that project.
    router.replace(afterDeletePath(projectId));
  }

  return (
    <FormatBarProvider>
    <Column className="pb-24">
      <TopBar
        left={back}
        right={
          <>
            <SaveIndicator />
            <Button ref={assistantButton} variant="soft" size="sm" onClick={() => setAssistant(true)} aria-haspopup="dialog" aria-expanded={assistant} className="h-10 px-3.5">
              <IconChat className="size-4" />
              Assistant
            </Button>
            <TextButton onClick={() => shareSheet.current?.open()} aria-haspopup="dialog" aria-label={shared ? "Shared: change or stop" : "Share"} title={shared ? "Shared with a link" : "Share"}>
              <IconLink className="size-4" />
              <span className="hidden sm:inline">{shared ? "Shared" : "Share"}</span>
              {shared && <span aria-hidden className="size-1.5 rounded-full bg-ok sm:hidden" />}
            </TextButton>
            <TextButton onClick={() => setPreview((p) => !p)} aria-label={preview ? "Edit" : "Preview"} title={preview ? "Edit" : "Preview"}>
              {preview ? <IconPen className="size-4" /> : <IconEye className="size-4" />}
              <span className="hidden sm:inline">{preview ? "Edit" : "Preview"}</span>
            </TextButton>
            <MoreMenu
              items={[
                { label: "Map", href: mapHref(note.id, 1) },
                { label: "New attempt", onSelect: () => void startAttempt(), disabled: attempting },
                { label: pinned ? "Unpin note" : "Pin note", onSelect: () => void togglePin() },
                { label: "Export note", onSelect: () => exportDialog.current?.open() },
                { label: "Delete note", onSelect: () => void remove() },
              ]}
            />
          </>
        }
      />

      {path.length > 0 && (
        <nav aria-label="Parent notes" className="-mb-4 mt-2 flex flex-wrap items-center gap-x-2 text-muted">
          {path.map((n, i) => (
            <Fragment key={n.id}>
              {i > 0 && <span aria-hidden className="text-faint">›</span>}
              <TextLink href={`/n/${n.id}`} className="max-w-[60vw] truncate text-xs">
                {displayTitle(n.title)}
              </TextLink>
            </Fragment>
          ))}
        </nav>
      )}

      <textarea
        ref={titleRef}
        value={title}
        onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            bodyRef.current?.focus();
          }
        }}
        rows={1}
        placeholder="Title"
        aria-label="Title"
        maxLength={200}
        className={cn(NOTE_TITLE_CLASS, "resize-none overflow-hidden outline-none")}
      />

      {/* The note's place and verdict, as one row of chips: its project, its parent note, its outcome. */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className={META_CHIP} title="Project">
          <IconFolder className="size-4" />
          <span className="sr-only">Project</span>
          <select id="project" value={projectId} onChange={(e) => void move(e.target.value)} className="max-w-[40vw] cursor-pointer appearance-none truncate bg-transparent outline-none">
            <option value="">No project</option>
            {projects?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => setPicking((p) => !p)} aria-expanded={picking} className={META_CHIP} title="Parent note">
          <IconBranch className="size-4" />
          <span className="sr-only">Parent:</span>
          <span className="max-w-[40vw] truncate">{parent ? displayTitle(parent.title) : "No parent"}</span>
        </button>
        <div className={NOTE_META_ROW_CLASS}>
          <span className="sr-only">Outcome</span>
          <Segmented label="Outcome" options={OUTCOME_CHOICES} value={outcome} onChange={(v) => void mark(v)} />
        </div>
      </div>
      {(moveError || parentError || outcomeError) && <Notice className="mt-2">{moveError ?? parentError ?? outcomeError}</Notice>}
      {picking && (
        <ParentPicker noteId={note.id} notes={notesIndex} current={parentId} onPick={(id) => void reparent(id)} onClose={() => setPicking(false)} />
      )}

      {preview ? (
        <RenderedBody value={notes} notes={notesIndex} />
      ) : (
        <>
          {/* The one shared format bar for the note's text blocks (sticky here on desktop, above the keyboard on phones). */}
          <FormatBarSlot />
          <LiveTextBlock
            handleRef={bodyRef}
            value={notes}
            onChange={setNotes}
            notes={notesIndex}
            selfId={note.id}
            label={NOTE_LABEL}
            className="mt-4 block min-h-24 w-full"
          />
        </>
      )}

      <section aria-label="Code" className="mt-10">
        {cells && cells.length > 0 && (
          <CellsBar
            cells={cells}
            running={runAll}
            failed={runAllFailed}
            onRunAll={() => void runAllCells()}
            onStop={stopRunAll}
            onDismissFailed={() => setRunAllFailed(null)}
          />
        )}
        {cells?.map((s, i) => (
          <div key={s.id} className={cn("relative")}>
            {agentAt?.id === s.id && (
              <p role="status" className="mb-1 text-xs text-muted">
                Assistant is {agentAt.doing} this cell
              </p>
            )}
            <CodeCell cell={s} index={i} outcome={outcome} notes={notesIndex} selfId={note.id} preview={preview} onControls={onControls} />
          </div>
        ))}
        <div className="mt-4 flex gap-6">
          <TextButton onClick={() => void createEmptyCell(note.id, endPosition(cells ?? []))}>Add code</TextButton>
          <FilePicker label="Upload file" onError={setUploadError} onFiles={async (files) => void (await createCells(note.id, endPosition(cells ?? []), files))} />
        </div>
        {uploadError && (
          <Notice className="mt-2" onDismiss={() => setUploadError(null)}>
            {uploadError}
          </Notice>
        )}
      </section>

      <NoteList title="Sub-notes" notes={subNotes} empty={null}>
        <TextButton onClick={() => void newSubNote()}>New sub-note</TextButton>
      </NoteList>
      <NoteList title="Linked from" notes={linkedFrom} empty="No notes link here." />
      {origin && <NoteList title="Derived from" notes={[origin]} empty={null} />}
      <NoteList title="Attempts" notes={attempts} empty={null}>
        <TextButton onClick={() => void startAttempt()} disabled={attempting}>
          New attempt
        </TextButton>
        {attemptError && (
          <Notice className="mb-3" actions={[{ label: "Try again", onClick: () => void startAttempt() }]}>
            {attemptError}
          </Notice>
        )}
      </NoteList>
      <ExportNoteDialog ref={exportDialog} read={readForExport} />
      <ShareSheet ref={shareSheet} noteId={note.id} title={displayTitle(title)} />
      <ProposalProvider value={applyProposal}>
      <AssistantPanel noteId={note.id} open={assistant} onClose={closeAssistant} latest={latestRun(cells ?? [])} agentNote={agentNote} stopCells={stopCells} onOpen={() => setAssistant(true)} onGoToCell={goToCell} onWorking={(on) => void (on || setAgentAt(null))} ready={cells !== undefined} />
      </ProposalProvider>
    </Column>
    </FormatBarProvider>
  );
}

/** One code cell with its "Note before run" above and "Note after run" below its output. */
/** A note opened from a search result at a cell (#cell-<id>): goes to it once the cells are shown. */
function useCellFromAddress(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    const m = /^#cell-(.+)$/.exec(window.location.hash);
    if (m) requestAnimationFrame(() => goToCell(m[1]!));
  }, [ready]);
}

/** Jumps to a cell and puts the keyboard there. */
function goToCell(id: string) {
  const el = document.getElementById(`cell-${id}`);
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
  el?.querySelector<HTMLElement>(".cm-content")?.focus({ preventScroll: true });
}

/**
 * Above the cells: each cell's state at a glance, as a numbered chip that jumps to it (how its
 * last run ended, or that the code changed since), Run all with its progress and Stop, and where
 * Run all stopped. From how notebooks show run state (a status rail per cell, a jump to the first
 * failure, Run all that halts at an error).
 */
function CellsBar({
  cells,
  running,
  failed,
  onRunAll,
  onStop,
  onDismissFailed,
}: {
  cells: readonly Cell[];
  running: { at: number; of: number } | null;
  failed: { id: string; n: number } | null;
  onRunAll: () => void;
  onStop: () => void;
  onDismissFailed: () => void;
}) {
  const states = cells.map(cellState);
  const firstBad = firstFailed(states);
  const runnable = cells.some((s) => runsInBrowser(s.language) || runsOnServer(s.language));
  return (
    <div className="mb-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          {firstBad !== null && !running && (
            <TextButton className="text-sm" onClick={() => goToCell(cells[firstBad - 1]!.id)}>
              Cell {firstBad} failed. Go to it
            </TextButton>
          )}
        </div>
        {runnable &&
          (running ? (
            <div className="flex items-center gap-3">
              <Working label={`Running cell ${running.at} of ${running.of}`} />
              <Button size="sm" variant="neutral" onClick={onStop}>
                <IconStop className="size-4" />
                Stop
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="soft" onClick={onRunAll} title="Runs every cell in order and stops at the first that fails">
              <IconPlay className="size-4" />
              Run all
            </Button>
          ))}
      </div>
      {failed && !running && (
        <Notice compact className="mt-3" onDismiss={onDismissFailed} actions={[{ label: `Go to cell ${failed.n}`, onClick: () => goToCell(failed.id) }]}>
          Cell {failed.n} failed, so the cells after it didn’t run.
        </Notice>
      )}
    </div>
  );
}

function CodeCell({ cell, index, outcome, notes, selfId, preview, onControls }: { cell: Cell; index: number; outcome: Outcome | null; notes: readonly NoteIndexItem[]; selfId: string; preview: boolean; onControls: (id: string, c: CellControls | null) => void }) {
  const cellNotes = useCellNotes(cell);
  const shared = { filename: cell.filename, index, notes, selfId, preview };
  return (
    <CellBlock
      cell={cell}
      index={index}
      outcome={outcome}
      before={<CellNote side="before" value={cellNotes.before} onChange={cellNotes.setBefore} {...shared} />}
      after={<CellNote side="after" value={cellNotes.after} onChange={cellNotes.setAfter} {...shared} />}
      onBeforeRemove={cellNotes.flush}
      onControls={onControls}
    />
  );
}

/** A titled list of notes (sub-notes, backlinks), each row a 48px link. */
function NoteList({ title, notes, empty, children }: { title: string; notes: readonly NoteIndexItem[]; empty: string | null; children?: React.ReactNode }) {
  return (
    <section aria-label={title} className="mt-10">
      <h2 className="text-xs text-muted">{title}</h2>
      <ul className="divide-y divide-line">
        {notes.map((n) => (
          <li key={n.id}>
            <Link href={`/n/${n.id}`} className={n.title.trim() ? "flex min-h-12 items-center truncate" : "flex min-h-12 items-center truncate text-muted"}>
              <span className="truncate">{displayTitle(n.title)}</span>
            </Link>
          </li>
        ))}
      </ul>
      {notes.length === 0 && empty && <p className="py-3 text-sm text-faint">{empty}</p>}
      {children && <div className="border-t border-line">{children}</div>}
    </section>
  );
}
