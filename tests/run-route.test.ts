// /api/run: every account runs on the server, with a GPU when the code needs one; runs that get a GPU
// count against GPU_RUNS.perDay (run_take, failing closed); CPU runs aren't counted. The session and
// Modal are stand-ins here.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextResponse } from "next/server";
import { GPU_RUNS } from "@/config/app";
import type { Session } from "@/lib/server/session";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "ci-placeholder";
});

const rpc = vi.fn<Session["db"]["rpc"]>();
vi.mock("@/lib/server/session", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/session")>();
  return { ...real, requireSession: async () => ({ userId: "u1", db: { rpc } }) satisfies Session };
});
const runAndWait = vi.fn();
vi.mock("@/lib/server/sandbox", () => ({ runAndWait: (...a: unknown[]) => runAndWait(...a) }));

const { POST } = await import("@/app/api/run/route");
const ok = { outcome: "ok", stdout: "1\n", stderr: "", exitCode: 0, ms: 5, line: null, outputs: null };
const takes = () => rpc.mock.calls.filter(([fn]) => fn === "run_take").length;
const post = (code: string, language = "python") => POST(new Request("http://localhost/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ language, code }) }));
const json = async (r: NextResponse | Response) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> });
const CNN = "import torch, torchvision\nfrom torch import nn\ndata = torchvision.datasets.CIFAR10('.', download=True)\nnet = nn.Conv2d(3, 8, 3)\nloss.backward()";

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: 0, error: null });
  runAndWait.mockReset().mockResolvedValue(ok);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/run", () => {
  it("anyone: heavy deep learning gets a GPU, chosen automatically and said why, counted once against the day's GPU runs", async () => {
    const r = await json(await post(CNN));
    expect(r.status).toBe(200);
    expect(runAndWait.mock.calls[0]![2].gpu).toBe("T4");
    expect(r.body.notice).toMatch(/^\[Benchjot\] Ran on a T4 GPU \(chosen automatically: convolutional layers, an image dataset, trains a model\)/);
    expect(rpc).toHaveBeenCalledWith("run_take", { per_day: GPU_RUNS.perDay });
    expect(GPU_RUNS.perDay).toBe(10);
    expect(takes()).toBe(1);
  });

  it("CPU runs aren't counted; small code stays on the CPU silently; # gpu: none wins; # gpu: T4 asks for one", async () => {
    const small = await json(await post("import pandas as pd\nprint(1)"));
    expect(runAndWait.mock.calls[0]![2].gpu).toBeNull();
    expect(small.body.notice).toBeUndefined();
    await post("# gpu: none\n" + CNN);
    expect(runAndWait.mock.calls[1]![2].gpu).toBeNull();
    expect(takes()).toBe(0);
    await post("# gpu: T4\nprint(1)");
    expect(runAndWait.mock.calls[2]![2].gpu).toBe("T4");
    expect(takes()).toBe(1);
  });

  it("past the day's GPU runs: 429 with the wait and how to run on the CPU now; nothing runs", async () => {
    rpc.mockResolvedValue({ data: 7200, error: null });
    const r = await json(await post(CNN));
    expect(r).toEqual({ status: 429, body: { error: `You’ve used today’s ${GPU_RUNS.perDay} GPU runs. More in 2 hours. To run it now on the CPU, add # gpu: none at the top of the cell: its GPU calls (PyTorch, CuPy) move to the CPU, slower.`, code: "notice", retryAfter: 7200 } });
    expect(runAndWait).not.toHaveBeenCalled();
  });

  it("the GPU counter fails closed", async () => {
    for (const setup of [() => rpc.mockResolvedValue({ data: null, error: { message: "db down" } }), () => rpc.mockRejectedValue(new Error("x")), () => rpc.mockResolvedValue({ data: "0", error: null })]) {
      setup();
      expect((await post(CNN)).status).toBe(503);
    }
    expect(runAndWait).not.toHaveBeenCalled();
  });

  it("passes the caller's own dataset keys to the run, and runs without them if they can't be read", async () => {
    rpc.mockImplementation(async (fn) => (fn === "data_tokens" ? { data: { hf_token: "hf_" + "x".repeat(20) }, error: null } : { data: 0, error: null }));
    await post("import datasets");
    expect(runAndWait.mock.calls[0]![4]).toEqual({ HF_TOKEN: "hf_" + "x".repeat(20) });
    expect(runAndWait.mock.calls[0]![5]).toBe("u1"); // whose download cache to mount
    rpc.mockImplementation(async (fn) => (fn === "data_tokens" ? { data: null, error: { message: "down" } } : { data: 0, error: null }));
    expect((await post("print(1)")).status).toBe(200);
    expect(runAndWait.mock.calls[1]![4]).toEqual({});
  });

  it("no # timeout: line on a run that waits: 240 s; R runs here too", async () => {
    await post("print(1)");
    expect(runAndWait.mock.calls[0]![2].timeoutSec).toBe(240);
    expect((await post("x <- 1\nprint(x)", "r")).status).toBe(200);
    expect(runAndWait.mock.calls[1]![0]).toBe("r");
    expect((await post("int main(){ return 0; }", "c")).status).toBe(200); // C runs on the server too
    expect((await post("console.log(1)", "javascript")).status).toBe(400); // not a language here
  });

  it("a GPU run the server couldn't run is given back (with the server's key); a run that ran is not; CPU runs never are", async () => {
    vi.stubEnv("RUN_REFUND_KEY", "server-key");
    runAndWait.mockRejectedValueOnce(new Error("sandbox failed to start"));
    expect((await post(CNN)).status).toBeGreaterThanOrEqual(500);
    expect(rpc).toHaveBeenCalledWith("run_refund", { key: "server-key" });
    rpc.mockClear();
    runAndWait.mockResolvedValueOnce({ ...ok, outcome: "error", exitCode: 1, stderr: "ZeroDivisionError" }); // the code ran and failed: a run
    expect((await post(CNN)).status).toBe(200);
    runAndWait.mockRejectedValueOnce(new Error("down"));
    await post("print(1)"); // a CPU run: nothing was counted, nothing to give back
    expect(rpc.mock.calls.some(([fn]) => fn === "run_refund")).toBe(false);
    vi.unstubAllEnvs();
  });

  it("bad directives are a 400 before anything is counted", async () => {
    expect((await post("# pip: $(whoami)")).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
