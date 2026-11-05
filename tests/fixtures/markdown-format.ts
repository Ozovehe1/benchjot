// Format bar cases shared with the Android app (its scripts/web-fixtures.mjs writes markdown_format.json
// with the web's own answers). "|" marks the selection: one "|" a cursor, two the ends of a selection.
import type { MarkdownFormat } from "@/lib/markdown-format";

export const MARKDOWN_FORMAT_CASES: [string, MarkdownFormat, string][] = [
  ["a |b| c", "bold", "a **|b|** c"],
  ["a **|b|** c", "bold", "a |b| c"],
  ["a |**b**| c", "bold", "a |b| c"],
  ["ab|", "bold", "ab**|**"],
  ["ab**|**", "bold", "ab|"],
  ["|word|", "italic", "_|word|_"],
  ["_|word|_", "italic", "|word|"],
  ["x |y| z", "code", "x `|y|` z"],
  ["x `|y|` z", "code", "x |y| z"],
  ["e = |mc^2|", "math", "e = $|mc^2|$"],
  ["e = $|mc^2|$", "math", "e = |mc^2|"],
  ["Ti|tle", "heading", "# Ti|tle"],
  ["# Ti|tle", "heading", "Ti|tle"],
  ["one\n|two", "heading", "one\n# |two"],
  ["|", "heading", "# |"],
  ["|a\nb|", "list", "- |a\n- b|"],
  ["- |a\n- b|", "list", "|a\nb|"],
  ["|a\n\nb|", "list", "- |a\n\n- b|"],
  ["- a\n|b|", "list", "- a\n- |b|"],
  ["see |docs|", "link", "see [docs](|url|)"],
  ["see |[docs](url)|", "link", "see |docs|"],
  ["see [|docs|](url) now", "link", "see |docs| now"],
  ["go |", "link", "go [|](url)"],
  ["|\nnext", "list", "- |\nnext"],
  ["**|", "bold", "****|**"],
];

/** "a |b| c" -> text "a b c", selection [2, 3]. */
export function parseCase(s: string): { text: string; start: number; end: number } {
  const first = s.indexOf("|");
  const second = s.indexOf("|", first + 1);
  if (second === -1) return { text: s.replace("|", ""), start: first, end: first };
  return { text: s.slice(0, first) + s.slice(first + 1, second) + s.slice(second + 1), start: first, end: second - 1 };
}
