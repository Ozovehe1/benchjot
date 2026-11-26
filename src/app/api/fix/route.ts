// POST /api/fix — ask Claude for the smallest fix to code given its last error.
// Any signed-in user may call it; the model and the daily allowance live in lib/server/llm.ts.
import { NextResponse } from "next/server";
import { fixMessages, fixRequest, parseFixAnswer } from "@/lib/ai/fix";
import { askModel, modelFrom } from "@/lib/server/llm";
import { readBody, requireSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const input = await readBody(request, (v) => fixRequest.safeParse(v));
  if (input instanceof NextResponse) return input;
  return askModel(session, modelFrom(request), "fix", fixMessages(input), parseFixAnswer);
}
