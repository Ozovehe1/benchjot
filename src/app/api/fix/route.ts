// POST /api/fix — ask Groq for the smallest fix to code given its last error.
// Any signed-in user may call it; the key, the model and the shared limit live in lib/server/groq.ts.
import { NextResponse } from "next/server";
import { fixMessages, fixRequest, parseFixAnswer } from "@/lib/fix";
import { askGroq } from "@/lib/server/groq";
import { readBody, requireSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const input = await readBody(request, (v) => fixRequest.safeParse(v));
  if (input instanceof NextResponse) return input;
  return askGroq(session, "fix", fixMessages(input), parseFixAnswer);
}
