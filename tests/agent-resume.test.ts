// A request left mid-way (the page closed, another note opened) is picked up again from its last step:
// the loop keeps where it is before every step, and goes on from there when the note is opened again.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAgent, type AgentCheckpoint, type AgentNote, type AgentReply, type AgentRequest } from "@/lib/ai/agent";
import { dropRun, keepRun, keptRun, LEAVING, RESUME_HOURS } from "@/lib/ai/agent-resume";
import { NO_HISTORY } from "@/lib/ai/assistant";

const note = (): AgentNote => ({
  read: async () => ({ title: "T", body: "b", cells: [] }),
  add: async () => "x",
  setCode: async () => {},
  run: async () => {},
  remove: async () => {},
  setBody: async () => {},
  see: vi.fn(async () => {}),
});
const undo = () => ({ added: [], changed: [], note: [] });

describe("the loop keeps where it is, and goes on from there", () => {
  it("a checkpoint before every step; leaving stops it as stopped, not done", async () => {
    const points: AgentCheckpoint[] = [];
    const ctrl = new AbortController();
    const replies: AgentReply[] = [{ message: "Writing.", calls: [{ tool: "write_note", after: "", text: "Line one." }], done: false, plan: ["Write", "Check"] }];
    const ask = vi.fn(async (): Promise<AgentReply> => {
      const r = replies.shift();
      if (r) return r;
      ctrl.abort(LEAVING); // the page is left while it thinks
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    });
    const final = await runAgent("write two lines", note(), ask, () => {}, undo(), ctrl.signal, NO_HISTORY, new Set(), { onCheckpoint: (c) => points.push(c) });
    expect(final.status).toBe("stopped");
    expect(points.map((p) => p.step)).toEqual([0, 1]);
    expect(points[1]!.sent).toHaveLength(1);
    expect(points[1]!.shown[0]!.actions[0]!.text).toContain("note");
    expect(points[1]!.plan?.steps).toEqual(["Write", "Check"]);
  });

  it("picked up again: it goes on from that step with what it had done, without looking at figures again", async () => {
    const n = note();
    const resume: AgentCheckpoint = {
      step: 3,
      sent: [{ message: "Writing.", calls: [{ tool: "write_note", after: "", text: "Line one." }], results: ["Wrote it at the end of the note."] }],
      shown: [{ message: "Writing.", actions: [{ text: "Wrote in the note", tone: "plain" }] }],
      checks: 1,
      nudges: 0,
      plan: { steps: ["Write", "Check"], done: 1 },
    };
    const bodies: AgentRequest[] = [];
    const states: string[] = [];
    const ask = vi.fn(async (body: AgentRequest): Promise<AgentReply> => (bodies.push(body), { message: "Both lines are in.", calls: [], done: true, finished: true }));
    const final = await runAgent("write two lines", n, ask, (s) => void (s.status === "working" && states.push(s.doing)), undo(), new AbortController().signal, NO_HISTORY, new Set(), { resume });
    expect(final.status).toBe("done");
    expect(states[0]).toBe("Picking up where it left off…");
    expect(bodies[0]!.steps).toHaveLength(1);
    expect(bodies[0]!.steps[0]!.results[0]).toBe("Wrote it at the end of the note.");
    expect(final.steps.map((s) => s.message)).toEqual(["Writing.", "Both lines are in."]);
    expect(n.see).not.toHaveBeenCalled();
  });
});

describe("kept on this device", () => {
  let store: Record<string, string>;
  beforeEach(() => {
    store = {};
    vi.stubGlobal("localStorage", { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v), removeItem: (k: string) => void delete store[k] });
  });
  afterEach(() => vi.unstubAllGlobals());

  const kept = { request: "r", voice: false, at: "2026-11-20T10:00:00.000Z", undo: undo(), history: NO_HISTORY, mine: ["c1"], checkpoint: { step: 2, sent: [], shown: [], checks: 0, nudges: 0 } };

  it("reads back what was kept, per note, until it's dropped", () => {
    const t = new Date("2026-11-20T10:00:00.000Z");
    keepRun("n1", kept, t);
    expect(keptRun("n1", t)).toMatchObject({ v: 1, request: "r", mine: ["c1"], checkpoint: { step: 2 } });
    expect(keptRun("n2", t)).toBeNull();
    dropRun("n1");
    expect(keptRun("n1", t)).toBeNull();
  });

  it("a request older than RESUME_HOURS, or a broken record, is let go", () => {
    const t = new Date("2026-11-20T10:00:00.000Z");
    keepRun("n1", kept, t);
    expect(keptRun("n1", new Date(t.getTime() + RESUME_HOURS * 3_600_000 + 1))).toBeNull();
    expect(store["bj-agent-run:n1"]).toBeUndefined();
    store["bj-agent-run:n2"] = "{not json";
    expect(keptRun("n2", t)).toBeNull();
  });

  it("no storage (private mode): nothing kept, nothing thrown", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } });
    expect(() => keepRun("n1", kept)).not.toThrow();
    expect(keptRun("n1")).toBeNull();
    expect(() => dropRun("n1")).not.toThrow();
  });
});
