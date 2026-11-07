// The Python run's two clocks (src/lib/run/runner.ts): the 30 s time limit counts only from the
// worker's "start" (the user's code), never Pyodide or downloading / importing packages, which
// have their own SETUP_TIMEOUT_MS; Stop works in both. The worker side (python.js, bj_preload.py)
// is checked in tests/bj_preload_test.py and the Pyodide harness, not here.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeWorker } from "./fake-worker";
import { RUN_TIMEOUT_MS, SETUP_TIMEOUT_MS, SETUP_TIMEOUT_TEXT } from "@/lib/run/types";

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal("Worker", FakeWorker);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const start = async () => {
  const { runCode } = await import("@/lib/run/runner");
  const status: string[] = [];
  const run = runCode("python", "import sklearn", { onStatus: (s) => status.push(s), onOutput: () => {} });
  const w = FakeWorker.last!;
  return { run, w, id: w.sent[0]!.id, status };
};
const settled = async (p: Promise<unknown>) => {
  let done = false;
  void p.then(() => (done = true));
  await Promise.resolve();
  return done;
};

describe("Python run timers", () => {
  it("doesn't count setup: a slow package load is not the time limit", async () => {
    const { run, w, id, status } = await start();
    w.reply({ id, type: "status", text: "Loading Python packages…" });
    vi.advanceTimersByTime(RUN_TIMEOUT_MS * 4); // two minutes on a phone link
    expect(await settled(run.done)).toBe(false);
    expect(w.terminated).toBe(false);
    w.reply({ id, type: "start" });
    vi.advanceTimersByTime(RUN_TIMEOUT_MS - 1);
    w.reply({ id, type: "done" });
    await expect(run.done).resolves.toMatchObject({ outcome: "ok" });
    expect(status).toEqual(["Loading Python packages…", ""]);
  });

  it("the time limit starts at start and stops the run", async () => {
    const { run, w, id } = await start();
    vi.advanceTimersByTime(SETUP_TIMEOUT_MS - 1);
    w.reply({ id, type: "start" });
    vi.advanceTimersByTime(RUN_TIMEOUT_MS);
    await expect(run.done).resolves.toMatchObject({ outcome: "timeout" });
    expect(w.terminated).toBe(true);
  });

  it("setup that never finishes fails with its own message after SETUP_TIMEOUT_MS", async () => {
    const { run, w } = await start();
    vi.advanceTimersByTime(SETUP_TIMEOUT_MS);
    await expect(run.done).resolves.toEqual({ outcome: "error", error: { text: SETUP_TIMEOUT_TEXT, line: null }, ms: 0 });
    expect(w.terminated).toBe(true);
    // The next run gets a fresh worker.
    const { runCode } = await import("@/lib/run/runner");
    runCode("python", "print(1)", { onStatus: () => {}, onOutput: () => {} });
    expect(FakeWorker.last).not.toBe(w);
  });

  it("Stop works while packages load", async () => {
    const { run, w, id } = await start();
    w.reply({ id, type: "status", text: "Loading Python packages…" });
    run.stop();
    await expect(run.done).resolves.toMatchObject({ outcome: "stopped", ms: 0 });
    expect(w.terminated).toBe(true);
  });

  it("a setup failure shows the worker's message as is, with no code line", async () => {
    const { run, w, id } = await start();
    const text = "Couldn't download Python packages (scipy). Check your connection and run again.\nTypeError: Failed to fetch";
    w.reply({ id, type: "error", setup: true, text });
    await expect(run.done).resolves.toEqual({ outcome: "error", error: { text, line: null }, ms: 0 });
    vi.advanceTimersByTime(SETUP_TIMEOUT_MS); // no timer left behind
    expect(w.terminated).toBe(false);
  });
});
