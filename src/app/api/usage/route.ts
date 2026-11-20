// GET /api/usage — the signed-in user's own usage, for Settings → Usage: Benchjot's counts
// (my_usage: AI requests on their own connection, and GPU runs on the server against the day's
// limit). Counts only, never content.
import { NextResponse } from "next/server";
import { GPU_RUNS } from "@/config/app";
import { requireSession } from "@/lib/server/session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const mine = await Promise.resolve(session.db.rpc("my_usage")).then(
    (r) => (r.data ?? {}) as Record<string, unknown>,
    () => ({}),
  );
  return NextResponse.json({ ...mine, gpu_runs_per_day: GPU_RUNS.perDay });
}
