"use client";
// CodeMirror modes per language id (lazy-loaded so only used grammars ship).
import type { Extension } from "@codemirror/state";
import type { LanguageId } from "./languages";

const legacy = async (load: () => Promise<Parameters<typeof import("@codemirror/language").StreamLanguage.define>[0]>) => {
  const [{ StreamLanguage }, mode] = await Promise.all([import("@codemirror/language"), load()]);
  return StreamLanguage.define(mode);
};

const LOADERS: Record<LanguageId, () => Promise<Extension>> = {
  python: async () => (await import("@codemirror/lang-python")).python(),
  javascript: async () => (await import("@codemirror/lang-javascript")).javascript({ jsx: true }),
  typescript: async () => (await import("@codemirror/lang-javascript")).javascript({ typescript: true, jsx: true }),
  c: async () => (await import("@codemirror/lang-cpp")).cpp(),
  cpp: async () => (await import("@codemirror/lang-cpp")).cpp(),
  matlab: () => legacy(async () => (await import("@codemirror/legacy-modes/mode/octave")).octave),
  r: () => legacy(async () => (await import("@codemirror/legacy-modes/mode/r")).r),
  julia: () => legacy(async () => (await import("@codemirror/legacy-modes/mode/julia")).julia),
  bash: () => legacy(async () => (await import("@codemirror/legacy-modes/mode/shell")).shell),
  sql: async () => (await import("@codemirror/lang-sql")).sql(),
  json: async () => (await import("@codemirror/lang-json")).json(),
  yaml: async () => (await import("@codemirror/lang-yaml")).yaml(),
  markdown: async () => (await import("@codemirror/lang-markdown")).markdown(),
  text: async () => [],
};

export function loadLanguage(id: string): Promise<Extension> {
  return (LOADERS[id as LanguageId] ?? LOADERS.text)();
}
