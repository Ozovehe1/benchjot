// The voice agent's pure parts (lib/ai/agent.ts): reading a step's reply, the prompts, what a run
// reports back, and the loop itself on a fake note (add, change, run, Undo, Stop, the step cap).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { firstObject } from "@/lib/ai/fix";
import { AGENT_CHECKS, AGENT_TOOLS, AGENT_LIMITS, AGENT_PATIENCE, CUT_RESULT, SLOW_RESULT, agentClock, passingFailure, retryWait, salvageAgentReply, HONEST_RULE, RUNTIME_RULE, agentCells, agentMessages, hasChanges, keptChanges, undoFromKept, agentRequest, agentRules, agentSummary, fakeSmell, makeCall, parseAgentReply, runAgent, runReport, sentStep, undoAgent, type AgentNote, type AgentReply, type AgentCell, type AgentState, type AgentUndo } from "@/lib/ai/agent";
import type { LastRun } from "@/lib/notes/schemas";
import { codeHash } from "@/lib/run/last-run";

const run = (outcome: LastRun["outcome"], extra: Partial<LastRun> = {}): LastRun => ({ outcome, stdout: "", stderr: "", error_line: null, line: null, ms: 1234, where: "browser", code_hash: "h", ran_at: "2026-11-19T10:00:00.000Z", ...extra });
const cell = (id: string, content: string, last_run: LastRun | null = null, language = "python"): AgentCell => ({ id, language, content, last_run, note_before: "", note_after: "" });

describe("reading a step", () => {
  it("keeps the calls that fit a tool, in order, and a step with calls always goes on", () => {
    const r = parseAgentReply("python", JSON.stringify({ message: "Writing it.", calls: [{ tool: "add_cell", language: "python", code: "print(1)\r\n\n" }, { tool: "run_cell", cell: 2 }, { tool: "rm_rf" }], done: true }));
    expect(r).toMatchObject({ message: "Writing it.", calls: [{ tool: "add_cell", language: "python", code: "print(1)" }, { tool: "run_cell", cell: 2 }], done: false });
    // A call that isn't a tool goes back to the agent to fix, instead of ending the request.
    expect(r.problems).toEqual(["A rm_rf call wasn't made: its arguments didn't fit the tool. Check them and make it again."]);
  });
  it("a reply with nothing at all is refused; a call that doesn't fit is told back, not thrown", () => {
    expect(parseAgentReply("python", '{"message": "Accuracy is 0.97.", "calls": [], "done": true}')).toEqual({ message: "Accuracy is 0.97.", calls: [], done: true });
    expect(() => parseAgentReply("python", '{"message": "", "calls": []}')).toThrow("didn’t say what to do");
    expect(parseAgentReply("python", '{"message": "x", "calls": [{"tool": "nope"}]}').problems).toHaveLength(1);
  });
  it("an unknown language falls back to the note's; web script in a Python cell is refused", () => {
    expect(parseAgentReply("r", JSON.stringify({ message: "", calls: [{ tool: "add_cell", language: "klingon", code: "x <- 1" }] })).calls[0]).toEqual({ tool: "add_cell", language: "r", code: "x <- 1" });
    const wrong = parseAgentReply("python", JSON.stringify({ message: "", calls: [{ tool: "add_cell", language: "python", code: "const x = 1;\nconsole.log(x)" }] }));
    expect(wrong.calls).toEqual([]);
    expect(wrong.problems).toEqual(["add_cell wasn't made: its code isn't Python. Write it in Python."]);
  });
  it("at most callsPerStep calls a step", () => {
    const calls = Array.from({ length: 9 }, (_, i) => ({ tool: "run_cell", cell: i + 1 }));
    expect(parseAgentReply("python", JSON.stringify({ message: "go", calls })).calls).toHaveLength(AGENT_LIMITS.callsPerStep);
  });
});

