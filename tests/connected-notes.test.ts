// Step 3 of the context graph: connected notes. The agent finds the user's other notes, reads their
// graphs, and asks their own agents, which answer from their note and can't change it.
import { describe, expect, it, vi } from "vitest";
import { AGENT_TOOLS, NOTES_REACH, NOTES_RULE, READ_ONLY_NOTE, agentRules, askNoteRequest, makeCall, parseAgentReply, readNativeReply, runAgent, type AgentCell, type AgentNote, type AgentReply, type AgentRequest, type NoteSummary, type OtherNotes, type Reach } from "@/lib/ai/agent";
import { noteGraph } from "@/lib/ai/assistant";
import { codeHash } from "@/lib/run/last-run";

const ID = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;
const cell = (id: string, content: string, stdout = ""): AgentCell => ({ id, language: "python", content, note_before: "", note_after: "", last_run: stdout ? { outcome: "ok", stdout, stderr: "", error_line: null, line: null, ms: 40, where: "browser", code_hash: codeHash(content), ran_at: "2026-11-19T10:00:00.000Z" } : null });

const NOTES: Record<string, { summary: NoteSummary; title: string; body: string; cells: AgentCell[]; outcome: "success" | "failed" | null }> = {
  [ID(1)]: { summary: { id: ID(1), title: "Annealing at 600 C", outcome: "success", updated_at: "2026-11-18T09:00:00.000Z", why: "linked from this note" }, title: "Annealing at 600 C", body: "**Result** Mean grain size 9.3 nm.", cells: [cell("x1", "# Potts model\nprint('mean d 9.3')", "mean d 9.3\n")], outcome: "success" },
  [ID(2)]: { summary: { id: ID(2), title: "Old attempt", outcome: "failed", updated_at: "2026-11-10T09:00:00.000Z" }, title: "Old attempt", body: "", cells: [], outcome: "failed" },
};

function others(): OtherNotes & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    find: async (q) => (queries.push(q), q === "nothing" ? [] : Object.values(NOTES).map((n) => n.summary)),
    open: async (id) => (NOTES[id] ? { title: NOTES[id].title, body: NOTES[id].body, cells: NOTES[id].cells, outcome: NOTES[id].outcome } : null),
  };
}

const plainNote = (o?: OtherNotes): AgentNote => ({
  read: async () => ({ title: "Grain growth", body: "See [[Annealing at 600 C|" + ID(1) + "]].", cells: [] }),
  add: async () => "x",
  setCode: async () => {},
  run: async () => {},
  remove: async () => {},
  setBody: async () => {},
  ...(o ? { others: o } : {}),
});
const reachOf = (o: OtherNotes, ask: Reach["ask"] = async () => ({ message: "", calls: [], done: true })): Reach => ({ others: o, refs: new Map(), ask, budget: { left: NOTES_REACH.budget }, depth: 0, path: [], from: "Grain growth" });
const undo = () => ({ added: [], changed: [], note: [] });

describe("the tools", () => {
  it("are given to the model and named in the rules", () => {
    const names = AGENT_TOOLS.map((t) => t.function.name);
    expect(names).toEqual(expect.arrayContaining(["find_notes", "read_note", "ask_note", "propose_change"]));
    expect(agentRules("python")).toContain(NOTES_RULE);
    expect(agentRules("python")).toContain("find_notes, read_note, ask_note, propose_change");
  });
  it("are read from native calls; references are N and a number", () => {
    const r = readNativeReply("python", "", [
      { id: "1", type: "function", function: { name: "find_notes", arguments: '{"query":"annealing"}' } },
      { id: "2", type: "function", function: { name: "read_note", arguments: '{"note":"n1"}' } },
      { id: "3", type: "function", function: { name: "ask_note", arguments: '{"note":"N2","question":"What failed?"}' } },
      { id: "4", type: "function", function: { name: "read_note", arguments: '{"note":"Annealing"}' } },
    ]);
    expect(r.calls).toEqual([{ tool: "find_notes", query: "annealing" }, { tool: "read_note", note: "N1" }, { tool: "ask_note", note: "N2", question: "What failed?" }]);
    expect(r.problems?.[0]).toContain("read_note call wasn't made");
    expect(parseAgentReply("python", JSON.stringify({ message: "x", calls: [{ tool: "find_notes" }] })).calls).toEqual([{ tool: "find_notes", query: "" }]);
  });
});

