// GET /api/data-keys — whether Hugging Face is connected, and as whom (never the token).
// POST /api/data-keys — saves a Hugging Face token the user pasted, sealed (lib/server/secret-box.ts),
// so the database never holds it in the clear. Removing it needs no secret, so the browser does that
// itself (set_data_tokens with ''). The usual way in is one tap: /api/hf/connect.
import { NextResponse } from "next/server";
import { z } from "zod";
import { hfStatus } from "@/lib/server/hf-grant";
import { canSeal, seal } from "@/lib/server/secret-box";
import { jsonError, readBody, requireSession } from "@/lib/server/session";

export const runtime = "nodejs";

const body = z.object({ hf_token: z.string().trim().regex(/^hf_[A-Za-z0-9]{16,128}$/, "That doesn’t look like a Hugging Face token. It starts with hf_: copy it again and paste it whole.") });

export async function GET(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const s = await hfStatus(session, new URL(request.url).origin);
  return NextResponse.json({ hf: s.connected, hfUser: s.username, hfBy: s.connectedBy, hfRemoved: s.removed }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const input = await readBody(request, (v) => body.safeParse(v));
  if (input instanceof NextResponse) return input;
  if (!canSeal()) {
    console.error("data-keys: KEY_ENCRYPTION_SECRET is not set");
    return jsonError(503, "Saving keys isn’t available right now. Try again later.");
  }
  const { error } = await session.db.rpc("set_data_tokens", { hf_token: seal(input.hf_token) });
  if (error) {
    console.error("set_data_tokens failed", error);
    return jsonError(500, "Couldn’t save it. Try again.");
  }
  return NextResponse.json({});
}
