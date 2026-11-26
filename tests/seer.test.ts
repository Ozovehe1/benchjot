// Step 2 of the context graph: the seer. A vision model looks at what a run showed and its words are
// kept with that run, so the agent and the graph read what a figure shows, not only that it exists.
import { describe, expect, it, vi } from "vitest";
import { makeCall, runAgent, SEE_AT_START, type AgentCell, type AgentNote, type AgentReply, type AgentUndo } from "@/lib/ai/agent";
import { noteGraph, producedLabel, shownLabel } from "@/lib/ai/assistant";
import { readSeerReply, seeRequest, seerPrompt } from "@/lib/ai/seer";
import { SEE_MAX_ITEMS, toSee, withSeen, outputItem, type OutputItem } from "@/lib/run/outputs";
import { codeHash } from "@/lib/run/last-run";

const fig = (files: Record<string, string>, extra: Partial<OutputItem> = {}): OutputItem => outputItem.parse({ kind: "image", source: "matplotlib", width: 640, height: 480, title: "Loss", files, ...extra });
const table: OutputItem = outputItem.parse({ kind: "table", index_columns: 1, columns: ["", "epoch", "loss"], rows: [[0, 1, 0.5]], total_rows: 1, total_columns: 2, files: {} });
const chart: OutputItem = outputItem.parse({ kind: "chart", lib: "plotly", version: "5", title: "Acc", files: { json: "3.json", png: "3.png" } });
const DIR = "11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333";

describe("what the seer looks at", () => {
  it("figures as PNG, animations as GIF, charts as their PNG; never tables, SVG-only or video-only", () => {
    const items = [fig({ png: "0.png", svg: "0.svg" }), table, fig({ gif: "2.gif", mp4: "2.mp4" }, { name: "animation-1.gif" }), chart, fig({ svg: "4.svg" }), fig({ mp4: "5.mp4" })];
    expect(toSee({ items })).toEqual([
      { index: 0, file: "0.png", kind: "figure", title: "Loss" },
      { index: 2, file: "2.gif", kind: "animation", title: "Loss" },
      { index: 3, file: "3.png", kind: "chart", title: "Acc" },
    ]);
  });
  it("an animation is looked at as its frame strip when it has one, and the prompt says it shows time", () => {
    const anim = fig({ gif: "0.gif", mp4: "0.mp4", strip: "0.png" }, { name: "animation-1.gif" });
    expect(toSee({ items: [anim] })).toEqual([{ index: 0, file: "0.png", kind: "animation", title: "Loss" }]);
    const p = seerPrompt({ title: "T", code: "", printed: "", items: [{ index: 0, file: "0.png", kind: "animation", title: "" }, { index: 1, file: "1.gif", kind: "animation", title: "" }] });
    expect(p).toContain("1: an animation, shown as frames in time order");
    expect(p).toContain("2: an animation (one frame of it may be all you can see)");
    expect(shownLabel(anim)).toBe('an animation (it plays by itself in the note) "Loss"');
  });
  it("skips what it has already described, and looks at most SEE_MAX_ITEMS at once", () => {
    expect(toSee({ items: [fig({ png: "0.png" }, { seen: "a line" })] })).toEqual([]);
    expect(toSee({ items: Array.from({ length: 6 }, (_, i) => fig({ png: `${i}.png` })) })).toHaveLength(SEE_MAX_ITEMS);
    expect(toSee(null)).toEqual([]);
  });
  it("its words go into the items they are about, and nowhere else", () => {
    const o = { items: [fig({ png: "0.png" }), table] };
    const out = withSeen(o, [{ index: 0, text: "  Loss falls from 2.1 to 0.3.  " }, { index: 1, text: "ignored" }]);
    expect(out.items[0]).toMatchObject({ seen: "Loss falls from 2.1 to 0.3." });
    expect(out.items[1]).not.toHaveProperty("seen");
  });
  it("an old run record without `seen`, or with a broken one, still reads", () => {
    expect((fig({ png: "0.png" }, { seen: 42 as unknown as string }) as { seen?: string }).seen).toBeUndefined();
  });
});

describe("the seer's request and reply", () => {
  it("only the user's own run folder, picture files, and at most three", () => {
    const ok = { dir: DIR, items: [{ index: 0, file: "0.png", kind: "figure", title: "" }], title: "T", code: "x", printed: "" };
    expect(seeRequest.safeParse(ok).success).toBe(true);
    expect(seeRequest.safeParse({ ...ok, dir: "../other/x/y" }).success).toBe(false);
    expect(seeRequest.safeParse({ ...ok, items: [{ index: 0, file: "0.svg", kind: "figure", title: "" }] }).success).toBe(false);
    expect(seeRequest.safeParse({ ...ok, items: Array(4).fill(ok.items[0]) }).success).toBe(false);
  });
  it("the prompt gives the note, the code, what it printed and the pictures in order", () => {
    const p = seerPrompt({ title: "Grain growth", code: "plt.plot(t, d)", printed: "mean 31.8", items: [{ index: 0, file: "0.png", kind: "figure", title: "Size" }, { index: 2, file: "2.gif", kind: "animation", title: "" }] });
    expect(p).toContain("Note: Grain growth");
    expect(p).toContain("plt.plot(t, d)");
    expect(p).toContain("mean 31.8");
    expect(p).toContain('1: a figure titled "Size"\n2: an animation');
  });
  it("reads numbered lines, lines that run on, and a reply without numbers", () => {
    const items = [{ index: 0 }, { index: 3 }];
    expect(readSeerReply("<think>hm</think>1: Loss falls\nto 0.3.\n**2**: A blank plot.", items)).toEqual({ seen: [{ index: 0, text: "Loss falls to 0.3." }, { index: 3, text: "A blank plot." }] });
    expect(readSeerReply("Grains coarsen over time.", items)).toEqual({ seen: [{ index: 0, text: "Grains coarsen over time." }] });
    expect(readSeerReply("9: out of range", items)).toEqual({ seen: [{ index: 0, text: "9: out of range" }] });
  });
});