describe("find_notes and read_note", () => {
  it("list notes with references, kept for the request", async () => {
    const o = others();
    const reach = reachOf(o);
    const { result, action } = await makeCall({ tool: "find_notes", query: "" }, plainNote(o), undo(), undefined, reach);
    expect(result).toContain('N1 · "Annealing at 600 C" · Successful · edited 2026-11-18 · linked from this note');
    expect(result).toContain('N2 · "Old attempt" · Failed · edited 2026-11-10');
    expect(action.text).toBe("Looked for notes · 2 found");
    // Found again: the same references.
    await makeCall({ tool: "find_notes", query: "attempt" }, plainNote(o), undo(), undefined, reach);
    expect([...reach.refs.keys()]).toEqual(["N1", "N2"]);
    expect((await makeCall({ tool: "find_notes", query: "nothing" }, plainNote(o), undo(), undefined, reach)).result).toBe('No other notes about "nothing".');
  });
  it("read_note gives that note's graph, without asking the AI", async () => {
    const o = others();
    const ask = vi.fn();
    const reach = reachOf(o, ask);
    await makeCall({ tool: "find_notes", query: "" }, plainNote(o), undo(), undefined, reach);
    const { result } = await makeCall({ tool: "read_note", note: "N1" }, plainNote(o), undo(), undefined, reach);
    const n = NOTES[ID(1)]!;
    expect(result).toBe(`Note N1 "Annealing at 600 C":\n${noteGraph(n.title, n.body, n.outcome, n.cells)}`);
    expect(result).toContain("printed: mean d 9.3");
    expect(ask).not.toHaveBeenCalled();
  });
  it("an unknown reference, or no other notes here, is said plainly", async () => {
    const o = others();
    expect((await makeCall({ tool: "read_note", note: "N7" }, plainNote(o), undo(), undefined, reachOf(o))).result).toContain("There is no note N7");
    expect((await makeCall({ tool: "find_notes", query: "" }, plainNote(), undo())).result).toContain("can't be reached");
  });
});

