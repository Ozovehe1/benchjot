"use client";
// Slim symbol row pinned above the on-screen keyboard while a code block is
// focused on a touch device. Keys insert at the cursor without taking focus.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { EditorView } from "@codemirror/view";
import { insertBracket } from "@codemirror/autocomplete";
import { indentMore, undo } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { symbolKeys } from "@/lib/languages";

function press(view: EditorView, key: string) {
  if (key === "Tab") {
    if (!view.state.selection.main.empty) indentMore(view);
    else view.dispatch(view.state.replaceSelection(view.state.facet(indentUnit)), { scrollIntoView: true, userEvent: "input" });
  } else {
    // Brackets and quotes follow the editor's auto-close rules, like typing them would.
    const tr = key.length === 1 ? insertBracket(view.state, key) : null;
    view.dispatch(tr ?? view.state.update(view.state.replaceSelection(key), { scrollIntoView: true, userEvent: "input" }));
  }
  view.focus();
}

/** Distance from the layout viewport's bottom to the visual viewport's bottom (the keyboard height). */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setInset(Math.max(0, window.innerHeight - (vv.offsetTop + vv.height)));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
}

export function CodeKeys({ view, language }: { view: EditorView; language: string }) {
  const bottom = useKeyboardInset();
  const keys = [...symbolKeys(language), "undo"];
  return createPortal(
    <div
      role="toolbar"
      aria-label="Code keys"
      style={{ bottom }}
      // Keep focus (and the keyboard) in the editor when a key is tapped.
      onMouseDown={(e) => e.preventDefault()}
      className="fixed inset-x-0 z-50 flex overflow-x-auto border-t border-line bg-bg font-mono text-[15px] [scrollbar-width:none]"
    >
      {keys.map((k) => (
        <button
          key={k}
          type="button"
          aria-label={k === "Tab" ? "Tab" : k === "undo" ? "Undo" : `Insert ${k}`}
          onClick={() => (k === "undo" ? (undo(view), view.focus()) : press(view, k))}
          className="h-10 min-w-10 shrink-0 px-2.5 text-fg active:bg-tint"
        >
          {k === "Tab" ? "tab" : k}
        </button>
      ))}
    </div>,
    document.body,
  );
}
