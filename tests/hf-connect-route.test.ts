// "Connect Hugging Face" (/.well-known/oauth-cimd, /api/hf/connect, /api/hf/callback, and the token
// a server run gets): Hugging Face's OAuth with a Client ID Metadata Document and PKCE. The verifier
// and state live only in this browser's cookie; the code is exchanged only when the state matches;
// the tokens are sealed before they're saved; an expiring token is renewed before a run. Hugging
// Face and the session are stand-ins; the routes are real.
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/server/session";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "ci-placeholder";
});

const rpc = vi.fn<Session["db"]["rpc"]>();
let signedIn = true;
vi.mock("@/lib/server/session", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/session")>();
  return { ...real, requireSession: async () => (signedIn ? ({ userId: "u1", db: { rpc } } satisfies Session) : real.apiError("session", 401)) };
});
const { GET: cimd } = await import("@/app/.well-known/oauth-cimd/route");
const { GET: connect } = await import("@/app/api/hf/connect/route");
const { GET: callback } = await import("@/app/api/hf/callback/route");
const { GET: status } = await import("@/app/api/data-keys/route");
const { hfRunToken, saveHfGrant } = await import("@/lib/server/hf-grant");
const { open, seal } = await import("@/lib/server/secret-box");

const SITE = "https://benchjot.vercel.app";
const net = vi.fn<typeof fetch>();
const ACCESS = "hf_oauth_" + "a1".repeat(17);
const REFRESH = "hf_oauth_" + "r2".repeat(17);
const json = (v: unknown, s = 200) => new Response(JSON.stringify(v), { status: s });
/** What set_data_tokens was last given, opened. */
const savedGrant = () => {
  const call = rpc.mock.calls.filter((c) => c[0] === "set_data_tokens").at(-1) as [string, { hf_token: string }] | undefined;
  return call ? { sealed: call[1].hf_token, grant: JSON.parse(open(call[1].hf_token)!) as Record<string, unknown> } : null;
};

