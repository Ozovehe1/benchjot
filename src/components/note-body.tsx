"use client";
// The note body textarea. Typing [[ opens a list of note titles pinned above
// the keyboard; picking one inserts [[Title|id]] (see src/lib/links.ts).
import { useState } from "react";
import { createPortal } from "react-dom";
import { completeLink, linkQueryAt, linkSuggestions, type NoteRef } from "@/lib/links";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";
import { cn } from "@/lib/format";

interface Props {
  value: string;
  onChange: (value: string) => void;
  notes: readonly NoteRef[];
  selfId: string;
  label: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  className?: string;
}

export function NoteBody({ value, onChange, notes, selfId, label, textareaRef, className }: Props) {
  const [caret, setCaret] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  // Escape hides the list for the `[[` at this position until the caret leaves it.
  const [dismissed, setDismissed] = useState<number | null>(null);

  const typing = caret === null ? null : linkQueryAt(value, caret);
  const open = typing !== null && typing.start !== dismissed;
  const suggestions = open ? linkSuggestions(typing.query, notes, selfId) : [];

  const track = (el: HTMLTextAreaElement) => {
    setCaret(el.selectionStart === el.selectionEnd ? el.selectionStart : null);
    setActive(0);
  };

  function pick(note: NoteRef) {
    if (!typing || caret === null) return;
    const next = completeLink(value, typing.start, caret, note);
    onChange(next.text);
    setCaret(null);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!suggestions.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pick(suggestions[Math.min(active, suggestions.length - 1)]!);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDismissed(typing!.start);
    }
  }

  return (
    <>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          track(e.target);
        }}
        onSelect={(e) => track(e.currentTarget)}
        onKeyDown={onKeyDown}
        onBlur={() => setCaret(null)}
        placeholder={label}
        aria-label={label}
        aria-autocomplete="list"
        aria-controls="link-suggestions"
        className={className}
      />
      {suggestions.length > 0 && <Suggestions notes={suggestions} active={active} onPick={pick} />}
    </>
  );
}

function Suggestions({ notes, active, onPick }: { notes: NoteRef[]; active: number; onPick: (n: NoteRef) => void }) {
  const bottom = useKeyboardInset();
  return createPortal(
    <ul
      id="link-suggestions"
      role="listbox"
      aria-label="Link to note"
      style={{ bottom }}
      // Keep focus (and the keyboard) in the textarea when a title is tapped.
      onMouseDown={(e) => e.preventDefault()}
      className="fixed inset-x-0 z-50 mx-auto max-w-[720px] divide-y divide-line border-t border-line bg-bg sm:border-x"
    >
      {notes.map((n, i) => (
        <li key={n.id} role="option" aria-selected={i === active}>
          <button
            type="button"
            onClick={() => onPick(n)}
            className={cn("flex h-12 w-full items-center truncate px-5 text-left text-sm sm:px-8", i === active ? "bg-tint text-fg" : "text-muted")}
          >
            <span className="truncate">{n.title}</span>
          </button>
        </li>
      ))}
    </ul>,
    document.body,
  );
}
