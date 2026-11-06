// The note body's Markdown format bar (the user's, 2026-11-05; Tier 1 tools 2026-11-06): one pure
// function for every button. Wraps toggle inline markers around the selection (or the cursor);
// line commands rewrite the leading marker of each selected line; block commands put a divider or a
// table on their own lines. The Android app's core MarkdownFormat.kt matches it on the same cases
// (tests/fixtures/markdown_format.json).
//
// Cycles: heading none -> H1 -> H2 -> H3 -> none; list none -> bullet -> numbered -> checklist -> none.
// The state is read from the first non-empty selected line and the next state is applied to every
// non-empty selected line (an empty line counts when it is the only one).

import { classifyLines, listMarker, type Edit, type ListKind } from "./live-markdown";

export type { Edit } from "./live-markdown";

/** Every format command, in format-bar order (Undo and Redo come first in the bar but are not formats). */
export const MARKDOWN_FORMATS = [
  "heading", "bold", "list", "checklist",
  "italic", "strike", "quote", "indent", "outdent", "code", "math", "link",
  "divider", "table",
] as const;
export type MarkdownFormat = (typeof MARKDOWN_FORMATS)[number];
/** Formats that live in the bar's "+" sheet rather than the row. */
export const SHEET_FORMATS: readonly MarkdownFormat[] = ["divider", "table"];

const WRAP: Partial<Record<MarkdownFormat, string>> = { bold: "**", italic: "_", strike: "~~", code: "`", math: "$" };
const LINK_URL = "url";
const INDENT = "  ";
export const DIVIDER_BLOCK = "---";
export const TABLE_BLOCK = "| Column 1 | Column 2 |\n| --- | --- |\n|  |  |";

function wrap(e: Edit, m: string): Edit {
  const { text, start, end } = e;
  const sel = text.slice(start, end);
  // The selection includes the markers: take them off.
  if (sel.length >= 2 * m.length && sel.startsWith(m) && sel.endsWith(m)) {
    const inner = sel.slice(m.length, sel.length - m.length);
    return { text: text.slice(0, start) + inner + text.slice(end), start, end: start + inner.length };
  }
  // The markers sit right around the selection (or the cursor): take them off.
  if (start >= m.length && text.slice(start - m.length, start) === m && text.slice(end, end + m.length) === m) {
    return { text: text.slice(0, start - m.length) + sel + text.slice(end + m.length), start: start - m.length, end: end - m.length };
  }
  return { text: text.slice(0, start) + m + sel + m + text.slice(end), start: start + m.length, end: end + m.length };
}

const LINK = /^\[([^\]]*)\]\(([^)]*)\)$/;

function link(e: Edit): Edit {
  const { text, start, end } = e;
  const sel = text.slice(start, end);
  const m = LINK.exec(sel);
  if (m) return { text: text.slice(0, start) + m[1] + text.slice(end), start, end: start + m[1]!.length };
  // The cursor or selection is a link's label: [label](...) around it.
  if (start > 0 && text[start - 1] === "[") {
    const after = /^\]\([^)\n]*\)/.exec(text.slice(end));
    if (after) return { text: text.slice(0, start - 1) + sel + text.slice(end + after[0].length), start: start - 1, end: end - 1 };
  }
  if (!sel) return { text: text.slice(0, start) + `[](${LINK_URL})` + text.slice(end), start: start + 1, end: start + 1 };
  const url = start + sel.length + 3;
  return { text: text.slice(0, start) + `[${sel}](${LINK_URL})` + text.slice(end), start: url, end: url + LINK_URL.length };
}

// ---- line commands ----

interface Line {
  from: number;
  text: string;
}

/** The selected lines. A selection ending right after a newline does not take the next line. */
function selectedLines(e: Edit): Line[] {
  const { text, start, end } = e;
  const from = start === 0 ? 0 : text.lastIndexOf("\n", start - 1) + 1;
  const nl = text.indexOf("\n", end > start && text[end - 1] === "\n" ? end - 1 : end);
  const to = nl === -1 ? text.length : nl;
  let at = from;
  return text.slice(from, to).split("\n").map((t) => {
    const l = { from: at, text: t };
    at += t.length + 1;
    return l;
  });
}

/**
 * Rewrites each line's leading `cut` characters as `put` (null: line untouched). A position inside
 * the cut part moves to the end of the new prefix; later positions shift with it.
 */
function rewrite(e: Edit, lines: Line[], fn: (l: Line, i: number) => { cut: number; put: string } | null): Edit {
  let text = e.text;
  let { start, end } = e;
  // Right to left so earlier offsets stay valid.
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!;
    const r = fn(l, i);
    if (!r) continue;
    const a = l.from;
    const b = l.from + r.cut;
    text = text.slice(0, a) + r.put + text.slice(b);
    const map = (p: number) => (p < a ? p : p < b ? a + r.put.length : p - r.cut + r.put.length);
    start = map(start);
    end = map(end);
  }
  return { text, start, end };
}

/** Lines a line command acts on: the non-empty ones, or the only one. */
function targets(lines: Line[]): Set<number> {
  const used = lines.map((l, i) => (l.text.trim() !== "" || lines.length === 1 ? i : -1)).filter((i) => i >= 0);
  return new Set(used);
}

const HEADING_PREFIX = /^#{1,6} /;

function heading(e: Edit): Edit {
  const lines = selectedLines(e);
  const on = targets(lines);
  const first = lines[[...on][0] ?? 0]!;
  const level = HEADING_PREFIX.exec(first.text)?.[0].length ?? 0; // "# " = 2
  const cur = level === 0 ? 0 : Math.min(level - 1, 3);
  const next = (cur + 1) % 4;
  const put = next === 0 ? "" : "#".repeat(next) + " ";
  return rewrite(e, lines, (l, i) => (on.has(i) ? { cut: HEADING_PREFIX.exec(l.text)?.[0].length ?? 0, put } : null));
}

