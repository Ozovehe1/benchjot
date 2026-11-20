// POST /api/runs/[id]/complete — a background run's sandbox sends its raw result (bj_job.py). No
// user session: the run's one-time token is the proof, checked in the database (server_run_meta,
// complete_server_run). The result is built as for a run that waits in the request (finishRun)
// and stored on the run for the user's page to pick up.
import { z } from "zod";
import { finishRun, type RunMeta } from "@/lib/run/server-languages";
import { anonymousDb } from "@/lib/server/session";

export const runtime = "nodejs";
export const maxDuration = 60;

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const body = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/),
  exitCode: z.number().int(),
  stdout: z.string().max(4_000_000),
  stderr: z.string().max(300_000),
  ms: z.number().int().nonnegative(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ID.test(id)) return new Response(null, { status: 404 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response(null, { status: 400 });
  const { token, exitCode, stdout, stderr, ms } = parsed.data;
  const db = anonymousDb();
  const meta = await db.rpc("server_run_meta", { run_id: id, token });
  if (meta.error) {
    console.error("server_run_meta failed", meta.error);
    return new Response(null, { status: 503 }); // the sandbox retries
  }
  if (!meta.data) return new Response(null, { status: 403 }); // wrong token, or the run was stopped
  const result = finishRun(meta.data as RunMeta, stdout, stderr, exitCode, ms);
  const done = await db.rpc("complete_server_run", { run_id: id, token, result });
  if (done.error) {
    console.error("complete_server_run failed", done.error);
    return new Response(null, { status: 503 });
  }
  return new Response(null, { status: done.data ? 204 : 403 });
}
