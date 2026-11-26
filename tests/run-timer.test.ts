// The Python run's clocks (src/lib/run/runner.ts): no time limit unless the cell sets one
// (`# timeout: 30`); it counts only from the worker's "start" to its "capturing" (the user's code),
// never Pyodide or downloading / importing packages (their own SETUP_TIMEOUT_MS) nor drawing
// figures and GIFs after the code; Stop works throughout. The worker side (python.js, bj_preload.py)
// is checked in tests/bj_preload_test.py and the Pyodide harness, not here.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeWorker } from "./fake-worker";
import { browserTimeoutMs, MAX_BROWSER_TIMEOUT_SEC, SETUP_TIMEOUT_MS, SETUP_TIMEOUT_TEXT } from "@/lib/run/types";

const LIMIT_MS = 30_000; // the cell's # timeout: 30

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal("Worker", FakeWorker);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const start = async (code = "# timeout: 30\nimport sklearn") => {
  const { runCode } = await import("@/lib/run/runner");
  const status: string[] = [];
  const run = runCode("python", code, { onStatus: (s) => status.push(s), onOutput: () => {} });
  const w = FakeWorker.last!;
  return { run, w, id: w.sent[0]!.id, status };
};
const settled = async (p: Promise<unknown>) => {
  let done = false;
  void p.then(() => (done = true));
  await Promise.resolve();
  return done;
};

describe("browserTimeoutMs", () => {
  it("reads the cell's # timeout: line (seconds), none by default", () => {
    expect(browserTimeoutMs("print(1)")).toBeNull();
    expect(browserTimeoutMs("# timeout: 90\nprint(1)")).toBe(90_000);
    expect(browserTimeoutMs("# Timeout: 45s")).toBe(45_000);
    expect(browserTimeoutMs("# timeout: none")).toBeNull();
    expect(browserTimeoutMs("# timeout: 999999")).toBe(MAX_BROWSER_TIMEOUT_SEC * 1000);
    expect(browserTimeoutMs("# timeout: soon")).toBeNull();
    expect(browserTimeoutMs("# timeout: 20\nx <- 1")).toBe(20_000); // R cells use the same line
    expect(browserTimeoutMs("// timeout: 20")).toBeNull();
  });
});

describe("Python run timers", () => {
  it("doesn't count setup: a slow package load is not the time limit", async () => {
    const { run, w, id, status } = await start();
    w.reply({ id, type: "status", text: "Loading Python packages…" });
    vi.advanceTimersByTime(LIMIT_MS * 4); // two minutes on a phone link
    expect(await settled(run.done)).toBe(false);
    expect(w.terminated).toBe(false);
    w.reply({ id, type: "start" });
    vi.advanceTimersByTime(LIMIT_MS - 1);
    w.reply({ id, type: "done" });
    await expect(run.done).resolves.toMatchObject({ outcome: "ok" });
    expect(status).toEqual(["Loading Python packages…", ""]);
  });

  it("the time limit starts at start and stops the run", async () => {
    const { run, w, id } = await start();
    vi.advanceTimersByTime(SETUP_TIMEOUT_MS - 1);
    w.reply({ id, type: "start" });
    vi.advanceTimersByTime(LIMIT_MS);
    await expect(run.done).resolves.toMatchObject({ outcome: "timeout", limitMs: LIMIT_MS });
    expect(w.terminated).toBe(true);
  });

  it("no # timeout: line, no limit: an hour-long run keeps going until it's done or stopped", async () => {
    const { run, w, id } = await start("import numpy");
    w.reply({ id, type: "start" });
    vi.advanceTimersByTime(60 * 60_000);
    expect(await settled(run.done)).toBe(false);
    w.reply({ id, type: "done" });
    await expect(run.done).resolves.toMatchObject({ outcome: "ok" });
  });

  it("drawing figures and GIFs after the code doesn't count toward the limit", async () => {
    const { run, w, id, status } = await start();
    w.reply({ id, type: "start" });
    vi.advanceTimersByTime(LIMIT_MS - 1_000);
    w.reply({ id, type: "capturing" });
    vi.advanceTimersByTime(LIMIT_MS * 3); // a slow phone drawing a 120-frame GIF
    w.reply({ id, type: "done" });
    await expect(run.done).resolves.toMatchObject({ outcome: "ok" });
    expect(status).toContain("Drawing figures…");
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

  it("code the browser can't run (TensorFlow, …) comes back marked needsServer", async () => {
    const { run, w, id } = await start();
    const text = "TensorFlow doesn't run in the browser (no WebAssembly build).";
    w.reply({ id, type: "error", setup: true, server: true, text });
    await expect(run.done).resolves.toEqual({ outcome: "error", error: { text, line: null }, ms: 0, needsServer: true });
  });
});
