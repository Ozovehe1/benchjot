// The note Assistant's pure parts (lib/ai/assistant.ts): Android's words, the note as read on a tap and its
// budget, the prompts, the history sent back, reading answers (a Python cell never gets web script
// back), the turns, and the rules that it only proposes code and never writes the note's own fields.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  errorTail,
  placeNoteText,
  removeNoteText,
  salvageAssistantAnswer,
  CUT_NOTE,
  ASSISTANT_LIMITS,
  ASSISTANT_HISTORY,
  assistantCells,
  assistantHistory,
  historySize,
  NOTE_CUT,
  cellsLeftOut,
  TABLE_PREVIEW,
  followUps,
  latestRun,
  noteContext,
  wrongLanguage,
  type AssistantCell,
} from "@/lib/ai/assistant";
import { lastRun, type LastRun, type Cell } from "@/lib/notes/schemas";
import { CONTEXT_CASES, HISTORY_CASES } from "./fixtures/assistant";
import { messageFor } from "@/lib/ui/user-message";
import { FIX_LIMITS } from "@/config/app";

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

describe("the limits Android shares", () => {
  it("the panel's actions are named for screen readers and tooltips", () => {
    const panel = src("components/notes/assistant-panel.tsx") + src("components/notes/assistant-parts.tsx");
    for (const label of ["Insert as a new cell", "Copy", "Delete", "Send", "Stop", "Speak", "Try again", "Undo everything it changed", "Clear conversation"]) expect(panel).toContain(label);
  });
  it("shares Fix's error limit, and reads a whole research note (100,000 characters)", () => {
    expect(ASSISTANT_LIMITS).toEqual({ maxRequestChars: 2_000, maxContextChars: 100_000, maxErrorChars: FIX_LIMITS.maxErrorChars, maxOutputChars: 2_000 });
  });
});

const run = (over: Partial<LastRun>): LastRun => ({ outcome: "ok", stdout: "", stderr: "", error_line: null, line: null, ms: 1, where: "browser", code_hash: "h", ran_at: "2026-11-06T18:00:00.000Z", ...over });

const c = (over: Partial<AssistantCell>): AssistantCell => ({ language: "python", code: "", error: "", noteBefore: "", noteAfter: "", stdout: "", produced: [], tables: [], ...over });
const row = (over: Partial<Cell>) => ({ language: "python", content: "", note_before: "", note_after: "", last_run: null, ...over });

