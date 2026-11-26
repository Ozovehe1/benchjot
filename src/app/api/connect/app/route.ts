// POST /api/connect/app {provider: "hf", nonce} — the Benchjot app (Android, desktop) asks for a
// link that starts connecting Hugging Face in its browser tab (lib/server/app-connect.ts,
// step 1). The link holds a sealed ticket for this user, provider and the app's nonce, for 10 minutes.
import { NextResponse } from "next/server";
import { z } from "zod";
import { appTicket, PROVIDERS } from "@/lib/server/app-connect";
import { appOrigin } from "@/lib/server/background-runs";
import { canSeal } from "@/lib/server/secret-box";
import { jsonError, readBody, requireSession } from "@/lib/server/session";

export const runtime = "nodejs";

const body = z.object({ provider: z.enum(PROVIDERS as [string, ...string[]]), nonce: z.string().regex(/^[\w-]{16,128}$/, "Bad request") });

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const input = await readBody(request, (v) => body.safeParse(v));
  if (input instanceof NextResponse) return input;
  if (!canSeal()) {
    console.error("connect app: KEY_ENCRYPTION_SECRET is not set");
    return jsonError(503, "Connecting isn’t available right now. Try again later.");
  }
  const t = appTicket(session.userId, input.provider as "hf", input.nonce);
  return NextResponse.json({ url: `${appOrigin(request)}/api/connect/start?${new URLSearchParams({ t })}` }, { headers: { "cache-control": "no-store" } });
}
