// Best-effort guess of a code block's language from its text. Used only while
// a block is still "Plain text" and the user hasn't picked a language.
import { PICKER_LANGUAGE_IDS, type LanguageId } from "./languages";

type Rule = { id: LanguageId; test: (code: string) => boolean };

const has = (re: RegExp) => (code: string) => re.test(code);

function isJson(code: string): boolean {
  const t = code.trim();
  if (!/^[[{]/.test(t)) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

// Order matters: more specific signals first.
const RULES: Rule[] = [
  { id: "json", test: isJson },
  { id: "bash", test: has(/^#!.*\b(ba|z)?sh\b/) },
  { id: "python", test: has(/^#!.*python/) },
  { id: "cpp", test: (c) => /#include\s*[<"]/.test(c) && /\bstd::|\bcout\b|\btemplate\s*<|\bclass\s+\w+|__global__|\bnamespace\b/.test(c) },
  { id: "fortran", test: has(/\bimplicit\s+none\b|^\s*end\s+(program|subroutine|module)\b|^\s*program\s+\w+\s*$/im) },
  { id: "c", test: has(/#include\s*[<"]|\bint\s+main\s*\(|\bprintf\s*\(/) },
  { id: "cpp", test: has(/\bstd::|__global__|\btemplate\s*</) },
  { id: "python", test: has(/^\s*(def|class)\s+\w+.*:\s*$|^\s*(from\s+[\w.]+\s+)?import\s+[\w.]+(\s+as\s+\w+)?\s*$|^\s*(if|elif|for|while|with|try)\b.*:\s*$|\bself\.\w+|\bprint\(/m) },
  { id: "sql", test: has(/^\s*(select\s+.+\s+from|insert\s+into|update\s+\w+\s+set|delete\s+from|create\s+(table|index|view)|with\s+\w+\s+as\s*\()/im) },
  { id: "r", test: has(/\w+\s*<-\s*|\blibrary\(\w+\)|%>%/) },
  { id: "julia", test: (c) => /^\s*(function|using|module)\s+\w+/m.test(c) && /^\s*end\s*$/m.test(c) },
  { id: "matlab", test: (c) => /^\s*%/m.test(c) || (/^\s*function\s+.*=\s*\w+\(/m.test(c) && /^\s*end\s*$/m.test(c)) },
  { id: "bash", test: has(/^\s*(echo|export|cd|sudo|apt(-get)?|pip3?|conda|npm|git|chmod|mkdir)\s+\S/m) },
  { id: "yaml", test: (c) => (c.match(/^\s*-?\s*[\w.-]+:(\s+\S.*)?$/gm)?.length ?? 0) >= 2 && !/[{};]/.test(c) },
  { id: "markdown", test: has(/^#{1,6}\s+\S|^\s*[-*]\s+\[[ x]\]|^```/m) },
];

/** The likely language of `code`, or null when there isn't enough signal. */
export function detectLanguage(code: string): LanguageId | null {
  if (code.trim().length < 8) return null;
  return RULES.find((r) => r.test(code))?.id ?? null;
}

const PICKER: readonly string[] = PICKER_LANGUAGE_IDS;

/**
 * A cell's language from what is typed or pasted: detectLanguage, but only the picker's languages
 * (a language the picker doesn't offer doesn't change the cell). detectLanguage
 * itself still knows every language: the Assistant uses it to refuse answers in the wrong one.
 */
export function detectCellLanguage(code: string): LanguageId | null {
  const id = detectLanguage(code);
  return id && PICKER.includes(id) ? id : null;
}
