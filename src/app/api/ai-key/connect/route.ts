// GET /api/ai-key/connect?next=/path — starts "Connect AI": keeps this connect's PKCE verifier and
// state in a short-lived cookie only this browser sends back, then sends the user to OpenRouter to
// authorize. They return to /api/ai-key/callback.
import { NextResponse } from "next/server";
import { authorizeUrl, CONNECT_COOKIE, newConnect } from "@/lib/server/openrouter";
import { canSeal } from "@/lib/server/secret-box";
import { requireSession } from "@/lib/server/session";
import { safeNext } from "@/lib/web/safe-next";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next") || "/settings");
  const session = await requireSession(request);
  if (session instanceof NextResponse) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(next)}`, url));
  const back = (result: string) => NextResponse.redirect(new URL(`${next}${next.includes("?") ? "&" : "?"}ai=${result}`, url));
  if (!canSeal()) {
    console.error("ai-key connect: KEY_ENCRYPTION_SECRET is not set");
    return back("unavailable");
  }
  const { verifier, challenge, state } = newConnect();
  const res = NextResponse.redirect(authorizeUrl(new URL("/api/ai-key/callback", url).toString(), challenge, state));
  res.cookies.set(CONNECT_COOKIE, JSON.stringify({ verifier, state, next }), { httpOnly: true, secure: url.protocol === "https:", sameSite: "lax", path: "/api/ai-key", maxAge: 600 });
  return res;
}
