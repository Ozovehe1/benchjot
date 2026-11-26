// POST /api/run — run a cell on a Modal Sandbox and wait for its result (up to
// SYNC_MAX_TIMEOUT_SEC): R cells, and the Android app. The web app runs Python as a background
// run instead (/api/runs). Checks shared with it: lib/server/run-prep.ts.
import { NextResponse } from "next/server";
import { runAndWait } from "@/lib/server/sandbox";
import { prepareRun, refundGpuRun, runEnv, takeGpuRun } from "@/lib/server/run-prep";
import { apiError } from "@/lib/server/session";
import { errorFacts, upstreamFailure } from "@/lib/ui/user-message";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const run = await prepareRun(request, true);
  if (run instanceof NextResponse) return run;
  const refused = await takeGpuRun(run.session, run.directives);
  if (refused) return refused;
  const env = await runEnv(run.session, request, run.code);
  try {
    const result = await runAndWait(run.language, run.code, run.directives, request.signal, env, run.session.userId);
    return NextResponse.json(run.notice ? { ...result, notice: run.notice } : result);
  } catch (e) {
    console.error("server run failed", e);
    // The server couldn't run it: not one of the day's GPU runs.
    await refundGpuRun(run.session, run.directives);
    const f = upstreamFailure(errorFacts(e));
    return apiError(f.kind, f.status, "run_server", f.retryAfter);
  }
}