describe("the agent reads what the seer saw", () => {
  it("in the labels and the graph; a table names its columns", () => {
    expect(producedLabel(fig({ png: "0.png" }, { seen: "Loss falls from 2.1 to 0.3." }))).toBe('a figure "Loss" (it shows: Loss falls from 2.1 to 0.3.)');
    expect(producedLabel(table)).toBe("a table, 1 rows × 2 columns (columns: epoch, loss)");
    const run = { outcome: "ok" as const, stdout: "", stderr: "", error_line: null, line: null, ms: 5, where: "browser" as const, code_hash: codeHash("x"), ran_at: "2026-11-20T10:00:00.000Z", outputs: { version: 1 as const, notes: [], dir: DIR, items: [fig({ png: "0.png" }, { seen: "Grains coarsen." })] } };
    expect(noteGraph("T", "", null, [{ language: "python", content: "x", last_run: run, note_before: "", note_after: "" }])).toContain("(it shows: Grains coarsen.)");
  });
});

// A note whose runs make a figure, and a seer that describes it.
function seeingNote(start: AgentCell[]) {
  const cells = start.map((c) => ({ ...c }));
  const looked: string[] = [];
  const runOf = (c: AgentCell, at: string) => ({ outcome: "ok" as const, stdout: "done\n", stderr: "", error_line: null, line: null, ms: 9, where: "browser" as const, code_hash: codeHash(c.content), ran_at: at, outputs: { version: 1 as const, notes: [], dir: DIR, items: [fig({ png: "0.png" })] } });
  const note: AgentNote = {
    read: async () => ({ title: "T", body: "b", cells: cells.map((c) => ({ ...c })) }),
    add: async () => "x",
    setCode: async () => {},
    setBody: async () => {},
    remove: async () => {},
    run: async (id) => {
      const c = cells.find((x) => x.id === id)!;
      c.last_run = runOf(c, "2026-11-20T12:00:00.000Z");
    },
    see: async (id) => {
      looked.push(id);
      const c = cells.find((x) => x.id === id)!;
      c.last_run = { ...c.last_run!, outputs: withSeen(c.last_run!.outputs!, [{ index: 0, text: "The loss falls to 0.3." }]) };
    },
  };
  return { note, cells, looked, runOf };
}

describe("when the seer looks", () => {
  it("after the agent runs a cell that showed a picture, and the report says what it shows", async () => {
    const { note, looked } = seeingNote([{ id: "a", language: "python", content: "plot()", last_run: null, note_before: "", note_after: "" }]);
    const undo: AgentUndo = { added: [], changed: [], note: [] };
    const { result } = await makeCall({ tool: "run_cell", cell: 1 }, note, undo);
    expect(looked).toEqual(["a"]);
    expect(result).toContain("(it shows: The loss falls to 0.3.)");
  });
  it("not after a run with nothing to see, nor when the page has no seer", async () => {
    const plain: AgentNote = { ...seeingNote([]).note };
    const { note, looked } = seeingNote([{ id: "a", language: "python", content: "x", last_run: null, note_before: "", note_after: "" }]);
    note.run = async () => {};
    await makeCall({ tool: "run_cell", cell: 1 }, note, { added: [], changed: [], note: [] });
    expect(looked).toEqual([]);
    delete plain.see;
    expect(plain.see).toBeUndefined();
  });
  it("before the first step: the newest current runs not yet described, at most SEE_AT_START", async () => {
    const c = (id: string, content: string): AgentCell => ({ id, language: "python", content, last_run: null, note_before: "", note_after: "" });
    const start = [c("old", "a"), c("new", "b"), c("mid", "c"), c("stale", "d")];
    const { note, cells, looked, runOf } = seeingNote(start);
    cells[0]!.last_run = runOf(cells[0]!, "2026-11-20T08:00:00.000Z");
    cells[1]!.last_run = runOf(cells[1]!, "2026-11-20T11:00:00.000Z");
    cells[2]!.last_run = runOf(cells[2]!, "2026-11-20T10:00:00.000Z");
    cells[3]!.last_run = { ...runOf(cells[3]!, "2026-11-20T11:30:00.000Z"), code_hash: codeHash("older code") };
    const states: string[] = [];
    const ask = vi.fn(async (): Promise<AgentReply> => ({ message: "Looked.", calls: [], done: true, finished: true }));
    await runAgent("what do the plots show?", note, ask, (s) => void (s.status === "working" && states.push(s.doing)), { added: [], changed: [], note: [] }, new AbortController().signal);
    expect(SEE_AT_START).toBe(2);
    expect(looked).toEqual(["new", "mid"]);
    expect(states[0]).toBe("Looking at the figures…");
    expect(JSON.stringify(ask.mock.calls[0])).toContain("it shows: The loss falls to 0.3.");
  });
});