describe("the note as read", () => {
  it("each cell keeps its last run's error only when that run failed, and its output only when it succeeded", () => {
    const cells = assistantCells([
      row({ content: "print(1)", last_run: run({ outcome: "ok", stdout: "1\n", stderr: "warn" }) }),
      row({ content: "1/0", last_run: run({ outcome: "error", stdout: "partial", error_line: "ZeroDivisionError: division by zero" }) }),
      row({ content: "x", last_run: run({ outcome: "error", stderr: "NameError: x" }) }),
      row({ content: "", last_run: null }),
      row({ content: "loop", last_run: run({ outcome: "timeout", stdout: "partial" }) }),
    ]);
    expect(cells.map((x) => x.error)).toEqual(["", "ZeroDivisionError: division by zero", "NameError: x", "", ""]);
    expect(cells.map((x) => x.stdout)).toEqual(["1\n", "", "", "", ""]);
  });
  it("each cell keeps its cell notes and names what its run made", () => {
    const [cell] = assistantCells([row({ note_before: "before", note_after: "after", last_run: run({ outputs: { version: 1, dir: `${"0".repeat(8)}-0000-4000-8000-${"0".repeat(12)}/${"0".repeat(8)}-0000-4000-8000-${"0".repeat(12)}/${"0".repeat(8)}-0000-4000-8000-${"0".repeat(12)}`, notes: [], items: [
      { kind: "image", source: "matplotlib", width: 1, height: 1, title: " Loss ", files: { png: "0.png" } },
      { kind: "chart", lib: "vega-lite", version: "6", title: "", files: { json: "1.json" } },
    ] } }) })]);
    // Said as shown on screen, never as a bare file name (the 20 Nov loop).
    expect(cell).toMatchObject({ noteBefore: "before", noteAfter: "after", produced: ['a figure "Loss"', "an interactive Vega-Lite chart"] });
  });
  it("reads the tables a run made: header and first rows as CSV, a few per cell, each within its budget", () => {
    const table = (n: number, rows: number) => ({ kind: "table" as const, index_columns: 1, columns: ["network", "accuracy"], rows: Array.from({ length: rows }, (_, i) => [`net, ${i}`, 0.9 + i / 1000]), total_rows: rows, total_columns: 1, files: { csv: `${n}.csv` } });
    const dir = `${"0".repeat(8)}-0000-4000-8000-${"0".repeat(12)}`;
    const [cell] = assistantCells([row({ last_run: run({ outputs: { version: 1, dir: `${dir}/${dir}/${dir}`, notes: [], items: [table(0, 3), table(1, 40), table(2, 2), table(3, 2)] } }) })]);
    expect(cell!.tables).toHaveLength(TABLE_PREVIEW.tables);
    expect(cell!.tables[0]).toBe('Table · 3 × 1:\n```csv\nnetwork,accuracy\n"net, 0",0.9\n"net, 1",0.901\n"net, 2",0.902\n```');
    expect(cell!.tables[1]).toContain(`(first ${TABLE_PREVIEW.rows} of 40 rows)`);
    expect(noteContext("", [cell!]).text).toContain('"net, 2",0.902');
    const failed = assistantCells([row({ last_run: run({ outcome: "error", outputs: { version: 1, dir: `${dir}/${dir}/${dir}`, notes: [], items: [table(0, 3)] } }) })]);
    expect(failed[0]!.tables).toEqual([]);
  });
  it("lays the note out as body, then each cell: note before, code, output, what it made, error, note after", () => {
    const { text, cut } = noteContext("Hypothesis: warmup helps.", [
      c({ code: "print(1)", noteBefore: " First. ", stdout: "1\n", produced: ['Figure "Loss"', "Table · 3 × 2"], noteAfter: "Worked." }),
      c({ code: "1/0", error: "Traceback\nZeroDivisionError" }),
    ]);
    expect(cut).toBe(false);
    expect(text).toBe(
      "Hypothesis: warmup helps.\n\nNote before run:\nFirst.\n```python\nprint(1)\n```\nOutput:\n```\n1\n```\nShown in the note: Figure \"Loss\"; Table · 3 × 2.\nNote after run:\nWorked.\n\n```python\n1/0\n```\nLast error:\n```\nTraceback\nZeroDivisionError\n```",
    );
  });
  it("the shared cases (assistant.json for Android): rows as saved, read and cut within the budget", () => {
    for (const k of CONTEXT_CASES) {
      for (const s of k.cells) expect(lastRun.nullable().safeParse(s.last_run).success, k.name).toBe(true);
      const { text } = noteContext(k.body, assistantCells(k.cells as unknown as Cell[]), k.max);
      expect(text.length, k.name).toBeLessThanOrEqual(k.max ?? ASSISTANT_LIMITS.maxContextChars);
    }
    const long = CONTEXT_CASES.find((k) => k.name.startsWith("a long output"))!;
    const { text } = noteContext(long.body, assistantCells(long.cells as unknown as Cell[]));
    expect(text).toContain("Output (only its last lines):");
    expect(text.endsWith("epoch 299 loss 0.0033\n```")).toBe(true);
  });
});

