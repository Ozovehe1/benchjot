// Live preview cases shared with the Android app (core LiveMarkdown.kt). The span lists were
// reviewed line by line against the rules in src/lib/live-markdown.ts and are frozen here: a change
// to the live view must change these on purpose. tests/fixtures/live_markdown.json is these cases
// expanded (scripts/write-fixtures.mjs); a test fails if the two differ.
// "|" in the continueList / formatState / shortcut cases marks the cursor (two: a selection).
import type { FormatState, LiveKind } from "@/lib/live-markdown";

const ID = "0b6f2c1e-7a2d-4f1e-9a51-3c2d1e0f9a8b";

export const LIVE_RULES = [
  "Active lines = lines touched by [activeFrom, activeTo]; activeFrom < 0 means no line is active.",
  "Markers on active lines are 'marker' (dimmed), elsewhere 'hide'. Inline tokens use the whole-active-line variant.",
  "h1/h2/h3/quote cover the line content after the marker. bullet/ordered/check_open/check_done cover the list MARKER on inactive lines (draw the glyph, number or tappable checkbox there); on active lines that range is 'marker'.",
  "A done item's content is also 'done' (struck, dimmed). Leading list indent on inactive lines is 'indent' (2 spaces a level).",
  "divider: the whole '---' line, 'marker' on its active line. fence and table: whole lines, never parsed or hidden.",
  "Inline: code and math hide only their single markers; wikilink shows only the title ([[ and |id]] are markers); link shows its label ([ and ](url) are markers); bold/italic/strike nest.",
  "'_' italic never opens or closes inside a word; math needs non-space after the opening and before the closing $, and $$ is not inline math.",
  "Spans are sorted by from, then longer first, then kind; empty spans are never emitted.",
];

/** [name, text, activeFrom, activeTo, spans as [kind, from, to]] */
export const LIVE_SPAN_CASES: [string, string, number, number, [LiveKind, number, number][]][] = [
  ["plain text has no spans", "hello world", -1, -1, []],
  ["h1 off the active line", "# Title\nbody", 9, 9, [["hide", 0, 2], ["h1", 2, 7]]],
  ["h1 on the active line shows its marker", "# Title\nbody", 3, 3, [["marker", 0, 2], ["h1", 2, 7]]],
  ["h2 and h3", "## Two\n### Three", -1, -1, [["hide", 0, 3], ["h2", 3, 6], ["hide", 7, 11], ["h3", 11, 16]]],
  ["#### is not a live heading", "#### Four", -1, -1, []],
  ["# without a space is text", "#tag", -1, -1, []],
  ["bold inactive", "a **b** c", -1, -1, [["hide", 2, 4], ["bold", 4, 5], ["hide", 5, 7]]],
  ["bold active", "a **b** c", 0, 0, [["marker", 2, 4], ["bold", 4, 5], ["marker", 5, 7]]],
  ["italic underscore and star", "_i_ and *j*", -1, -1, [["hide", 0, 1], ["italic", 1, 2], ["hide", 2, 3], ["hide", 8, 9], ["italic", 9, 10], ["hide", 10, 11]]],
  ["snake_case is not italic", "snake_case_name", -1, -1, []],
  ["strike", "~~gone~~", -1, -1, [["hide", 0, 2], ["strike", 2, 6], ["hide", 6, 8]]],
  ["inline code is not parsed inside", "`**x**`", -1, -1, [["hide", 0, 1], ["code", 1, 6], ["hide", 6, 7]]],
  ["math inactive", "e = $mc^2$", -1, -1, [["hide", 4, 5], ["math", 5, 9], ["hide", 9, 10]]],
  ["math active shows source", "e = $mc^2$", 2, 2, [["marker", 4, 5], ["math", 5, 9], ["marker", 9, 10]]],
  ["dollar amounts with spaces are not math", "costs $5 and $ 6", -1, -1, []],
  ["link", "see [docs](https://x.y)", -1, -1, [["hide", 4, 5], ["link", 5, 9], ["hide", 9, 23]]],
  ["wikilink with id shows only the title", `go [[Plan|${ID}]] now`, -1, -1, [["hide", 3, 5], ["wikilink", 5, 9], ["hide", 9, 48]]],
  ["wikilink without id", "go [[Plan]]", -1, -1, [["hide", 3, 5], ["wikilink", 5, 9], ["hide", 9, 11]]],
  ["bold inside a link label", "[**b**](u)", -1, -1, [["hide", 0, 1], ["link", 1, 6], ["hide", 1, 3], ["bold", 3, 4], ["hide", 4, 6], ["hide", 6, 10]]],
  ["nested italic in bold", "**a _b_**", -1, -1, [["hide", 0, 2], ["bold", 2, 7], ["hide", 4, 5], ["italic", 5, 6], ["hide", 6, 7], ["hide", 7, 9]]],
  ["bullet inactive", "- one", -1, -1, [["bullet", 0, 2]]],
  ["star bullet active", "* one", 0, 0, [["marker", 0, 2]]],
  ["nested bullets", "- a\n  - b\n    - c", -1, -1, [["bullet", 0, 2], ["indent", 4, 6], ["bullet", 6, 8], ["indent", 10, 14], ["bullet", 14, 16]]],
  ["ordered", "1. a\n10. b", -1, -1, [["ordered", 0, 3], ["ordered", 5, 9]]],
  ["checklist open and done", "- [ ] todo\n- [x] done", -1, -1, [["check_open", 0, 6], ["check_done", 11, 17], ["done", 17, 21]]],
  ["checklist active line", "- [ ] todo\n- [x] done", 12, 12, [["check_open", 0, 6], ["marker", 11, 17], ["done", 17, 21]]],
  ["nested checklist", "- [ ] a\n  - [x] b", -1, -1, [["check_open", 0, 6], ["indent", 8, 10], ["check_done", 10, 16], ["done", 16, 17]]],
  ["empty checklist item", "- [ ] ", -1, -1, [["check_open", 0, 6]]],
  ["quote", "> wise **words**", -1, -1, [["hide", 0, 2], ["quote", 2, 16], ["hide", 7, 9], ["bold", 9, 14], ["hide", 14, 16]]],
  ["divider inactive", "a\n\n---", 0, 0, [["divider", 3, 6]]],
  ["divider active", "a\n\n---", 4, 4, [["marker", 3, 6]]],
  ["fence is not parsed", "```py\n# not a heading\n- **x**\n```\n**y**", -1, -1, [["fence", 0, 5], ["fence", 6, 21], ["fence", 22, 29], ["fence", 30, 33], ["hide", 34, 36], ["bold", 36, 37], ["hide", 37, 39]]],
  ["unclosed fence runs to the end", "```\n# x", -1, -1, [["fence", 0, 3], ["fence", 4, 7]]],
  ["table lines are monospace source", "| a | b |\n| --- | --- |\n| **1** | 2 |", -1, -1, [["table", 0, 9], ["table", 10, 23], ["table", 24, 37]]],
  ["selection over two lines makes both active", "# A\n# B\n# C", 1, 5, [["marker", 0, 2], ["h1", 2, 3], ["marker", 4, 6], ["h1", 6, 7], ["hide", 8, 10], ["h1", 10, 11]]],
  ["cursor at line end is still that line", "# A\n**b**", 3, 3, [["marker", 0, 2], ["h1", 2, 3], ["hide", 4, 6], ["bold", 6, 7], ["hide", 7, 9]]],
  ["unclosed bold is text", "**open", -1, -1, []],
  ["empty markers are text", "**** and __", -1, -1, []],
  ["inline in list item", "- [x] **done** $x$", -1, -1, [["check_done", 0, 6], ["done", 6, 18], ["hide", 6, 8], ["bold", 8, 12], ["hide", 12, 14], ["hide", 15, 16], ["math", 16, 17], ["hide", 17, 18]]],
  ["heading with wikilink", `# See [[Plan|${ID}]]`, -1, -1, [["hide", 0, 2], ["h1", 2, 51], ["hide", 6, 8], ["wikilink", 8, 12], ["hide", 12, 51]]],

];

