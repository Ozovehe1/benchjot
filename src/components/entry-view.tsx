"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAutosave, useSaveStatus } from "@/lib/autosave";
import { createEmptySnippet, createSnippets, deleteEntry, updateEntry, useEntry, useProjects, useSnippets } from "@/lib/data";
import type { Entry } from "@/lib/schemas";
import { useAutosize } from "@/lib/use-autosize";
import { FilePicker } from "./file-picker";
import { Markdown } from "./markdown";
import { SaveIndicator } from "./save-indicator";
import { SnippetBlock } from "./snippet-block";
import { Column, TextButton, TextLink, TopBar } from "./ui";

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
  const { data: projects } = useProjects();

  async function move(next: string) {
    const previous = projectId;
    setProjectId(next);
    setMoveError(null);
    try {
      await updateEntry(entry.id, { project_id: next || null });
    } catch (e) {
      setProjectId(previous);
      setMoveError(e instanceof Error ? e.message : "Could not move the note.");
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
    router.replace("/");
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
        className="mt-6 block w-full resize-none overflow-hidden text-xl font-semibold leading-snug outline-none"
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

      {preview ? (
        <div className="mt-4 min-h-24">{notes.trim() ? <Markdown>{notes}</Markdown> : <p className="text-faint">Nothing written.</p>}</div>
      ) : (
        <textarea
          ref={notesRef}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={NOTE_LABEL}
          aria-label={NOTE_LABEL}
          className="mt-4 block min-h-24 w-full resize-none overflow-hidden leading-7 outline-none"
        />
      )}

      <section aria-label="Code" className="mt-10">
        {snippets?.map((s, i) => <SnippetBlock key={s.id} snippet={s} index={i} />)}
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

      <div className="mt-12">
        <TextButton onClick={remove}>Delete note</TextButton>
      </div>
    </Column>
  );
}
