"use client";
// One live Markdown text block (the note body; built to sit several times in a note between code
// cells later). It takes value/onChange for its own Markdown text, owns its CodeMirror history, and
// while focused reports itself to the note's single shared format bar (format-bar.tsx).
// [[ opens note-title suggestions in that same slot; picking one inserts [[Title|id]] (src/lib/links.ts).
import { useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { Prec } from "@codemirror/state";
import { EditorView, keymap, type ViewUpdate } from "@codemirror/view";
import { completeLink, linkQueryAt, linkSuggestions, type NoteRef } from "@/lib/links";
import { blockState, editSpec, liveExtensions } from "@/lib/live-editor";
import { useReportBlock } from "./format-bar";

export interface TextBlockHandle {
  focus: () => void;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  notes: readonly NoteRef[];
  selfId: string;
  label: string;
  handleRef?: React.Ref<TextBlockHandle>;
  className?: string;
}

interface Typing {
  start: number;
  caret: number;
  query: string;
}

export function LiveTextBlock({ value, onChange, notes, selfId, label, handleRef, className }: Props) {
  const id = useId();
  const report = useReportBlock();
  const [view, setView] = useState<EditorView | null>(null);
  const [focused, setFocused] = useState(false);
  const [typing, setTyping] = useState<Typing | null>(null);
  const [active, setActive] = useState(0);
  // Escape hides the list for the `[[` at this position until the caret leaves it.
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [, setTick] = useState(0);

  useImperativeHandle(handleRef, () => ({
    focus: () => {
      if (!view) return;
      view.focus();
      view.dispatch({ selection: { anchor: view.state.doc.length }, scrollIntoView: true });
    },
  }), [view]);

  const suggestions = useMemo(
    () => (typing && typing.start !== dismissed ? linkSuggestions(typing.query, notes, selfId) : []),
    [typing, dismissed, notes, selfId],
  );

  const pick = useCallback(
    (note: NoteRef) => {
      if (!view || !typing) return;
      const text = view.state.doc.toString();
      const next = completeLink(text, typing.start, typing.caret, note);
      view.dispatch({ ...editSpec(text, { text: next.text, start: next.caret, end: next.caret }), userEvent: "input.complete", scrollIntoView: true });
      setTyping(null);
      view.focus();
    },
    [view, typing],
  );

  // Keyboard for the suggestion list; a ref keeps the keymap stable.
  const keys = useRef({ suggestions, active, pick, typing });
  keys.current = { suggestions, active, pick, typing };
  const suggestKeys = useMemo(
    () =>
      Prec.highest(
        keymap.of([
          { key: "ArrowDown", run: () => step(1) },
          { key: "ArrowUp", run: () => step(-1) },
          { key: "Enter", run: () => choose() },
          { key: "Tab", run: () => choose() },
          {
            key: "Escape",
            run: () => {
              const t = keys.current.typing;
              if (!keys.current.suggestions.length || !t) return false;
              setDismissed(t.start);
              return true;
            },
          },
        ]),
      ),
    [],
  );
  function step(by: number): boolean {
    const n = keys.current.suggestions.length;
    if (!n) return false;
    setActive((i) => (i + by + n) % n);
    return true;
  }
  function choose(): boolean {
    const { suggestions: s, active: a, pick: p } = keys.current;
    if (!s.length) return false;
    p(s[Math.min(a, s.length - 1)]!);
    return true;
  }

  const onUpdate = useCallback((u: ViewUpdate) => {
    if (!u.docChanged && !u.selectionSet && !u.focusChanged) return;
    const sel = u.state.selection.main;
    const q = sel.empty ? linkQueryAt(u.state.doc.toString(), sel.head) : null;
    setTyping(q ? { start: q.start, caret: sel.head, query: q.query } : null);
    if (u.docChanged || u.selectionSet) setActive(0);
    if (u.focusChanged) setFocused(u.view.hasFocus);
    setTick((t) => t + 1);
  }, []);

  const extensions = useMemo(() => liveExtensions(label, [suggestKeys, EditorView.updateListener.of(onUpdate)]), [label, suggestKeys, onUpdate]);

  // Report to the shared bar while focused (state recomputed on each update via tick).
  useEffect(() => {
    if (!view) return;
    if (!focused) {
      report(id, null);
      return;
    }
    report(id, {
      id,
      view,
      state: blockState(view.state),
      suggest: suggestions.length ? { notes: suggestions, active: Math.min(active, suggestions.length - 1), pick } : null,
    });
  });
  useEffect(() => () => report(id, null), [id, report]);

  return (
    <div className={className}>
      <CodeMirror
        value={value}
        onChange={onChange}
        onCreateEditor={setView}
        theme="none"
        basicSetup={false}
        extensions={extensions}
        placeholder={label}
        aria-controls="link-suggestions"
      />
    </div>
  );
}
