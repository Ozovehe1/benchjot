// Single source of truth for the code languages Trialbook understands.
// Editor modes live in cm-languages.ts and are keyed by the same ids.

export const LANGUAGES = [
  { id: "python", label: "Python", ext: ["py", "ipynb", "pyx"] },
  { id: "javascript", label: "JavaScript", ext: ["js", "mjs", "cjs", "jsx"] },
  { id: "typescript", label: "TypeScript", ext: ["ts", "tsx", "mts"] },
  { id: "c", label: "C", ext: ["c", "h"] },
  { id: "cpp", label: "C++ / CUDA", ext: ["cpp", "cc", "cxx", "hpp", "cu", "cuh"] },
  { id: "matlab", label: "MATLAB / Octave", ext: ["m"] },
  { id: "r", label: "R", ext: ["r", "R"] },
  { id: "julia", label: "Julia", ext: ["jl"] },
  { id: "bash", label: "Bash", ext: ["sh", "bash", "zsh"] },
  { id: "sql", label: "SQL", ext: ["sql"] },
  { id: "json", label: "JSON", ext: ["json"] },
  { id: "yaml", label: "YAML", ext: ["yaml", "yml"] },
  { id: "markdown", label: "Markdown", ext: ["md"] },
  { id: "text", label: "Plain text", ext: ["txt", "log", "csv"] },
] as const;

export type LanguageId = (typeof LANGUAGES)[number]["id"];

export const LANGUAGE_IDS = LANGUAGES.map((l) => l.id) as [LanguageId, ...LanguageId[]];

export const DEFAULT_LANGUAGE: LanguageId = "python";

export function languageLabel(id: string): string {
  return LANGUAGES.find((l) => l.id === id)?.label ?? id;
}

/** Markdown code-fence tag for a language id. */
export function fenceTag(id: string): string {
  return id === "text" ? "" : id === "matlab" ? "matlab" : id;
}

/** Guess a language from a filename's extension; null when unknown. */
export function guessLanguage(filename: string): LanguageId | null {
  const m = /\.([A-Za-z0-9]+)$/.exec(filename.trim());
  if (!m?.[1]) return null;
  const ext = m[1];
  const hit =
    LANGUAGES.find((l) => (l.ext as readonly string[]).includes(ext)) ??
    LANGUAGES.find((l) => (l.ext as readonly string[]).includes(ext.toLowerCase()));
  return hit?.id ?? null;
}

/** Default filename extension for a language. */
export function defaultExtension(id: LanguageId): string {
  return LANGUAGES.find((l) => l.id === id)?.ext[0] ?? "txt";
}
