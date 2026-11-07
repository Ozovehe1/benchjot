// renderFigure: a kept figure's SVG / PDF from the Pyodide worker (public/workers/python.js
// answers { type: "rendered" } or { type: "error", user }). The worker is a fake here; the
// Python side (bj_capture.render) is tested in tests/bj_capture_test.py.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Msg = { id: number; render?: { data: Uint8Array; format: string; matplotlib?: string }; code?: string };

class FakeWorker extends EventTarget {
  static last: FakeWorker | null = null;
  sent: Msg[] = [];
  terminated = false;
  constructor(public url: string) {
    super();
    FakeWorker.last = this;
  }
  postMessage(m: Msg) {
    this.sent.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  reply(data: object) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("Worker", FakeWorker);
});
afterEach(() => vi.unstubAllGlobals());

// Fresh modules per test (the warm worker is module state); FriendlyError from the same graph.
const load = async () => ({ ...(await import("@/lib/run/runner")), FriendlyError: (await import("@/lib/user-message")).FriendlyError });

describe("renderFigure", () => {
  it("asks the Python worker for the format and resolves with its bytes", async () => {
    const { renderFigure } = await load();
    const data = new Uint8Array([1, 2, 3]);
    const p = renderFigure(data, "svg", "3.8.4");
    const w = FakeWorker.last!;
    expect(w.url).toBe("/workers/python.js");
    const [m] = w.sent;
    expect(m!.render).toEqual({ data, format: "svg", matplotlib: "3.8.4" });
    expect(m!.render!.data).not.toBe(data); // a copy is transferred, the caller keeps its bytes
    w.reply({ id: m!.id + 1, type: "rendered", data: new Uint8Array([9]) }); // someone else's answer
    w.reply({ id: m!.id, type: "rendered", data: new Uint8Array([7]) });
    await expect(p).resolves.toEqual(new Uint8Array([7]));
  });

  it("shows Python's own message for a figure it can't make, and fails plainly otherwise", async () => {
    const { renderFigure, FriendlyError } = await load();
    const a = renderFigure(new Uint8Array(), "pdf", "3.10.9");
    const w = FakeWorker.last!;
    w.reply({ id: w.sent[0]!.id, type: "error", text: "Traceback…\nbj_capture.RenderError: made with 3.10", user: "made with 3.10" });
    const e = await a.catch((x) => x);
    expect(e).toBeInstanceOf(FriendlyError);
    expect(e.message).toBe("made with 3.10");
    const b = renderFigure(new Uint8Array(), "pdf", undefined);
    w.reply({ id: w.sent[1]!.id, type: "error", text: "MemoryError", user: null });
    const e2 = await b.catch((x) => x);
    expect(e2).not.toBeInstanceOf(FriendlyError);
    expect(e2.message).toBe("MemoryError");
  });

  it("shares the warm worker with runs, and fails when a Stop throws it away", async () => {
    const { renderFigure, runCode, FriendlyError } = await load();
    const run = runCode("python", "while True: pass", { onStatus: () => {}, onOutput: () => {} });
    const w = FakeWorker.last!;
    const p = renderFigure(new Uint8Array([1]), "svg", "3.8.4");
    expect(FakeWorker.last).toBe(w);
    run.stop();
    expect(w.terminated).toBe(true);
    await expect(p).rejects.toBeInstanceOf(FriendlyError);
    await expect(run.done).resolves.toMatchObject({ outcome: "stopped" });
  });
});
