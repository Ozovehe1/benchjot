// The Assistant fixes of 20 Nov 2026, from a real conversation: an answer that ended in raw
// {"tool": "edit_cell", …} JSON (the edit never made), its step notes in the answer, "Done in the
// note" written twice, an animation shown with IPython's display, and Undo that could stick.
import { describe, expect, it } from "vitest";
import { retryWait, AGENT_PATIENCE, GRAPH_RULE, loopGuard, runReport, AGENT_TOOLS, NO_CALL_RESULT, cutNativeReply, readNativeReply, unfinishedCells, DEVICE_PYTHON, runPlace, serverOnlyImports, LIBRARIES, OUTPUT_RULE, WHERE_RULE, libraryGuide, agentMessages, agentRequest, agentRules, agentSummary, makeCall, parseAgentReply, runAgent, splitLeakedCalls, splitSummary, undoAgent, undoFromKept, type AgentCell, type AgentNote, type AgentReply, type AgentUndo } from "@/lib/ai/agent";
import { endPosition } from "@/lib/notes/positions";
import { AGENT_STYLE } from "@/config/app";
import { noteGraph, noteParts, shownLabel } from "@/lib/ai/assistant";
import { aiUsedText } from "@/lib/ai/budget";
import { codeHash } from "@/lib/run/last-run";

const cell = (id: string, content: string): AgentCell => ({ id, language: "python", content, last_run: null, note_before: "", note_after: "" });

function fakeNote(initial: AgentCell[] = [], body = "body") {
  const cells = [...initial];
  const text = { body };
  const ran: { id: string; where?: string }[] = [];
  let next = 1;
  const note: AgentNote = {
    read: async () => ({ title: "T", body: text.body, cells: cells.map((c) => ({ ...c })) }),
    setBody: async (t) => void (text.body = t),
    add: async (language, code) => {
      const id = `new${next++}`;
      cells.push({ ...cell(id, code), language });
      return id;
    },
    setCode: async (id, code) => {
      const c = cells.find((x) => x.id === id);
      if (!c) throw new Error("that cell isn't on the page");
      c.content = code;
    },
    run: async (id, where) => {
      ran.push({ id, ...(where ? { where } : {}) });
      cells.find((x) => x.id === id)!.last_run = { outcome: "ok", stdout: "ok\n", stderr: "", error_line: null, line: null, ms: 10, where: "browser", code_hash: codeHash(cells.find((x) => x.id === id)!.content), ran_at: "2026-11-20T10:00:00.000Z" };
    },
    remove: async (id) => {
      const i = cells.findIndex((c) => c.id === id);
      if (i >= 0) cells.splice(i, 1);
    },
  };
  return { note, cells, text, ran };
}

const scripted = (replies: AgentReply[]) => async (): Promise<AgentReply> => {
  const r = replies.shift() ?? { message: "Done.", calls: [], done: true };
  return r.done && !r.calls.length && !r.cut ? { ...r, finished: true } : r; // saying it's done = calling finish
};

describe("tool calls written into the message", () => {
  it("are made, and never shown as JSON (the reported answer)", () => {
    const leaked = 'The animation uses to_jshtml, which doesn\'t show here. I\'ll fix cell 2.\n"calls": [{"tool": "edit_cell", "cell": 2, "code": "import matplotlib\\nplt.close(fig)"}]},';
    const r = parseAgentReply("python", JSON.stringify({ message: leaked, calls: [] }));
    expect(r.message).toBe("The animation uses to_jshtml, which doesn't show here. I'll fix cell 2.");
    expect(r.calls).toEqual([{ tool: "edit_cell", cell: 2, code: "import matplotlib\nplt.close(fig)" }]);
    expect(r.done).toBe(false);
  });
  it("a whole reply written as the message: its words and its calls", () => {
    const inner = JSON.stringify({ message: "Running it.", calls: [{ tool: "run_cell", cell: 1 }] });
    const r = parseAgentReply("python", JSON.stringify({ message: inner }));
    expect(r).toEqual({ message: "Running it.", calls: [{ tool: "run_cell", cell: 1 }], done: false });
  });
  it("a stray brace at the end goes (\"I'll fix both.{\")", () => {
    expect(splitLeakedCalls("I'll fix both.{")).toEqual({ message: "I'll fix both.", calls: [] });
    expect(parseAgentReply("python", '{"message": "I\'ll fix both.{", "calls": []}').message).toBe("I'll fix both.");
  });
  it("plain answers are left alone, braces in prose included", () => {
    expect(splitLeakedCalls("Use a dict like {a: 1} here.").message).toBe("Use a dict like {a: 1} here.");
  });
  it("real calls win over ones in the message", () => {
    const r = parseAgentReply("python", JSON.stringify({ message: 'x {"tool": "delete_cell", "cell": 1}', calls: [{ tool: "run_cell", cell: 2 }] }));
    expect(r.calls).toEqual([{ tool: "run_cell", cell: 2 }]);
    expect(r.message).toBe("x");
  });
});