describe("budget", () => {
  it("an error keeps its last lines, cut at a line start, and says so", () => {
    const lines = Array.from({ length: 400 }, (_, i) => `line ${i} ${"x".repeat(20)}`);
    const t = errorTail(lines.join("\n"));
    expect(t.cut).toBe(true);
    expect(t.text.length).toBeLessThanOrEqual(ASSISTANT_LIMITS.maxErrorChars);
    expect(t.text.endsWith(lines.at(-1)!)).toBe(true);
    expect(lines).toContain(t.text.split("\n")[0]);
    expect(errorTail("short\nerror\n")).toEqual({ text: "short\nerror", cut: false });
  });
  it("one huge last line keeps its end", () => {
    const t = errorTail("a".repeat(5000) + "END", 100);
    expect(t).toEqual({ text: "a".repeat(97) + "END", cut: true });
  });
  it("a long cell error is labelled as cut", () => {
    const { text } = noteContext("", [c({ code: "x", error: "e\n".repeat(3000) + "Boom" })]);
    expect(text).toContain("Last error (only its last lines):");
    expect(text.endsWith("Boom\n```")).toBe(true);
  });
  it("a long body keeps its first lines, and the code after it is still there", () => {
    const body = Array.from({ length: 20_000 }, (_, i) => `row ${i}`).join("\n");
    const { text, cut } = noteContext(body, [c({ code: "print('cell')" })]);
    expect(cut).toBe(true);
    expect(text.length).toBeLessThanOrEqual(ASSISTANT_LIMITS.maxContextChars);
    expect(text.startsWith("row 0\nrow 1\n")).toBe(true);
    expect(text).toContain(`\n${NOTE_CUT}\n\n`);
    expect(text.endsWith("```python\nprint('cell')\n```")).toBe(true); // the newest work is kept
    const rows = text.split(`\n${NOTE_CUT}`)[0]!.split("\n");
    expect(rows.every((l, i) => l === `row ${i}`)).toBe(true);
  });
  it("many long cells: every cell is there, the newest with their code whole, the older ones' code left out, and it fits", () => {
    const cells = Array.from({ length: 12 }, (_, i) => c({ code: `# cell ${i}\n` + "x = 1\n".repeat(3000), stdout: `out ${i}` }));
    const { text, cut } = noteContext("Question: does it work?", cells);
    expect(cut).toBe(true);
    expect(text.length).toBeLessThanOrEqual(ASSISTANT_LIMITS.maxContextChars);
    expect(text.startsWith("Question: does it work?\n\n")).toBe(true);
    for (let i = 0; i < 12; i++) expect(text).toContain(`out ${i}`); // every run's output
    const withCode = [...text.matchAll(/# cell (\d+)/g)].map((m) => Number(m[1]));
    expect(withCode.at(-1)).toBe(11);
    expect(withCode).toEqual(Array.from({ length: withCode.length }, (_, i) => 12 - withCode.length + i)); // code for a run of the newest
    expect(text).not.toContain(cellsLeftOut(1).slice(0, 10));
  });
  it("when not even the outputs fit, the oldest cells are named in one line", () => {
    const cells = Array.from({ length: 40 }, (_, i) => c({ code: "x = 1", noteBefore: `cell ${i} ` + "words ".repeat(1_000) }));
    const { text } = noteContext("Q", cells);
    expect(text.length).toBeLessThanOrEqual(ASSISTANT_LIMITS.maxContextChars);
    expect(text).toMatch(/\[\d+ earlier code cells were left out to fit\.\]/);
    expect(text).toContain("cell 39 ");
  });
  it("one newest cell too long alone keeps its code's first lines, and still its output", () => {
    const { text } = noteContext("", [c({ code: "y = 2\n".repeat(30_000), stdout: "accuracy 0.97" })]);
    expect(text.length).toBeLessThanOrEqual(ASSISTANT_LIMITS.maxContextChars);
    expect(text.startsWith("```python\ny = 2\n")).toBe(true);
    expect(text).toContain(`${NOTE_CUT}\n\`\`\``);
    expect(text).toContain("accuracy 0.97");
  });
  it("a long note keeps what each run showed before code: outputs of older cells aren't dropped for the newest cell's code (the reported note)", () => {
    // Four 7,000-character cells (28,000 chars) in a smaller budget: the newest was stopped, the older ones have results.
    const cells = [0, 1, 2, 3].map((i) => c({ code: `# cell ${i}\n` + "z = 3\n".repeat(1_160), stdout: i < 3 ? `result of cell ${i}` : "", noResult: i === 3 ? "it was stopped before it finished" : undefined }));
    const { text } = noteContext("Do 4 layers beat 2?", cells, 16_000);
    expect(text.length).toBeLessThanOrEqual(16_000);
    for (const i of [0, 1, 2]) expect(text).toContain(`result of cell ${i}`);
    expect(text).toContain("No output to read: it was stopped before it finished.");
  });
});



describe("answers", () => {
  const py = "import math\nprint(math.pi)";
  const js = "const x = [1, 2].map((v) => v * 2);\nconsole.log(x);";
  it("a Python or R cell never gets web script back; what can't be told is let through", () => {
    expect(wrongLanguage("python", "x = 1")).toBe(false);
    expect(wrongLanguage("python", py)).toBe(false);
    expect(wrongLanguage("python", "import numpy as np\nf = lambda v: v * 2\nlet = 3")).toBe(false);
    expect(wrongLanguage("r", "library(dplyr)\nf <- function(x) { x + 1 }")).toBe(false);
    expect(wrongLanguage("r", "f <- function(x) {\n  x + 1\n}\nprint(f(1))")).toBe(false);
    expect(wrongLanguage("sql", js)).toBe(false); // only Python and R cells are checked
  });
});

describe("the assistant changes the note only through the agent, and never cell notes or the outcome", () => {
  it("the panel and the agent's logic and route touch no cell notes or outcome, and the database only for the conversation", () => {
    for (const file of ["components/notes/assistant-panel.tsx", "lib/ai/agent.ts", "app/api/agent/route.ts", "lib/server/llm.ts"]) {
      const code = src(file).replace(/^\s*\/\/.*$/gm, "");
      expect(code, file).not.toMatch(/updateNote|updateCell|saveCellNotes|saveLastRun|createCells|note_before\s*:|note_after\s*:|outcome:\s*["{]|\.from\(|lib\/run\/runner|runInBrowser/);
    }
  });
  it("clearing the conversation can't be undone, so it asks first", () => {
    const panel = src("components/notes/assistant-panel.tsx");
    const clear = panel.slice(panel.indexOf("async function clearAll()"));
    expect(clear.slice(0, clear.indexOf("clearAssistant("))).toContain("window.confirm(");
  });
  it("its data access writes only assistant_turns and deletes only its own rows", () => {
    const data = src("lib/data/index.ts");
    const part = data.slice(data.indexOf("// ------------------------------------------------------------------ assistant history"));
    expect(part.match(/\.from\("([a-z_]+)"\)/g)?.map((m) => m.slice(7, -2)).sort()).toEqual(["assistant_summaries", "assistant_summaries", "assistant_turns", "assistant_turns", "assistant_turns", "assistant_turns", "assistant_turns"]);
    expect(part).not.toMatch(/\.update\(|\.upsert\(|from\("(notes|cells)"\)/);
  });
  it("every request goes to the agent; the note screen gives it the note's cells and text", () => {
    const panel = src("components/notes/assistant-panel.tsx");
    expect(panel).toContain("await runAgent(run.request, liveNote,");
    expect(panel).not.toContain("requestAssistant");
    const view = src("components/notes/note-view.tsx");
    expect(view).toContain("<AssistantPanel noteId={note.id}");
    expect(view).toMatch(/setBody: async \(text\) => \{\s*notesNow\.current = text;\s*setNotes\(text\);/);
  });
  it("the top bar reads Assistant, then Preview/Edit, then More, like Android", () => {
    const view = src("components/notes/note-view.tsx");
    const at = ["<SaveIndicator />", "<IconChat className=\"size-4\" />", '{preview ? "Edit" : "Preview"}', "<MoreMenu"].map((s) => view.indexOf(s));
    expect(at[0]).toBeGreaterThan(0);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });
});


describe("history as sent", () => {
  it("the summary's newest lines and the last six answered turns, each cut, and their size counts against the note", () => {
    for (const k of HISTORY_CASES) {
      const h = assistantHistory(k.summary, k.turns);
      expect(h.summary.length, k.name).toBeLessThanOrEqual(ASSISTANT_HISTORY.maxSummaryChars);
      expect(h.turns.length, k.name).toBe(Math.min(6, k.turns.length));
    }
    const six = assistantHistory("", HISTORY_CASES[1]!.turns);
    expect(six.turns.map((t) => t.request)).toEqual(["request 2", "request 3", "request 4", "request 5", "request 6", "request 7"]);
    const cut = assistantHistory(HISTORY_CASES[2]!.summary, HISTORY_CASES[2]!.turns);
    expect(cut.summary).toBe("2026-10-01 Ask: what is lr — The learning rate.");
    expect(cut.turns[0]!.request).toHaveLength(ASSISTANT_HISTORY.maxTurnRequestChars);
    expect(cut.turns[0]!.request.endsWith("…")).toBe(true);
    expect(cut.turns[1]!.answer.kind === "code" && cut.turns[1]!.answer.code.length).toBe(ASSISTANT_HISTORY.maxTurnAnswerChars);
    const long = assistantHistory(HISTORY_CASES[3]!.summary, []);
    expect(HISTORY_CASES[3]!.summary.endsWith(long.summary)).toBe(true);
    expect(long.summary.startsWith("2026-")).toBe(true);
  });
  it("the history's size counts its summary and turns", () => {
    const history = assistantHistory("s".repeat(1000), [{ task: "ask", request: "q", answer: { kind: "prose", text: "a" } }]);
    expect(historySize(history)).toBe(1002);
  });
});

describe("error text", () => {
  it("names the assistant", () => {
    expect(messageFor("rate_limited", "assistant", 120)).toBe("The Assistant has hit its limit for now. Try again in 2 minutes.");
    expect(messageFor("server", "assistant")).toBe("The Assistant couldn’t finish. Something went wrong on our side. Try again in a moment.");
    expect(messageFor("offline", "assistant")).toBe("The Assistant couldn’t finish. You seem to be offline. Check your connection and try again.");
  });
});

describe("following up on a run (the loop: propose, insert, run, read what happened)", () => {
  const ran = (over: Partial<LastRun>) => run({ ran_at: "2026-11-18T10:00:00.000Z", ...over });

  it("finds the cell that ran last", () => {
    const cells = [row({ content: "a", last_run: ran({ ran_at: "2026-11-18T10:00:00.000Z" }) }), row({ content: "b", last_run: ran({ ran_at: "2026-11-18T11:00:00.000Z", outcome: "error" }) }), row({ content: "c" })];
    expect(latestRun(cells.map((s, i) => ({ ...s, filename: `f${i}.py` })))).toEqual({ index: 1, filename: "f1.py", ended: "error", ranAt: "2026-11-18T11:00:00.000Z", code: "b" });
    expect(latestRun([row({})].map((s) => ({ ...s, filename: "" })))).toBeNull();
  });

  it("a failed run newer than the conversation offers the fix; nothing once the conversation is newer", () => {
    const r = { index: 2, filename: "train.py", ended: "error" as const, ranAt: "2026-11-18T10:00:00.000Z", code: "1/0" };
    expect(followUps(r)).toEqual([{ label: "Cell 3 failed: fix it", request: "I ran cell 3 (train.py) and it failed. What went wrong, and how do I fix it?" }]);
    expect(followUps(null)).toEqual([]);
  });

  it("a run that worked offers what it shows and what next", () => {
    const r = { index: 0, filename: "", ended: "ok" as const, ranAt: "2026-11-18T10:00:00.000Z", code: "plot()\n" };
    const offers = followUps(r);
    expect(offers.map((o) => o.label)).toEqual(["What does cell 1 show?", "What next?"]);
    expect(offers[0]!.request).toBe("I just ran cell 1. What do the results show? Be specific about the numbers.");
    expect(followUps({ ...r, ended: "stopped" })).toEqual([]);
    expect(followUps({ ...r, ended: "timeout" })[0]!.label).toBe("Cell 1 timed out: fix it");
  });


  it("the panel shows the follow-ups and sends them like any request (one tap, never by itself)", () => {
    const panel = src("components/notes/assistant-panel.tsx");
    expect(panel).toContain("recent.map((f) =>");
    expect(panel).toContain("onClick={() => void send(f.request)}");
    expect(panel).not.toMatch(/useEffect\([^)]*send\(/s);
    expect(src("components/notes/note-view.tsx")).toContain("latest={latestRun(cells ?? [])}");
  });
});


describe("the assistant writes into the note when asked", () => {
  const body = "Does depth help?\n\n**Result** *(after the runs)*\n\n## Method\nTwo spirals.";
  it("puts the text under the line it names, Markdown and case aside, else at the end", () => {
    expect(placeNoteText(body, { text: "Depth doesn't help.", after: "Result (after the runs)" })).toEqual({
      body: "Does depth help?\n\n**Result** *(after the runs)*\n\nDepth doesn't help.\n\n## Method\nTwo spirals.",
      under: "**Result** *(after the runs)*",
    });
    expect(placeNoteText(body, { text: "x", after: "result" }).under).toBe("**Result** *(after the runs)*"); // a line that starts with it
    expect(placeNoteText(body, { text: "Ends here.", after: "" })).toEqual({ body: `${body}\n\nEnds here.\n`, under: null });
    expect(placeNoteText(body, { text: "Ends here.", after: "No such line" }).under).toBeNull();
    expect(placeNoteText("", { text: "First.", after: "" }).body).toBe("First.\n");
  });
  it("Undo takes exactly that text out again", () => {
    const w = { text: "Depth doesn't help.", after: "Result" };
    expect(removeNoteText(placeNoteText(body, w).body, w.text)).toBe(body);
    const end = { text: "Ends here.", after: "" };
    expect(removeNoteText(placeNoteText(body, end).body, end.text).trimEnd()).toBe(body);
    expect(removeNoteText("edited away", w.text)).toBe("edited away");
  });
  it("what it wrote goes back with the history, cut to its budget", () => {
    const h = assistantHistory("", [{ task: "ask", request: "Insert it", answer: { kind: "prose", text: "Added.", write: { text: "x".repeat(5_000), after: "" } } }]);
    expect(h.turns[0]!.answer.wrote).toHaveLength(ASSISTANT_HISTORY.maxTurnAnswerChars);
  });
});

describe("a reply cut at the length limit", () => {
  it("salvages the message so far, saying where it stopped; nothing when no message began", () => {
    expect(salvageAssistantAnswer('{"message":"Line one\\nline \\"two\\" \\u00e9')).toEqual({ kind: "prose", text: `Line one\nline "two" é…\n\n${CUT_NOTE}` });
    expect((salvageAssistantAnswer('{"message":"Done.","code":"import num') as { text: string }).text).toMatch(/^Done\.\n\n\*Its code or note text was too long/);
    expect(salvageAssistantAnswer('{"code":"print(')).toBeNull();
  });
});

describe("one Send button: the model decides to answer or to hand the work to the agent", () => {
  it("the panel has one Send button; the microphone goes the same way", () => {
    const panel = src("components/notes/assistant-panel.tsx");
    expect(panel).not.toMatch(/>\s*Do it\s*</);
    expect(panel).toContain("useSpeech((text) => void send(text, true))");
  });
});
