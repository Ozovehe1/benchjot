"use client";
import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAutosave, useSaveStatus } from "@/lib/autosave";
import {
  createEmptySnippet,
  createEntry,
  createSnippets,
  deleteEntry,
  updateEntry,
  useEntry,
  useNoteIndex,
  useNoteLinks,
  useProjects,
  useSnippets,
} from "@/lib/data";
import { cn, displayTitle } from "@/lib/format";
import { backlinksTo } from "@/lib/links";
import { OUTCOME_CHOICES, type Outcome } from "@/lib/outcome";
import { afterDeletePath } from "@/lib/paths";
import type { Entry, NoteIndexItem } from "@/lib/schemas";
import { ancestors, childrenOf } from "@/lib/tree";
import { useAutosize } from "@/lib/use-autosize";
import { FilePicker } from "./file-picker";
import { NoteBody } from "./note-body";
import { NOTE_META_ROW_CLASS, NOTE_TITLE_CLASS, RenderedBody } from "./note-parts";
import { ParentPicker } from "./parent-picker";
import { SaveIndicator } from "./save-indicator";
import { SnippetBlock } from "./snippet-block";
import { Column, Segmented, TextButton, TextLink, TopBar } from "./ui";
import { userMessage } from "@/lib/user-message";

const NO_NOTES: NoteIndexItem[] = [];

/** Placeholder and accessible name of the note body. */
const NOTE_LABEL = "Experiment note";

export function EntryView({ id }: { id: string }) {
  const { data: entry, error, isLoading } = useEntry(id);
  const { data: projects } = useProjects();
  const project = projects?.find((p) => p.id === entry?.project_id);
  const back = project ? <TextLink href={`/p/${project.id}`}>{project.name}</TextLink> : <TextLink href="/">All notes</TextLink>;

  if (isLoading) return <Column><TopBar left={back} /></Column>;
  if (error || !entry) {
    return (
      <Column>
        <TopBar left={back} />
        <p className="py-10 text-sm text-muted">This note doesn’t exist.</p>
      </Column>
    );
  }
  return <Editor entry={entry} back={back} />;
}

