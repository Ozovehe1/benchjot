// Single source of truth for the code languages the app understands.
// Editor modes live in cm-languages.ts and are keyed by the same ids.

export const LANGUAGES = [
  { id: "python", label: "Python" },
  { id: "javascript", label: "JavaScript" },
  { id: "typescript", label: "TypeScript" },
  { id: "c", label: "C" },
  { id: "cpp", label: "C++ / CUDA" },
  { id: "matlab", label: "MATLAB" },
  { id: "r", label: "R" },
  { id: "julia", label: "Julia" },
  { id: "bash", label: "Shell" },
  { id: "sql", label: "SQL" },
  { id: "json", label: "JSON" },
  { id: "yaml", label: "YAML" },
  { id: "markdown", label: "Markdown" },
  { id: "text", label: "Plain text" },
] as const;

export type LanguageId = (typeof LANGUAGES)[number]["id"];

export const LANGUAGE_IDS = LANGUAGES.map((l) => l.id) as [LanguageId, ...LanguageId[]];

export const DEFAULT_LANGUAGE: LanguageId = "python";
