"use client";
// The shared frame of a code block's code (the editor and read-only code alike): code over
// FOLD_LINES lines shows folded to that height with a fade and a toggle. Focusing the editor
// unfolds it, so the cursor is never hidden.
import { useState } from "react";
import { folds, foldLabel, FOLD_LINES } from "@/lib/code-fold";
import { TextButton } from "./ui";

/** 12 lines of 13.5px × 1.65 code plus the 12px top padding (the editor's and StaticCode's). */
const FOLDED_HEIGHT = `calc(${FOLD_LINES} * 13.5px * 1.65 + 12px)`;

export function FoldedCode({ code, children }: { code: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const fold = folds(code);
  const closed = fold && !open;
  return (
    <div onFocusCapture={() => fold && setOpen(true)}>
      <div className="relative overflow-hidden" style={closed ? { maxHeight: FOLDED_HEIGHT } : undefined}>
        {children}
        {closed && <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-bg" />}
      </div>
      {fold && (
        <TextButton onClick={() => setOpen(!open)} aria-expanded={open} className="text-xs">
          {foldLabel(code, open)}
        </TextButton>
      )}
    </div>
  );
}
