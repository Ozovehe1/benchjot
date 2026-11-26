// The live conversation (lib/ai/agent.ts LIVE): Claude's own turns are kept and sent back unchanged,
// each tool call answered by its id, so it keeps its reasoning between steps and reads the rest from
// the prompt cache. Past its size limit, or without turns, the request goes on the older way.
import { afterEach, describe, expect, it } from "vitest";
import { agentClock, liveAnswer, pendingOf, runAgent, type AgentCell, type AgentReply, type LiveMessage } from "@/lib/ai/agent";

const cell = (id: string, content: string): AgentCell => ({ id, language: "python", content, last_run: null, note_before: "", note_after: "" });
const realSleep = agentClock.sleep;
afterEach(() => {
  agentClock.sleep = realSleep;
});

function fakeNote(cells: AgentCell[] = []) {
  let body = "body";
  return {
    read: async () => ({ title: "T", body, outcome: "", cells: [...cells] }),
    addCell: async (language: string, code: string) => (cells.push(cell(`c${cells.length + 1}`, code)), `c${cells.length}`),
    editCell: async () => {},
    deleteCell: async () => {},
    runCell: async () => ({ ok: true, output: "printed 1", seconds: 1 }),
    setBody: async (b: string) => void (body = b),
  };
}

describe("liveAnswer", () => {
  const turn: LiveMessage = {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "text", text: "Running it." },
      { type: "tool_use", id: "t1", name: "run_cell", input: { cell: 1 } },
      { type: "tool_use", id: "t2", name: "set_plan", input: { steps: ["a", "b"], done: 0 } },
      { type: "tool_use", id: "t3", name: "add_cell", input: {} },
    ],
  };
  it("answers every tool call by its id, plans and unmade calls included, then the notes", () => {
    const a = liveAnswer(turn, [{ id: "t1", text: "Cell 1 printed 1." }], ["An add_cell call wasn't made."])!;
    expect(a.role).toBe("user");
    expect(a.content).toEqual([
      { type: "tool_result", tool_use_id: "t1", content: "Cell 1 printed 1." },
      { type: "tool_result", tool_use_id: "t2", content: "Plan updated." },
      { type: "tool_result", tool_use_id: "t3", content: "This call wasn't made: see the note below." },
      { type: "text", text: "An add_cell call wasn't made." },
    ]);
  });
  it("after a turn that wasn't kept (cut off), only the notes", () => {
    expect(liveAnswer({ role: "user", content: [{ type: "text", text: "x" }] }, [], ["Shorter, please."])).toEqual({ role: "user", content: [{ type: "text", text: "Shorter, please." }] });
    expect(liveAnswer(undefined, [], [])).toBeNull();
  });
});

describe("pendingOf", () => {
  it("results by id when every call has one; the rest are notes", () => {
    expect(pendingOf(["a", "b"], 2, ["r1", "r2", "problem"])).toEqual({ results: [{ id: "a", text: "r1" }, { id: "b", text: "r2" }], notes: ["problem"] });
  });
  it("without ids, all of it as text", () => {
    expect(pendingOf(undefined, 1, ["r1"])).toEqual({ results: [], notes: ["Results of your calls:\n1. r1"] });
    expect(pendingOf(undefined, 0, ["Check cell 2."])).toEqual({ results: [], notes: ["Check cell 2."] });
  });
});

describe("runAgent keeps the live conversation", () => {
  it("sends Claude's turns back unchanged, each call's result by its id, and the note only once", async () => {
    const bodies: Record<string, unknown>[] = [];
    const first: LiveMessage[] = [
      { role: "user", content: [{ type: "text", text: "Request: go" }] },
      { role: "assistant", content: [{ type: "thinking", thinking: "", signature: "s1" }, { type: "tool_use", id: "t1", name: "run_cell", input: { cell: 1 } }] },
    ];
    let n = 0;
    const ask = async (b: unknown) => {
      bodies.push(structuredClone(b) as Record<string, unknown>);
      if (++n === 1) return { message: "", calls: [{ tool: "run_cell", cell: 1 }], ids: ["t1"], done: false, turns: first } as AgentReply;
      return { message: "It prints 1.", calls: [], done: true, finished: true, turns: [{ role: "user", content: [{ type: "text", text: "x" }] }] } as AgentReply;
    };
    const end = await runAgent("go", fakeNote([cell("u1", "print(1)")]) as never, ask, () => {}, { added: [], changed: [], note: [] }, new AbortController().signal);
    expect(end.status).toBe("done");
    expect(bodies[0]).toMatchObject({ live: true, transcript: [], results: [], notes: [] });
    expect(String(bodies[0]!.note)).toContain("print(1)");
    expect(bodies[1]).toMatchObject({ live: true, transcript: first, note: "", steps: [] });
    expect((bodies[1]!.results as { id: string; text: string }[])[0]!.id).toBe("t1");
    expect(bodies[1]!.language).toBe(bodies[0]!.language);
  });
  it("a reply without turns (an old server) goes on the older way, rebuilt from the steps", async () => {
    const bodies: Record<string, unknown>[] = [];
    let n = 0;
    const ask = async (b: unknown) => {
      bodies.push(structuredClone(b) as Record<string, unknown>);
      if (++n === 1) return { message: "", calls: [{ tool: "run_cell", cell: 1 }], done: false } as AgentReply;
      return { message: "Done.", calls: [], done: true, finished: true } as AgentReply;
    };
    await runAgent("go", fakeNote([cell("u1", "print(1)")]) as never, ask, () => {}, { added: [], changed: [], note: [] }, new AbortController().signal);
    expect(bodies[1]!.live).toBeUndefined();
    expect((bodies[1]!.steps as unknown[]).length).toBe(1);
  });
});
