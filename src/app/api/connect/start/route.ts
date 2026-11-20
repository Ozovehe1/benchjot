// GET /api/connect/start?t=<ticket> — the app's browser tab starts connecting (lib/server/app-connect.ts,
// step 2): the same PKCE sign-in as the web's own Connect buttons, with the cookie noting the app's
// user and nonce, so the callback returns to the app instead of a page.
import { NextResponse } from "next/server";
import { openTicket } from "@/lib/server/app-connect";
import { appOrigin, HF_CONNECT_COOKIE, hfAuthorizeUrl, newHfConnect } from "@/lib/server/huggingface";
import { authorizeUrl, CONNECT_COOKIE, newConnect } from "@/lib/server/openrouter";

export const runtime = "nodejs";

export function GET(request: Request) {
  const url = new URL(request.url);
  const ticket = openTicket(url.searchParams.get("t"));
  if (!ticket) {
    return new NextResponse("This link has expired. Go back to Benchjot and tap Connect again.", { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  const app = { uid: ticket.u, nonce: ticket.n };
  const cookie = { httpOnly: true, secure: url.protocol === "https:", sameSite: "lax" as const, maxAge: 1800 };
  if (ticket.p === "ai") {
    const { verifier, challenge, state } = newConnect();
    const res = NextResponse.redirect(authorizeUrl(new URL("/api/ai-key/callback", url).toString(), challenge, state));
    res.cookies.set(CONNECT_COOKIE, JSON.stringify({ verifier, state, next: "/settings", app }), { ...cookie, path: "/api/ai-key" });
    return res;
  }
  const { verifier, challenge, state } = newHfConnect();
  const res = NextResponse.redirect(hfAuthorizeUrl(appOrigin(request), challenge, state));
  res.cookies.set(HF_CONNECT_COOKIE, JSON.stringify({ verifier, state, next: "/settings", app }), { ...cookie, path: "/api/hf" });
  return res;
}