describe("where a cell runs", () => {
  it("run_cell takes where: device or server; anything else is left out", () => {
    const r = parseAgentReply("python", JSON.stringify({ message: "go", calls: [{ tool: "run_cell", cell: 1, where: "server" }, { tool: "run_cell", cell: 2, where: "moon" }, { tool: "run_cell", cell: 3 }] }));
    expect(r.calls).toEqual([{ tool: "run_cell", cell: 1, where: "server" }, { tool: "run_cell", cell: 2 }, { tool: "run_cell", cell: 3 }]);
  });
  it("is passed to the note", async () => {
    const { note, ran } = fakeNote([cell("u1", "print(1)")]);
    const undo: AgentUndo = { added: [], changed: [], note: [] };
    await makeCall({ tool: "run_cell", cell: 1, where: "server" }, note, undo);
    await makeCall({ tool: "run_cell", cell: 1 }, note, undo);
    expect(ran).toEqual([{ id: "u1", where: "server" }, { id: "u1" }]);
  });
  it("the rules say when to use each, and how results show", () => {
    const rules = agentRules("python");
    expect(rules).toContain(WHERE_RULE);
    expect(WHERE_RULE).toMatch(/device is the default/);
    expect(WHERE_RULE).toMatch(/Never send small, quick work to the server/);
    expect(rules).toContain(OUTPUT_RULE);
    expect(OUTPUT_RULE).toMatch(/never import from IPython/);
    expect(OUTPUT_RULE).toMatch(/to_jshtml/);
    expect(agentRules("r")).not.toContain(OUTPUT_RULE);
  });
});

describe("what the user reads", () => {
  it("no step notes in the answer; Checking its work is a status, not a step", async () => {
    const { note } = fakeNote();
    const states: string[] = [];
    const end = await runAgent(
      "plot it",
      note,
      scripted([
        { message: "Adding it.", calls: [{ tool: "add_cell", language: "python", code: "print(1)" }], done: false },
        { message: "Done.", calls: [], done: true }, // the cell hasn't run: sent back to check
        { message: "Ran it: it prints 1.", calls: [{ tool: "run_cell", cell: 1 }], done: false },
        { message: "It prints 1.", calls: [], done: true },
      ]),
      (s) => s.status === "working" && states.push(s.doing),
      { added: [], changed: [], note: [] },
      new AbortController().signal,
    );
    const texts = end.steps.flatMap((s) => s.actions.map((a) => a.text));
    expect(texts.join(" ")).not.toMatch(/Checking its work|cut off/);
    expect(states).toContain("Checking its work…");
    expect(agentSummary(end.steps)).toBe("Done in the note: Added cell 1 · Python; Ran cell 1 · 10 ms.\n\nIt prints 1.");
  });
  it("each thing done is listed once, and a Done line the model wrote isn't doubled", () => {
    const steps = [
      { message: "a", actions: [{ text: "Ran cell 2 · 1.2 s", tone: "ok" as const }] },
      { message: "Done in the note: ran it.\n\nIt works.", actions: [{ text: "Ran cell 2 · 3.0 s", tone: "ok" as const }] },
    ];
    expect(agentSummary(steps)).toBe("Done in the note: Ran cell 2 · 3.0 s.\n\nIt works.");
  });
  it("history gives what was done as its own field, so it isn't copied into answers", () => {
    expect(splitSummary("Done in the note: Added cell 2; Ran cell 2 · 1 s.\n\nDone in the note: x.\n\nIt works.")).toEqual({ did: "Added cell 2; Ran cell 2 · 1 s; x", text: "It works." });
    const m = agentMessages(agentRequest.parse({ request: "again", language: "python", title: "T", note: "n", steps: [], history: { summary: "", turns: [{ task: "ask", request: "plot", answer: { kind: "prose", text: "Done in the note: Added cell 2.\n\nIt plots." } }] } }));
    // Plain text, the Done line moved out of the answer, so there's nothing to copy.
    expect(m[2]).toEqual({ role: "assistant", content: "It plots.\n\n[What I changed in the note then: Added cell 2]" });
    expect(m[0]!.content).toContain("don't list it or write \"Done in the note\"");
  });
});