describe("ask_note: that note's own agent answers", () => {
  it("on that note, read only, in a few steps, and its answer comes back", async () => {
    const o = others();
    const bodies: AgentRequest[] = [];
    const ask = vi.fn(async (body: AgentRequest): Promise<AgentReply> => {
      bodies.push(body);
      // It tries to change the note first; that is refused, then it answers.
      if (bodies.length === 1) return { message: "", calls: [{ tool: "edit_cell", cell: 1, code: "print(1)" }], done: false };
      return { message: "Mean grain size reached 9.3 nm (cell 1); the note is marked Successful.", calls: [], done: true, finished: true };
    });
    const reach = reachOf(o, ask);
    await makeCall({ tool: "find_notes", query: "" }, plainNote(o), undo(), undefined, reach);
    const { result, action } = await makeCall({ tool: "ask_note", note: "N1", question: "What grain size did it reach?" }, plainNote(o), undo(), undefined, reach);
    expect(bodies[0]!.title).toBe("Annealing at 600 C");
    expect(bodies[0]!.request).toBe(askNoteRequest("What grain size did it reach?", "Grain growth"));
    expect(bodies[0]!.note).toContain("<graph>");
    expect(JSON.stringify(bodies[1]!.steps)).toContain(READ_ONLY_NOTE.slice(0, 40));
    expect(NOTES[ID(1)]!.cells[0]!.content).toContain("Potts");
    expect(result).toBe('Note N1 "Annealing at 600 C" answers: Mean grain size reached 9.3 nm (cell 1); the note is marked Successful.');
    expect(action.text).toBe('Asked note "Annealing at 600 C"');
  });
  it("every ask draws on one budget of AI requests for the request; when it's spent, it says so", async () => {
    const o = others();
    const ask = vi.fn(async (): Promise<AgentReply> => ({ message: "Looking.", calls: [{ tool: "edit_cell", cell: 1, code: `print(${Math.random()})` }], done: false }));
    const reach = reachOf(o, ask);
    await makeCall({ tool: "find_notes", query: "" }, plainNote(o), undo(), undefined, reach);
    let last = "";
    for (let i = 0; i < 6; i++) last = (await makeCall({ tool: "ask_note", note: "N2", question: `Why ${i}?` }, plainNote(o), undo(), undefined, reach)).result;
    expect(ask.mock.calls.length).toBeLessThanOrEqual(NOTES_REACH.budget);
    expect(reach.budget.left).toBeLessThan(2);
    expect(last).toContain("used up for this request");
    const calls = ask.mock.calls.length;
    await makeCall({ tool: "ask_note", note: "N1", question: "x" }, plainNote(o), undo(), undefined, reach);
    expect(ask).toHaveBeenCalledTimes(calls);
  });
  it("the asked note can ask one note further, never back along the chain, and no further than that", async () => {
    const o = others();
    const seen: { depth: number; results: string[] }[] = [];
    const ask = vi.fn(async (body: AgentRequest): Promise<AgentReply> => {
      const depth = body.request.includes('("Old attempt")') ? 2 : 1;
      const step = body.steps.length;
      if (step === 0) return { message: "", calls: [{ tool: "find_notes", query: "" }], done: false };
      seen.push({ depth, results: body.steps.flatMap((s) => s.results) });
      if (depth === 1 && step === 1) return { message: "", calls: [{ tool: "ask_note", note: "N1", question: "and you?" }], done: false };
      return { message: `Answer at depth ${depth}.`, calls: [], done: true, finished: true };
    });
    const reach = reachOf(o, ask);
    await makeCall({ tool: "find_notes", query: "" }, plainNote(o), undo(), undefined, reach);
    const { result } = await makeCall({ tool: "ask_note", note: "N2", question: "x" }, plainNote(o), undo(), undefined, reach);
    expect(result).toContain("answers: Answer at depth 1.");
    // N2 (Old attempt) found notes without itself, and asked Annealing, which answered.
    expect(seen[0]!.results[0]).not.toContain("Old attempt");
    expect(seen.find((x) => x.depth === 1 && x.results.some((r) => r.includes("Answer at depth 2.")))).toBeTruthy();
    // Annealing, two deep, can't reach further notes.
    expect(seen.find((x) => x.depth === 2)!.results[0]).toContain("can't be reached");
  });
});

describe("propose_change", () => {
  it("proposes text for another note, placed under one of its lines; nothing changes until Apply", async () => {
    const o = others();
    const reach = reachOf(o);
    await makeCall({ tool: "find_notes", query: "" }, plainNote(o), undo(), undefined, reach);
    const ok = await makeCall({ tool: "propose_change", note: "N1", after: "**Result** Mean grain size 9.3 nm.", text: "See also [[Grain growth]]." }, plainNote(o), undo(), undefined, reach);
    expect(ok.result).toContain("until the user taps Apply");
    expect(ok.action.detail).toEqual({ kind: "proposal", noteId: ID(1), title: "Annealing at 600 C", after: "**Result** Mean grain size 9.3 nm.", text: "See also [[Grain growth]]." });
    expect(NOTES[ID(1)]!.body).toBe("**Result** Mean grain size 9.3 nm.");
    const bad = await makeCall({ tool: "propose_change", note: "N1", after: "No such line", text: "x" }, plainNote(o), undo(), undefined, reach);
    expect(bad.result).toContain('has no line "No such line"');
    const nested = await makeCall({ tool: "propose_change", note: "N1", after: "", text: "x" }, plainNote(o), undo(), undefined, { ...reach, depth: 1 });
    expect(nested.result).toContain("Only the note the user is working in");
  });
  it("is read from native calls, and a saved proposal reads back", async () => {
    const r = readNativeReply("python", "", [{ id: "1", type: "function", function: { name: "propose_change", arguments: '{"note":"n1","after":"","text":"Add this."}' } }]);
    expect(r.calls).toEqual([{ tool: "propose_change", note: "N1", after: "", text: "Add this." }]);
    const { actionDetail } = await import("@/lib/ai/assistant");
    expect(actionDetail.safeParse({ kind: "proposal", noteId: ID(1), title: "A", after: "", text: "Add this.", applied: true }).success).toBe(true);
  });
});

