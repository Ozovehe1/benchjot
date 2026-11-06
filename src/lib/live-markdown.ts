// The note body's live preview (the user's, 2026-11-06): the body stays Markdown text and the
// editor shows it styled while typing, Obsidian-style. Everything here is pure; the CodeMirror
// view (src/components/live-editor.tsx) and Android's core LiveMarkdown.kt only paint these answers.
// tests/fixtures/live_markdown.json is the authority for both platforms.
//
// Rules (also written into the fixture's "rules"):
// - Active lines are the lines touched by [activeFrom, activeTo]; activeFrom < 0 means none (no focus).
// - Markers on active lines are kind "marker" (shown dimmed), on other lines "hide". Inline tokens use
//   the whole-active-line variant: a token's markers show when its line is active.
// - Block spans cover the line content after the marker. List spans ("bullet", "ordered",
//   "check_open", "check_done") cover the list MARKER itself on inactive lines (the platform draws
//   •, the number, or a tappable checkbox there); on active lines that marker is "marker".
//   A done item's content is also "done" (struck, dimmed). Leading list indent on inactive lines is
//   "indent" (2 spaces per level).
// - "fence" lines (``` … ```) and "table" lines are whole-line monospace, never parsed or hidden.
// - Spans are sorted by from, then longer first, then kind; empty spans are never emitted.

import { linkRe } from "./links";

export type LiveKind =
  | "marker" | "hide"
  | "h1" | "h2" | "h3" | "quote"
  | "bullet" | "ordered" | "check_open" | "check_done" | "done" | "indent"
  | "divider" | "fence" | "table"
  | "bold" | "italic" | "strike" | "code" | "math" | "link" | "wikilink";

export interface LiveSpan {
  from: number;
  to: number;
  kind: LiveKind;
}

export type ListKind = "bullet" | "ordered" | "check";

/** One line of the body, classified. Offsets are absolute. */
export interface LineInfo {
  from: number;
  to: number;
  /** Where the line's content starts (after any block marker). */
  content: number;
  block:
    | { kind: "plain" }
    | { kind: "heading"; level: 1 | 2 | 3 }
    | { kind: "quote" }
    | { kind: "list"; list: ListKind; indent: number; marker: string; number?: number; done?: boolean }
    | { kind: "divider" }
    | { kind: "fence" }
    | { kind: "table" };
}

const FENCE = /^ {0,3}```/;
const HEADING = /^(#{1,3}) /;
const QUOTE = /^> ?/;
const CHECK = /^( *)([-*]) \[([ xX])\](?: |$)/;
const ORDERED = /^( *)(\d{1,9})\. /;
const BULLET = /^( *)([-*]) /;
const DIVIDER = /^-{3,}\s*$/;
const TABLE = /^\s*\|.*\|\s*$/;

/** The list marker at the start of a line, if any (also used by the format commands). */
export function listMarker(line: string): { list: ListKind; indent: number; marker: string; number?: number; done?: boolean } | null {
  let m = CHECK.exec(line);
  if (m) return { list: "check", indent: m[1]!.length, marker: m[0].slice(m[1]!.length), done: m[3] !== " " };
  m = ORDERED.exec(line);
  if (m) return { list: "ordered", indent: m[1]!.length, marker: m[0].slice(m[1]!.length), number: Number(m[2]) };
  if (DIVIDER.test(line)) return null;
  m = BULLET.exec(line);
  if (m) return { list: "bullet", indent: m[1]!.length, marker: m[0].slice(m[1]!.length) };
  return null;
}

/** Splits the body into classified lines, tracking ``` fences. */
export function classifyLines(text: string): LineInfo[] {
  const out: LineInfo[] = [];
  let fenced = false;
  let from = 0;
  for (const line of text.split("\n")) {
    const to = from + line.length;
    let block: LineInfo["block"] = { kind: "plain" };
    let content = from;
    if (fenced || FENCE.test(line)) {
      if (FENCE.test(line)) fenced = !fenced;
      block = { kind: "fence" };
    } else if (TABLE.test(line)) block = { kind: "table" };
    else if (DIVIDER.test(line)) block = { kind: "divider" };
    else {
      const h = HEADING.exec(line);
      const l = h ? null : listMarker(line);
      const q = h || l ? null : QUOTE.exec(line);
      if (h) {
        block = { kind: "heading", level: h[1]!.length as 1 | 2 | 3 };
        content = from + h[0].length;
      } else if (l) {
        block = { kind: "list", ...l };
        content = from + l.indent + l.marker.length;
      } else if (q) {
        block = { kind: "quote" };
        content = from + q[0].length;
      }
    }
    out.push({ from, to, content, block });
    from = to + 1;
  }
  return out;
}