describe("Undo", () => {
  it("added, changed and written are all put back", async () => {
    const { note, cells, text } = fakeNote([cell("u1", "print('mine')")], "# Results\n");
    const undo: AgentUndo = { added: [], changed: [], note: [] };
    await makeCall({ tool: "add_cell", language: "python", code: "print(2)" }, note, undo);
    await makeCall({ tool: "edit_cell", cell: 1, code: "print('agent')" }, note, undo);
    await makeCall({ tool: "write_note", after: "# Results", text: "Accuracy 0.97." }, note, undo);
    await undoAgent(note, undo);
    expect(cells.map((c) => c.content)).toEqual(["print('mine')"]);
    expect(text.body).toBe("# Results\n");
    expect(undo).toEqual({ added: [], changed: [], note: [] });
  });
  it("a cell the user deleted since doesn't make Undo fail", async () => {
    const { note, cells } = fakeNote([cell("u1", "a"), cell("u2", "b")]);
    const undo: AgentUndo = { added: [], changed: [], note: [] };
    await makeCall({ tool: "edit_cell", cell: 1, code: "A" }, note, undo);
    await makeCall({ tool: "edit_cell", cell: 2, code: "B" }, note, undo);
    cells.splice(0, 1); // the user deletes cell 1
    await undoAgent(note, undo);
    expect(cells.map((c) => c.content)).toEqual(["b"]);
  });
  it("an Undo that fails part way carries on where it stopped when tapped again", async () => {
    const { note, cells } = fakeNote([cell("u1", "a")]);
    const undo: AgentUndo = { added: [], changed: [], note: [] };
    await makeCall({ tool: "add_cell", language: "python", code: "x" }, note, undo);
    await makeCall({ tool: "add_cell", language: "python", code: "y" }, note, undo);
    await makeCall({ tool: "edit_cell", cell: 1, code: "A" }, note, undo);
    let fail = true;
    const flaky: AgentNote = { ...note, setCode: async (id, code) => (fail ? ((fail = false), Promise.reject(new TypeError("offline"))) : note.setCode(id, code)) };
    await expect(undoAgent(flaky, undo)).rejects.toThrow("offline");
    expect(undo.added).toEqual([]); // the added cells are already gone and won't be tried again
    await undoAgent(flaky, undo);
    expect(cells.map((c) => c.content)).toEqual(["a"]);
  });
  it("after a reload, text it removed comes back", async () => {
    const { note, text } = fakeNote([], "Intro\n\nOld result.\n\nEnd");
    const undo: AgentUndo = { added: [], changed: [], note: [] };
    await makeCall({ tool: "replace_note", find: "Old result.", replace: "New result." }, note, undo);
    await undoAgent(note, undoFromKept({ added: [], changed: [], note: undo.note.map((e) => ({ wrote: e.wrote, replaced: e.replaced })) }));
    expect(text.body).toBe("Intro\n\nOld result.\n\nEnd");
  });
});

describe("cell positions", () => {
  it("a new cell goes after the last one, even with gaps (two cells at position 1 was the bug)", () => {
    expect(endPosition([])).toBe(0);
    expect(endPosition([{ position: 1 }, { position: 2 }])).toBe(3); // cell 0 deleted: the count (2) would clash
    expect(endPosition([{ position: 0 }, { position: 1 }])).toBe(2);
  });
});