describe("in the whole loop", () => {
  it("the note's own agent finds, reads and answers", async () => {
    const o = others();
    const replies: AgentReply[] = [
      { message: "Looking.", calls: [{ tool: "find_notes", query: "" }], done: false },
      { message: "Reading it.", calls: [{ tool: "read_note", note: "N1" }], done: false },
      { message: "The earlier run reached 9.3 nm (note Annealing at 600 C).", calls: [], done: true, finished: true },
    ];
    const ask = vi.fn(async (): Promise<AgentReply> => replies.shift()!);
    const states: string[] = [];
    const final = await runAgent("how does this compare with the annealing note?", plainNote(o), ask, (s) => void (s.status === "working" && states.push(s.doing)), undo(), new AbortController().signal);
    expect(final.status).toBe("done");
    expect(final.steps.flatMap((s) => s.actions.map((a) => a.text))).toEqual(["Looked for notes · 2 found", 'Read note "Annealing at 600 C"']);
    expect(states).toContain("Looking through your notes…");
  });
});

describe("other notes are only read", () => {
  it("the data functions behind find_notes and read_note never write", async () => {
    const { readFileSync } = await import("node:fs");
    const data = readFileSync("src/lib/data/index.ts", "utf8");
    const start = data.indexOf("// ------------------------------------------------------------------ other notes, for the Assistant");
    const part = data.slice(start, data.indexOf("// ------------------------------------------------------------------", start + 10));
    expect(part).toContain("export async function findOtherNotes");
    expect(part).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });
});

describe("the graph names linked notes", () => {
  it("as titles, never raw link markup", () => {
    const g = noteGraph("Grain growth", `**Question** Does it match [[Annealing at 600 C|${ID(1)}]]?\n\nSee also [[Old attempt]].`, null, []);
    expect(g).toContain("Question: Does it match Annealing at 600 C?");
    expect(g).toContain("Links to: Annealing at 600 C; Old attempt");
    expect(g).not.toContain(ID(1));
  });
});

describe("which notes find_notes lists", () => {
  it("linked first, then the parent, the notes under it, then the newest", async () => {
    const { rankOtherNotes } = await import("@/lib/notes/other-notes");
    const { OTHER_NOTES_CASES } = await import("./fixtures/other-notes");
    const [first, cap, search, none, fused, near] = OTHER_NOTES_CASES.map((c) => rankOtherNotes(c.from, c.rows, c.matched, c.max, c.similar));
    expect(first!.map((n) => `${n.title}${n.why ? ` (${n.why})` : ""}`)).toEqual([
      "Note 5 (linked from this note)",
      "Note 3 (linked from this note)",
      "Note 2 (this note's parent)",
      "Note 6 (a note under this one)",
      "Note 7 (a note under this one)",
      "Note 4",
      "Note 8",
    ]);
    expect(cap!.map((n) => n.title)).toEqual(["Note 4", "Note 3"]);
    expect(search!.map((n) => n.title)).toEqual(["Note 3", "Note 2"]);
    expect(none).toEqual([]);
    // Note 3 is found by words (2nd) and meaning (2nd); 2 by words first; 5 by meaning first.
    expect(fused!.map((n) => `${n.title} (${n.why})`)).toEqual(["Note 3 (matches)", "Note 2 (matches)", "Note 5 (close in meaning)", "Note 4 (matches)", "Note 6 (close in meaning)"]);
    expect(near!.map((n) => `${n.title}${n.why ? ` (${n.why})` : ""}`)).toEqual(["Note 2 (linked from this note)", "Note 3 (a note under this one)", "Note 6 (close in meaning to this note)", "Note 4", "Note 5"]);
  });
});
