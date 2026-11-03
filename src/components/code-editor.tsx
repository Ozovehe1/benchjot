"use client";
import { useEffect, useMemo, useState } from "react";
import CodeMirror, { EditorView, type Extension } from "@uiw/react-codemirror";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { loadLanguage } from "@/lib/cm-languages";

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

export function CodeEditor({
  value,
  onChange,
  language,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  language: string;
  label: string;
}) {
  const [lang, setLang] = useState<Extension>([]);
  useEffect(() => {
    let live = true;
    void loadLanguage(language).then((ext) => live && setLang(ext));
    return () => {
      live = false;
    };
  }, [language]);

  const extensions = useMemo(() => [baseTheme, highlight, lang, EditorView.contentAttributes.of({ "aria-label": label })], [lang, label]);

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      theme="none"
      extensions={extensions}
      minHeight="72px"
      placeholder="Code"
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
        autocompletion: false,
        searchKeymap: true,
        tabSize: 4,
      }}
      indentWithTab
    />
  );
}