describe("which library for which task", () => {
  it("each language gets its own guide, of installed libraries only", async () => {
    const image = (await import("@/lib/run/python-image.json")).default.packages.map((p: string) => p.replace(/[[=<>!~].*$/, "").toLowerCase());
    // Every Python library named in the guide is in the server image (opencv is imported as cv2, so named by its package).
    const named = [...LIBRARIES.python!.matchAll(/\b([a-z][a-z0-9-]+)\b/g)].map((m) => m[1]!);
    for (const lib of ["xgboost", "lightgbm", "catboost", "statsmodels", "pymc", "transformers", "torchvision", "networkx", "simpy", "mesa", "geopandas", "optuna", "shap", "prophet", "umap-learn", "hdbscan", "opencv-python-headless"]) {
      expect(named).toContain(lib);
      expect(image).toContain(lib);
    }
    expect(agentRules("python")).toContain("Which Python library for which task");
    expect(agentRules("r")).toContain("ggplot2");
    expect(agentRules("julia")).toContain("DataFrames");
    expect(agentRules("matlab")).toContain("pkg load");
    expect(libraryGuide("sql")).toBe("");
  });
  it("libraries off the device go to the server, on web and Android alike", () => {
    expect(WHERE_RULE).toMatch(/Set "where": "server" when the cell needs any other library/);
    expect(WHERE_RULE).toMatch(/No module named/);
  });
});

describe("where a run goes is decided by the app, not the model", () => {
  it("a Python cell importing a server-only library goes to the server, whatever the model said", () => {
    expect(serverOnlyImports("import torch\nimport numpy as np\nfrom xgboost import XGBClassifier\nimport os, json")).toEqual(["torch", "xgboost"]);
    expect(serverOnlyImports("import numpy as np\nimport matplotlib.pyplot as plt\nfrom IPython.display import HTML")).toEqual([]);
    expect(runPlace({ language: "python", content: "import torch" }, undefined)).toBe("server");
    expect(runPlace({ language: "python", content: "import torch" }, "device")).toBe("server");
    expect(runPlace({ language: "python", content: "import numpy" }, undefined)).toBeUndefined();
    expect(runPlace({ language: "python", content: "import numpy" }, "server")).toBe("server");
    expect(DEVICE_PYTHON.has("sklearn")).toBe(true);
  });
  it("is passed to the note, and said in the step", async () => {
    const { note, ran } = fakeNote([cell("u1", "import torch\nprint(1)")]);
    const r = await makeCall({ tool: "run_cell", cell: 1 }, note, { added: [], changed: [], note: [] });
    expect(ran).toEqual([{ id: "u1", where: "server" }]);
    expect(r.action.text).toMatch(/^Ran cell 1 on the server/);
  });
  it("a library the device doesn't have: run again on the server by itself", async () => {
    const { note, cells, ran } = fakeNote([cell("u1", "import numpy\nprint(1)")]);
    const missing: AgentNote = {
      ...note,
      run: async (id, where) => {
        await note.run(id, where);
        if (!where) cells[0]!.last_run = { ...cells[0]!.last_run!, outcome: "error", error_line: "ModuleNotFoundError: No module named 'pyfoo'" };
      },
    };
    const r = await makeCall({ tool: "run_cell", cell: 1 }, missing, { added: [], changed: [], note: [] });
    expect(ran).toEqual([{ id: "u1" }, { id: "u1", where: "server" }]);
    expect(r.action.tone).toBe("ok");
  });
});

describe("native tool calling and the completion gate (20 Nov 2026: it kept stopping on its own)", () => {
  const tc = (name: string, args: unknown, id = name) => ({ id, type: "function" as const, function: { name, arguments: JSON.stringify(args) } });
  it("reads tool calls; finish ends with its answer; set_plan is the checklist", () => {
    const r = readNativeReply("python", "Editing cell 2.", [tc("edit_cell", { cell: 2, code: "print(1)\r\n" }), tc("run_cell", { cell: 2 }), tc("set_plan", { steps: ["Fix it", "Run it"], done: 1 })]);
    expect(r).toMatchObject({ message: "Editing cell 2.", calls: [{ tool: "edit_cell", cell: 2, code: "print(1)" }, { tool: "run_cell", cell: 2 }], plan: ["Fix it", "Run it"], planDone: 1 });
    expect(r.finished).toBeUndefined();
    const f = readNativeReply("python", "", [tc("finish", { answer: "It prints 1." })]);
    expect(f).toMatchObject({ message: "It prints 1.", calls: [], finished: true });
  });
  it("finish with calls in the same reply: the calls are made first, and it isn't done yet", () => {
    const r = readNativeReply("python", "", [tc("run_cell", { cell: 1 }), tc("finish", { answer: "Done." })]);
    expect(r.calls).toHaveLength(1);
    expect(r.finished).toBeUndefined();
  });
  it("broken arguments and wrong code are told back, never thrown", () => {
    const r = readNativeReply("python", "", [{ id: "a", type: "function", function: { name: "run_cell", arguments: "{cell: 2" } }, tc("add_cell", { language: "python", code: "const x = 1;\nconsole.log(x)" })]);
    expect(r.calls).toEqual([]);
    expect(r.problems).toEqual(["Your run_cell call's arguments weren't valid JSON, so it wasn't made. Make it again.", "add_cell wasn't made: its code isn't Python. Write it in Python."]);
  });
  it("a model that writes its reply as text still acts", () => {
    expect(readNativeReply("python", JSON.stringify({ message: "Running.", calls: [{ tool: "run_cell", cell: 1 }] }), []).calls).toEqual([{ tool: "run_cell", cell: 1 }]);
    expect(readNativeReply("python", 'Fixing it. {"tool": "run_cell", "cell": 3}', []).calls).toEqual([{ tool: "run_cell", cell: 3 }]);
    expect(cutNativeReply("Writing a long cell")).toEqual({ message: "Writing a long cell", calls: [], done: false, cut: true });
  });
  it("the reported failure: it changed a cell, said it would run it, and stopped. Now it's sent back and runs it", async () => {
    const { note, ran } = fakeNote([cell("u1", "print(1)")]);
    await note.run("u1"); // cell 1 ran before (the old code)
    ran.length = 0;
    const bodies: { steps: { results: string[] }[] }[] = [];
    const replies: AgentReply[] = [
      { message: "Changing cell 1.", calls: [{ tool: "edit_cell", cell: 1, code: "print(2)" }], done: false },
      { message: "Running cell 1 again to show the animation.", calls: [], done: true }, // announced, no call, no finish
      { message: "Running it.", calls: [{ tool: "run_cell", cell: 1 }], done: false },
      { message: "It prints 2.", calls: [], done: true, finished: true },
    ];
    const end = await runAgent("fix it", note, async (b) => (bodies.push(structuredClone(b) as never), replies.shift()!), () => {}, { added: [], changed: [], note: [] }, new AbortController().signal);
    expect(end.status).toBe("done");
    expect(bodies[2]!.steps.at(-1)!.results).toEqual([NO_CALL_RESULT]);
    expect(ran).toEqual([{ id: "u1" }]);
    expect(end.steps.at(-1)!.message).toBe("It prints 2.");
  });
  it("finishing after changing a cell without running it again is sent back: its last run was of other code", async () => {
    const { note } = fakeNote([cell("u1", "print(1)")]);
    await note.run("u1");
    const bodies: { steps: { results: string[] }[] }[] = [];
    const replies: AgentReply[] = [
      { message: "Changing it.", calls: [{ tool: "edit_cell", cell: 1, code: "print(2)" }], done: false },
      { message: "Done.", calls: [], done: true, finished: true },
      { message: "Running.", calls: [{ tool: "run_cell", cell: 1 }], done: false },
      { message: "It prints 2.", calls: [], done: true, finished: true },
    ];
    const end = await runAgent("go", note, async (b) => (bodies.push(structuredClone(b) as never), replies.shift()!), () => {}, { added: [], changed: [], note: [] }, new AbortController().signal);
    expect(bodies[2]!.steps.at(-1)!.results[0]).toMatch(/^Not finished: cell 1 was changed after its last run/);
    expect(end.steps.at(-1)!.message).toBe("It prints 2.");
    expect(unfinishedCells((await note.read()).cells, { added: [], changed: [{ id: "u1", code: "print(1)" }], note: [] })).toBeNull();
  });
  it("a plain answer to a question needs no finish: one request, no nudge", async () => {
    const { note } = fakeNote([cell("u1", "print(1)")]);
    let asked = 0;
    const end = await runAgent("what does cell 1 print?", note, async () => (asked++, { message: "It prints 1.", calls: [], done: true }), () => {}, { added: [], changed: [], note: [] }, new AbortController().signal);
    expect(asked).toBe(1);
    expect(end.steps.at(-1)!.message).toBe("It prints 1.");
  });
  it("a call that couldn't be made is told back with the step's results", async () => {
    const { note } = fakeNote([cell("u1", "print(1)")]);
    const bodies: { steps: { results: string[] }[] }[] = [];
    const replies: AgentReply[] = [
      { message: "Running.", calls: [{ tool: "run_cell", cell: 1 }], done: false, problems: ["add_cell wasn't made: its code isn't Python. Write it in Python."] },
      { message: "Done.", calls: [], done: true, finished: true },
    ];
    await runAgent("go", note, async (b) => (bodies.push(structuredClone(b) as never), replies.shift()!), () => {}, { added: [], changed: [], note: [] }, new AbortController().signal);
    expect(bodies[1]!.steps[0]!.results).toHaveLength(2);
    expect(bodies[1]!.steps[0]!.results[1]).toMatch(/isn't Python/);
  });
  it("the model is given every tool, and the reply budget fits a whole simulation cell", () => {
    expect(AGENT_TOOLS.every((t) => t.type === "function" && t.function.parameters.type === "object")).toBe(true);
    expect(AGENT_STYLE.maxTokens).toBeGreaterThanOrEqual(12_000);
  });
});

describe("step 1 of the context graph and the guardrails (20 Nov 2026, 2pm session)", () => {
  const dir = `${"0".repeat(8)}-0000-4000-8000-${"0".repeat(12)}`;
  const outs = (items: unknown[], notes: string[] = []) => ({ version: 1, dir: `${dir}/${dir}/${dir}`, notes, items }) as never;
  const ran = (code: string, extra: Record<string, unknown> = {}) => ({ outcome: "ok", stdout: "", stderr: "", error_line: null, line: null, ms: 12_600, where: "browser", code_hash: codeHash(code), ran_at: "2026-11-20T10:59:59.000Z", ...extra }) as never;
  it("an animation is said to be shown, never a bare file name (the 10:59 loop)", () => {
    expect(shownLabel({ kind: "image", source: "file", name: "animation-1.gif", width: 1, height: 1, title: "Grain growth", files: { gif: "0.gif" } } as never)).toBe('an animation (it plays by itself in the note) "Grain growth"');
    expect(shownLabel({ kind: "image", source: "file", name: "animation-1.gif", width: 1, height: 1, title: "", files: { gif: "0.gif", mp4: "0.mp4" } } as never)).toBe("an animation (it plays by itself in the note)");
    expect(shownLabel({ kind: "image", source: "file", name: "clip.mp4", width: 0, height: 0, title: "", files: { mp4: "0.mp4" } } as never)).toBe("a video (clip.mp4) (it plays in the note)");
    expect(shownLabel({ kind: "image", source: "file", name: "plot.png", width: 1, height: 1, title: "", files: { png: "0.png" } } as never)).toBe("an image (plot.png, a file the code wrote)");
    expect(shownLabel({ kind: "chart", lib: "plotly", version: "6", title: "Loss", files: { json: "0.json" } } as never)).toBe('an interactive Plotly chart "Loss"');
    expect(shownLabel({ kind: "table", index_columns: 0, columns: ["a"], rows: [], total_rows: 14, total_columns: 3, files: { csv: "0.csv" } } as never)).toBe("a table, 14 rows × 3 columns");
  });
  it("what the run itself said about its outputs reaches the agent", async () => {
    const code = "from IPython.display import HTML\nHTML('<b>x</b>')";
    const { note } = fakeNote([{ ...cell("u1", code), last_run: ran(code, { outputs: outs([], ["HTML output isn't shown in Benchjot; print text, or show a figure, table or chart instead."]) }) }]);
    const report = runReport(1, (await note.read()).cells[0]!);
    expect(report).toContain("Notes from the run: HTML output isn't shown");
  });
  it("the graph: a card for the note and for each cell, built from the note itself", () => {
    const anim = "# Potts grain growth, animated\nimport numpy as np\nfrom matplotlib.animation import FuncAnimation\nanim = FuncAnimation(fig, update)";
    const stale = "print('old')";
    const g = noteGraph("Grain growth", "**Question** Does annealing coarsen the grains?\n\n**Setup** Potts model, 200 MCS.\n\nLoose notes.", "success", [
      { language: "python", content: anim, note_before: "Expect: grains grow.", note_after: "They did.", last_run: ran(anim, { stdout: "MCS 10: 239 grains\nFinal: 216 grains, mean d = 9.34 nm\n", outputs: outs([{ kind: "image", source: "file", name: "animation-1.gif", width: 1, height: 1, title: "Grain growth", files: { gif: "0.gif" } }]) }) },
      { language: "python", content: "print('new')", note_before: "", note_after: "", last_run: ran(stale) },
      { language: "r", content: "x <- 1", note_before: "", note_after: "", last_run: null },
    ]);
    expect(g).toMatch(/^<graph>\nNote: Grain growth · outcome: Successful\nQuestion: Does annealing coarsen the grains\?\nSetup: Potts model, 200 MCS\.\nCells:\n/);
    expect(g).toContain("[Cell 1] python · purpose: Potts grain growth, animated · expected: Expect: grains grow. · ran ok on the device in 12.6 s · shown in the note: an animation (it plays by itself in the note) \"Grain growth\" · printed: MCS 10: 239 grains | Final: 216 grains, mean d = 9.34 nm · observed: They did. · uses: numpy, matplotlib");
    expect(g).toContain("[Cell 2] python · ran ok on the device in 12.6 s; CHANGED since that run, so its results are of older code");
    expect(g).toContain("[Cell 3] r · not run yet");
    expect(g.endsWith("</graph>")).toBe(true);
    expect(noteGraph("", "", null, [])).toBe("");
    expect(noteParts("## Result\n\nAccuracy rose to 0.97.")).toEqual([{ part: "Result", text: "Accuracy rose to 0.97." }]);
  });
  it("the agent reads the graph first, then the note", async () => {
    const { note } = fakeNote([cell("u1", "print(1)")], "**Question** Is it 1?");
    const bodies: { note: string }[] = [];
    await runAgent("go", { ...note, read: async () => ({ ...(await note.read()), outcome: "failed" }) }, async (b) => (bodies.push(b as never), { message: "It prints 1.", calls: [], done: true }), () => {}, { added: [], changed: [], note: [] }, new AbortController().signal);
    expect(bodies[0]!.note).toMatch(/^<graph>\nNote: T · outcome: Failed\nQuestion: Is it 1\?\nCells:\n\[Cell 1\] python · not run yet\n<\/graph>\n\n\*\*Question\*\* Is it 1\?/);
    expect(agentRules("python")).toContain(GRAPH_RULE);
  });
  it("going in circles: a working cell rewritten and rerun with the same result is told once, then it stops and asks", async () => {
    const { note } = fakeNote([cell("u1", "print(1)")]);
    let n = 0;
    const ask = async () => (n++, { message: "Making it show.", calls: [{ tool: "edit_cell" as const, cell: 1, code: `print(1)  # try ${n}` }, { tool: "run_cell" as const, cell: 1 }], done: false });
    const bodies: { steps: { results: string[] }[] }[] = [];
    const end = await runAgent("show the animation", { ...note, run: async (id) => { await note.run(id); } }, async (b) => (bodies.push(structuredClone(b) as never), (await ask()) as AgentReply), () => {}, { added: [], changed: [], note: [] }, new AbortController().signal);
    expect(end.status).toBe("done");
    expect(bodies.some((b) => b.steps.some((s) => s.results.some((r) => r.startsWith("You may be going in circles")))) ).toBe(true);
    expect(end.steps.at(-1)!.message).toMatch(/^I stopped because I was going in circles: .*What would you like me to do next\?$/s);
    expect(n).toBeLessThan(AGENT_PATIENCE.maxSteps);
  });
  it("work that makes progress is never called a loop", () => {
    const g = loopGuard();
    expect(g.after([{ tool: "edit_cell", cell: 1, code: "lr=0.1" }, { tool: "run_cell", cell: 1 }], ["Changed cell 1.", "Cell 1 ran without error in 1.0 s.\nOutput: acc 0.81"])).toBeNull();
    expect(g.after([{ tool: "edit_cell", cell: 1, code: "lr=0.01" }, { tool: "run_cell", cell: 1 }], ["Changed cell 1.", "Cell 1 ran without error in 2.0 s.\nOutput: acc 0.88"])).toBeNull();
    expect(g.before([{ tool: "edit_cell", cell: 1, code: "lr=0.001" }])).toBeNull();
    expect(g.before([{ tool: "edit_cell", cell: 1, code: "lr=0.1" }])).toBeNull(); // first time this guard sees it in before()
    expect(g.before([{ tool: "edit_cell", cell: 1, code: "lr=0.1" }])).toMatch(/set back to code it already had/);
  });
  it("the line under the composer says what's left of the day's requests", () => {
    expect(aiUsedText(12)).toBe("38 of 50 AI requests left today · each step counts as one");
    expect(aiUsedText(70)).toBe("0 of 50 AI requests left today · each step counts as one");
  });
});

describe("the Data library tools", () => {
  const undo = (): AgentUndo => ({ added: [], changed: [], note: [] });
  it("list_data lists the files with how a cell opens them; save_data saves and says the name", async () => {
    const { note } = fakeNote([cell("u1", "print(1)")]);
    const saved: string[] = [];
    note.data = { list: async () => [{ name: "iris.csv", size: 4551 }], save: async (url, name) => (saved.push(url), { name: name ?? "x.csv", size: 2_000_000 }) };
    const listed = await makeCall({ tool: "list_data" }, note, undo());
    expect(listed.result).toContain("- iris.csv (4 KB)");
    expect(listed.result).toContain('pd.read_csv("iris.csv")');
    const r = await makeCall({ tool: "save_data", url: "https://x.org/wine.csv", name: "wine.csv" }, note, undo());
    expect(saved).toEqual(["https://x.org/wine.csv"]);
    expect(r.result).toMatch(/^Saved wine\.csv \(1\.9 MB\)/);
    expect(r.action.tone).toBe("plain");
  });
  it("a refused download goes back to the agent with the reason and the way round it", async () => {
    const { note } = fakeNote([]);
    note.data = { list: async () => [], save: async () => Promise.reject(new Error("Only https:// addresses can be added.")) };
    const r = await makeCall({ tool: "save_data", url: "http://x.org/a.csv", name: "" }, note, undo());
    expect(r.result).toContain("Only https:// addresses can be added.");
    expect(r.result).toContain("server cell");
    expect(r.action.tone).toBe("fail");
  });
  it("where there is no library, it says so", async () => {
    const { note } = fakeNote([]);
    expect((await makeCall({ tool: "list_data" }, note, undo())).result).toBe("The Data library can't be reached here.");
  });
  it("find_datasets lists datasets across platforms with refs, or a ref's files with addresses", async () => {
    const { note } = fakeNote([]);
    note.data = {
      list: async () => [],
      save: async () => ({ name: "x", size: 1 }),
      find: async (q) =>
        q.includes(":")
          ? { kind: "files", ref: q, files: [{ name: "titanic.csv", size: 44385, url: "https://zenodo.org/api/records/1/files/titanic.csv/content" }, { name: "big.parquet", size: 80_000_000, url: "https://x/big.parquet" }] }
          : { kind: "datasets", results: [{ ref: "zenodo:1", title: "Titanic", source: "Zenodo", detail: "107 downloads" }, { ref: "openml:40945", title: "Titanic (version 1)", source: "OpenML", detail: "1k rows" }], missed: ["figshare"] },
    };
    const search = await makeCall({ tool: "find_datasets", query: "titanic" }, note, undo());
    expect(search.result).toContain("- zenodo:1 — Titanic (Zenodo; 107 downloads)");
    expect(search.result).toContain("- openml:40945 — Titanic (version 1) (OpenML; 1k rows)");
    expect(search.result).toContain("figshare didn't answer this time");
    const files = await makeCall({ tool: "find_datasets", query: "zenodo:1" }, note, undo());
    expect(files.result).toContain("titanic.csv — 43 KB — https://zenodo.org/api/records/1/files/titanic.csv/content");
    expect(files.result).toMatch(/big\.parquet — [\d.]+ MB \(over 50 MB — load it in a server cell instead\)/);
  });
  it("without dataset search it points at web_search", async () => {
    const { note } = fakeNote([]);
    note.data = { list: async () => [], save: async () => ({ name: "x", size: 1 }) };
    expect((await makeCall({ tool: "find_datasets", query: "iris" }, note, undo())).result).toContain("web_search");
  });
});

describe("the Assistant never spins forever", () => {
  it("the server's own words (AI not set up, key refused) are final, not retried", () => {
    expect(retryWait({ status: 503, code: "notice" }, 0, 0)).toBeNull();
  });
  it("a passing hiccup is retried, but at most maxTries times", () => {
    const e = { status: 502, code: "server" };
    const waits = Array.from({ length: AGENT_PATIENCE.maxTries + 2 }, (_, i) => retryWait(e, i, 0));
    expect(waits.slice(0, AGENT_PATIENCE.maxTries - 1).every((w) => typeof w === "number" && w > 0)).toBe(true);
    expect(waits.slice(AGENT_PATIENCE.maxTries - 1).every((w) => w === null)).toBe(true);
  });
});
