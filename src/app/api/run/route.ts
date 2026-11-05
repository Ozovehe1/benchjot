// POST /api/run — run a snippet on a Modal Sandbox. Pro only, checked here on the server.
import { NextResponse } from "next/server";
import { z } from "zod";
import { runOnModal } from "@/lib/server/modal";
import { apiError, jsonError, readBody, requireSession } from "@/lib/server/session";
import { errorFacts, upstreamFailure } from "@/lib/user-message";
import { DirectiveError, LIMITS, parseDirectives, runsOnServer } from "@/lib/run/server-languages";

export const runtime = "nodejs";
export const maxDuration = 300;

const body = z.object({
  language: z.string().refine(runsOnServer, "This language doesn't run on the server"),
  code: z.string().min(1, "Nothing to run").max(LIMITS.maxCodeChars, "Code is too long"),
});

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  if (session.plan !== "pro") return jsonError(403, "Server runs are part of Pro.");

  const input = await readBody(request, (v) => body.safeParse(v));
  if (input instanceof NextResponse) return input;
  if (!runsOnServer(input.language)) return jsonError(400, "This language doesn't run on the server");

  let directives;
  try {
    directives = parseDirectives(input.language, input.code);
  } catch (e) {
    if (e instanceof DirectiveError) return jsonError(400, e.message);
    throw e;
  }
  try {
    return NextResponse.json(await runOnModal(input.language, input.code, directives, request.signal));
  } catch (e) {
    console.error("server run failed", e);
    const f = upstreamFailure(errorFacts(e));
    return apiError(f.kind, f.status, "run_server", f.retryAfter);
  }
}
