// Background server runs: POST /api/runs (start), GET / DELETE /api/runs/[id], and the sandbox's
// POST /api/runs/[id]/complete. The session, the database tables and Modal are stand-ins here; the
// SQL itself is tested in tests/server-runs-sql.test.ts and the sandbox side in tests/bj_job_test.py.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/server/session";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "ci-placeholder";
});

/** One table call as the routes make it: the chain of methods and their arguments. */
type Op = { table: string; calls: [string, unknown[]][] };
let ops: Op[] = [];
let answer: (op: Op) => { data: unknown; error: unknown } = () => ({ data: null, error: null });

function table(name: string) {
  const op: Op = { table: name, calls: [] };
  ops.push(op);
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "update", "insert", "order", "limit", "single", "maybeSingle"]) {
    q[m] = (...args: unknown[]) => {
      op.calls.push([m, args]);
      return q;
    };
  }
  q.then = (resolve: (v: unknown) => void) => resolve(answer(op));
  return q;
}
const kind = (op: Op) => op.calls[0]?.[0];
const arg = (op: Op, m: string) => op.calls.find(([n]) => n === m)?.[1];

const rpc = vi.fn<Session["db"]["rpc"]>();
vi.mock("@/lib/server/session", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/session")>();
  return { ...real, requireSession: async () => ({ userId: "u1", db: { rpc, from: table as unknown as NonNullable<Session["db"]["from"]> } }) };
});

// requireSession itself, with a client whose methods need `this` (as supabase-js's do): a route
// that takes `from` off `db` must still work (the production bug of 2026-11-18).
describe("requireSession's db", () => {
  it("gives methods that work detached from the client", async () => {
    vi.resetModules();
    vi.doUnmock("@/lib/server/session");
    class Client {
      rest = "ok";
      auth = { getUser: async () => ({ data: { user: { id: "u1" } } }) };
      from(t: string) {
        if (t === "profiles") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { plan: "free" } }) }) }) };
        return `${this.rest}:${t}`;
      }
      rpc(fn: string) {
        return Promise.resolve({ data: `${this.rest}:${fn}`, error: null });
      }
    }
    vi.doMock("@/lib/data/supabase/server", () => ({ serverSupabase: async () => new Client(), tokenSupabase: () => new Client(), anonSupabase: () => new Client() }));
    const { requireSession } = await import("@/lib/server/session");
    const s = (await requireSession(new Request("http://x"))) as Session;
    const { from, rpc: call } = s.db;
    expect(from!("server_runs")).toBe("ok:server_runs");
    expect((await call("run_take")).data).toBe("ok:run_take");
    vi.doUnmock("@/lib/data/supabase/server");
    vi.doMock("@/lib/data/supabase/server", () => ({ anonSupabase: () => ({ rpc: anonRpc }) }));
  });
});
const startInBackground = vi.fn();
const stopRun = vi.fn();
const isRunning = vi.fn();
const liveStatus = vi.fn();
vi.mock("@/lib/server/sandbox", () => ({
  liveStatus: (...a: unknown[]) => liveStatus(...a),
  startInBackground: (...a: unknown[]) => startInBackground(...a),
  stopRun: (...a: unknown[]) => stopRun(...a),
  isRunning: (...a: unknown[]) => isRunning(...a),
}));
const anonRpc = vi.fn();
vi.mock("@/lib/data/supabase/server", () => ({ anonSupabase: () => ({ rpc: anonRpc }) }));

const { POST: start } = await import("@/app/api/runs/route");
const { GET: status, DELETE: stop } = await import("@/app/api/runs/[id]/route");
const { POST: complete } = await import("@/app/api/runs/[id]/complete/route");

