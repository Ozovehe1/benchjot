"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import CodeMirror, { EditorView, type Extension } from "@uiw/react-codemirror";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { languageSettings, loadGrammar } from "@/lib/cm-languages";
import { errorLineField, lintFor, setErrorLine } from "@/lib/cm-run";
import { CodeKeys } from "./code-keys";

// Theme from the app's CSS variables, so it follows light/dark.
const baseTheme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "var(--fg)" },
  ".cm-content": { caretColor: "var(--fg)", padding: "12px 0" },
  ".cm-cursor": { borderLeftColor: "var(--fg)" },
  ".cm-line": { padding: "0" },
  ".cm-gutters": { display: "none" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--fg) 14%, transparent) !important",
  },
  ".cm-placeholder": { color: "var(--faint)" },
  ".cm-matchingBracket": { backgroundColor: "var(--tint)", outline: "none" },
  ".cm-tooltip": { backgroundColor: "var(--bg)", border: "1px solid var(--line)", borderRadius: "2px" },
  ".cm-tooltip-autocomplete > ul": { fontFamily: "var(--font-mono)", fontSize: "13px" },
  ".cm-tooltip-autocomplete > ul > li": { padding: "2px 10px" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--tint)", color: "var(--fg)" },
  ".cm-completionIcon": { display: "none" },
});

const highlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: "var(--hl-keyword)" },
    { tag: [t.string, t.special(t.string), t.regexp], color: "var(--hl-string)" },
    { tag: [t.number, t.bool, t.null, t.atom], color: "var(--hl-number)" },
    { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--hl-comment)", fontStyle: "italic" },
    { tag: [t.className, t.typeName], color: "var(--hl-type)" },
    { tag: [t.operator, t.punctuation, t.bracket], color: "var(--muted)" },
    { tag: t.heading, fontWeight: "600" },
  ]),
);

// Code is not prose: no capitalisation, autocorrect, suggestions or spellcheck on mobile keyboards.
const codeInput = (label: string) =>
  EditorView.contentAttributes.of({
    "aria-label": label,
    autocapitalize: "off",
    autocorrect: "off",
    autocomplete: "off",
    spellcheck: "false",
    inputmode: "text",
  });

function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const update = () => setCoarse(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return coarse;
}

export function CodeEditor({
  value,
  onChange,
  language,
  label,
  errorLine = null,
  onFixable,
}: {
  value: string;
  onChange: (v: string) => void;
  language: string;
  label: string;
  /** 1-based line to highlight after a failed run; cleared by the next edit. */
  errorLine?: number | null;
  /** Count of issues the linter can fix automatically. */
  onFixable?: (n: number) => void;
}) {
  const [grammar, setGrammar] = useState<Extension>([]);
  const [view, setView] = useState<EditorView | null>(null);
  const [focused, setFocused] = useState(false);
  // Lint starts once the block is touched, so just reading a note never downloads a linter.
  const [touched, setTouched] = useState(false);
  const coarse = useCoarsePointer();
  const fixableRef = useRef(onFixable);
  fixableRef.current = onFixable;

  useEffect(() => {
    view?.dispatch({ effects: setErrorLine.of(errorLine) });
  }, [view, errorLine]);

  useEffect(() => {
    let live = true;
    setGrammar([]);
    void loadGrammar(language).then((ext) => live && setGrammar(ext));
    return () => {
      live = false;
    };
  }, [language]);

  const extensions = useMemo(
    () => [
      baseTheme,
      highlight,
      grammar,
      languageSettings(language),
      codeInput(label),
      EditorView.lineWrapping, // no sideways swiping on phones
      errorLineField,
      touched ? lintFor(language, (n) => fixableRef.current?.(n)) : [],
      EditorView.focusChangeEffect.of((_state, focusing) => {
        setFocused(focusing);
        if (focusing) setTouched(true);
        return null;
      }),
    ],
    [grammar, language, label, touched],
  );

  return (
    <>
      <CodeMirror
        value={value}
        onChange={onChange}
        onCreateEditor={setView}
        theme="none"
        extensions={extensions}
        minHeight="72px"
        placeholder="Code"
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          autocompletion: true,
          closeBrackets: true,
          bracketMatching: true,
          indentOnInput: true,
          searchKeymap: true,
        }}
        indentWithTab
      />
      {coarse && focused && view && <CodeKeys view={view} language={language} />}
    </>
  );
}
