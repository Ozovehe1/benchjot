// Cases for rankOtherNotes (web tests and the Android parity fixtures).
import type { OtherNoteRow } from "@/lib/notes/other-notes";

const id = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;
const row = (n: number, updated: string, parent: number | null = null, outcome: OtherNoteRow["outcome"] = null): OtherNoteRow => ({ id: id(n), title: `Note ${n}`, outcome, updated_at: `2026-11-${updated}T10:00:00.000Z`, parent_id: parent === null ? null : id(parent) });

export const OTHER_NOTES_CASES: { name: string; from: { id: string; parent_id: string | null; body: string }; rows: OtherNoteRow[]; matched: boolean; max: number; similar?: string[] }[] = [
  {
    name: "linked, parent, children, then the newest; never itself; each once",
    from: { id: id(1), parent_id: id(2), body: `See [[Note 5|${id(5)}]] and [[Note 3|${id(3)}]], again [[x|${id(5)}]], and [[gone|${id(9)}]].` },
    rows: [row(1, "20"), row(2, "01"), row(3, "05", null, "failed"), row(4, "19"), row(5, "02", null, "success"), row(6, "18", 1), row(7, "17", 1), row(8, "16")],
    matched: false,
    max: 8,
  },
  { name: "at most max", from: { id: id(1), parent_id: null, body: "" }, rows: [row(2, "01"), row(3, "02"), row(4, "03")], matched: false, max: 2 },
  { name: "search matches keep the search's order", from: { id: id(1), parent_id: null, body: "" }, rows: [row(3, "01"), row(1, "20"), row(2, "05")], matched: true, max: 8 },
  { name: "no other notes", from: { id: id(1), parent_id: null, body: "" }, rows: [row(1, "20")], matched: false, max: 8 },
  {
    name: "words and meaning fused: found both ways first, then by place; meaning-only rows say so",
    from: { id: id(1), parent_id: null, body: "" },
    rows: [row(2, "01"), row(3, "02"), row(4, "03"), { ...row(5, "04"), matched: false }, { ...row(6, "05"), matched: false }],
    matched: true,
    max: 8,
    similar: [id(5), id(3), id(6), id(9)],
  },
  {
    name: "no words: close in meaning comes after the children and before the newest",
    from: { id: id(1), parent_id: null, body: `[[Note 2|${id(2)}]]` },
    rows: [row(2, "01"), row(3, "19", 1), row(4, "20"), row(5, "02"), row(6, "03")],
    matched: false,
    max: 5,
    similar: [id(6), id(2), id(1)],
  },
];
