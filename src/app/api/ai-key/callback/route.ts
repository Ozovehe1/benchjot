// GET /api/ai-key/callback?code=&state= — the user is back from OpenRouter. The code is exchanged
// with the verifier from this browser's cookie (so a code made for anyone else's connect is useless
// here), the key is sealed (lib/server/secret-box.ts) and saved, and the user returns to where they
// started with ?ai=connected, or ?ai=failed / ?ai=cancelled. When the Benchjot app started the connect
// (lib/server/app-connect.ts), the browser tab goes back to the app with the key sealed to its user.
import { NextResponse } from "next/server";
import { appReturn, appReturnPage, type AppConnect } from "@/lib/server/app-connect";
import { CONNECT_COOKIE, exchangeCode, keyHash } from "@/lib/server/openrouter";
import { seal } from "@/lib/server/secret-box";
import { requireSession } from "@/lib/server/session";
import { safeNext } from "@/lib/web/safe-next";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const cookie = (request.headers.get("cookie") ?? "").split(/;\s*/).find((c) => c.startsWith(`${CONNECT_COOKIE}=`));
  let saved: { verifier?: string; state?: string; next?: string; app?: AppConnect } = {};
  try {
    saved = JSON.parse(decodeURIComponent(cookie?.slice(CONNECT_COOKIE.length + 1) ?? "%7B%7D")) as typeof saved;
  } catch {
    // unreadable cookie: treated as none
  }
  const next = safeNext(saved.next || "/settings");
  const back = (result: string) => {
    const res = NextResponse.redirect(new URL(`${next}${next.includes("?") ? "&" : "?"}ai=${result}`, url));
    res.cookies.set(CONNECT_COOKIE, "", { path: "/api/ai-key", maxAge: 0 });
    return res;
  };
  const code = url.searchParams.get("code");
  const stateOk = Boolean(saved.verifier && saved.state && url.searchParams.get("state") === saved.state);
  // Started by the app: no Benchjot session in this tab; the key goes back sealed to the app's user.
  const app = saved.app;
  if (app && typeof app.uid === "string" && typeof app.nonce === "string") {
    const toApp = (outcome: { value: string } | { error: string }) => {
      // A page with a button back to the app, not a redirect (app-connect.ts appReturnPage).
      const res = appReturnPage("ai", appReturn("ai", app, outcome), "value" in outcome);
      res.headers.append("set-cookie", `${CONNECT_COOKIE}=; Path=/api/ai-key; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
      return res;
    };
    if (!code) return toApp({ error: "cancelled" });
    if (!stateOk) return toApp({ error: "failed" });
    const key = await exchangeCode(code, saved.verifier!);
    return toApp(key ? { value: key } : { error: "failed" });
  }
  const session = await requireSession(request);
  if (session instanceof NextResponse) return NextResponse.redirect(new URL("/login", url));
  if (!code) return back("cancelled");
  if (!stateOk) return back("failed");
  const key = await exchangeCode(code, saved.verifier!);
  if (!key) return back("failed");
  const { error } = await session.db.rpc("set_ai_key", { provider: "openrouter", key: seal(key), key_hash: keyHash(key) });
  if (error) {
    console.error("set_ai_key failed", error);
    return back("failed");
  }
  return back("connected");
}