/** The line containing `pos` (clamped to the text). */
export function lineAt(lines: readonly LineInfo[], pos: number): LineInfo {
  for (const l of lines) if (pos <= l.to) return l;
  return lines[lines.length - 1]!;
}

// ---- inline tokens ----

const WORD = /[\p{L}\p{N}_]/u;

function closeOf(text: string, m: string, from: number, end: number): number {
  for (let i = text.indexOf(m, from); i !== -1 && i + m.length <= end; i = text.indexOf(m, i + 1)) {
    if (i > from && text[i - 1] !== " ") return i;
  }
  return -1;
}

/** Inline spans for text[from, end) (one line's content). `mark` is "marker" or "hide". */
function inline(text: string, from: number, end: number, mark: "marker" | "hide", out: LiveSpan[]): void {
  const push = (a: number, b: number, kind: LiveKind) => {
    if (b > a) out.push({ from: a, to: b, kind });
  };
  let i = from;
  while (i < end) {
    const c = text[i]!;
    const rest = text.slice(i, end);
    // `code`: no parsing inside.
    if (c === "`") {
      const j = text.indexOf("`", i + 1);
      if (j !== -1 && j < end && j > i + 1) {
        push(i, i + 1, mark); push(i + 1, j, "code"); push(j, j + 1, mark);
        i = j + 1;
        continue;
      }
    }
    // $math$: not $$, opener followed and closer preceded by non-space.
    if (c === "$" && text[i + 1] !== "$" && text[i + 1] !== " " && i + 1 < end) {
      let j = text.indexOf("$", i + 1);
      while (j !== -1 && j < end && text[j - 1] === "\\") j = text.indexOf("$", j + 1);
      if (j !== -1 && j < end && j > i + 1 && text[j - 1] !== " ") {
        push(i, i + 1, mark); push(i + 1, j, "math"); push(j, j + 1, mark);
        i = j + 1;
        continue;
      }
    }
    // [[Title|id]] note links: only the title shows.
    if (rest.startsWith("[[")) {
      const re = linkRe();
      re.lastIndex = 0;
      const m = re.exec(rest);
      if (m && m.index === 0) {
        const title = m[1]!;
        push(i, i + 2, mark); push(i + 2, i + 2 + title.length, "wikilink"); push(i + 2 + title.length, i + m[0].length, mark);
        i += m[0].length;
        continue;
      }
    }
    // [label](url)
    if (c === "[") {
      const m = /^\[([^\]\n]+)\]\(([^)\s]*)\)/.exec(rest);
      if (m) {
        const lb = i + 1 + m[1]!.length;
        push(i, i + 1, mark);
        inline(text, i + 1, lb, mark, out);
        push(i + 1, lb, "link");
        push(lb, i + m[0].length, mark);
        i += m[0].length;
        continue;
      }
    }
    // **bold**, ~~strike~~, _italic_ / *italic*
    const pair = rest.startsWith("**") ? "**" : rest.startsWith("~~") ? "~~" : c === "_" || c === "*" ? c : null;
    if (pair && text[i + pair.length] !== undefined && text[i + pair.length] !== " " && i + pair.length < end) {
      const intraword = pair === "_" && i > 0 && WORD.test(text[i - 1]!);
      const j = intraword ? -1 : closeOf(text, pair, i + pair.length, end);
      const after = j === -1 ? "" : text[j + pair.length] ?? "";
      if (j !== -1 && !(pair === "_" && WORD.test(after)) && !(pair === "*" && text[j + 1] === "*")) {
        const kind: LiveKind = pair === "**" ? "bold" : pair === "~~" ? "strike" : "italic";
        push(i, i + pair.length, mark);
        push(i + pair.length, j, kind);
        inline(text, i + pair.length, j, mark, out);
        push(j, j + pair.length, mark);
        i = j + pair.length;
        continue;
      }
      i += pair.length;
      continue;
    }
    i++;
  }
}