/** [text, lineStart, text after tapping the checkbox] */
export const TOGGLE_CHECK_CASES: [string, number, string][] = [
  ["- [ ] a", 0, "- [x] a"],
  ["- [x] a", 0, "- [ ] a"],
  ["- [X] a", 0, "- [ ] a"],
  ["x\n  - [ ] b", 2, "x\n  - [x] b"],
  ["- [ ] a\n- [ ] b", 8, "- [ ] a\n- [x] b"],
  ["* [ ] star", 0, "* [x] star"],
  ["- a", 0, "- a"],
  ["plain [ ] text", 0, "plain [ ] text"],
  ["```\n- [ ] a\n```", 4, "```\n- [ ] a\n```"],
];

/** [text with cursor, after Enter (null: a plain newline)] */
export const CONTINUE_LIST_CASES: [string, string | null][] = [
  ["- a|", "- a\n- |"],
  ["* a|", "* a\n* |"],
  ["1. a|", "1. a\n2. |"],
  ["9. a|", "9. a\n10. |"],
  ["- [ ] a|", "- [ ] a\n- [ ] |"],
  ["- [x] a|", "- [x] a\n- [ ] |"],
  ["  - b|", "  - b\n  - |"],
  ["a\n    1. b|\nc", "a\n    1. b\n    2. |\nc"],
  ["- ab|cd", "- ab\n- |cd"],
  ["- |", "|"],
  ["1. |", "|"],
  ["a\n  - [ ] |\nb", "a\n|\nb"],
  ["-| a", null],
  ["plain|", null],
  ["1.|", null],
  ["# head|", null],
  ["```\n- a|", null],
];

const NONE: FormatState = { heading: 0, list: null, quote: false, bold: false, italic: false, strike: false, code: false, math: false, link: false };
/** [text with cursor, what the bar lights up] */
export const FORMAT_STATE_CASES: [string, FormatState][] = [
  ["plain|", NONE],
  ["a **b|** c", { ...NONE, bold: true }],
  ["a **b** |c", NONE],
  ["# Ti|tle", { ...NONE, heading: 1 }],
  ["### x|", { ...NONE, heading: 3 }],
  ["- [ ] a|", { ...NONE, list: "check" }],
  ["2. a|", { ...NONE, list: "ordered" }],
  ["> q|", { ...NONE, quote: true }],
  ["x _i|_", { ...NONE, italic: true }],
  ["~~s|~~", { ...NONE, strike: true }],
  ["`c|`", { ...NONE, code: true }],
  ["$x|$", { ...NONE, math: true }],
  ["[do|cs](u)", { ...NONE, link: true }],
  ["- **b|**", { ...NONE, list: "bullet", bold: true }],
];
