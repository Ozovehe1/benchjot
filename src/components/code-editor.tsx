"use client";
import { useEffect, useMemo, useState } from "react";
import CodeMirror, { EditorView, type Extension } from "@uiw/react-codemirror";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { loadLanguage } from "@/lib/cm-languages";

// Theme built from the app's CSS variables, so it follows dark/light mode.
const baseTheme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "var(--fg)" },
  ".cm-content": { caretColor: "var(--accent)", padding: "12px 0" },
  ".cm-cursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  ".cm-gutters": { backgroundColor: "transparent", color: "var(--faint)", border: "none", paddingLeft: "4px" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--surface-3) 45%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--muted)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--accent) 22%, transparent) !important",
  },
  ".cm-line": { padding: "0 14px 0 6px" },
  ".cm-placeholder": { color: "var(--faint)" },
  ".cm-foldPlaceholder": { backgroundColor: "var(--surface-3)", border: "none", color: "var(--muted)" },
  ".cm-matchingBracket": { backgroundColor: "color-mix(in srgb, var(--accent) 18%, transparent)", outline: "none" },
});

const highlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: "var(--hl-keyword)" },
    { tag: [t.string, t.special(t.string), t.regexp], color: "var(--hl-string)" },
    { tag: [t.number, t.bool, t.null, t.atom], color: "var(--hl-number)" },
    { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--hl-comment)", fontStyle: "italic" },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--hl-function)" },
    { tag: [t.definition(t.variableName), t.className, t.typeName], color: "var(--hl-type)" },
    { tag: [t.propertyName, t.attributeName], color: "var(--hl-property)" },
    { tag: [t.operator, t.punctuation, t.bracket], color: "var(--hl-punct)" },
    { tag: [t.meta, t.annotation, t.processingInstruction], color: "var(--hl-meta)" },
    { tag: t.heading, fontWeight: "600", color: "var(--hl-function)" },
  ]),
);

export function CodeEditor({
  value,
  onChange,
  language,
  readOnly,
  wrap,
  minHeight = "160px",
  maxHeight,
  label,
}: {
  value: string;
  onChange?: (v: string) => void;
  language: string;
  readOnly?: boolean;
  wrap?: boolean;
  minHeight?: string;
  maxHeight?: string;
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

  const extensions = useMemo(
    () => [baseTheme, highlight, lang, ...(wrap ? [EditorView.lineWrapping] : []), EditorView.contentAttributes.of({ "aria-label": label })],
    [lang, wrap, label],
  );

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      readOnly={readOnly}
      editable={!readOnly}
      theme="none"
      extensions={extensions}
      minHeight={minHeight}
      maxHeight={maxHeight}
      placeholder={readOnly ? undefined : "Paste or type code…"}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: !readOnly,
        highlightActiveLineGutter: !readOnly,
        autocompletion: false,
        searchKeymap: true,
        tabSize: 4,
      }}
      indentWithTab
    />
  );
}
