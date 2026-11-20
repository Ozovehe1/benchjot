// GET /api/hf/callback?code=&state= — the user is back from Hugging Face. The code is exchanged with
// the verifier from this browser's cookie (so a code made for anyone else's connect is useless here),
// the tokens are sealed (lib/server/secret-box.ts) and saved, and the user returns to where they
// started with ?hf=connected, or ?hf=failed / ?hf=cancelled. When the Benchjot app started the connect
// (lib/server/app-connect.ts), the browser tab goes back to the app with the grant sealed to its user.
import { NextResponse } from "next/server";
import { appReturn, appReturnPage, type AppConnect } from "@/lib/server/app-connect";
import { saveHfGrant } from "@/lib/server/hf-grant";
import { appOrigin, exchangeHfCode, HF_CONNECT_COOKIE, hfUsername } from "@/lib/server/huggingface";
import { requireSession } from "@/lib/server/session";
import { safeNext } from "@/lib/web/safe-next";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const cookie = (request.headers.get("cookie") ?? "").split(/;\s*/).find((c) => c.startsWith(`${HF_CONNECT_COOKIE}=`));
  let saved: { verifier?: string; state?: string; next?: string; app?: AppConnect } = {};
  try {
    saved = JSON.parse(decodeURIComponent(cookie?.slice(HF_CONNECT_COOKIE.length + 1) ?? "%7B%7D")) as typeof saved;
  } catch {
    // unreadable cookie: treated as none
  }
  const next = safeNext(saved.next || "/settings");
  const back = (result: string) => {
    const res = NextResponse.redirect(new URL(`${next}${next.includes("?") ? "&" : "?"}hf=${result}`, url));
    res.cookies.set(HF_CONNECT_COOKIE, "", { path: "/api/hf", maxAge: 0 });
    return res;
  };
  // Each way this can end is logged (never a code or token), so a connect that doesn't finish can be traced.
  const app = saved.app;
  if (app && typeof app.uid === "string" && typeof app.nonce === "string") {
    // Started by the app: no Benchjot session in this tab; the grant goes back sealed to the app's user.
    const toApp = (outcome: { value: string } | { error: string }) => {
      // A page with a button back to the app, not a redirect (app-connect.ts appReturnPage).
      const res = appReturnPage("hf", appReturn("hf", app, outcome), "value" in outcome);
      res.headers.append("set-cookie", `${HF_CONNECT_COOKIE}=; Path=/api/hf; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
      return res;
    };
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    if (!code) {
      console.error("hf callback (app): no code", error ?? "");
      return toApp({ error: error && error !== "access_denied" ? "failed" : "cancelled" });
    }
    if (!saved.verifier || !saved.state || url.searchParams.get("state") !== saved.state) {
      console.error("hf callback (app): state does not match");
      return toApp({ error: "failed" });
    }
    const grant = await exchangeHfCode(appOrigin(request), code, saved.verifier);
    if (!grant) return toApp({ error: "failed" });
    const u = await hfUsername(grant.a);
    console.log("hf callback (app): connected");
    return toApp({ value: JSON.stringify(u ? { ...grant, u } : grant) });
  }
  const session = await requireSession(request);
  if (session instanceof NextResponse) {
    console.error("hf callback: not signed in to Benchjot here (sign-in finished in another browser?)");
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(next)}`, url));
  }
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  if (!code) {
    console.error("hf callback: no code", error ?? "", (url.searchParams.get("error_description") ?? "").slice(0, 200));
    return back(error && error !== "access_denied" ? "failed" : "cancelled");
  }
  if (!saved.verifier || !saved.state) {
    console.error("hf callback: no connect cookie (expired, or another browser)");
    return back("expired");
  }
  if (url.searchParams.get("state") !== saved.state) {
    console.error("hf callback: state does not match");
    return back("failed");
  }
  const grant = await exchangeHfCode(appOrigin(request), code, saved.verifier);
  if (!grant) return back("failed");
  const u = await hfUsername(grant.a);
  if (!(await saveHfGrant(session, u ? { ...grant, u } : grant))) return back("failed");
  console.log("hf callback: connected");
  return back("connected");
}
