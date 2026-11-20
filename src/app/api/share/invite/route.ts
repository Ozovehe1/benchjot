// POST /api/share/invite — the owner adds someone to a shared note by username: share_invite() (as the
// owner) makes the invitation, which they accept on their Benchjot home (the Android app also alerts
// them on the phone). Answers who was invited.
import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readBody, requireSession } from "@/lib/server/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const input = await readBody(request, (v) => z.object({ noteId: z.string().uuid(), username: z.string().trim().min(1).max(60) }).safeParse(v));
  if (input instanceof NextResponse) return input;

  const { data, error } = await session.db.rpc("share_invite", { note: input.noteId, name: input.username });
  if (error) {
    const e = error as { code?: string; message?: string };
    if (e.code === "P0002" || e.code === "22023") return jsonError(400, e.message ?? "Couldn’t invite them.");
    console.error("share_invite failed", error);
    return jsonError(500, "Couldn’t invite them. Try again.");
  }
  const invited = data as { user_id: string; username: string };
  return NextResponse.json({ username: invited.username });
}
