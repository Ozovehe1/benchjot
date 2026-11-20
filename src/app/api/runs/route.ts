// POST /api/runs — start a background server run (Python, up to an hour): answers at once
// with the run (RunState); the page polls GET /api/runs/[id]; the sandbox sends its result to
// /api/runs/[id]/complete, stored even if no page is open. Same checks as /api/run (run-prep.ts),
// plus how many runs one user may have going (MAX_ACTIVE_RUNS).
import { NextResponse } from "next/server";
import { appOrigin, newRunToken, overdue, toRunState, type RunMeta } from "@/lib/server/background-runs";
import { startInBackground } from "@/lib/server/sandbox";
import { prepareRun, refundGpuRun, runEnv, takeGpuRun } from "@/lib/server/run-prep";
import { apiError, jsonError } from "@/lib/server/session";
import { errorFacts, upstreamFailure } from "@/lib/ui/user-message";
import { MAX_ACTIVE_RUNS } from "@/lib/run/server-languages";

export const runtime = "nodejs";
// Starting can include building a new `# pip:` layer; the run itself never waits here.
export const maxDuration = 300;

const COLUMNS = "id, status, started_at, limit_sec, notice, result, error, sandbox_id";

export async function POST(request: Request) {
  const run = await prepareRun(request, false);
  if (run instanceof NextResponse) return run;
  if (run.language !== "python") return jsonError(400, "Background runs are for Python. Other languages run with /api/run.");
  const from = run.session.db.from;
  if (!from) return apiError("server", 500, "run_server");

  // Runs still going (a "running" row past its deadline is lost: marked failed, not counted).
  const { data: active, error } = await from("server_runs").select("id, started_at, limit_sec").eq("status", "running");
  if (error) {
    console.error("server_runs read failed", error);
    return apiError("server", 503, "run_server");
  }
  const lost = (active ?? []).filter((r) => overdue(r.started_at, r.limit_sec)).map((r) => r.id);
  if (lost.length) await from("server_runs").update({ status: "failed", error: "The server run ended without sending its result.", finished_at: new Date().toISOString() }).in("id", lost);
  const going = (active ?? []).length - lost.length;
  const max = MAX_ACTIVE_RUNS;
  if (going >= max) return jsonError(429, `You have ${going} server run${going === 1 ? "" : "s"} going (at most ${max}). Wait for one to finish, or stop one.`);

  const refused = await takeGpuRun(run.session, run.directives);
  if (refused) return refused;
  const env = await runEnv(run.session, request);
  const { token, hash } = newRunToken();
  const meta: RunMeta = { language: run.language, gpu: run.directives.gpu, network: run.directives.network };
  const inserted = await from("server_runs")
    .insert({ cell_id: run.cellId ?? null, limit_sec: run.directives.timeoutSec, token_hash: hash, notice: run.notice || null, meta })
    .select(COLUMNS)
    .single();
  if (inserted.error || !inserted.data) {
    await refundGpuRun(run.session, run.directives);
    console.error("server_runs insert failed", inserted.error);
    return apiError("server", 503, "run_server");
  }
  const row = inserted.data;
  const origin = appOrigin(request);
  try {
    const { sandboxId, note } = await startInBackground(run.code, run.directives, env, { callback: `${origin}/api/runs/${row.id}/complete`, token, appHost: new URL(origin).host, userId: run.session.userId });
    await from("server_runs").update({ sandbox_id: sandboxId, ...(note ? { meta: { ...meta, note } } : {}) }).eq("id", row.id);
  } catch (e) {
    console.error("background run start failed", e);
    // It never started: not one of the day's GPU runs.
    await refundGpuRun(run.session, run.directives);
    await from("server_runs").update({ status: "failed", error: "The server run couldn’t start.", finished_at: new Date().toISOString() }).eq("id", row.id);
    const f = upstreamFailure(errorFacts(e));
    return apiError(f.kind, f.status, "run_server", f.retryAfter);
  }
  return NextResponse.json(toRunState(row));
}