beforeEach(() => {
  signedIn = true;
  rpc.mockReset().mockResolvedValue({ data: null, error: null } as never);
  net.mockReset();
  vi.stubGlobal("fetch", net);
  vi.stubEnv("KEY_ENCRYPTION_SECRET", "s".repeat(48));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function start(next = "/settings") {
  const res = await connect(new Request(`${SITE}/api/hf/connect?next=${encodeURIComponent(next)}`));
  const to = new URL(res.headers.get("location")!);
  const cookie = res.headers.get("set-cookie")!;
  const value = cookie.split(";")[0]!;
  return { to, cookie, value, saved: JSON.parse(decodeURIComponent(value.split("=")[1]!)) as { verifier: string; state: string; next: string } };
}

describe("Connect Hugging Face", () => {
  it("the client document is its own client_id, names Benchjot and allows one way back; nothing secret", async () => {
    const doc = (await (await cimd(new Request(`${SITE}/.well-known/oauth-cimd`))).json()) as Record<string, unknown>;
    expect(doc.client_id).toBe(`${SITE}/.well-known/oauth-cimd`);
    expect(doc.client_name).toBe("Benchjot");
    expect(doc.redirect_uris).toEqual([`${SITE}/api/hf/callback`]);
    expect(doc.token_endpoint_auth_method).toBe("none");
    expect(JSON.stringify(doc)).not.toMatch(/secret/i);
  });

  it("sends the user to Hugging Face with a PKCE challenge, read-only repo scopes, keeping the verifier in an httpOnly cookie", async () => {
    const { to, cookie, saved } = await start();
    expect(`${to.origin}${to.pathname}`).toBe("https://huggingface.co/oauth/authorize");
    expect(to.searchParams.get("client_id")).toBe(`${SITE}/.well-known/oauth-cimd`);
    expect(to.searchParams.get("redirect_uri")).toBe(`${SITE}/api/hf/callback`);
    expect(to.searchParams.get("response_type")).toBe("code");
    // Read-only on repos, nothing else (voice uses the browser's own speech recognition, not Hugging Face).
    expect(to.searchParams.get("scope")!.split(" ").sort()).toEqual(["gated-repos", "openid", "profile", "read-repos"]);
    expect(to.searchParams.get("code_challenge_method")).toBe("S256");
    expect(to.searchParams.get("code_challenge")).toBe(createHash("sha256").update(saved.verifier).digest("base64url"));
    expect(to.searchParams.get("state")).toBe(saved.state);
    expect(to.toString()).not.toContain(saved.verifier);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/Path=\/api\/hf/i);
  });

  it("back from Hugging Face: the code is exchanged with the verifier, the tokens saved sealed with the username", async () => {
    const { value, saved } = await start();
    net.mockImplementation(async (u) =>
      String(u) === "https://huggingface.co/oauth/token" ? json({ access_token: ACCESS, refresh_token: REFRESH, expires_in: 28800, token_type: "Bearer" }) : json({ preferred_username: "ada" }),
    );
    const res = await callback(new Request(`${SITE}/api/hf/callback?code=abc&state=${saved.state}`, { headers: { cookie: value } }));
    expect(res.headers.get("location")).toBe(`${SITE}/settings?hf=connected`);
    const form = new URLSearchParams(String(net.mock.calls[0]![1]!.body));
    expect(Object.fromEntries(form)).toEqual({ grant_type: "authorization_code", code: "abc", redirect_uri: `${SITE}/api/hf/callback`, client_id: `${SITE}/.well-known/oauth-cimd`, code_verifier: saved.verifier });
    const s = savedGrant()!;
    expect(s.sealed).toMatch(/^enc:v1:/);
    expect(s.sealed).not.toContain("hf_oauth");
    expect(s.sealed.length).toBeLessThanOrEqual(16_000);
    expect(s.grant).toMatchObject({ a: ACCESS, r: REFRESH, u: "ada" });
    expect(s.grant.e).toBeGreaterThan(Date.now());
  });

  it("a code for another connect is never exchanged; declining or a refused code connects nothing", async () => {
    const { value } = await start();
    expect((await callback(new Request(`${SITE}/api/hf/callback?code=abc&state=other`, { headers: { cookie: value } }))).headers.get("location")).toContain("hf=failed");
    expect((await callback(new Request(`${SITE}/api/hf/callback?code=abc&state=x`))).headers.get("location")).toContain("hf=expired"); // no cookie: too late, or another browser
    expect((await callback(new Request(`${SITE}/api/hf/callback?error=access_denied`, { headers: { cookie: value } }))).headers.get("location")).toContain("hf=cancelled");
    expect((await callback(new Request(`${SITE}/api/hf/callback?error=invalid_scope`, { headers: { cookie: value } }))).headers.get("location")).toContain("hf=failed");
    expect(net).not.toHaveBeenCalled();
    const { value: v2, saved } = await start();
    net.mockResolvedValue(json({ error: "invalid_grant" }, 400));
    expect((await callback(new Request(`${SITE}/api/hf/callback?code=abc&state=${saved.state}`, { headers: { cookie: v2 } }))).headers.get("location")).toContain("hf=failed");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("only returns to this site; signed out goes to sign-in; without the server's secret nothing starts", async () => {
    expect((await start("https://evil.example/x")).saved.next).toBe("/");
    signedIn = false;
    expect((await connect(new Request(`${SITE}/api/hf/connect`))).headers.get("location")).toContain("/login");
    signedIn = true;
    vi.stubEnv("KEY_ENCRYPTION_SECRET", "");
    expect((await connect(new Request(`${SITE}/api/hf/connect?next=/settings`))).headers.get("location")).toBe(`${SITE}/settings?hf=unavailable`);
  });

  it("Hugging Face's long signed tokens are kept whole", async () => {
    const jwt = "eyJ" + "a".repeat(1400) + ".eyJ" + "b".repeat(900) + "." + "c".repeat(340);
    expect(await saveHfGrant({ userId: "u1", db: { rpc } } as Session, { a: jwt, r: jwt, e: 1, u: "ada" })).toBe(true);
    expect(savedGrant()!.grant).toEqual({ a: jwt, r: jwt, e: 1, u: "ada" });
    expect(savedGrant()!.sealed.length).toBeLessThanOrEqual(16_000);
  });
});

describe("the token a server run gets", () => {
  const session = { userId: "u1", db: { rpc } } as Session;
  const stored = (v: string | null) => rpc.mockImplementation(async (fn) => (fn === "data_tokens" ? { data: { hf_token: v }, error: null } : { data: null, error: null }) as never);

  it("a fresh token is used as it is; a pasted one too", async () => {
    stored(seal(JSON.stringify({ a: ACCESS, r: REFRESH, e: Date.now() + 8 * 3600_000 })));
    expect(await hfRunToken(session, SITE)).toBe(ACCESS);
    stored(seal("hf_" + "p".repeat(30)));
    expect(await hfRunToken(session, SITE)).toBe("hf_" + "p".repeat(30));
    stored(null);
    expect(await hfRunToken(session, SITE)).toBeUndefined();
    expect(net).not.toHaveBeenCalled();
  });

  it("one that expires within the hour is renewed first and the new one saved", async () => {
    stored(seal(JSON.stringify({ a: ACCESS, r: REFRESH, e: Date.now() + 10 * 60_000, u: "ada" })));
    net.mockResolvedValue(json({ access_token: "hf_oauth_new" + "n".repeat(20), expires_in: 28800 }));
    expect(await hfRunToken(session, SITE)).toBe("hf_oauth_new" + "n".repeat(20));
    expect(Object.fromEntries(new URLSearchParams(String(net.mock.calls[0]![1]!.body)))).toEqual({ grant_type: "refresh_token", refresh_token: REFRESH, client_id: `${SITE}/.well-known/oauth-cimd` });
    expect(savedGrant()!.grant).toMatchObject({ a: "hf_oauth_new" + "n".repeat(20), r: REFRESH, u: "ada" });
  });

  it("when renewing fails: a still-valid token is used, an expired one isn't", async () => {
    net.mockResolvedValue(json({ error: "invalid_grant" }, 400));
    stored(seal(JSON.stringify({ a: ACCESS, r: REFRESH, e: Date.now() + 10 * 60_000 })));
    expect(await hfRunToken(session, SITE)).toBe(ACCESS);
    stored(seal(JSON.stringify({ a: ACCESS, r: REFRESH, e: Date.now() - 1000 })));
    expect(await hfRunToken(session, SITE)).toBeUndefined();
  });

  it("Settings sees who is connected and how, never the token", async () => {
    net.mockResolvedValue(json({ name: "ada" })); // Hugging Face still accepts it
    stored(seal(JSON.stringify({ a: ACCESS, r: REFRESH, e: Date.now() + 3600_000, u: "ada" })));
    const body = await (await status(new Request(`${SITE}/api/data-keys`))).text();
    expect(JSON.parse(body)).toEqual({ hf: true, hfUser: "ada", hfBy: "signin", hfRemoved: false });
    expect(body).not.toContain("hf_oauth");
    stored(seal("hf_" + "p".repeat(30)));
    expect(await (await status(new Request(`${SITE}/api/data-keys`))).json()).toEqual({ hf: true, hfUser: null, hfBy: "token", hfRemoved: false });
  });

  it("access removed on Hugging Face shows in Settings, and the connection is forgotten", async () => {
    net.mockResolvedValue(json({ error: "Invalid credentials" }, 401));
    stored(seal(JSON.stringify({ a: ACCESS, r: REFRESH, e: Date.now() + 3600_000, u: "ada" })));
    expect(await (await status(new Request(`${SITE}/api/data-keys`))).json()).toEqual({ hf: false, hfUser: null, hfBy: null, hfRemoved: true });
    expect(rpc).toHaveBeenCalledWith("set_data_tokens", { hf_token: "" });
  });

  it("when Hugging Face can't be reached, the connection is shown as stored", async () => {
    net.mockRejectedValue(new Error("offline"));
    stored(seal("hf_" + "p".repeat(30)));
    expect(await (await status(new Request(`${SITE}/api/data-keys`))).json()).toMatchObject({ hf: true, hfRemoved: false });
  });
});
