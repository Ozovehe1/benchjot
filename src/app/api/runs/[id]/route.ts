// GET /api/runs/[id] — a background run's state (and its result once done); DELETE stops it.
// The row is read as the caller (RLS: only their own runs). A run past its deadline whose sandbox
// has ended without a result is marked failed here.
import { NextResponse } from "next/server";
import { overdue, toLiveStatus, toRunState, type RunStatus } from "@/lib/server/background-runs";
import { isRunning, liveStatus, stopRun } from "@/lib/server/sandbox";
import { apiError, jsonError, requireSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const maxDuration = 60;

const COLUMNS = "id, status, started_at, limit_sec, notice, result, error, sandbox_id";
type Row = { id: string; status: RunStatus; started_at: string; limit_sec: number; notice: string | null; result: unknown; error: string | null; sandbox_id: string | null };
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load(request: Request, params: Promise<{ id: string }>) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  if (!ID.test(id)) return jsonError(404, "No such run.");
  const from = session.db.from;
  if (!from) return apiError("server", 500, "run_server");
  const { data, error } = await from("server_runs").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) {
    console.error("server_runs read failed", error);
    return apiError("server", 503, "run_server");
  }
  if (!data) return jsonError(404, "No such run.");
  return { from, row: data as Row };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const got = await load(request, params);
  if (got instanceof NextResponse) return got;
  const { from, row } = got;
  if (row.status === "running" && overdue(row.started_at, row.limit_sec) && !(row.sandbox_id && (await isRunning(row.sandbox_id)))) {
    const failed = { status: "failed" as const, error: "The server run ended without sending its result.", finished_at: new Date().toISOString() };
    await from("server_runs").update(failed).eq("id", row.id).eq("status", "running");
    return NextResponse.json(toRunState({ ...row, ...failed }));
  }
  // Still running: what it is doing right now, when the sandbox can say.
  if (row.status === "running" && row.sandbox_id) {
    const live = toLiveStatus(await liveStatus(row.sandbox_id));
    if (live) return NextResponse.json({ ...toRunState(row), live });
  }
  return NextResponse.json(toRunState(row));
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const got = await load(request, params);
  if (got instanceof NextResponse) return got;
  const { from, row } = got;
  if (row.status !== "running") return NextResponse.json(toRunState(row));
  const stopped = { status: "stopped" as const, finished_at: new Date().toISOString() };
  // The row first: a result arriving while the sandbox stops is refused (complete_server_run needs "running").
  await from("server_runs").update(stopped).eq("id", row.id).eq("status", "running");
  if (row.sandbox_id) await stopRun(row.sandbox_id);
  return NextResponse.json(toRunState({ ...row, ...stopped }));
}
