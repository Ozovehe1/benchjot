"use client";
// Everything a language changes inside CodeMirror, built from languages.ts:
// grammar (lazy-loaded so only used ones ship), indent unit, line-comment
// token for toggleComment, and keyword completion.
import { completeFromList } from "@codemirror/autocomplete";
import { indentUnit, StreamLanguage, type StreamParser } from "@codemirror/language";
import { EditorState, Prec, type Extension } from "@codemirror/state";
import { languageConfig, type LanguageId } from "./languages";

const legacy = async (load: () => Promise<StreamParser<unknown>>) => StreamLanguage.define(await load());

const GRAMMARS: Record<LanguageId, () => Promise<Extension>> = {
  python: async () => (await import("@codemirror/lang-python")).python(),
  javascript: async () => (await import("@codemirror/lang-javascript")).javascript({ jsx: true }),
  typescript: async () => (await import("@codemirror/lang-javascript")).javascript({ typescript: true, jsx: true }),
  go: () => legacy(async () => (await import("@codemirror/legacy-modes/mode/go")).go as StreamParser<unknown>),
  c: async () => (await import("@codemirror/lang-cpp")).cpp(),
  cpp: async () => (await import("@codemirror/lang-cpp")).cpp(),
  matlab: () => legacy(async () => (await import("@codemirror/legacy-modes/mode/octave")).octave as StreamParser<unknown>),
  r: () => legacy(async () => (await import("@codemirror/legacy-modes/mode/r")).r as StreamParser<unknown>),
  julia: () => legacy(async () => (await import("@codemirror/legacy-modes/mode/julia")).julia as StreamParser<unknown>),
  bash: () => legacy(async () => (await import("@codemirror/legacy-modes/mode/shell")).shell as StreamParser<unknown>),
  sql: async () => (await import("@codemirror/lang-sql")).sql(),
  json: async () => (await import("@codemirror/lang-json")).json(),
  yaml: async () => (await import("@codemirror/lang-yaml")).yaml(),
  markdown: async () => (await import("@codemirror/lang-markdown")).markdown(),
  text: async () => [],
};

// These grammars already complete their own keywords; adding ours would list each twice.
const GRAMMAR_COMPLETES = new Set<string>(["python", "javascript", "typescript", "sql"]);

/** Indent, comment token and completion for a language (synchronous; the grammar loads separately). */
export function languageSettings(id: string): Extension {
  const cfg = languageConfig(id);
  const data: Record<string, unknown> = {};
  if (cfg.comment) data.commentTokens = { line: cfg.comment };
  if (cfg.keywords.length && !GRAMMAR_COMPLETES.has(cfg.id)) data.autocomplete = completeFromList(cfg.keywords.map((label) => ({ label, type: "keyword" })));
  // Highest precedence so these win over defaults and the grammar's own data.
  return Prec.highest([
    indentUnit.of(cfg.indent),
    EditorState.tabSize.of(cfg.indent === "\t" ? 4 : cfg.indent.length),
    EditorState.languageData.of(() => [data]),
  ]);
}

export function loadGrammar(id: string): Promise<Extension> {
  return (GRAMMARS[id as LanguageId] ?? GRAMMARS.text)();
}