describe("the prompts", () => {
  const base = { request: "plot the loss", language: "python", title: "Warmup", note: "body", steps: [] };
  it("first step: the request, then the note as it is now", () => {
    const m = agentMessages(agentRequest.parse(base));
    expect(m.map((x) => x.role)).toEqual(["system", "user"]);
    expect(m[0]!.content).toContain("add_cell");
    expect(m[0]!.content).toContain("Never write a tool call, JSON or code meant for a cell in your text");
    expect(AGENT_TOOLS.map((t) => t.function.name)).toEqual(["add_cell", "edit_cell", "run_cell", "delete_cell", "write_note", "replace_note", "find_notes", "read_note", "ask_note", "propose_change", "list_data", "save_data", "find_datasets", "set_plan", "finish"]);
    expect(m[1]!.content).toMatch(/^Request: plot the loss\n\nThe note as it is now:\n<note title="Warmup">\nbody\n<\/note>/);
  });
  it("later steps: each step and its results, the note after the last results, and the request again", () => {
    const steps = [sentStep({ message: "Adding it.", calls: [{ tool: "add_cell", language: "python", code: "x".repeat(5000) }], results: ["Added cell 1 (Python)."] })];
    expect(steps[0]!.calls[0]).toMatchObject({ code: expect.stringMatching(/^x{1499}…$/) });
    const m = agentMessages(agentRequest.parse({ ...base, steps }));
    // Native tool calling: the step is the agent's tool call, its result a tool message, then the note now.
    expect(m.map((x) => x.role)).toEqual(["system", "user", "assistant", "tool", "user"]);
    expect(m[2]).toMatchObject({ role: "assistant", content: "Adding it.", tool_calls: [{ id: "s0c0", type: "function", function: { name: "add_cell" } }] });
    expect(JSON.parse((m[2] as { tool_calls: { function: { arguments: string } }[] }).tool_calls[0]!.function.arguments)).toMatchObject({ language: "python" });
    expect(m[3]).toEqual({ role: "tool", tool_call_id: "s0c0", content: "Added cell 1 (Python)." });
    expect(m[4]!.content).toMatch(/^The note as it is now:/);
    expect(m[4]!.content).toMatch(/Continue the request: plot the loss$/);
  });
  it("cells are numbered as the agent refers to them", () => {
    expect(agentCells([cell("a", "print(1)"), cell("b", "print(2)")]).map((c) => c.label)).toEqual(["[Cell 1]", "[Cell 2]"]);
  });
});

