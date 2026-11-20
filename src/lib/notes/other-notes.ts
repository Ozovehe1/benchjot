// Which of the user's other notes the Assistant's find_notes lists, and in what order (Android
// core OtherNotes.kt, parity-checked). Pure: the rows come from the database or the device copy.
import { parseLinks } from "./links";

/** A note as find_notes reads it. */
export type OtherNoteRow = { id: string; title: string; outcome: "success" | "failed" | null; updated_at: string; parent_id: string | null; /** false: found only by meaning, not by the word search. */ matched?: boolean };
/** One note as find_notes lists it; `why` says how it relates to the note asking. */
export type OtherNote = { id: string; title: string; outcome: "success" | "failed" | null; updated_at: string; why?: string };

/** At most this many notes per find_notes. */
export const OTHER_NOTES_MAX = 8;

/** The notes a note links to ([[Title|id]]), in the order they appear, at most 50. */
export const linkedIds = (body: string) => [...new Set(parseLinks(body).flatMap((p) => (p.kind === "link" && p.id ? [p.id] : [])))].slice(0, 50);

/** Reciprocal rank fusion's constant: how much a lower place in one list still counts. */
const FUSE_K = 60;

/**
 * The list find_notes gives. `similar`: the ids search by meaning found, closest first.
 * Words searched (`matched`): the word matches and the meaning matches fused by their places in the
 * two lists (reciprocal rank fusion), so a note found both ways comes first.
 * No words: the notes this one links to, its parent, the notes under it, the notes closest in
 * meaning to it, then the most recently edited. Never the note itself; each note once; at most `max`.
 */
export function rankOtherNotes(from: { id: string; parent_id: string | null; body: string }, rows: readonly OtherNoteRow[], matched: boolean, max: number = OTHER_NOTES_MAX, similar: readonly string[] = []): OtherNote[] {
  const out: OtherNote[] = [];
  const seen = new Set([from.id]);
  const take = (r: OtherNoteRow, why?: string) => {
    if (seen.has(r.id) || out.length >= max) return;
    seen.add(r.id);
    out.push({ id: r.id, title: r.title, outcome: r.outcome, updated_at: r.updated_at, ...(why ? { why } : {}) });
  };
  const byId = new Map(rows.map((r) => [r.id, r]));
  const close = similar.filter((id) => byId.has(id));
  if (matched) {
    // Word matches: the rows the word search gave, in its order. Rows found only by meaning say matched: false.
    const words = rows.filter((r) => r.matched !== false).map((r) => r.id);
    const score = new Map<string, number>();
    words.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (FUSE_K + i + 1)));
    close.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (FUSE_K + i + 1)));
    const order = [...score.keys()].sort((a, b) => score.get(b)! - score.get(a)! || (words.indexOf(a) + 1 || 999) - (words.indexOf(b) + 1 || 999) || (a < b ? -1 : 1));
    order.forEach((id) => take(byId.get(id)!, words.includes(id) ? "matches" : "close in meaning"));
    return out;
  }
  const newest = [...rows].sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : a.id < b.id ? -1 : 1));
  for (const id of linkedIds(from.body)) if (byId.has(id)) take(byId.get(id)!, "linked from this note");
  if (from.parent_id && byId.has(from.parent_id)) take(byId.get(from.parent_id)!, "this note's parent");
  newest.filter((r) => r.parent_id === from.id).forEach((r) => take(r, "a note under this one"));
  close.forEach((id) => take(byId.get(id)!, "close in meaning to this note"));
  newest.forEach((r) => take(r));
  return out;
}
