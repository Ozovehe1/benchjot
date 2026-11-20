// DELETE /api/ai-key — disconnects the user's own AI (their OpenRouter key is removed from Benchjot;
// they can also revoke it on OpenRouter). Connecting is /api/ai-key/connect.
import { NextResponse } from "next/server";
import { jsonError, requireSession } from "@/lib/server/session";

export const runtime = "nodejs";

export async function DELETE(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const { error } = await session.db.rpc("set_ai_key", { provider: "openrouter", key: "", key_hash: "" });
  if (error) {
    console.error("set_ai_key (remove) failed", error);
    return jsonError(500, "Couldn’t disconnect. Try again.");
  }
  return NextResponse.json({});
}
