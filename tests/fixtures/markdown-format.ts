// Format bar cases shared with the Android app. The expected answers here are hand-written; the test
// checks applyFormat against them and that tests/fixtures/markdown_format.json (what Android copies)
// is exactly these cases expanded (scripts/write-fixtures.mjs regenerates it).
// "|" marks the selection: one "|" a cursor, two the ends of a selection.
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
  // Heading cycles none -> H1 -> H2 -> H3 -> none (was a plain # toggle before 2026-11-06).
  ["# Ti|tle", "heading", "## Ti|tle"],
  ["## Ti|tle", "heading", "### Ti|tle"],
  ["### Ti|tle", "heading", "Ti|tle"],
  ["#### Ti|tle", "heading", "Ti|tle"],
  ["|# a\nb|", "heading", "## |a\n## b|"],
  ["#|# Title", "heading", "### |Title"],
  ["one\n|two", "heading", "one\n# |two"],
  ["|", "heading", "# |"],
  ["|a\nb|", "list", "- |a\n- b|"],
  // List cycles none -> bullet -> numbered -> checklist -> none (was a plain - toggle before 2026-11-06).
  ["- |a\n- b|", "list", "1. |a\n2. b|"],
  ["1. |a\n2. b|", "list", "- [ ] |a\n- [ ] b|"],
  ["- [ ] |a\n- [x] b|", "list", "|a\nb|"],
  ["  - |a", "list", "  1. |a"],
  ["|a\n- b|", "list", "- |a\n- b|"],
  // Checklist toggles; done items stay done while switching between lists.
  ["|a", "checklist", "- [ ] |a"],
  ["- |a", "checklist", "- [ ] |a"],
  ["- [ ] |a\n- [x] b|", "checklist", "|a\nb|"],
  ["- [x] |a\nb|", "checklist", "- [x] |a\n- [ ] b|"],
  ["3. |a", "checklist", "- [ ] |a"],
  ["|a\n\nb|", "list", "- |a\n\n- b|"],
  ["- a\n|b|", "list", "- a\n- |b|"],
  ["see |docs|", "link", "see [docs](|url|)"],
  ["see |[docs](url)|", "link", "see |docs|"],
  ["see [|docs|](url) now", "link", "see |docs| now"],
  ["go |", "link", "go [|](url)"],
  ["|\nnext", "list", "- |\nnext"],
  ["**|", "bold", "****|**"],
  // Inside a token of the same format (the button is lit there): pressing it takes that token's markers off.
  ["a **bo|ld** c", "bold", "a bo|ld c"],
  ["**a |b| c**", "bold", "a |b| c"],
  ["x *it|al* y", "italic", "x it|al y"],
  ["~~ga|ne~~", "strike", "ga|ne"],
  ["`co|de`", "code", "co|de"],
  ["$x^|2$", "math", "x^|2"],
  ["**a** b|", "bold", "**a** b**|**"],
  // Strike
  ["a |b| c", "strike", "a ~~|b|~~ c"],
  ["a ~~|b|~~ c", "strike", "a |b| c"],
  ["|", "strike", "~~|~~"],
  // Quote
  ["|a\nb|", "quote", "> |a\n> b|"],
  ["> |a\n> b|", "quote", "|a\nb|"],
  [">|a", "quote", "|a"],
  ["> a\n|b|", "quote", "> a\n> |b|"],
  // Indent / outdent: list lines only, 2 spaces, clamped at 0
  ["- |a", "indent", "  - |a"],
  ["  - |a", "indent", "    - |a"],
  ["|a\n- b|", "indent", "|a\n  - b|"],
  ["  - |a", "outdent", "- |a"],
  ["- |a", "outdent", "- |a"],
  [" 1. |a", "outdent", "1. |a"],
  ["|plain", "indent", "|plain"],
  ["|    - [ ] a\n  - b|", "outdent", "|  - [ ] a\n- b|"],
  // Divider: own line, blank line before (so the line above never becomes a heading), cursor after
  ["|", "divider", "---\n|"],
  ["text|", "divider", "text\n\n---\n|"],
  ["te|xt\nmore", "divider", "text\n\n---\n|\nmore"],
  ["a\n\n|\nb", "divider", "a\n\n---\n|\nb"],
  ["a\n|", "divider", "a\n\n---\n|"],
];

type Sel = { text: string; start: number; end: number };
const T = "| Column 1 | Column 2 |\n| --- | --- |\n|  |  |";
/** Cases whose text has "|" in it (tables), so they spell out the selection. */
export const MARKDOWN_FORMAT_EXPLICIT: { input: Sel; format: MarkdownFormat; output: Sel }[] = [
  // Table: 2x2 skeleton on its own lines, blank line before, "Column 1" selected.
  { input: { text: "", start: 0, end: 0 }, format: "table", output: { text: T + "\n", start: 2, end: 10 } },
  { input: { text: "notes", start: 5, end: 5 }, format: "table", output: { text: "notes\n\n" + T + "\n", start: 9, end: 17 } },
  // Line commands leave a table row alone except where asked.
  { input: { text: "| a | b |", start: 2, end: 2 }, format: "bold", output: { text: "| ****a | b |", start: 4, end: 4 } },
];

// Typing `[] ` at a line start becomes `- [ ] ` (null: unchanged). Not inside ``` fences.
export const CHECK_SHORTCUT_CASES: [string, string | null][] = [
  ["[] |", "- [ ] |"],
  ["a\n  [] |", "a\n  - [ ] |"],
  ["x [] |", null],
  ["```\n[] |", null],
  ["[]|", null],
];

/** "a |b| c" -> text "a b c", selection [2, 3]. */
export function parseCase(s: string): { text: string; start: number; end: number } {
  const first = s.indexOf("|");
  const second = s.indexOf("|", first + 1);
  if (second === -1) return { text: s.replace("|", ""), start: first, end: first };
  return { text: s.slice(0, first) + s.slice(first + 1, second) + s.slice(second + 1), start: first, end: second - 1 };
}
