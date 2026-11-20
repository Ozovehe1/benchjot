// Connecting OpenRouter or Hugging Face from the Benchjot app (lib/server/app-connect.ts): the app asks
// for a link, its browser tab signs in through the same PKCE flow as the web, the callback returns to
// the app with the result sealed to the user and the app's nonce, and the app finishes with its own
// session. Providers and the session are stand-ins; the routes are real.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/server/session";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "ci-placeholder";
});

const rpc = vi.fn<Session["db"]["rpc"]>();
let user: string | null = "u1";
vi.mock("@/lib/server/session", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/session")>();
  return { ...real, requireSession: async () => (user ? ({ userId: user, db: { rpc } } satisfies Session) : real.apiError("session", 401)) };
});
const { POST: link } = await import("@/app/api/connect/app/route");
const { GET: start } = await import("@/app/api/connect/start/route");
const { POST: finish } = await import("@/app/api/connect/finish/route");
const { GET: aiCallback } = await import("@/app/api/ai-key/callback/route");
const { GET: hfCallback } = await import("@/app/api/hf/callback/route");
const { open } = await import("@/lib/server/secret-box");
const { appTicket } = await import("@/lib/server/app-connect");

const SITE = "https://benchjot.vercel.app";
const NONCE = "n".repeat(24);
const KEY = "sk-or-v1-" + "ab12".repeat(12);
const net = vi.fn<typeof fetch>();
const json = (v: unknown, s = 200) => new Response(JSON.stringify(v), { status: s });
const post = (path: string, body: unknown) => new Request(`${SITE}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  user = "u1";
  rpc.mockReset().mockResolvedValue({ data: null, error: null } as never);
  net.mockReset();
  vi.stubGlobal("fetch", net);
  vi.stubEnv("KEY_ENCRYPTION_SECRET", "s".repeat(48));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** Steps 1–2: the app's link, opened in its browser tab; returns where the tab goes and its cookie. */
async function begin(provider: "ai" | "hf") {
  const res = await link(post("/api/connect/app", { provider, nonce: NONCE }));
  expect(res.status).toBe(200);
  const url = ((await res.json()) as { url: string }).url;
  expect(url.startsWith(`${SITE}/api/connect/start?t=`)).toBe(true);
  const tab = await start(new Request(url));
  const cookie = tab.headers.get("set-cookie")!.split(";")[0]!;
  const saved = JSON.parse(decodeURIComponent(cookie.split("=").slice(1).join("="))) as { state: string; app: { uid: string; nonce: string } };
  return { to: new URL(tab.headers.get("location")!), cookie, saved };
}

/**
 * The way back to the app, from the page the tab ends on: a button (and a one-time try by itself), not a
 * redirect, since Chrome on Android won't open an app from a redirect that comes too long after a tap.
 */
async function appLink(res: Response): Promise<string> {
  expect(res.status).toBe(200);
  expect(res.headers.get("location")).toBeNull();
  const html = await res.text();
  expect(html).toContain(">Open Benchjot</a>");
  expect(html).not.toContain("<script");
  const href = /<a href="([^"]+)"/.exec(html)![1]!.replace(/&amp;/g, "&");
  expect(html).toContain(`content="0;url=${/<a href="([^"]+)"/.exec(html)![1]!}"`);
  return href;
}

describe("connecting from the app", () => {
  it("a link needs the app's session and a nonce; an expired or forged ticket starts nothing", async () => {
    user = null;
    expect((await link(post("/api/connect/app", { provider: "ai", nonce: NONCE }))).status).toBe(401);
    user = "u1";
    expect((await link(post("/api/connect/app", { provider: "ai", nonce: "short" }))).status).toBe(400);
    expect((await link(post("/api/connect/app", { provider: "github", nonce: NONCE }))).status).toBe(400);
    const old = appTicket("u1", "ai", NONCE, Date.now() - 11 * 60_000);
    expect((await start(new Request(`${SITE}/api/connect/start?t=${encodeURIComponent(old)}`))).status).toBe(400);
    expect((await start(new Request(`${SITE}/api/connect/start?t=enc%3Av1%3Aforged.x`))).status).toBe(400);
  });

  it("OpenRouter: the tab signs in like the web, comes back to the app with the key sealed, and the app saves it for its user", async () => {
    const { to, cookie, saved } = await begin("ai");
    expect(`${to.origin}${to.pathname}`).toBe("https://openrouter.ai/auth");
    expect(to.searchParams.get("callback_url")).toBe(`${SITE}/api/ai-key/callback`);
    expect(saved.app).toEqual({ uid: "u1", nonce: NONCE });
    net.mockResolvedValue(json({ key: KEY }));
    user = null; // the tab has no Benchjot session
    const back = await aiCallback(new Request(`${SITE}/api/ai-key/callback?code=abc&state=${saved.state}`, { headers: { cookie } }));
    const ret = new URL(await appLink(back));
    expect(`${ret.protocol}//${ret.host}`).toBe("benchjot://connected");
    expect(ret.searchParams.get("p")).toBe("ai");
    expect(ret.searchParams.get("n")).toBe(NONCE);
    const r = ret.searchParams.get("r")!;
    expect(r).not.toContain("sk-or");
    expect(rpc).not.toHaveBeenCalled(); // nothing saved by the tab

    user = "someone-else";
    expect((await finish(post("/api/connect/finish", { r }))).status).toBe(400);
    user = "u1";
    const done = await finish(post("/api/connect/finish", { r }));
    expect(await done.json()).toEqual({ provider: "ai" });
    const [, args] = rpc.mock.calls.find((c) => c[0] === "set_ai_key")! as [string, { key: string }];
    expect(open(args.key)).toBe(KEY);
  });

  it("Hugging Face: the grant comes back sealed and is saved with its refresh token and username", async () => {
    const { to, cookie, saved } = await begin("hf");
    expect(`${to.origin}${to.pathname}`).toBe("https://huggingface.co/oauth/authorize");
    net.mockImplementation(async (u) => (String(u).endsWith("/oauth/token") ? json({ access_token: "hf_oauth_" + "a".repeat(1500), refresh_token: "hf_oauth_r" + "b".repeat(30), expires_in: 28800 }) : json({ preferred_username: "ada" })));
    user = null;
    const back = await hfCallback(new Request(`${SITE}/api/hf/callback?code=abc&state=${saved.state}`, { headers: { cookie } }));
    const r = new URL(await appLink(back)).searchParams.get("r")!;
    user = "u1";
    expect(await (await finish(post("/api/connect/finish", { r }))).json()).toEqual({ provider: "hf" });
    const [, args] = rpc.mock.calls.find((c) => c[0] === "set_data_tokens")! as [string, { hf_token: string }];
    expect(JSON.parse(open(args.hf_token)!)).toMatchObject({ u: "ada", r: "hf_oauth_r" + "b".repeat(30) });
  });

  it("declining or a refused code returns to the app with the reason and no result", async () => {
    const { cookie, saved } = await begin("ai");
    user = null;
    const declined = new URL(await appLink(await aiCallback(new Request(`${SITE}/api/ai-key/callback`, { headers: { cookie } }))));
    expect(declined.searchParams.get("error")).toBe("cancelled");
    expect(declined.searchParams.get("r")).toBeNull();
    net.mockResolvedValue(json({ error: "bad" }, 400));
    const failed = new URL(await appLink(await aiCallback(new Request(`${SITE}/api/ai-key/callback?code=x&state=${saved.state}`, { headers: { cookie } }))));
    expect(failed.searchParams.get("error")).toBe("failed");
  });
});
