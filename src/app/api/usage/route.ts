// GET /api/usage — the signed-in user's own usage, for Settings → Usage and the Assistant: AI
// requests in the last 24 hours, AI credits this month, GPU runs today (my_usage), each with its
// limit. Counts only, never content. Read per account, so switching accounts shows that account's.
import { NextResponse } from "next/server";
import { AI, GPU_RUNS } from "@/config/app";
import { requireSession } from "@/lib/server/session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const mine = await Promise.resolve(session.db.rpc("my_usage")).then(
    (r) => (r.data ?? {}) as Record<string, unknown>,
    () => ({}),
  );
  return NextResponse.json({ ...mine, gpu_runs_per_day: GPU_RUNS.perDay, ai_per_day: AI.perDay, ai_credits_per_month: AI.creditsPerMonth }, { headers: { "cache-control": "no-store" } });
}
