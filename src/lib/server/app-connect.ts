// Server-side only: connecting Hugging Face from the Benchjot apps (Android, desktop).
// The app's browser tab isn't signed in to Benchjot, so the connect is handed off in sealed steps
// (AES-256-GCM with the server's secret, lib/server/secret-box.ts; only this server can open them):
//
//   1. The signed-in app asks POST /api/connect/app for a link. It gets a ticket bound to the user,
//      the provider and a nonce of the app's own, valid for 10 minutes.
//   2. Its browser tab opens /api/connect/start?t=<ticket>, which starts the provider's sign-in
//      exactly as the web does (PKCE, the same callback), noting in the cookie that the app asked.
//   3. The callback exchanges the code, then sends the browser back to the app
//      (benchjot://connected?…) with the result sealed to the same user and nonce.
//   4. The app checks the nonce is the one it started with and posts the result to
//      POST /api/connect/finish with its own session; the server saves it only for that same user.
//
// So a ticket or a result is useless to anyone else: it opens only here, finishes only for the user
// it names, and the app ignores a result it didn't ask for.
import { open, seal } from "./secret-box";

type Provider = "hf";
export const PROVIDERS: readonly Provider[] = ["hf"];
/** Where the browser tab returns to the app. */
const APP_RETURN = "benchjot://connected";
const TICKET_MS = 10 * 60_000;
const RESULT_MS = 10 * 60_000;

interface Ticket {
  u: string;
  p: Provider;
  n: string;
  x: number;
}

/** A ticket for the user's app to start a connect with (step 1). */
export function appTicket(userId: string, provider: Provider, nonce: string, now = Date.now()): string {
  return seal(JSON.stringify({ u: userId, p: provider, n: nonce, x: now + TICKET_MS } satisfies Ticket));
}

function read<T extends { x: number }>(sealed: string | null | undefined, now: number): T | null {
  const plain = open(sealed ?? null);
  if (!plain || !plain.startsWith("{")) return null;
  try {
    const v = JSON.parse(plain) as T;
    return typeof v.x === "number" && v.x > now ? v : null;
  } catch {
    return null;
  }
}

/** The ticket's user, provider and nonce while it's valid; null otherwise (step 2). */
export function openTicket(t: string | null, now = Date.now()): Ticket | null {
  const v = read<Ticket>(t, now);
  return v && typeof v.u === "string" && PROVIDERS.includes(v.p) && typeof v.n === "string" ? v : null;
}

/** What the cookie remembers when the app started the connect: whose it is and the app's nonce. */
export interface AppConnect {
  uid: string;
  nonce: string;
}

interface Result {
  u: string;
  p: Provider;
  n: string;
  x: number;
  /** The provider's answer: the Hugging Face grant as JSON. */
  v: string;
}

/** The browser tab's way back to the app (step 3): the result sealed to the user and nonce, or why there's none. */
export function appReturn(provider: Provider, app: AppConnect, outcome: { value: string } | { error: string }, now = Date.now()): string {
  const q = new URLSearchParams({ p: provider, n: app.nonce });
  if ("value" in outcome) q.set("r", seal(JSON.stringify({ u: app.uid, p: provider, n: app.nonce, x: now + RESULT_MS, v: outcome.value } satisfies Result)));
  else q.set("error", outcome.error);
  return `${APP_RETURN}?${q}`;
}

const LABEL: Record<Provider, string> = { hf: "Hugging Face" };
const escape = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The browser tab's last page (step 3): a button back to the app, which then saves the result. Not a
 * redirect: Chrome on Android opens an app from a redirect only right after a tap, and the provider's
 * code exchange can take long enough that it quietly doesn't (the tab stayed, nothing was saved).
 * The tap on this button is the one Chrome needs. It also tries once by itself (meta refresh), and
 * uses no script.
 */
export function appReturnPage(provider: Provider, back: string, ok: boolean): Response {
  const href = escape(back);
  const title = ok ? `${LABEL[provider]} is connected` : "Nothing was connected";
  const line = ok ? "Go back to the Benchjot app to finish. It saves the connection there." : "Go back to the Benchjot app and try again.";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="0;url=${href}"><title>${title} · Benchjot</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#161616;color:#e8e6e3;font-family:system-ui,sans-serif">
<main style="max-width:420px;padding:32px 24px;text-align:center">
<h1 style="font-size:22px;font-weight:600;margin:0 0 12px">${title}</h1>
<p style="font-size:15px;line-height:1.5;color:#b9b7b3;margin:0 0 28px">${line}</p>
<a href="${href}" style="display:inline-block;padding:14px 28px;border-radius:12px;background:#e8e6e3;color:#161616;font-weight:600;font-size:16px;text-decoration:none">Open Benchjot</a>
</main></body></html>`;
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

/** The result's value for this user and provider while it's valid; null otherwise (step 4). */
export function openResult(r: string, userId: string, now = Date.now()): { provider: Provider; nonce: string; value: string } | null {
  const v = read<Result>(r, now);
  if (!v || v.u !== userId || !PROVIDERS.includes(v.p) || typeof v.v !== "string" || typeof v.n !== "string") return null;
  return { provider: v.p, nonce: v.n, value: v.v };
}