function marker(kind: ListKind | null, n: number, done = false): string {
  if (kind === "bullet") return "- ";
  if (kind === "ordered") return `${n}. `;
  if (kind === "check") return done ? "- [x] " : "- [ ] ";
  return "";
}

/** Sets every target line's list marker to `kind` (keeping indent; numbered lines count 1, 2, …). */
function setList(e: Edit, lines: Line[], on: Set<number>, kind: ListKind | null): Edit {
  const n = new Map<number, number>();
  let count = 0;
  lines.forEach((_, i) => on.has(i) && n.set(i, ++count));
  return rewrite(e, lines, (l, i) => {
    if (!on.has(i)) return null;
    const m = listMarker(l.text);
    const indent = m ? m.indent : 0;
    const keepDone = kind === "check" && m?.list === "check" && m.done;
    return { cut: indent + (m?.marker.length ?? 0), put: " ".repeat(indent) + marker(kind, n.get(i)!, keepDone) };
  });
}

const LIST_CYCLE: Record<ListKind | "none", ListKind | null> = { none: "bullet", bullet: "ordered", ordered: "check", check: null };

function list(e: Edit): Edit {
  const lines = selectedLines(e);
  const on = targets(lines);
  const first = lines[[...on][0] ?? 0]!;
  return setList(e, lines, on, LIST_CYCLE[listMarker(first.text)?.list ?? "none"]);
}

function checklist(e: Edit): Edit {
  const lines = selectedLines(e);
  const on = targets(lines);
  const all = [...on].every((i) => listMarker(lines[i]!.text)?.list === "check");
  return setList(e, lines, on, all ? null : "check");
}

const QUOTE_PREFIX = /^> ?/;

function quote(e: Edit): Edit {
  const lines = selectedLines(e);
  const on = targets(lines);
  const off = [...on].every((i) => QUOTE_PREFIX.test(lines[i]!.text));
  return rewrite(e, lines, (l, i) => {
    if (!on.has(i)) return null;
    if (off) return { cut: QUOTE_PREFIX.exec(l.text)![0].length, put: "" };
    return QUOTE_PREFIX.test(l.text) ? null : { cut: 0, put: "> " };
  });
}

/** Indent / outdent: list lines only, 2 spaces a level, clamped at 0. */
function shift(e: Edit, by: 1 | -1): Edit {
  const lines = selectedLines(e);
  return rewrite(e, lines, (l) => {
    const m = listMarker(l.text);
    if (!m) return null;
    if (by === 1) return { cut: 0, put: INDENT };
    const cut = Math.min(m.indent, INDENT.length);
    return cut === 0 ? null : { cut, put: "" };
  });
}

// ---- block inserts ----

/**
 * Puts `block` on its own lines at the cursor's line (the selection end's), with a blank line before
 * it (so `---` never turns the line above into a heading) and the cursor on an empty line after it.
 * `select` picks a range inside the block to select instead (relative to the block's start).
 */
function insertBlock(e: Edit, block: string, select?: [number, number]): Edit {
  const { text, end } = e;
  const lines = classifyLines(text);
  const idx = lines.findIndex((l) => end <= l.to);
  const l = lines[idx === -1 ? lines.length - 1 : idx]!;
  const blank = text.slice(l.from, l.to).trim() === "";
  const prev = idx > 0 ? lines[idx - 1]! : null;
  const prevBlank = !prev || text.slice(prev.from, prev.to).trim() === "";
  let at: number;
  let out: string;
  if (blank && prevBlank) {
    at = l.from;
    out = text.slice(0, l.from) + block + "\n" + text.slice(l.to);
  } else {
    const sep = blank ? "\n" : "\n\n";
    at = l.to + sep.length;
    out = text.slice(0, l.to) + sep + block + "\n" + text.slice(l.to);
  }
  if (select) return { text: out, start: at + select[0], end: at + select[1] };
  const caret = at + block.length + 1;
  return { text: out, start: caret, end: caret };
}

const TABLE_FIRST_CELL: [number, number] = [2, 2 + "Column 1".length];

/** Applies one format command to `text` with the selection [start, end). */
export function applyFormat(text: string, start: number, end: number, format: MarkdownFormat): Edit {
  const a = Math.max(0, Math.min(start, end, text.length));
  const b = Math.min(text.length, Math.max(start, end));
  const e = { text, start: a, end: b };
  switch (format) {
    case "link": return link(e);
    case "heading": return heading(e);
    case "list": return list(e);
    case "checklist": return checklist(e);
    case "quote": return quote(e);
    case "indent": return shift(e, 1);
    case "outdent": return shift(e, -1);
    case "divider": return insertBlock(e, DIVIDER_BLOCK);
    case "table": return insertBlock(e, TABLE_BLOCK, TABLE_FIRST_CELL);
    default: return wrap(e, WRAP[format]!);
  }
}

/** Typing shortcut: `[] ` at a line start becomes `- [ ] `. Returns the edit, or null when it doesn't apply. */
export function expandCheckShortcut(text: string, caret: number): Edit | null {
  const from = caret === 0 ? 0 : text.lastIndexOf("\n", caret - 1) + 1;
  const before = text.slice(from, caret);
  const m = /^( *)\[\] $/.exec(before);
  if (!m) return null;
  const lines = classifyLines(text);
  if (lines.find((l) => l.from === from)?.block.kind === "fence") return null;
  const put = m[1] + "- [ ] ";
  return { text: text.slice(0, from) + put + text.slice(caret), start: from + put.length, end: from + put.length };
}
