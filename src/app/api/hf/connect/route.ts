// GET /api/hf/connect?next= — "Connect Hugging Face": starts the sign-in (PKCE). The verifier and
// state go in an httpOnly cookie for /api/hf only, for 30 minutes (time to make a Hugging Face account first); the user goes to huggingface.co to sign in and
// tap Allow, and comes back to /api/hf/callback.
import { NextResponse } from "next/server";
import { appOrigin, HF_CONNECT_COOKIE, hfAuthorizeUrl, newHfConnect } from "@/lib/server/huggingface";
import { canSeal } from "@/lib/server/secret-box";
import { requireSession } from "@/lib/server/session";
import { safeNext } from "@/lib/web/safe-next";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next") || "/settings");
  const session = await requireSession(request);
  if (session instanceof NextResponse) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(next)}`, url));
  const back = (result: string) => NextResponse.redirect(new URL(`${next}${next.includes("?") ? "&" : "?"}hf=${result}`, url));
  if (!canSeal()) {
    console.error("hf connect: KEY_ENCRYPTION_SECRET is not set");
    return back("unavailable");
  }
  const { verifier, challenge, state } = newHfConnect();
  const res = NextResponse.redirect(hfAuthorizeUrl(appOrigin(request), challenge, state));
  res.cookies.set(HF_CONNECT_COOKIE, JSON.stringify({ verifier, state, next }), { httpOnly: true, secure: url.protocol === "https:", sameSite: "lax", path: "/api/hf", maxAge: 1800 });
  return res;
}