describe("what a run reports back", () => {
  it("how it ended, its output, what it made and its error", () => {
    expect(runReport(2, cell("a", "print(1)", run("ok", { stdout: "acc 0.97\n" })))).toBe("Cell 2 ran without error in 1.2 s.\nOutput:\n```\nacc 0.97\n```");
    expect(runReport(1, cell("a", "1/0", run("error", { error_line: "ZeroDivisionError: division by zero", ms: 40 })))).toBe("Cell 1 failed after 40 ms.\nError:\n```\nZeroDivisionError: division by zero\n```");
    expect(runReport(3, cell("a", "x = 1", run("ok")))).toBe("Cell 3 ran without error in 1.2 s.\nIt printed nothing.");
    expect(runReport(1, cell("a", "x"))).toMatch(/wasn't saved/);
    expect(runReport(1, cell("a", "x", run("ok", { stdout: "y".repeat(50_000) }))).length).toBeLessThanOrEqual(AGENT_LIMITS.maxResultChars);
  });
});

/** A note in memory: cells by id; a run of code containing "boom" fails. */
function fakeNote(initial: AgentCell[] = [], body = "body") {
  const cells = [...initial];
  const text = { body };
  let next = 1;
  const note: AgentNote = {
    read: async () => ({ title: "T", body: text.body, cells: cells.map((c) => ({ ...c })) }),
    setBody: async (t) => void (text.body = t),
    add: async (language, code) => {
      const id = `new${next++}`;
      cells.push(cell(id, code, null, language));
      return id;
    },
    setCode: async (id, code) => void (cells.find((c) => c.id === id)!.content = code),
    run: async (id) => {
      const c = cells.find((x) => x.id === id)!;
      c.last_run = c.content.includes("boom") ? run("error", { error_line: "NameError: boom", code_hash: codeHash(c.content) }) : run("ok", { stdout: `ran ${c.content}\n`, code_hash: codeHash(c.content) });
    },
    remove: async (id) => void cells.splice(cells.findIndex((c) => c.id === id), 1),
  };
  return { note, cells, text };
}

const scripted = (replies: AgentReply[]) => {
  const bodies: unknown[] = [];
  // A scripted reply that says it's done has called finish (native tools).
  const finish = (r: AgentReply): AgentReply => (r.done && !r.calls.length && !r.cut ? { ...r, finished: true } : r);
  return { bodies, ask: async (body: unknown) => (bodies.push(body), finish(replies.shift() ?? { message: "Done.", calls: [], done: true })) };
};

describe("the loop", () => {
  it("adds, runs, reads the error, fixes it, runs again, and finishes; Undo puts the note back", async () => {
    const { note, cells } = fakeNote([cell("u1", "print('mine')")]);
    const { ask, bodies } = scripted([
      { message: "Writing it.", calls: [{ tool: "add_cell", language: "python", code: "boom" }, { tool: "run_cell", cell: 2 }], done: false },
      { message: "Fixing the name.", calls: [{ tool: "edit_cell", cell: 2, code: "print(2)" }, { tool: "run_cell", cell: 2 }], done: false },
      { message: "It prints 2.", calls: [], done: true },
    ]);
    const states: AgentState[] = [];
    const undo: AgentUndo = { added: [], changed: [], note: [] };
    const end = await runAgent("print two", note, ask, (s) => states.push(s), undo, new AbortController().signal);
    expect(end.status).toBe("done");
    expect(end.steps.map((s) => s.actions.map((a) => [a.text, a.tone]))).toEqual([[["Added cell 2 · Python", "plain"], ["Ran cell 2 · failed: NameError: boom", "fail"]], [["Changed cell 2", "plain"], ["Ran cell 2 · 1.2 s", "ok"]], []]);
    expect(cells.map((c) => c.content)).toEqual(["print('mine')", "print(2)"]);
    // The second step saw the first one's results, and the note as it was then.
    const second = bodies[1] as { steps: { results: string[] }[]; note: string };
    expect(second.steps[0]!.results[1]).toContain("NameError: boom");
    expect(second.note).toContain("[Cell 2 · you wrote this cell]"); // it knows which cells are its own
    expect(second.note).toContain("[Cell 1]\n");
    expect(states.some((s) => s.status === "working" && s.doing === "Running cell 2…")).toBe(true);
    expect(undo).toEqual({ added: ["new1"], changed: [], note: [] }); // its own cell's edits need no separate undo
    expect(agentSummary(end.steps)).toBe("Done in the note: Added cell 2 · Python; Ran cell 2 · failed: NameError: boom; Changed cell 2; Ran cell 2 · 1.2 s.\n\nIt prints 2.");
    await undoAgent(note, undo);
    expect(cells.map((c) => c.content)).toEqual(["print('mine')"]);
  });

  it("changing the user's own cell is undone back to their code", async () => {
    const { note, cells } = fakeNote([cell("u1", "print('mine')")]);
    const undo: AgentUndo = { added: [], changed: [], note: [] };
    await makeCall({ tool: "edit_cell", cell: 1, code: "print('agent')" }, note, undo);
    await makeCall({ tool: "edit_cell", cell: 1, code: "print('again')" }, note, undo);
    expect(undo.changed).toEqual([{ id: "u1", code: "print('mine')" }]);
    await undoAgent(note, undo);
    expect(cells[0]!.content).toBe("print('mine')");
  });

  it("a call on a cell that isn't there, or one that fails, goes back to the agent as its result", async () => {
    const { note } = fakeNote();
    const undo: AgentUndo = { added: [], changed: [], note: [] };
    expect(await makeCall({ tool: "run_cell", cell: 4 }, note, undo)).toEqual({ result: "There is no cell 4; the note has 0 code cells.", action: { text: "No cell 4", tone: "fail" } });
    const broken = { ...note, add: async () => Promise.reject(new Error("the new cell didn't appear")) };
    expect(await makeCall({ tool: "add_cell", language: "python", code: "x" }, broken, undo)).toEqual({ result: "That call failed: the new cell didn't appear", action: { text: "Writing a Python cell failed", tone: "fail" } });
  });

  it("Stop ends it before the next call; the step cap ends a request that never finishes", async () => {
    const { note } = fakeNote([cell("u1", "x")]);
    const ctrl = new AbortController();
    const once = { message: "Running.", calls: [{ tool: "run_cell" as const, cell: 1 }, { tool: "run_cell" as const, cell: 1 }], done: false };
    const stopped = await runAgent("go", { ...note, run: async () => ctrl.abort() }, async () => once, () => {}, { added: [], changed: [], note: [] }, ctrl.signal);
    expect(stopped.status).toBe("stopped");
    expect(stopped.steps[0]!.actions).toHaveLength(1);

    // Real long work changes something each step (a repeated step is a loop, stopped by loopGuard).
    let asked = 0;
    const capped = await runAgent("go", note, async () => (asked++, { message: "Trying.", calls: [{ tool: "edit_cell" as const, cell: 1, code: `print(${asked})` }, { tool: "run_cell" as const, cell: 1 }], done: false }), () => {}, { added: [], changed: [], note: [] }, new AbortController().signal);
    expect(asked).toBe(AGENT_PATIENCE.maxSteps);
    expect(capped.status).toBe("done"); // its last step is told to finish: it ends with an answer, never "go on"
    expect(capped.steps.at(-1)!.actions).toHaveLength(0);
  });

  it("a failed step throws with the steps so far, for the panel to show", async () => {
    const { note } = fakeNote();
    const err = await runAgent("go", note, async () => Promise.reject(new Error("429")), () => {}, { added: [], changed: [], note: [] }, new AbortController().signal).catch((e: unknown) => e);
    expect(err).toMatchObject({ message: "429", steps: [] });
  });
});

describe("the request as sent", () => {
  it("note and steps together stay within the reading budget", () => {
    const big = { request: "x", language: "python", title: "", note: "n".repeat(99_000), steps: [sentStep({ message: "m", calls: [], results: ["r".repeat(2_000)] })] };
    expect(agentRequest.safeParse(big).success).toBe(false);
    expect(agentRequest.safeParse({ ...big, note: "n".repeat(90_000) }).success).toBe(true);
  });
});

describe("the agent never fakes a result (the reported placeholder figures)", () => {
  it("code that draws placeholders, swallows errors or looks for other cells' variables isn't put in the note", async () => {
    const reported = 'try:\n    net2 = nets["spirals"]\nexcept NameError:\n    net2 = None\nax.set_title("Spiral boundaries (placeholder)")';
    expect(fakeSmell(reported)).not.toBeNull();
    expect(fakeSmell("try:\n    x = load()\nexcept Exception:\n    pass")).toMatch(/carries on/);
    expect(fakeSmell("if 'nets' in globals():\n    use(nets)")).toMatch(/other cells/);
    expect(fakeSmell("import numpy as np\nprint(np.mean([1, 2]))")).toBeNull();
    const { note, cells } = fakeNote();
    const undo: AgentUndo = { added: [], changed: [], note: [] };
    const r = await makeCall({ tool: "add_cell", language: "python", code: reported }, note, undo);
    expect(r.result).toMatch(/^Not put in the note/);
    expect(cells).toHaveLength(0);
  });

  it("it can't finish while a cell it wrote hasn't run cleanly: it's sent back once", async () => {
    const { note } = fakeNote();
    const { ask, bodies } = scripted([
      { message: "Adding it.", calls: [{ tool: "add_cell", language: "python", code: "boom" }], done: false },
      { message: "Done!", calls: [], done: true },
      ...Array.from({ length: 3 }, () => ({ message: "It can't run: boom isn't defined anywhere.", calls: [], done: true })),
    ]);
    const end = await runAgent("go", note, ask, () => {}, { added: [], changed: [], note: [] }, new AbortController().signal);
    expect(end.status).toBe("done");
    const third = bodies[2] as { steps: { results: string[] }[] };
    expect(third.steps.at(-1)!.results[0]).toMatch(/^Not finished: cell 1 hasn't been run/);
    // Sent back each time it tries to finish (AGENT_CHECKS.checks), then it ends saying plainly what isn't done.
    expect(bodies).toHaveLength(2 + AGENT_CHECKS.checks);
    expect(end.steps.at(-1)!.message).toMatch(/can't run/);
    expect(end.steps.at(-1)!.message).toMatch(/\*\*Not finished:\*\* cell 1 hasn't been run/);
  });

  it("the rules say how cells run and forbid faking; a bigger job starts with a plan", () => {
    const rules = agentRules("python");
    for (const words of [RUNTIME_RULE, HONEST_RULE, "fresh process", "call set_plan in your first reply", "call finish", "Ask one short question only when you truly can't tell"]) expect(rules).toContain(words);
    expect(rules).not.toContain("You never write the note's text");
  });
});

describe("writing in the note's text", () => {
  it("writes under a heading, changes or removes text, and Undo takes it all back", async () => {
    const { note, text } = fakeNote([], "Question\n\n**Result** _(after the runs)_\n\n## Method\nSpirals.");
    const undo: AgentUndo = { added: [], changed: [], note: [] };
    expect((await makeCall({ tool: "write_note", after: "Result (after the runs)", text: "Depth helps on spirals." }, note, undo)).action.text).toBe("Wrote in the note under “Result (after the runs)”");
    expect(text.body).toBe("Question\n\n**Result** _(after the runs)_\n\nDepth helps on spirals.\n\n## Method\nSpirals.");
    await makeCall({ tool: "replace_note", find: "Spirals.", replace: "Two spirals, 2 vs 4 layers." }, note, undo);
    expect(text.body).toContain("Two spirals, 2 vs 4 layers.");
    expect((await makeCall({ tool: "replace_note", find: "nowhere", replace: "" }, note, undo)).result).toMatch(/isn't in the note's text/);
    await undoAgent(note, undo);
    expect(text.body).toBe("Question\n\n**Result** _(after the runs)_\n\n## Method\nSpirals.");
  });

  it("Undo still takes its text out when the user typed elsewhere since", async () => {
    const { note, text } = fakeNote([], "Intro");
    const undo: AgentUndo = { added: [], changed: [], note: [] };
    await makeCall({ tool: "write_note", after: "", text: "Its summary." }, note, undo);
    text.body = `My own line.\n${text.body}`;
    await undoAgent(note, undo);
    expect(text.body.trim()).toBe("My own line.\nIntro");
  });

  it("deletes only cells it added for this request", async () => {
    const { note, cells } = fakeNote([cell("u1", "print('mine')")]);
    const undo: AgentUndo = { added: [], changed: [], note: [] };
    expect((await makeCall({ tool: "delete_cell", cell: 1 }, note, undo)).result).toMatch(/isn't one you added/);
    await makeCall({ tool: "add_cell", language: "python", code: "print(2)" }, note, undo);
    await makeCall({ tool: "delete_cell", cell: 2 }, note, undo);
    expect(cells.map((c) => c.id)).toEqual(["u1"]);
    expect(undo.added).toEqual([]);
  });
});

describe("the conversation goes with every step", () => {
  it("earlier turns come before the request, what it wrote included", () => {
    const history = { summary: "2026-11-18 Ask: explain — It tests depth.", turns: [{ task: "ask" as const, request: "Draft the Result", answer: { kind: "prose" as const, text: "Here's a draft.", wrote: "Depth helps." } }] };
    const msgs = agentMessages({ request: "insert it", language: "python", title: "T", note: "n", steps: [], history });
    expect(msgs[1]).toEqual({ role: "user", content: "Draft the Result" });
    expect(msgs[2]).toEqual({ role: "assistant", content: "Here's a draft.\n\nWrote into the note:\nDepth helps." });
    expect(msgs.at(-1)!.content).toContain("Request: insert it");
    expect(msgs.at(-1)!.content).toContain("<earlier>");
  });
  it("reads the note tools from a reply", () => {
    const r = parseAgentReply("python", JSON.stringify({ message: "Writing it.", calls: [{ tool: "write_note", after: "Result", text: "x\r\ny" }, { tool: "replace_note", find: "a" }, { tool: "delete_cell", cell: 2 }] }));
    expect(r.calls).toEqual([{ tool: "write_note", after: "Result", text: "x\ny" }, { tool: "replace_note", find: "a", replace: "" }, { tool: "delete_cell", cell: 2 }]);
  });
});

describe("Undo and its own cells survive a reload (kept with the turn)", () => {
  it("what Undo needs is kept without the note's whole text, and undoes from there", async () => {
    const { note, cells, text } = fakeNote([cell("u1", "print('mine')")], "Intro");
    const undo: AgentUndo = { added: [], changed: [], note: [] };
    await makeCall({ tool: "add_cell", language: "python", code: "print(2)" }, note, undo);
    await makeCall({ tool: "edit_cell", cell: 1, code: "print('changed')" }, note, undo);
    await makeCall({ tool: "write_note", after: "", text: "Its summary." }, note, undo);
    await makeCall({ tool: "replace_note", find: "Intro", replace: "Introduction" }, note, undo);
    const kept = keptChanges(undo);
    expect(JSON.stringify(kept)).not.toContain('"before"');
    expect(hasChanges(kept)).toBe(true);
    // After a reload: only what was kept.
    await undoAgent(note, undoFromKept(JSON.parse(JSON.stringify(kept))));
    expect(cells.map((c) => c.content)).toEqual(["print('mine')"]);
    expect(text.body.trim()).toBe("Intro");
  });
  it("cells it wrote in earlier requests are marked for it", () => {
    const labels = agentCells([cell("u1", "a"), cell("n9", "b")], new Set(["n9"])).map((c) => c.label);
    expect(labels).toEqual(["[Cell 1]", "[Cell 2 · you wrote this cell]"]);
  });
});

describe("the plan checklist and what each step looks like opened", () => {
  it("reads a plan and its progress; a one-step plan is no plan", () => {
    const r = parseAgentReply("python", JSON.stringify({ message: "Starting.", calls: [], plan: ["1. Retrain both nets", "- Plot the boundaries", "Write the result"], plan_done: 1 }));
    expect(r.plan).toEqual(["Retrain both nets", "Plot the boundaries", "Write the result"]);
    expect(r.planDone).toBe(1);
    expect(parseAgentReply("python", JSON.stringify({ message: "x", plan: ["only"] })).plan).toBeUndefined();
    expect(parseAgentReply("python", JSON.stringify({ message: "x", plan: "nonsense", plan_done: "y" })).plan).toBeUndefined();
  });
  it("the loop keeps the plan and ticks it off; the model reads its plan back", async () => {
    const { note } = fakeNote();
    const { ask, bodies } = scripted([
      { message: "Plan made.", calls: [{ tool: "add_cell", language: "python", code: "print(1)" }, { tool: "run_cell", cell: 1 }], done: false, plan: ["Write it", "Run it", "Report"], planDone: 0 },
      { message: "Ran.", calls: [], done: true, planDone: 3 },
    ]);
    const states: AgentState[] = [];
    const end = await runAgent("go", note, ask, (s) => states.push(s), { added: [], changed: [], note: [] }, new AbortController().signal);
    expect(end.plan).toEqual({ steps: ["Write it", "Run it", "Report"], done: 3 });
    expect(states.some((s) => s.status === "working" && s.plan?.done === 0)).toBe(true);
    expect(agentMessages(bodies[1] as never)[2]!.content).toContain("[Plan: Write it; Run it; Report]");
  });
  it("each step carries what it looks like opened: code, change, output, text", async () => {
    const { note } = fakeNote([cell("u1", "print('mine')")], "Intro");
    const undo: AgentUndo = { added: [], changed: [], note: [] };
    expect((await makeCall({ tool: "add_cell", language: "python", code: "print(2)" }, note, undo)).action.detail).toEqual({ kind: "code", language: "python", code: "print(2)" });
    expect((await makeCall({ tool: "edit_cell", cell: 1, code: "print('new')" }, note, undo)).action.detail).toEqual({ kind: "diff", before: "print('mine')", after: "print('new')" });
    expect((await makeCall({ tool: "run_cell", cell: 1 }, note, undo)).action.detail).toEqual({ kind: "output", text: "Output:\n```\nran print('new')\n```" });
    expect((await makeCall({ tool: "write_note", after: "", text: "Summary." }, note, undo)).action.detail).toEqual({ kind: "text", text: "Summary." });
  });
});

describe("what went wrong in the reported run (summary figure labels)", () => {
  it("a reply cut off at the length limit isn't taken as done: it's told to write less, and goes on", async () => {
    const { note } = fakeNote();
    const { ask, bodies } = scripted([
      { message: "Rewriting it", calls: [], done: false, cut: true },
      { message: "Done in a shorter cell.", calls: [], done: true },
    ]);
    const end = await runAgent("label the figure", note, ask, () => {}, { added: [], changed: [], note: [] }, new AbortController().signal);
    expect(end.status).toBe("done");
    // The half reply isn't shown: only the whole one after it.
    expect(end.steps.map((s) => s.message)).toEqual(["Done in a shorter cell."]);
    expect((bodies[1] as { steps: { results: string[] }[] }).steps[0]!.results[0]).toBe(CUT_RESULT);
    expect(salvageAgentReply('{"message":"Cell 8 as written can\'t run, rewriting","calls":[{"tool":"edit_cell","cell":8,"code":"import matplotlib')).toEqual({ message: "Cell 8 as written can't run, rewriting", calls: [], done: false, cut: true });
  });
  it("a string broken by a real line break gets a precise hint", async () => {
    const { note } = fakeNote([cell("u1", "x")]);
    const broken: AgentNote = { ...note, run: async () => void 0, read: async () => ({ title: "T", body: "", cells: [{ ...cell("u1", "x"), last_run: run("error", { error_line: "SyntaxError: unterminated string literal (detected at line 87)" }) }] }) };
    const r = await makeCall({ tool: "run_cell", cell: 1 }, broken, { added: [], changed: [], note: [] });
    expect(r.result).toMatch(/Hint: a string in the code has a real line break inside it/);
    expect(r.result).toContain("\\\\n");
  });
  it("a finished request's plan reads all done; the rules ask to tick it as it goes", async () => {
    const { note } = fakeNote();
    const { ask } = scripted([{ message: "Plan.", calls: [], done: true, plan: ["a", "b", "c"], planDone: 0 }]);
    const end = await runAgent("go", note, ask, () => {}, { added: [], changed: [], note: [] }, new AbortController().signal);
    expect(end.plan).toEqual({ steps: ["a", "b", "c"], done: 3 });
    expect(agentRules("python")).toContain("each time a step is finished, call set_plan with the same steps and done = how many are finished, in the same reply as your other calls");
  });
  it("a reply followed by more text or a second object is read as its first whole object", () => {
    const r = parseAgentReply("python", '{"message":"Done.","calls":[],"done":true} {"message":"again"}');
    expect(r.message).toBe("Done.");
    expect(firstObject('noise {"a":"}{\\"","b":{"c":1}} tail {"x":2}')).toBe('{"a":"}{\\"","b":{"c":1}}');
  });
});

describe("it carries on by itself: no Continue, no error for a hiccup", () => {
  const realSleep = agentClock.sleep;
  let slept: number[] = [];
  beforeEach(() => {
    slept = [];
    agentClock.sleep = async (ms) => void slept.push(ms);
  });
  afterEach(() => {
    agentClock.sleep = realSleep;
  });
  const fail = (status: number, code?: string, retryAfter?: number) => Object.assign(new Error(`/api/agent answered ${status}`), { status, code, retryAfter });

  it("a slow, busy or dropped AI is waited out, up to maxTries, and the work goes on", async () => {
    const { note, cells } = fakeNote();
    const states: AgentState[] = [];
    let n = 0;
    const flaky = async () => {
      n++;
      if (n === 1) return { message: "Adding.", calls: [{ tool: "add_cell" as const, language: "python", code: "print(1)" }, { tool: "run_cell" as const, cell: 1 }], done: false, plan: ["Add", "Check"], planDone: 0 } as AgentReply;
      if (n <= 6) throw [fail(502, "server"), fail(504, "timeout"), new TypeError("Failed to fetch")][n % 3]; // 5 hiccups in a row: within maxTries
      return { message: "It printed 1.", calls: [], done: true, finished: true, planDone: 2 } as AgentReply;
    };
    const end = await runAgent("go", note, flaky, (s) => states.push(s), { added: [], changed: [], note: [] }, new AbortController().signal);
    expect(end.status).toBe("done");
    expect(n).toBe(7);
    expect(cells).toHaveLength(1); // nothing done twice
    expect(end.plan).toEqual({ steps: ["Add", "Check"], done: 2 });
    expect(states.every((s) => s.status !== "working" || !/busy|again|error|fail/i.test(s.doing))).toBe(true); // a hiccup isn't shown: it's still "Thinking…"
    expect(slept.length).toBeGreaterThanOrEqual(5 + 15 + 30 + 60); // it really waited, a second at a time
    expect(Math.max(...slept)).toBe(1000); // a second at a time, so the countdown moves and Stop is heard
    // No failure tone for a hiccup: only real cell failures are marked.
    expect(end.steps.flatMap((s) => s.actions).filter((a) => a.tone === "fail")).toHaveLength(0);
  });
  it("after a timeout it's asked for a shorter reply", async () => {
    const { note } = fakeNote();
    const bodies: { steps: { results: string[] }[]; notes?: string[] }[] = [];
    let n = 0;
    const ask = async (b: unknown) => {
      bodies.push(structuredClone(b) as (typeof bodies)[number]);
      if (++n === 1) throw fail(504, "timeout");
      return { message: "Done.", calls: [], done: true } as AgentReply;
    };
    await runAgent("go", note, ask, () => {}, { added: [], changed: [], note: [] }, new AbortController().signal);
    expect(bodies[0]!.steps).toHaveLength(0);
    expect(bodies[0]!.notes).toEqual([]);
    expect(bodies[1]!.notes).toEqual([SLOW_RESULT]);
  });
  it("Stop during a wait stops it at once", async () => {
    const { note } = fakeNote();
    const ctrl = new AbortController();
    agentClock.sleep = async () => ctrl.abort();
    const end = await runAgent("go", note, async () => { throw fail(502, "server"); }, () => {}, { added: [], changed: [], note: [] }, ctrl.signal);
    expect(end.status).toBe("stopped");
  });
  it("work that needs more steps than are sent back goes on by itself", async () => {
    const { note } = fakeNote([cell("u1", "x")]);
    const sizes: number[] = [];
    let n = 0;
    const ask = async (b: unknown) => {
      sizes.push((b as { steps: unknown[] }).steps.length);
      return (++n < 12 ? { message: "Running.", calls: [{ tool: "edit_cell", cell: 1, code: `print(${n})` }, { tool: "run_cell", cell: 1 }], done: false } : { message: "Done.", calls: [], done: true, finished: true }) as AgentReply;
    };
    const end = await runAgent("go", note, ask, () => {}, { added: [], changed: [], note: [] }, new AbortController().signal);
    expect(end.status).toBe("done");
    expect(n).toBe(12);
    expect(Math.max(...sizes)).toBe(AGENT_LIMITS.steps - 1); // the server's limit is never passed
    expect(agentRequest.safeParse({ request: "go", language: "python", title: "", note: "", steps: Array(AGENT_LIMITS.steps).fill({ message: "", calls: [], results: [] }) }).success).toBe(true);
  });
  it("only what waiting can't fix stops it: a refusal, a daily limit", () => {
    expect(retryWait(fail(403), 0, 0)).toBeNull();
    expect(retryWait(fail(401, "session"), 0, 0)).toBeNull();
    expect(retryWait(fail(429, "rate_limited", 3600), 0, 0)).toBeNull(); // today's limit: waiting a minute won't help
    expect(retryWait(fail(429, "rate_limited", 20), 0, 0)).toBe(20); // a per-minute limit is waited out
    expect(retryWait(fail(429), 0, AGENT_PATIENCE.limitTries)).toBeNull();
    expect(retryWait(fail(502, "server"), 4, 0)).toBe(60);
    expect(retryWait(fail(502, "server"), AGENT_PATIENCE.maxTries - 1, 0)).toBeNull(); // not forever
    expect(retryWait(fail(503, "notice"), 0, 0)).toBeNull(); // the server's own words: final
    expect(passingFailure(new TypeError("Failed to fetch"))).toBe(true);
    expect(passingFailure(Object.assign(new Error("x"), { name: "AbortError" }))).toBe(false);
  });
});

describe("the plan the user watches moves with the work", () => {
  it("after two working steps without a tick, it's reminded where the plan stands; finishing ticks every step", async () => {
    const { note } = fakeNote();
    const { bodies, ask } = scripted([
      { message: "Adding.", calls: [{ tool: "add_cell", language: "python", code: "print(1)" }], done: false, plan: ["Add", "Run", "Report"], planDone: 0 },
      { message: "Running.", calls: [{ tool: "run_cell", cell: 1 }], done: false },
      { message: "Again.", calls: [{ tool: "edit_cell", cell: 1, code: "print(2)" }, { tool: "run_cell", cell: 1 }], done: false },
      { message: "It prints 2.", calls: [], done: true },
    ]);
    const end = await runAgent("go", note, ask, () => {}, { added: [], changed: [], note: [] }, new AbortController().signal);
    const sentTexts = JSON.stringify(bodies);
    expect(sentTexts).toContain("Your plan shows 0 of 3 steps done");
    expect(end.plan).toEqual({ steps: ["Add", "Run", "Report"], done: 3 });
  });
});
