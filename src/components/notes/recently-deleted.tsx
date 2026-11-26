"use client";
// Recently Deleted (as Apple Notes has it): deleted notes wait here 30 days, then go for good.
// Each can be restored or deleted now; Delete all empties it. Only deleting for good asks first.
import { useState } from "react";
import { deleteNotesForever, restoreNote, useRecentlyDeleted } from "@/lib/data";
import { RECENTLY_DELETED_DAYS, daysLeftText, displayTitle } from "@/lib/ui/format";
import { errorFacts, userMessage, userText } from "@/lib/ui/user-message";
import { Column, Notice, TextButton, TextLink, TopBar } from "../ui";

export function RecentlyDeleted() {
  const { data: notes, error: loadError, mutate } = useRecentlyDeleted();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(key: string, f: () => Promise<void>, action: "restore" | "delete_note") {
    setBusy(key);
    setError(null);
    try {
      await f();
      await mutate();
    } catch (e) {
      setError(userMessage(e, action));
    } finally {
      setBusy(null);
    }
  }

  function deleteAll() {
    if (!notes?.length) return;
    if (!window.confirm(`Delete ${notes.length === 1 ? "this note" : `all ${notes.length} notes`} and their code for good? This can’t be undone.`)) return;
    void act("all", () => deleteNotesForever(notes.map((n) => n.id)), "delete_note");
  }

  return (
    <Column>
      <TopBar left={<TextLink href="/">All notes</TextLink>} />
      <header className="mt-2 flex flex-wrap items-end justify-between gap-4 lg:mt-8">
        <div>
          <h1 className="text-[34px] font-normal leading-none tracking-[-0.02em] lg:text-[40px]">Recently deleted</h1>
          <p className="mt-2.5 text-sm text-muted">Notes stay here for {RECENTLY_DELETED_DAYS} days, then they’re deleted for good.</p>
        </div>
        {!!notes?.length && (
          <TextButton onClick={deleteAll} disabled={busy !== null} className="!text-fail">
            Delete all
          </TextButton>
        )}
      </header>

      {(error || loadError) && (
        <Notice className="my-4" onDismiss={error ? () => setError(null) : undefined}>
          {error ?? userText(errorFacts(loadError), "load_notes")}
        </Notice>
      )}
      {notes?.length === 0 && <p className="py-10 text-sm text-muted">Nothing here.</p>}

      <ul className="mt-8 divide-y divide-line border-y border-line">
        {notes?.map((n) => (
          <li key={n.id} className="flex flex-wrap items-center gap-x-6 gap-y-1 py-3">
            <span className="min-w-0 flex-1">
              <span className={n.title.trim() ? "block truncate font-display text-[18px] text-fg" : "block truncate font-display text-[18px] italic text-muted"}>{displayTitle(n.title)}</span>
              <span className="mt-0.5 block text-xs text-faint">{daysLeftText(n.deleted_at!)}</span>
            </span>
            <span className="flex items-center gap-4">
              <TextButton strong onClick={() => void act(n.id, () => restoreNote(n.id), "restore")} disabled={busy !== null}>
                Restore
              </TextButton>
              <TextButton
                onClick={() => window.confirm("Delete this note and its code for good? This can’t be undone.") && void act(n.id, () => deleteNotesForever([n.id]), "delete_note")}
                disabled={busy !== null}
                className="!text-fail"
              >
                Delete now
              </TextButton>
            </span>
          </li>
        ))}
      </ul>
    </Column>
  );
}