const RUN_ID = "9f000000-0000-4000-8000-0000000000aa";
const CELL = "9f000000-0000-4000-8000-0000000000bb";
const row = (over: Record<string, unknown> = {}) => ({ id: RUN_ID, status: "running", started_at: new Date().toISOString(), limit_sec: 600, notice: null, result: null, error: null, sandbox_id: "sb-1", ...over });
const json = async (r: Response) => ({ status: r.status, body: r.status === 204 ? null : ((await r.json()) as Record<string, unknown>) });
const startReq = (code: string, language = "python") => new Request("https://benchjot.vercel.app/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ language, code, cellId: CELL }) });
const params = (id = RUN_ID) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  ops = [];
  rpc.mockReset().mockResolvedValue({ data: 0, error: null });
  startInBackground.mockReset().mockResolvedValue({ sandboxId: "sb-1", note: "" });
  stopRun.mockReset().mockResolvedValue(undefined);
  isRunning.mockReset().mockResolvedValue(true);
  liveStatus.mockReset().mockResolvedValue(null);
  anonRpc.mockReset();
  answer = (op) => (kind(op) === "insert" ? { data: row(), error: null } : kind(op) === "select" ? { data: [], error: null } : { data: null, error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/runs", () => {
  it("starts a Python run up to an hour, for anyone: a row, then the sandbox with its callback and token", async () => {
    const r = await json(await start(startReq("# timeout: 3600\nimport torch\nprint(1)")));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: RUN_ID, status: "running", limitSec: 600 });
    const insert = ops.find((o) => kind(o) === "insert")!;
    const inserted = arg(insert, "insert")![0] as Record<string, unknown>;
    expect(inserted).toMatchObject({ cell_id: CELL, limit_sec: 3600, meta: { language: "python", gpu: null, network: "datasets" } });
    expect(inserted.token_hash).toMatch(/^[0-9a-f]{64}$/);
    const [code, d, , job] = startInBackground.mock.calls[0]!;
    expect(code).toContain("import torch");
    expect(d.timeoutSec).toBe(3600);
    expect(job).toMatchObject({ callback: `https://benchjot.vercel.app/api/runs/${RUN_ID}/complete`, appHost: "benchjot.vercel.app", userId: "u1" });
    expect(job.token).toMatch(/^[0-9a-f]{64}$/);
    expect(job.token).not.toBe(inserted.token_hash); // only the hash is stored
    const saved = ops.find((o) => kind(o) === "update" && (arg(o, "update")![0] as Record<string, unknown>).sandbox_id);
    expect(arg(saved!, "update")![0]).toEqual({ sandbox_id: "sb-1" });
  });

  it("no # timeout: line: the full hour; a cell's own limit is kept", async () => {
    await start(startReq("import torch"));
    expect(startInBackground.mock.calls[0]![1].timeoutSec).toBe(3600);
    await start(startReq("# timeout: 300\nimport torch"));
    expect(startInBackground.mock.calls[1]![1].timeoutSec).toBe(300);
  });

  it("other languages, and more than the active-run limit, are refused before anything starts", async () => {
    expect((await start(startReq("int main(){}", "c"))).status).toBe(400);
    answer = (op) => (kind(op) === "select" ? { data: [{ id: "a", started_at: new Date().toISOString(), limit_sec: 600 }, { id: "b", started_at: new Date().toISOString(), limit_sec: 600 }, { id: "c", started_at: new Date().toISOString(), limit_sec: 600 }], error: null } : { data: null, error: null });
    const r = await json(await start(startReq("print(1)")));
    expect(r.status).toBe(429);
    expect(r.body!.error).toMatch(/3 server runs going/);
    expect(startInBackground).not.toHaveBeenCalled();
  });

  it("a lost run (past its deadline) doesn't count and is marked failed", async () => {
    const old = new Date(Date.now() - 3 * 3600_000).toISOString();
    answer = (op) => (kind(op) === "select" ? { data: [{ id: "lost", started_at: old, limit_sec: 600 }, { id: "a", started_at: new Date().toISOString(), limit_sec: 600 }, { id: "b", started_at: new Date().toISOString(), limit_sec: 600 }], error: null } : kind(op) === "insert" ? { data: row(), error: null } : { data: null, error: null });
    expect((await start(startReq("print(1)"))).status).toBe(200);
    const failed = ops.find((o) => kind(o) === "update" && (arg(o, "update")![0] as Record<string, unknown>).status === "failed")!;
    expect(arg(failed, "in")).toEqual(["id", ["lost"]]);
  });

  it("a GPU run counts against the day's GPU runs; a CPU run doesn't; past them, nothing starts", async () => {
    const CNN = "import torch\nfrom torch import nn\nnet = nn.Conv2d(3, 8, 3).cuda()\nloss.backward()";
    expect((await start(startReq("print(1)"))).status).toBe(200);
    expect(rpc.mock.calls.some(([fn]) => fn === "run_take")).toBe(false);
    expect((await start(startReq(CNN))).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("run_take", { per_day: 10 });
    expect(startInBackground.mock.calls[1]![1].gpu).toBe("T4");
    rpc.mockImplementation(async (fn: string) => ({ data: fn === "run_take" ? 3600 : null, error: null }) as never);
    const r = await json(await start(startReq(CNN)));
    expect(r.status).toBe(429);
    expect(r.body!.error).toMatch(/today’s 10 GPU runs.*# gpu: none/);
    expect(startInBackground).toHaveBeenCalledTimes(2);
  });

  it("a GPU run that couldn't start is given back", async () => {
    vi.stubEnv("RUN_REFUND_KEY", "server-key");
    startInBackground.mockRejectedValue(new Error("image build failed"));
    expect((await start(startReq("# gpu: T4\nprint(1)"))).status).toBeGreaterThanOrEqual(500);
    expect(rpc.mock.calls.map(([fn]) => fn)).toEqual(expect.arrayContaining(["run_take", "run_refund"]));
    vi.unstubAllEnvs();
  });

  it("a sandbox that can't start marks the run failed", async () => {
    startInBackground.mockRejectedValue(new Error("image build failed"));
    expect((await start(startReq("print(1)"))).status).toBeGreaterThanOrEqual(500);
    const failed = ops.find((o) => kind(o) === "update" && (arg(o, "update")![0] as Record<string, unknown>).status === "failed")!;
    expect(arg(failed, "eq")).toEqual(["id", RUN_ID]);
  });
});

describe("GET / DELETE /api/runs/[id]", () => {
  it("answers the run's state, with its result once done", async () => {
    answer = () => ({ data: row({ status: "done", result: { outcome: "ok", stdout: "1\n" }, notice: "[Benchjot] Ran on a T4 GPU" }), error: null });
    const r = await json(await status(new Request("http://x"), params()));
    expect(r.body).toMatchObject({ id: RUN_ID, status: "done", notice: "[Benchjot] Ran on a T4 GPU", result: { outcome: "ok", stdout: "1\n" } });
  });

  it("a run past its deadline whose sandbox ended is failed; one still running isn't", async () => {
    const old = new Date(Date.now() - 2 * 3600_000).toISOString();
    answer = (op) => (kind(op) === "select" ? { data: row({ started_at: old }), error: null } : { data: null, error: null });
    isRunning.mockResolvedValue(true);
    expect((await json(await status(new Request("http://x"), params()))).body!.status).toBe("running");
    isRunning.mockResolvedValue(false);
    expect((await json(await status(new Request("http://x"), params()))).body).toMatchObject({ status: "failed", error: "The server run ended without sending its result." });
  });

  it("while running: what the sandbox says it is doing, cleaned; nothing when it can't say", async () => {
    answer = () => ({ data: row(), error: null });
    expect((await json(await status(new Request("http://x"), params()))).body!.live).toBeUndefined();
    liveStatus.mockResolvedValue({ phase: "running", elapsedSec: 42.5, line: "epoch 3: loss 0.412\u001b[0m" + "x".repeat(300) });
    const live = (await json(await status(new Request("http://x"), params()))).body!.live as { phase: string; elapsedSec: number; line: string };
    expect(live.phase).toBe("running");
    expect(live.elapsedSec).toBe(42.5);
    expect(live.line.startsWith("epoch 3: loss 0.412 [0m")).toBe(true);
    expect(live.line).toHaveLength(160);
    liveStatus.mockResolvedValue({ phase: "<script>", line: 5 }); // not a status: ignored
    expect((await json(await status(new Request("http://x"), params()))).body!.live).toBeUndefined();
  });

  it("someone else's run, or a bad id, is not found", async () => {
    answer = () => ({ data: null, error: null }); // RLS: no row
    expect((await status(new Request("http://x"), params())).status).toBe(404);
    expect((await status(new Request("http://x"), params("../etc"))).status).toBe(404);
  });

  it("stop marks the row stopped first, then ends the sandbox", async () => {
    answer = (op) => (kind(op) === "select" ? { data: row(), error: null } : { data: null, error: null });
    const r = await json(await stop(new Request("http://x", { method: "DELETE" }), params()));
    expect(r.body!.status).toBe("stopped");
    expect(stopRun).toHaveBeenCalledWith("sb-1");
    const upd = ops.find((o) => kind(o) === "update")!;
    expect(arg(upd, "update")![0]).toMatchObject({ status: "stopped" });
  });
});

describe("POST /api/runs/[id]/complete", () => {
  const TOKEN = "c".repeat(64);
  const body = (over: Record<string, unknown> = {}) => new Request("http://x", { method: "POST", body: JSON.stringify({ token: TOKEN, exitCode: 0, stdout: "hello\n", stderr: "", ms: 1234, ...over }) });

  it("with the run's token: builds the result as a waiting run would and stores it", async () => {
    anonRpc.mockImplementation(async (fn: string) => (fn === "server_run_meta" ? { data: { language: "python", gpu: null, network: "datasets" }, error: null } : { data: true, error: null }));
    expect((await complete(body(), params())).status).toBe(204);
    const [fn, args] = anonRpc.mock.calls[1]!;
    expect(fn).toBe("complete_server_run");
    expect(args).toMatchObject({ run_id: RUN_ID, token: TOKEN, result: { outcome: "ok", stdout: "hello\n", exitCode: 0, ms: 1234, line: null } });
  });

  it("a wrong token, or a stopped run, is refused and stores nothing", async () => {
    anonRpc.mockResolvedValue({ data: null, error: null });
    expect((await complete(body(), params())).status).toBe(403);
    expect(anonRpc).toHaveBeenCalledTimes(1);
  });

  it("malformed bodies are refused before the database", async () => {
    expect((await complete(body({ token: "short" }), params())).status).toBe(400);
    expect((await complete(new Request("http://x", { method: "POST", body: "nope" }), params())).status).toBe(400);
    expect(anonRpc).not.toHaveBeenCalled();
  });

  it("a database failure answers 503 so the sandbox tries again", async () => {
    anonRpc.mockResolvedValue({ data: null, error: { message: "down" } });
    expect((await complete(body(), params())).status).toBe(503);
  });
});
