// Single source of truth for every code language the app understands:
// label, file extensions, indent style, line-comment token, completion
// keywords and the language-first keys of the mobile symbol row.
// Editor modes (grammars) live in cm-languages.ts, keyed by the same ids.

export interface LanguageConfig {
  id: string;
  label: string;
  /** File extensions, first one is used for downloads. */
  ext: readonly string[];
  /** One indent level: spaces or a tab. */
  indent: string;
  /** Line-comment token, null when the language has none (JSON, plain text). */
  comment: string | null;
  /** Keywords and common builtins offered by autocomplete. */
  keywords: readonly string[];
  /** Keys shown first on the mobile symbol row. */
  keys: readonly string[];
}

const SP2 = "  ";
const SP4 = "    ";

export const LANGUAGES = [
  {
    id: "python", label: "Python", ext: ["py", "pyw", "pyx", "ipynb"], indent: SP4, comment: "#",
    keywords: ["and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif", "else", "except", "False", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "None", "nonlocal", "not", "or", "pass", "raise", "return", "True", "try", "while", "with", "yield", "print", "range", "len", "enumerate", "zip", "self", "__init__", "isinstance", "super", "dict", "list", "tuple", "set", "float", "int", "str"],
    keys: [":", "#", "_", "self", "=", "\"", "'"],
  },
  {
    id: "javascript", label: "JavaScript", ext: ["js", "mjs", "cjs", "jsx"], indent: SP2, comment: "//",
    keywords: ["async", "await", "break", "case", "catch", "class", "const", "continue", "default", "delete", "else", "export", "extends", "false", "finally", "for", "function", "if", "import", "in", "instanceof", "let", "new", "null", "of", "return", "static", "super", "switch", "this", "throw", "true", "try", "typeof", "undefined", "var", "while", "yield", "console", "Promise", "Array", "Object", "JSON", "Math"],
    keys: ["=>", "{", "}", ";", "`", "(", ")", "."],
  },
  {
    id: "typescript", label: "TypeScript", ext: ["ts", "tsx", "mts", "cts"], indent: SP2, comment: "//",
    keywords: ["abstract", "any", "as", "async", "await", "boolean", "break", "case", "catch", "class", "const", "continue", "declare", "default", "else", "enum", "export", "extends", "false", "finally", "for", "function", "if", "implements", "import", "in", "interface", "keyof", "let", "never", "new", "null", "number", "private", "protected", "public", "readonly", "return", "string", "super", "switch", "this", "throw", "true", "try", "type", "typeof", "undefined", "unknown", "void", "while", "Promise", "Record"],
    keys: ["=>", "{", "}", ";", ":", "`", "<", ">"],
  },
  {
    id: "go", label: "Go", ext: ["go"], indent: "\t", comment: "//",
    keywords: ["break", "case", "chan", "const", "continue", "default", "defer", "else", "fallthrough", "for", "func", "go", "goto", "if", "import", "interface", "map", "package", "range", "return", "select", "struct", "switch", "type", "var", "nil", "true", "false", "err", "error", "string", "int", "float64", "bool", "byte", "make", "append", "len", "fmt"],
    keys: [":=", "{", "}", "(", ")", "*", "&", "."],
  },
  {
    id: "c", label: "C", ext: ["c", "h"], indent: SP4, comment: "//",
    keywords: ["auto", "break", "case", "char", "const", "continue", "default", "do", "double", "else", "enum", "extern", "float", "for", "goto", "if", "int", "long", "register", "return", "short", "signed", "sizeof", "static", "struct", "switch", "typedef", "union", "unsigned", "void", "volatile", "while", "NULL", "printf", "malloc", "free", "include"],
    keys: [";", "{", "}", "*", "&", "#", "->", "(", ")"],
  },
  {
    id: "cpp", label: "C++ / CUDA", ext: ["cpp", "cc", "cxx", "hpp", "hh", "cu", "cuh"], indent: SP4, comment: "//",
    keywords: ["auto", "bool", "break", "case", "catch", "char", "class", "const", "constexpr", "continue", "default", "delete", "do", "double", "else", "enum", "explicit", "false", "float", "for", "if", "include", "int", "long", "namespace", "new", "nullptr", "private", "protected", "public", "return", "sizeof", "static", "std", "struct", "switch", "template", "this", "throw", "true", "try", "typename", "using", "vector", "virtual", "void", "while", "__global__", "__device__"],
    keys: [";", "{", "}", "::", "<", ">", "*", "&", "#"],
  },
  {
    id: "rust", label: "Rust", ext: ["rs"], indent: SP4, comment: "//",
    keywords: ["as", "async", "await", "break", "const", "continue", "crate", "else", "enum", "false", "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod", "move", "mut", "pub", "ref", "return", "self", "Self", "static", "struct", "super", "trait", "true", "type", "unsafe", "use", "where", "while", "Vec", "String", "Option", "Result", "Some", "None", "Ok", "Err", "println"],
    keys: [";", "{", "}", "::", "&", "->", "!", "<", ">"],
  },
  {
    id: "java", label: "Java", ext: ["java"], indent: SP4, comment: "//",
    keywords: ["abstract", "boolean", "break", "case", "catch", "char", "class", "continue", "default", "do", "double", "else", "enum", "extends", "final", "finally", "float", "for", "if", "implements", "import", "instanceof", "int", "interface", "long", "new", "null", "package", "private", "protected", "public", "return", "static", "String", "super", "switch", "this", "throw", "throws", "true", "false", "try", "var", "void", "while", "System", "List", "Map"],
    keys: [";", "{", "}", "(", ")", ".", "<", ">", "\""],
  },
  {
    id: "matlab", label: "MATLAB", ext: ["m"], indent: SP4, comment: "%",
    keywords: ["break", "case", "catch", "continue", "else", "elseif", "end", "for", "function", "global", "if", "otherwise", "persistent", "return", "switch", "try", "while", "zeros", "ones", "size", "length", "plot", "disp", "fprintf"],
    keys: ["%", ";", "(", ")", "[", "]", ".*", "'"],
  },
  {
    id: "r", label: "R", ext: ["r", "R"], indent: SP2, comment: "#",
    keywords: ["break", "else", "FALSE", "for", "function", "if", "in", "next", "NULL", "NA", "repeat", "return", "TRUE", "while", "library", "data.frame", "c", "list", "print", "paste", "mean", "sum"],
    keys: ["<-", "%>%", "#", "$", "(", ")", "~", ","],
  },
  {
    id: "julia", label: "Julia", ext: ["jl"], indent: SP4, comment: "#",
    keywords: ["begin", "break", "catch", "const", "continue", "do", "else", "elseif", "end", "export", "false", "finally", "for", "function", "global", "if", "import", "let", "local", "macro", "module", "quote", "return", "struct", "true", "try", "using", "while", "println"],
    keys: ["end", "#", "::", ".", "(", ")", "[", "]"],
  },
  {
    id: "bash", label: "Shell", ext: ["sh", "bash", "zsh"], indent: SP2, comment: "#",
    keywords: ["case", "do", "done", "elif", "else", "esac", "export", "fi", "for", "function", "if", "in", "local", "return", "then", "until", "while", "echo", "cd", "grep", "sed", "awk", "python", "pip", "sudo"],
    keys: ["$", "|", "-", "#", ">", "&&", "\"", "~"],
  },
  {
    id: "sql", label: "SQL", ext: ["sql"], indent: SP2, comment: "--",
    keywords: ["select", "from", "where", "and", "or", "not", "insert", "into", "values", "update", "set", "delete", "create", "table", "alter", "drop", "join", "left", "inner", "on", "group", "by", "order", "having", "limit", "as", "distinct", "count", "null", "is", "in", "with"],
    keys: [";", "*", "'", ",", "(", ")", "=", "--"],
  },
  {
    id: "json", label: "JSON", ext: ["json"], indent: SP2, comment: null,
    keywords: ["true", "false", "null"],
    keys: ["\"", ":", ",", "{", "}", "[", "]"],
  },
  {
    id: "yaml", label: "YAML", ext: ["yaml", "yml"], indent: SP2, comment: "#",
    keywords: ["true", "false", "null"],
    keys: [":", "-", "#", "\"", "|", ">"],
  },
  {
    id: "markdown", label: "Markdown", ext: ["md", "markdown"], indent: SP2, comment: null,
    keywords: [],
    keys: ["#", "*", "-", "`", "[", "]", "(", ")"],
  },
  {
    id: "text", label: "Plain text", ext: ["txt", "log", "csv", "tsv"], indent: SP4, comment: null,
    keywords: [],
    keys: [],
  },
] as const satisfies readonly LanguageConfig[];

