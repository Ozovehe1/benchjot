// A note's table of contents: the Markdown headings the person wrote (# Title, ## Section, ### Part),
// as Jupyter builds its own, plus one entry per code cell ("Cell 3", with the cell's title when it has
// one), so every cell is a tap away; each cell sits under the heading it falls beneath. Page order: the
// note's text, then for each cell its "Note before run", the cell, its "Note after run". Nothing is
// guessed from code. Pure.
export type ContentsPlace = { kind: "body" } | { kind: "cell"; id: string; side: "before" | "after" };
/** One heading: its level, its text as read (Markdown marks removed), where it is, and which heading of that place it is (0 = first). */
export type ContentsHeading = { kind: "heading"; key: string; level: 1 | 2 | 3; text: string; place: ContentsPlace; index: number };
/** One code cell: its number, its title if it has one, and the level of the heading it sits under (0: none above it). */
export type ContentsCell = { kind: "cell"; key: string; id: string; n: number; title: string; under: 0 | 1 | 2 | 3 };
export type ContentsItem = ContentsHeading | ContentsCell;

/** Headings as the note's editor shows them: "# ", "## ", "### " at a line's start, outside fenced code. */
const HEADING = /^(#{1,3}) +(.+?)\s*#*\s*$/;
const FENCE = /^ {0,3}(```|~~~)/;

/** A heading's words without Markdown marks: [[Title|id]] → Title, [text](url) → text, `code`, **bold**, _italic_, ~~strike~~. */
export function plainHeading(text: string): string {
  return text
    .replace(/\[\[([^\]|]+)(\|[^\]]*)?\]\]/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
    .replace(/(^|\W)[*_](\S(?:.*?\S)?)[*_](?=\W|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/** The headings in one Markdown text, in order. */
export function headingsOf(markdown: string): { level: 1 | 2 | 3; text: string }[] {
  const out: { level: 1 | 2 | 3; text: string }[] = [];
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const m = HEADING.exec(line);
    const text = m ? plainHeading(m[2]!) : "";
    if (m && text) out.push({ level: m[1]!.length as 1 | 2 | 3, text });
  }
  return out;
}

/** The note's table of contents: the text's headings, then for each cell its before-note's headings, the cell, its after-note's headings. */
export function contents(body: string, cells: readonly { id: string; filename?: string | null; note_before?: string | null; note_after?: string | null }[]): ContentsItem[] {
  const out: ContentsItem[] = [];
  let under: 0 | 1 | 2 | 3 = 0;
  const add = (markdown: string | null | undefined, place: ContentsPlace, key: string) =>
    headingsOf(markdown ?? "").forEach((h, index) => {
      out.push({ kind: "heading", key: `${key}:${index}`, ...h, place, index });
      under = h.level;
    });
  add(body, { kind: "body" }, "body");
  cells.forEach((c, i) => {
    add(c.note_before, { kind: "cell", id: c.id, side: "before" }, `${c.id}:before`);
    out.push({ kind: "cell", key: `${c.id}:cell`, id: c.id, n: i + 1, title: c.filename?.trim() ?? "", under });
    add(c.note_after, { kind: "cell", id: c.id, side: "after" }, `${c.id}:after`);
  });
  return out;
}
