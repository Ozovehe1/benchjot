// POST /api/helper — the note Helper online: write code for the note, or answer from it.
// The browser sends the note as read on the tap that asked; nothing here reads or writes the database
// except the shared Fix/Helper limit. Same key, model and limits as Fix (lib/server/groq.ts).
import { NextResponse } from "next/server";
import { helperMessages, helperRequest, parseHelperAnswer } from "@/lib/helper";
import { askGroq } from "@/lib/server/groq";
import { readBody, requireSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const input = await readBody(request, (v) => helperRequest.safeParse(v));
  if (input instanceof NextResponse) return input;
  return askGroq(session, "helper", helperMessages(input), (content) => parseHelperAnswer(input.task, input.language, content));
}