function Editor({ entry, back }: { entry: Entry; back: React.ReactNode }) {
  const router = useRouter();
  const { flushAll } = useSaveStatus();
  const [title, setTitle] = useState(entry.title);
  const [notes, setNotes] = useState(entry.notes);
  const [preview, setPreview] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState(entry.project_id ?? "");
  const [moveError, setMoveError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(entry.outcome ?? null);
  const [outcomeError, setOutcomeError] = useState<string | null>(null);

  async function mark(next: Outcome | null) {
    const previous = outcome;
    setOutcome(next);
    setOutcomeError(null);
    try {
      await updateEntry(entry.id, { outcome: next });
    } catch (e) {
      setOutcome(previous);
      setOutcomeError(userMessage(e, "outcome"));
    }
  }
  const { data: projects } = useProjects();
  const notesIndex = useNoteIndex().data ?? NO_NOTES;
  const { data: links } = useNoteLinks();
  const [parentId, setParentId] = useState<string | null>(entry.parent_id ?? null);
  const [picking, setPicking] = useState(false);
  const [parentError, setParentError] = useState<string | null>(null);
  // The tree as it is now, with this note's parent as just chosen.
  const tree = notesIndex.map((n) => (n.id === entry.id ? { ...n, parent_id: parentId } : n));
  const path = ancestors(entry.id, tree);
  const parent = path.at(-1);
  const subNotes = childrenOf(entry.id, tree);
  const linkedFrom = links ? backlinksTo(entry.id, links, notesIndex) : [];

  async function reparent(next: string | null) {
    const previous = parentId;
    setPicking(false);
    setParentId(next);
    setParentError(null);
    try {
      await updateEntry(entry.id, { parent_id: next });
    } catch (e) {
      setParentId(previous);
      setParentError(userMessage(e, "parent"));
    }
  }

  async function newSubNote() {
    await flushAll();
    const child = await createEntry("", projectId || null, entry.id);
    router.push(`/n/${child.id}`);
  }

  async function move(next: string) {
    const previous = projectId;
    setProjectId(next);
    setMoveError(null);
    try {
      await updateEntry(entry.id, { project_id: next || null });
    } catch (e) {
      setProjectId(previous);
      setMoveError(userMessage(e, "move"));
    }
  }
  const titleRef = useAutosize(title);
  const notesRef = useAutosize(notes);
  const { data: snippets } = useSnippets(entry.id);

  useAutosave({ title, notes }, (v) => updateEntry(entry.id, v), { baseline: { title: entry.title, notes: entry.notes } });

  // A brand-new note starts with the cursor in the title.
  useEffect(() => {
    if (!entry.title && !entry.notes) titleRef.current?.focus();
  }, [entry.title, entry.notes, titleRef]);

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

  async function remove() {
    if (!window.confirm("Delete this note and its code?")) return;
    await flushAll();
    await deleteEntry(entry.id);
    // A note filed in a project (sub-notes included, they carry their own project_id) returns to that project.
    router.replace(afterDeletePath(projectId));
  }

  return (
    <Column className="pb-24">
      <TopBar
        left={back}
        right={
          <>
            <SaveIndicator />
            <TextButton onClick={() => setPreview((p) => !p)}>{preview ? "Edit" : "Preview"}</TextButton>
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
            notesRef.current?.focus();
          }
        }}
        rows={1}
        placeholder="Title"
        aria-label="Title"
        maxLength={200}
        className={cn(NOTE_TITLE_CLASS, "resize-none overflow-hidden outline-none")}
      />

      <div className="mt-1 flex items-center gap-2 text-xs text-muted">
        <label htmlFor="project">Project</label>
        <select
          id="project"
          value={projectId}
          onChange={(e) => void move(e.target.value)}
          className="min-h-12 max-w-[60vw] cursor-pointer appearance-none truncate bg-transparent outline-none hover:text-fg"
        >
          <option value="">None</option>
          {projects?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {moveError && <span role="alert" className="text-fg">{moveError}</span>}
      </div>

      <div className="flex items-center gap-2 text-xs text-muted">
        <span>Parent</span>
        <TextButton onClick={() => setPicking((p) => !p)} aria-expanded={picking} className="max-w-[60vw] truncate text-xs">
          <span className="truncate">{parent ? displayTitle(parent.title) : "None"}</span>
        </TextButton>
        {parentError && <span role="alert" className="text-fg">{parentError}</span>}
      </div>
      {picking && (
        <ParentPicker noteId={entry.id} notes={notesIndex} current={parentId} onPick={(id) => void reparent(id)} onClose={() => setPicking(false)} />
      )}

      <div className={NOTE_META_ROW_CLASS}>
        <span>Outcome</span>
        <Segmented label="Outcome" options={OUTCOME_CHOICES} value={outcome} onChange={(v) => void mark(v)} />
        {outcomeError && <span role="alert" className="text-fg">{outcomeError}</span>}
      </div>

      {preview ? (
        <RenderedBody value={notes} notes={notesIndex} />
      ) : (
        <NoteBody
          textareaRef={notesRef}
          value={notes}
          onChange={setNotes}
          notes={notesIndex}
          selfId={entry.id}
          label={NOTE_LABEL}
          className="mt-4 block min-h-24 w-full resize-none overflow-hidden leading-7 outline-none"
        />
      )}

      <section aria-label="Code" className="mt-10">
        {snippets?.map((s, i) => <SnippetBlock key={s.id} snippet={s} index={i} outcome={outcome} />)}
        <div className="flex gap-6 border-t border-line">
          <TextButton onClick={() => void createEmptySnippet(entry.id, snippets?.length ?? 0)}>Add code</TextButton>
          <FilePicker label="Upload file" onError={setUploadError} onFiles={(files) => createSnippets(entry.id, snippets?.length ?? 0, files)} />
        </div>
        {uploadError && (
          <p role="alert" className="text-sm">
            {uploadError}
          </p>
        )}
      </section>

      <NoteList title="Sub-notes" notes={subNotes} empty={null}>
        <TextButton onClick={() => void newSubNote()}>New sub-note</TextButton>
      </NoteList>
      <NoteList title="Linked from" notes={linkedFrom} empty="No notes link here." />

      <div className="mt-12">
        <TextButton onClick={remove}>Delete note</TextButton>
      </div>
    </Column>
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
