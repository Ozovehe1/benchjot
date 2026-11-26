// POST /api/connect/finish {r} — the app hands back the sealed result its browser tab returned with
// (lib/server/app-connect.ts, step 4). It is saved only for the user it was sealed to, as the web's own
// callbacks save it: the Hugging Face grant, sealed.
import { NextResponse } from "next/server";
import { z } from "zod";
import { openResult } from "@/lib/server/app-connect";
import { saveHfGrant } from "@/lib/server/hf-grant";
import { readHfGrant } from "@/lib/server/huggingface";
import { jsonError, readBody, requireSession } from "@/lib/server/session";

export const runtime = "nodejs";

const body = z.object({ r: z.string().min(1).max(20_000) });

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const input = await readBody(request, (v) => body.safeParse(v));
  if (input instanceof NextResponse) return input;
  const result = openResult(input.r, session.userId);
  if (!result) return jsonError(400, "That connect expired or isn’t yours. Tap Connect again.");
  const grant = readHfGrant(result.value);
  if (!grant || !(await saveHfGrant(session, grant))) return jsonError(500, "Couldn’t save the connection. Try again.");
  return NextResponse.json({ provider: result.provider });
}
