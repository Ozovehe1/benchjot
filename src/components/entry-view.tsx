"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAutosave, useSaveStatus } from "@/lib/autosave";
import { createSnippet, deleteEntry, updateEntry, useEntry, useSnippets } from "@/lib/data";
import type { Entry } from "@/lib/schemas";
import { useAutosize } from "@/lib/use-autosize";
import { Markdown } from "./markdown";
import { SaveIndicator } from "./save-indicator";
import { SnippetBlock } from "./snippet-block";
import { Column, TextButton, TextLink, TopBar } from "./ui";

export function EntryView({ id }: { id: string }) {
  const { data: entry, error, isLoading } = useEntry(id);
  const back = <TextLink href="/">All notes</TextLink>;

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
        className="mt-6 block w-full resize-none overflow-hidden text-[22px] font-semibold leading-snug outline-none"
      />

      {preview ? (
        <div className="mt-4 min-h-40">{notes.trim() ? <Markdown>{notes}</Markdown> : <p className="text-faint">Nothing written.</p>}</div>
      ) : (
        <textarea
          ref={notesRef}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Write in Markdown"
          aria-label="Note"
          className="mt-4 block min-h-40 w-full resize-none overflow-hidden leading-7 outline-none"
        />
      )}

      <section aria-label="Code" className="mt-10">
        {snippets?.map((s, i) => <SnippetBlock key={s.id} snippet={s} index={i} />)}
        <div className="border-t border-line">
          <TextButton onClick={() => void createSnippet(entry.id, snippets?.length ?? 0)}>Add code</TextButton>
        </div>
      </section>

      <div className="mt-16">
        <TextButton onClick={remove}>Delete note</TextButton>
      </div>
    </Column>
  );
}
