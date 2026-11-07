// The note Helper's shared cases. Shared with the Android app: its scripts/web-fixtures.mjs writes
// helper.json with the web's own answers (helperCells + noteContext, helperHistory, helperRules,
// earlierBlock), which core HelperOnline.kt and AssistPrompts must match.
import type { HelperAnswer, HelperTask } from "@/lib/helper";

const ROW = { user_id: "9f000000-0000-4000-8000-000000000001", entry_id: "9f000000-0000-4000-8000-0000000000e1", filename: "", created_at: "2026-11-07T02:00:00Z", updated_at: "2026-11-07T02:00:00Z" };
const RUN = { stdout: "", stderr: "", error_line: null, line: null, ms: 12, where: "browser", code_hash: "h1", ran_at: "2026-11-07T02:00:00.000Z" };
const DIR = "9f000000-0000-4000-8000-000000000001/9f000000-0000-4000-8000-0000000000c1/9f000000-0000-4000-8000-0000000000a1";
let n = 0;
/** A snippets row as the database returns it (Android decodes the same JSON into core Snippet). */
const cell = (over: Record<string, unknown>) => ({ ...ROW, id: `9f000000-0000-4000-8000-0000000000${(++n).toString().padStart(2, "0")}`, position: n, language: "python", content: "", note_before: "", note_after: "", last_run: null, ...over });

export interface ContextCase {
  name: string;
  body: string;
  snippets: Record<string, unknown>[];
  max?: number;
}

const longOut = Array.from({ length: 300 }, (_, i) => `epoch ${i} loss ${(1 / (i + 1)).toFixed(4)}`).join("\n");

export const CONTEXT_CASES: ContextCase[] = [
  { name: "body only", body: "Hypothesis: warmup helps.", snippets: [] },
  {
    name: "every part of a cell, in order",
    body: "Two parameters: lr and warmup.",
    snippets: [
      cell({
        content: "import matplotlib.pyplot as plt\nplt.plot([1, 2])\nprint('acc', 0.91)",
        note_before: "Try **lr = 0.1** first.",
        note_after: "Accuracy looks good; check [[Baseline|9f000000-0000-4000-8000-0000000000e2]].",
        last_run: { ...RUN, outcome: "ok", stdout: "acc 0.91\n", outputs: { version: 1, dir: DIR, notes: [], items: [
          { kind: "image", source: "matplotlib", width: 640, height: 480, title: "Loss curve", files: { png: "0.png" } },
          { kind: "table", index_columns: 1, columns: ["a", "b"], rows: [[1, 2]], total_rows: 10, total_columns: 2, files: { csv: "1.csv" } },
          { kind: "chart", lib: "plotly", version: "5.24.1", title: "", files: { json: "2.json" } },
        ] } },
      }),
    ],
  },
  {
    name: "a failed run shows its error, not its output",
    body: "",
    snippets: [cell({ content: "1/0", last_run: { ...RUN, outcome: "error", stdout: "before\n", stderr: "Traceback\nZeroDivisionError: division by zero", error_line: "ZeroDivisionError: division by zero" } })],
  },
  {
    name: "a stopped or timed-out run shows neither",
    body: "b",
    snippets: [cell({ content: "while True: pass", last_run: { ...RUN, outcome: "timeout", stdout: "partial" } }), cell({ language: "javascript", content: "1", last_run: { ...RUN, outcome: "stopped" } })],
  },
  { name: "a long output keeps its last lines and says so", body: "", snippets: [cell({ content: "train()", last_run: { ...RUN, outcome: "ok", stdout: longOut } })] },
  { name: "blank cell notes are left out", body: "x", snippets: [cell({ content: "print(1)", note_before: "  \n ", note_after: "\n" })] },
  {
    name: "a long note keeps its beginning and is cut at a line",
    body: Array.from({ length: 40 }, (_, i) => `row ${i}`).join("\n"),
    snippets: [cell({ content: "print('cell')", note_after: "after" })],
    max: 200,
  },
];

export interface HistoryCase {
  name: string;
  summary: string;
  turns: { task: HelperTask; request: string; answer: HelperAnswer }[];
}

const turn = (i: number, answer: HelperAnswer, task: HelperTask = "ask") => ({ task, request: `request ${i}`, answer });

export const HISTORY_CASES: HistoryCase[] = [
  { name: "none", summary: "", turns: [] },
  {
    name: "the last six turns, oldest first",
    summary: "",
    turns: Array.from({ length: 8 }, (_, i) => turn(i, i % 2 ? { kind: "prose", text: `answer ${i}` } : { kind: "code", code: `print(${i})`, summary: `Prints ${i}.`, language: "python" }, i % 2 ? "ask" : "write")),
  },
  {
    name: "long requests and answers are cut",
    summary: "  2026-10-01 Ask: what is lr — The learning rate.  ",
    turns: [{ task: "ask", request: `  ${"why ".repeat(200)}  `, answer: { kind: "prose", text: "because ".repeat(400) } }, turn(1, { kind: "code", code: "x = 1\n".repeat(400), summary: "Sets x.", language: "python" })],
  },
  {
    name: "a long summary keeps its newest lines",
    summary: Array.from({ length: 60 }, (_, i) => `2026-09-${String((i % 28) + 1).padStart(2, "0")} Write: plot ${i} — Plots the results of run ${i}.`).join("\n"),
    turns: [],
  },
];

/** Languages whose shared rules the phone's prompts must match word for word. */
export const RULE_LANGUAGES = ["python", "javascript", "r"];