function sortSpans(spans: LiveSpan[]): LiveSpan[] {
  return spans.sort((a, b) => a.from - b.from || b.to - a.to || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
}

/** Lines touched by [activeFrom, activeTo] as a predicate on a line. */
function activeTest(activeFrom: number, activeTo: number): (l: LineInfo) => boolean {
  if (activeFrom < 0) return () => false;
  const a = Math.min(activeFrom, activeTo);
  const b = Math.max(activeFrom, activeTo);
  return (l) => l.from <= b && l.to >= a;
}

/** The live view of `text`: which ranges to hide, dim or style. See the rules at the top. */
export function liveSpans(text: string, activeFrom: number, activeTo: number): LiveSpan[] {
  const isActive = activeTest(activeFrom, activeTo);
  const out: LiveSpan[] = [];
  const push = (a: number, b: number, kind: LiveKind) => {
    if (b > a) out.push({ from: a, to: b, kind });
  };
  for (const l of classifyLines(text)) {
    const active = isActive(l);
    const mark = active ? "marker" : "hide";
    const b = l.block;
    switch (b.kind) {
      case "fence":
      case "table":
        push(l.from, l.to, b.kind);
        continue;
      case "divider":
        push(l.from, l.to, active ? "marker" : "divider");
        continue;
      case "heading":
        push(l.from, l.content, mark);
        push(l.content, l.to, `h${b.level}` as LiveKind);
        break;
      case "quote":
        push(l.from, l.content, mark);
        push(l.content, l.to, "quote");
        break;
      case "list": {
        const m = l.from + b.indent;
        if (!active) push(l.from, m, "indent");
        const kind: LiveKind = active ? "marker" : b.list === "check" ? (b.done ? "check_done" : "check_open") : b.list;
        push(m, l.content, kind);
        if (b.list === "check" && b.done) push(l.content, l.to, "done");
        break;
      }
      case "plain":
        break;
    }
    inline(text, l.content, l.to, mark, out);
  }
  return sortSpans(out);
}

/** Flips `[ ]` <-> `[x]` on the checklist line containing `lineStart`; any other line: unchanged. */
export function toggleCheck(text: string, lineStart: number): string {
  const lines = classifyLines(text);
  const l = lineAt(lines, Math.max(0, lineStart));
  if (l.block.kind !== "list" || l.block.list !== "check") return text;
  const box = l.from + l.block.indent + l.block.marker.indexOf("[") + 1;
  return text.slice(0, box) + (l.block.done ? " " : "x") + text.slice(box + 1);
}

export interface Edit {
  text: string;
  start: number;
  end: number;
}

/**
 * Enter at `caret` on a list line: continues the list (same indent, next number, a new `- [ ] `),
 * or, on an empty item, ends the list (the marker goes, no new line). Null: let Enter insert a
 * plain newline (not a list line, caret inside the marker, or inside a ``` fence).
 */
export function continueList(text: string, caret: number): Edit | null {
  if (caret < 0 || caret > text.length) return null;
  const l = lineAt(classifyLines(text), caret);
  const b = l.block;
  if (b.kind !== "list" || caret < l.content) return null;
  if (text.slice(l.content, l.to).trim() === "") {
    const t = text.slice(0, l.from) + text.slice(l.to);
    return { text: t, start: l.from, end: l.from };
  }
  const bullet = b.marker[0]!;
  const next = b.list === "ordered" ? `${(b.number ?? 0) + 1}. ` : b.list === "check" ? `${bullet} [ ] ` : `${bullet} `;
  const ins = "\n" + " ".repeat(b.indent) + next;
  const at = caret + ins.length;
  return { text: text.slice(0, caret) + ins + text.slice(caret), start: at, end: at };
}

/** What the format bar lights up for the selection [start, end]. */
export interface FormatState {
  heading: 0 | 1 | 2 | 3;
  list: ListKind | null;
  quote: boolean;
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
  math: boolean;
  link: boolean;
}

/** The formats at the cursor: block state from the first selected line, inline from the spans around `start`. */
export function formatState(text: string, start: number, end: number): FormatState {
  const lines = classifyLines(text);
  const l = lineAt(lines, Math.max(0, Math.min(start, end)));
  const b = l.block;
  const spans = liveSpans(text, start, end);
  const a = Math.min(start, end);
  const z = Math.max(start, end);
  const inside = (k: LiveKind) => spans.some((s) => s.kind === k && s.from <= a && s.to >= z);
  return {
    heading: b.kind === "heading" ? b.level : 0,
    list: b.kind === "list" ? b.list : null,
    quote: b.kind === "quote",
    bold: inside("bold"),
    italic: inside("italic"),
    strike: inside("strike"),
    code: inside("code"),
    math: inside("math"),
    link: inside("link") || inside("wikilink"),
  };
}