export type LanguageId = (typeof LANGUAGES)[number]["id"];

export const LANGUAGE_IDS = LANGUAGES.map((l) => l.id) as [LanguageId, ...LanguageId[]];

/** New code blocks start as Python; an empty one still switches to a language detected from what is typed or pasted. */
export const DEFAULT_LANGUAGE: LanguageId = "python";

/**
 * Whether a block's language is settled on open: it has code, or the user picked a
 * language other than the default (or plain text, the old default). Unsettled blocks
 * follow detection and keep their own language when nothing is detected.
 */
export function languageChosen(language: string, content: string): boolean {
  return content.trim() !== "" || (language !== DEFAULT_LANGUAGE && language !== "text");
}

export function languageConfig(id: string): LanguageConfig {
  return LANGUAGES.find((l) => l.id === id) ?? LANGUAGES[LANGUAGES.length - 1]!;
}

export function isLanguageId(id: string): id is LanguageId {
  return LANGUAGES.some((l) => l.id === id);
}

/** Language from a filename's extension (case-sensitive match first, so .R is R and .m is MATLAB); null when unknown. */
export function languageFromFilename(filename: string): LanguageId | null {
  const m = /\.([A-Za-z0-9+]+)$/.exec(filename.trim());
  if (!m?.[1]) return null;
  const ext = m[1];
  const has = (l: LanguageConfig, e: string) => l.ext.includes(e);
  return (LANGUAGES.find((l) => has(l, ext)) ?? LANGUAGES.find((l) => has(l, ext.toLowerCase())))?.id ?? null;
}

/** File name for downloading a block: its own name, or code-N.<ext of its language>. */
export function downloadName(filename: string, language: string, index: number): string {
  return filename.trim() || `code-${index + 1}.${languageConfig(language).ext[0]}`;
}

/** Keys shown on top of most keyboards' missing symbols, after the language's own. */
export const COMMON_KEYS = ["{", "}", "(", ")", "[", "]", "<", ">", "=", ";", ":", "\"", "'", "/", "\\", "_", "|"] as const;

/** The mobile symbol row: Tab, the language's keys, then the common ones (no repeats). Undo is added by the row itself. */
export function symbolKeys(id: string): string[] {
  return ["Tab", ...new Set([...languageConfig(id).keys, ...COMMON_KEYS])];
}
