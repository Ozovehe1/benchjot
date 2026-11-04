// Note links, written in a note's body as [[Title|<note id>]].
//
// The body is the single source of truth: links are derived from it on read
// (here for rendering, in note_links() in SQL for backlinks and the map).
// The id is what a link points at; the title in the brackets is only a
// fallback label, so renaming a note never breaks a link to it. [[Title]]
// without an id (typed by hand) resolves by title.
//
// LINK_PATTERN must stay identical to the pattern in note_links()
// (supabase/migrations/20261104040000_note_tree_and_links.sql); a test checks it.

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
export const LINK_PATTERN = `\\[\\[([^]|[\\n]+)(?:\\|(${UUID}))?\\]\\]`;
// JS needs the leading ] in the bracket escaped; Postgres needs it bare.
const linkRe = () => new RegExp(LINK_PATTERN.replace("[^]", "[^\\]"), "g");

export interface NoteLink {
  label: string;
  id: string | null;
}

/** A link and the note whose body it is in. */
export interface SourcedLink extends NoteLink {
  source: string;
}

export type Segment = { kind: "text"; text: string } | ({ kind: "link"; raw: string } & NoteLink);

/** Splits text into plain runs and links, in order. Joining every `text`/`raw` gives the input back. */
export function parseLinks(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(linkRe())) {
    const at = m.index;
    if (at > last) out.push({ kind: "text", text: text.slice(last, at) });
    out.push({ kind: "link", raw: m[0], label: m[1]!.trim(), id: m[2]?.toLowerCase() ?? null });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/** The link to insert for a note. Characters that would end the link early are replaced. */
export function formatLink(title: string, id: string): string {
  const label = title.replace(/[[\]|\s]+/g, " ").trim() || "Untitled";
  return `[[${label}|${id}]]`;
}

export interface NoteRef {
  id: string;
  title: string;
}

/** The note a link points at: by id when it has one, else by title (case-insensitive). Null if missing. */
export function resolveLink(link: NoteLink, notes: readonly NoteRef[]): NoteRef | null {
  if (link.id) return notes.find((n) => n.id === link.id) ?? null;
  const want = link.label.toLowerCase();
  return notes.find((n) => n.title.trim().toLowerCase() === want) ?? null;
}

/**
 * An unfinished link being typed at the caret: `[[` then a query on the same
 * line, with no `]` or `|` yet. Returns where `[[` starts and the query.
 */
export function linkQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const start = before.lastIndexOf("[[");
  if (start < 0) return null;
  const query = before.slice(start + 2);
  if (/[[\]|\n]/.test(query) || query.length > 200) return null;
  return { start, query };
}

/** Replaces the typed `[[query` (from `start` to the caret) with the full link; returns the new text and caret. */
export function completeLink(text: string, start: number, caret: number, note: NoteRef): { text: string; caret: number } {
  // Drop a `]]` the user (or the keyboard) already typed right after the caret.
  const tail = text.slice(caret).replace(/^\]\]/, "");
  const link = formatLink(note.title, note.id);
  return { text: text.slice(0, start) + link + tail, caret: start + link.length };
}

/** Notes whose title contains the query (case-insensitive), title-prefix matches first. */
export function linkSuggestions(query: string, notes: readonly NoteRef[], excludeId: string, limit = 6): NoteRef[] {
  const q = query.trim().toLowerCase();
  const scored = notes
    .filter((n) => n.id !== excludeId && n.title.trim())
    .map((n) => ({ n, at: n.title.toLowerCase().indexOf(q) }))
    .filter((s) => s.at >= 0);
  // Stable sort: prefix matches first, otherwise the given order (most recent first).
  scored.sort((a, b) => Number(a.at !== 0) - Number(b.at !== 0));
  return scored.slice(0, limit).map((s) => s.n);
}

/** Notes that link to `id`, once each, in the order of `notes` (most recent first); never the note itself. */
export function backlinksTo<T extends NoteRef>(id: string, links: readonly SourcedLink[], notes: readonly T[]): T[] {
  const from = new Set(links.filter((l) => l.source !== id && resolveLink(l, notes)?.id === id).map((l) => l.source));
  return notes.filter((n) => from.has(n.id));
}
