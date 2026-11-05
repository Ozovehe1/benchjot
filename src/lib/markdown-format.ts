// The note body's Markdown format bar (the user's, 2026-11-05): one pure function for every
// button. It wraps the selection (or inserts the markers with the cursor between them), gives
// List / Heading as a line prefix, and toggles off when the format is already there.
// The Android app's core MarkdownFormat.kt matches it on the same cases (markdown_format.json fixture).

export const MARKDOWN_FORMATS = ["bold", "italic", "heading", "list", "code", "math", "link"] as const;
export type MarkdownFormat = (typeof MARKDOWN_FORMATS)[number];

export interface Edit {
  text: string;
  /** Selection after the edit (start === end: a cursor). */
  start: number;
  end: number;
}

const WRAP: Partial<Record<MarkdownFormat, string>> = { bold: "**", italic: "_", code: "`", math: "$" };
const PREFIX: Partial<Record<MarkdownFormat, string>> = { heading: "# ", list: "- " };
const LINK_URL = "url";

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

function prefix(e: Edit, p: string): Edit {
  const { text, start, end } = e;
  const from = start === 0 ? 0 : text.lastIndexOf("\n", start - 1) + 1;
  const nl = text.indexOf("\n", end > start && text[end - 1] === "\n" ? end - 1 : end);
  const to = nl === -1 ? text.length : nl;
  const lines = text.slice(from, to).split("\n");
  const used = lines.filter((l) => l.trim() !== "");
  const off = used.length > 0 && used.every((l) => l.startsWith(p));
  let delta = 0;
  let first = 0;
  const out = lines.map((l, i) => {
    let next = l;
    if (off) next = l.startsWith(p) ? l.slice(p.length) : l;
    else if (!l.startsWith(p) && (l.trim() !== "" || lines.length === 1)) next = p + l;
    if (i === 0) first = next.length - l.length;
    delta += next.length - l.length;
    return next;
  });
  return {
    text: text.slice(0, from) + out.join("\n") + text.slice(to),
    start: Math.max(from, start + first),
    end: Math.max(from, end + delta),
  };
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

/** Applies one format button to `text` with the selection [start, end). */
export function applyFormat(text: string, start: number, end: number, format: MarkdownFormat): Edit {
  const a = Math.max(0, Math.min(start, end, text.length));
  const b = Math.min(text.length, Math.max(start, end));
  const e = { text, start: a, end: b };
  if (format === "link") return link(e);
  const p = PREFIX[format];
  if (p) return prefix(e, p);
  return wrap(e, WRAP[format]!);
}
