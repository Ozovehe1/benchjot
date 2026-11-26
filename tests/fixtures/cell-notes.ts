// Hand-written cases for cell notes ("Note before run" / "Note after run"), shared with Android as
// tests/fixtures/cell_notes.json (scripts/write-fixtures.mjs). Expected answers are written here by
// hand, never produced by the implementation. Checked against the real SQL (note_links(),
// search_notes() in supabase/migrations/20261106200000_cell_notes.sql) by tests/cell-notes-sql.test.ts
// and against the collapse rule by tests/cell-notes.test.ts.

const A = "0b6e6a9e-1111-4222-8333-444455556666";
const B = "1c7f7b0f-2222-4333-9444-555566667777";
const N1 = "2d808c10-3333-4444-a555-666677778888";
const N2 = "3e919d21-4444-4555-b666-777788889999";

export const CELL_NOTE_LABELS = { before: "Note before run", after: "Note after run" } as const;

/** Collapsed when the text is empty or only spaces, tabs and newlines. */
export const COLLAPSE_CASES: [text: string, collapsed: boolean][] = [
  ["", true],
  [" ", true],
  ["\n\n", true],
  [" \t\n \r\n", true],
  ["x", false],
  ["  done \n", false],
  ["[[Dropout sweep]]", false],
  ["-", false],
];

export interface CellCase {
  position: number;
  content: string;
  note_before: string;
  note_after: string;
}
interface LinkCase {
  name: string;
  note: { id: string; notes: string };
  /** In any order; links come out by `position`. */
  cells: CellCase[];
  /** Body links first, then each cell by position: note_before's, then note_after's. Label trimmed, id lowercased. */
  links: { source: string; label: string; id: string | null }[];
}

const cell = (position: number, note_before = "", note_after = "", content = "print(1)"): CellCase => ({ position, content, note_before, note_after });

export const LINK_CASES: LinkCase[] = [
  {
    name: "old note: body links only, empty cell notes",
    note: { id: N1, notes: `See [[Dropout sweep|${A}]].` },
    cells: [cell(0)],
    links: [{ source: N1, label: "Dropout sweep", id: A }],
  },
  {
    name: "link in a note before run",
    note: { id: N1, notes: "No links here." },
    cells: [cell(0, `Compare with [[Tokenizer study|${B}]] first.`)],
    links: [{ source: N1, label: "Tokenizer study", id: B }],
  },
  {
    name: "link in a note after run, uppercase id, plus the body",
    note: { id: N1, notes: `Goal from [[Dropout sweep|${A}]].` },
    cells: [cell(0, "", `Matches [[ Tokenizer study |${B.toUpperCase()}]].`)],
    links: [
      { source: N1, label: "Dropout sweep", id: A },
      { source: N1, label: "Tokenizer study", id: B },
    ],
  },
  {
    name: "two cells out of order: by position, before then after",
    note: { id: N2, notes: "" },
    cells: [cell(1, `[[Second before|${B}]]`, "[[Second after]]"), cell(0, "[[First before]]", `[[First after|${A}]]`)],
    links: [
      { source: N2, label: "First before", id: null },
      { source: N2, label: "First after", id: A },
      { source: N2, label: "Second before", id: B },
      { source: N2, label: "Second after", id: null },
    ],
  },
  {
    name: "not links: unclosed, multi-line, empty, bad id",
    note: { id: N1, notes: "" },
    cells: [cell(0, "[[open and [[a\nb]]", "[[]] and [[x|not-an-id]] and [a]")],
    links: [],
  },
  {
    name: "a [[link]] inside code doesn't count",
    note: { id: N1, notes: "" },
    cells: [cell(0, "", "", `s = "[[Dropout sweep|${A}]]"`)],
    links: [],
  },
];

interface SearchCase {
  name: string;
  query: string;
  note: { id: string; title: string; notes: string; outcome: "success" | "failed" | null };
  cells: CellCase[];
  match: boolean;
}

const note = (notes = "", title = "Warmup run", outcome: SearchCase["note"]["outcome"] = null) => ({ id: N1, title, notes, outcome });

export const SEARCH_CASES: SearchCase[] = [
  { name: "word in a note before run", query: "hypothesis", note: note(), cells: [cell(0, "Hypothesis: cosine beats linear.")], match: true },
  { name: "word in a note after run", query: "overfits", note: note(), cells: [cell(0, "", "It overfits after epoch 3.")], match: true },
  { name: "word in neither", query: "tokenizer", note: note(), cells: [cell(0, "Hypothesis.", "Result.")], match: false },
  { name: "every term must match, across body and cell notes", query: "goal overfits", note: note("The goal."), cells: [cell(0, "", "overfits")], match: true },
  { name: "one term missing", query: "goal underfits", note: note("The goal."), cells: [cell(0, "", "overfits")], match: false },
  { name: "case-insensitive", query: "COSINE", note: note(), cells: [cell(0, "cosine schedule")], match: true },
  { name: "second cell's note", query: "baseline", note: note(), cells: [cell(0), cell(1, "", "keep as baseline")], match: true },
  { name: "old note: code still matches with empty cell notes", query: "print", note: note(), cells: [cell(0)], match: true },
];
