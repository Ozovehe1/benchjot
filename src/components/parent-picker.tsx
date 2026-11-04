"use client";
// Pick a note's parent: search the user's notes, or choose None. Only notes
// that keep the tree a tree are offered (the database refuses cycles anyway).
import { useState } from "react";
import { displayTitle } from "@/lib/format";
import { searchTerms } from "@/lib/search";
import type { NoteIndexItem } from "@/lib/schemas";
import { parentCandidates } from "@/lib/tree";
import { TextButton } from "./ui";

const LIMIT = 8;

export function ParentPicker({
  noteId,
  notes,
  current,
  onPick,
  onClose,
}: {
  noteId: string;
  notes: readonly NoteIndexItem[];
  current: string | null;
  onPick: (parentId: string | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const terms = searchTerms(query);
  const matches = parentCandidates(noteId, notes)
    .filter((n) => n.id !== current && terms.every((t) => n.title.toLowerCase().includes(t)))
    .slice(0, LIMIT);

  return (
    <div className="mb-2 border-y border-line">
      <input
        type="search"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        placeholder="Search notes"
        aria-label="Search notes for a parent"
        className="h-12 w-full border-b border-line outline-none focus:border-faint"
      />
      <ul aria-label="Parent notes" className="divide-y divide-line">
        {current && (
          <li>
            <TextButton onClick={() => onPick(null)} className="w-full">None</TextButton>
          </li>
        )}
        {matches.map((n) => (
          <li key={n.id}>
            <TextButton onClick={() => onPick(n.id)} strong className="w-full truncate text-left">
              <span className="truncate">{displayTitle(n.title)}</span>
            </TextButton>
          </li>
        ))}
        {matches.length === 0 && <li className="py-3 text-sm text-muted">No notes match.</li>}
      </ul>
      <TextButton onClick={onClose}>Cancel</TextButton>
    </div>
  );
}
