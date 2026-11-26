// The page following a background run (src/lib/run/server-client.ts followBackgroundRun): status
// with the time so far, polling through dropped connections, the result once done, Stop.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { elapsedText, followBackgroundRun, pollDelay, runStatusText, timingNote, type BackgroundRun } from "@/lib/run/server-client";

const START = new Date("2026-11-18T10:00:00Z").getTime();
const running: BackgroundRun = { id: "r1", status: "running", startedAt: new Date(START).toISOString(), limitSec: 3600 };
const fetchMock = vi.fn<typeof fetch>();
const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("elapsedText / pollDelay", () => {
  it("formats like a stopwatch and asks less often as a run goes on", () => {
    expect(elapsedText(0)).toBe("0:00");
    expect(elapsedText(252_000)).toBe("4:12");
    expect(elapsedText(3_725_000)).toBe("1:02:05");
    expect([pollDelay(10_000), pollDelay(5 * 60_000), pollDelay(30 * 60_000)]).toEqual([2_000, 5_000, 10_000]);
  });
});

describe("what the cell says while a run is going", () => {
  const t0 = Date.parse(running.startedAt);
  it("starting: the wait so far; running: the code's own clock and latest line; then saving", () => {
    expect(runStatusText(running, t0 + 25_000, null)).toBe("Starting server · 0:25");
    const live = { ...running, live: { phase: "running" as const, elapsedSec: 40, line: "epoch 3: loss 0.412" } };
    expect(runStatusText(live, t0 + 90_000, t0 + 88_000)).toBe("Running · 0:42 · epoch 3: loss 0.412"); // 40 s + 2 s since it was read
    expect(runStatusText({ ...live, live: { ...live.live, line: "" } }, t0 + 90_000, t0 + 90_000)).toBe("Running · 0:40");
    expect(runStatusText({ ...live, live: { ...live.live, line: "y".repeat(200) } }, t0, t0)).toHaveLength("Running · 0:40 · ".length + 70);
    expect(runStatusText({ ...live, live: { ...live.live, phase: "saving" } }, t0, t0)).toBe("Saving results…");
    expect(runStatusText(live, t0 + 65_000, t0, true)).toBe("Reconnecting… · 1:05");
  });
  it("the finished run says how the time was spent, when there was a real wait", () => {
    expect(timingNote(458_000, 21_000)).toBe("[Benchjot] Server ready in 7:17; your code ran for 21 s.\n");
    expect(timingNote(40_000, 12_000)).toBe("[Benchjot] Server ready in 28 s; your code ran for 12 s.\n");
    expect(timingNote(14_000, 12_000)).toBe(""); // no wait worth a line
  });
});

describe("followBackgroundRun", () => {
  it("shows the time running, then the result with its notice first", async () => {
    const status: string[] = [];
    const out: [string, string][] = [];
    fetchMock
      .mockResolvedValueOnce(ok(running))
      .mockResolvedValueOnce(ok({ ...running, status: "done", notice: "[Benchjot] Ran on a T4 GPU\n", result: { outcome: "ok", stdout: "epoch 1\n", stderr: "", exitCode: 0, ms: 90_000, line: null, outputs: null } }));
    const h = followBackgroundRun(running, (s, t) => out.push([s, t]), (s) => status.push(s));
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(2_000);
    const r = await h.done;
    expect(r).toMatchObject({ outcome: "ok", ms: 90_000, serverRunId: "r1" });
    expect(out).toEqual([["stderr", "[Benchjot] Ran on a T4 GPU\n"], ["stdout", "epoch 1\n"]]); // 4 s in all, the code 90 s: no timing line
    expect(status[0]).toBe("Starting server · 0:00");
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/runs/r1");
  });

  it("moves from Starting to Running with the code's latest line, ticking between checks", async () => {
    const status: string[] = [];
    fetchMock
      .mockResolvedValueOnce(ok(running))
      .mockResolvedValueOnce(ok({ ...running, live: { phase: "running", elapsedSec: 3, line: "epoch 1: loss 0.9" } }))
      .mockResolvedValueOnce(ok({ ...running, live: { phase: "saving", elapsedSec: 9, line: "" } }))
      .mockResolvedValue(ok({ ...running, status: "done", result: { outcome: "ok", stdout: "", stderr: "", exitCode: 0, ms: 9000, line: null } }));
    const h = followBackgroundRun(running, () => {}, (s) => status.push(s));
    await vi.advanceTimersByTimeAsync(9_000);
    await h.done;
    const seen = [...new Set(status)];
    expect(seen[0]).toBe("Starting server · 0:00");
    expect(seen).toContain("Starting server · 0:02");
    expect(seen.some((s) => /^Running · 0:0[3-5] · epoch 1: loss 0\.9$/.test(s))).toBe(true);
    expect(seen).toContain("Saving results…");
  });

  it("keeps going through a dropped connection", async () => {
    const status: string[] = [];
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(ok({ ...running, status: "done", result: { outcome: "ok", stdout: "", stderr: "", exitCode: 0, ms: 1, line: null } }));
    const h = followBackgroundRun(running, () => {}, (s) => status.push(s));
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(h.done).resolves.toMatchObject({ outcome: "ok" });
    expect(status.some((s) => s.startsWith("Reconnecting…"))).toBe(true);
  });

  it("Stop asks the server to stop the run", async () => {
    fetchMock.mockResolvedValue(ok({ ...running, status: "stopped" }));
    const h = followBackgroundRun(running, () => {}, () => {});
    h.stop();
    await expect(h.done).resolves.toMatchObject({ outcome: "stopped", serverRunId: "r1" });
    expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1", { method: "DELETE" });
  });

  it("a failed run shows why; a finished run already known needs no request", async () => {
    await expect(followBackgroundRun({ ...running, status: "failed", error: "The server run couldn’t start." }, () => {}, () => {}).done).resolves.toMatchObject({ outcome: "error", error: { text: "The server run couldn’t start." } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
