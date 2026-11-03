"use client";
// CodeMirror pieces for running code: the highlighted error line, and lint
// (Ruff for Python, the transpiler's syntax check for JS/TS) as subtle underlines.
import { linter, type Diagnostic } from "@codemirror/lint";
import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { offsetOf } from "./run/ruff-fix";
import { transpile } from "./run/transpile";

// ------------------------------------------------------------------ error line
export const setErrorLine = StateEffect.define<number | null>();

const errorLineDeco = Decoration.line({ class: "cm-errorLine" });

export const errorLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (!e.is(setErrorLine)) continue;
      const n = e.value;
      if (n === null || n < 1 || n > tr.state.doc.lines) return Decoration.none;
      return Decoration.set([errorLineDeco.range(tr.state.doc.line(n).from)]);
    }
    return tr.docChanged ? Decoration.none : deco; // any edit clears it
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ------------------------------------------------------------------ lint
const clampRange = (view: EditorView, from: number, to: number) => {
  const len = view.state.doc.length;
  const a = Math.max(0, Math.min(from, len));
  return { from: a, to: Math.max(a, Math.min(to, len)) };
};

function pythonLint(onFixable: (n: number) => void): Extension {
  return linter(
    async (view) => {
      const { ruffCheck } = await import("./run/ruff");
      const text = view.state.doc.toString();
      const found = await ruffCheck(text);
      onFixable(found.filter((d) => d.fix?.edits.length).length);
      return found.map((d): Diagnostic => {
        const { from, to } = clampRange(view, offsetOf(text, d.start_location), offsetOf(text, d.end_location));
        const syntax = !d.code || d.code === "E999";
        return { from, to, severity: syntax ? "error" : "warning", message: d.code ? `${d.code} ${d.message}` : d.message, source: "ruff" };
      });
    },
    { delay: 700 },
  );
}

function scriptLint(language: "javascript" | "typescript"): Extension {
  return linter(
    (view) => {
      const text = view.state.doc.toString();
      const r = transpile(text, language);
      if (r.ok) return [];
      const at = offsetOf(text, { row: r.issue.line, column: r.issue.column });
      const { from, to } = clampRange(view, at, at + 1);
      return [{ from, to, severity: "error", message: r.issue.message }];
    },
    { delay: 500 },
  );
}

/** Lint for a language (none for languages without a checker). `onFixable` gets the count of auto-fixable issues. */
export function lintFor(language: string, onFixable: (n: number) => void): Extension {
  if (language === "python") return pythonLint(onFixable);
  if (language === "javascript" || language === "typescript") return scriptLint(language);
  return [];
}
