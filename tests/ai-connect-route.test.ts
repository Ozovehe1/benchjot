// "Connect AI" (/api/ai-key/connect and /callback): the PKCE flow with OpenRouter. The verifier and
// state live only in this browser's cookie; the code is exchanged only when the state matches; the
// key is sealed before it's saved. OpenRouter and the session are stand-ins; the routes are real.
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
const { GET: connect } = await import("@/app/api/ai-key/connect/route");
const { GET: callback } = await import("@/app/api/ai-key/callback/route");
const { DELETE } = await import("@/app/api/ai-key/route");
const { open } = await import("@/lib/server/secret-box");

const net = vi.fn<typeof fetch>();
const KEY = "sk-or-v1-" + "ab12".repeat(12);

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

/** Starts a connect and returns where it sends the user and the cookie it set. */
async function start(next = "/welcome/boosts") {
  const res = await connect(new Request(`https://benchjot.vercel.app/api/ai-key/connect?next=${encodeURIComponent(next)}`));
  const to = new URL(res.headers.get("location")!);
  const cookie = res.headers.get("set-cookie")!;
  return { to, cookie, value: cookie.split(";")[0]! };
}

describe("Connect AI", () => {
  it("sends the user to OpenRouter with a PKCE challenge, keeping the verifier in an httpOnly cookie", async () => {
    const { to, cookie, value } = await start();
    expect(`${to.origin}${to.pathname}`).toBe("https://openrouter.ai/auth");
    expect(to.searchParams.get("callback_url")).toBe("https://benchjot.vercel.app/api/ai-key/callback");
    expect(to.searchParams.get("code_challenge_method")).toBe("S256");
    expect(to.searchParams.get("key_label")).toBe("Benchjot");
    const saved = JSON.parse(decodeURIComponent(value.split("=")[1]!)) as { verifier: string; state: string; next: string };
    expect(to.searchParams.get("code_challenge")).toBe(createHash("sha256").update(saved.verifier).digest("base64url"));
    expect(to.searchParams.get("state")).toBe(saved.state);
    expect(to.toString()).not.toContain(saved.verifier); // the verifier never goes in a URL
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/Path=\/api\/ai-key/i);
  });

  it("back from OpenRouter: the code is exchanged with the verifier, the key saved sealed, and the user returned", async () => {
    const { value } = await start();
    const saved = JSON.parse(decodeURIComponent(value.split("=")[1]!)) as { verifier: string; state: string };
    net.mockResolvedValue(new Response(JSON.stringify({ key: KEY }), { status: 200 }));
    const res = await callback(new Request(`https://benchjot.vercel.app/api/ai-key/callback?code=abc&state=${saved.state}`, { headers: { cookie: value } }));
    expect(res.headers.get("location")).toBe("https://benchjot.vercel.app/welcome/boosts?ai=connected");
    expect(net.mock.calls[0]![0]).toBe("https://openrouter.ai/api/v1/auth/keys");
    expect(JSON.parse(String(net.mock.calls[0]![1]!.body))).toEqual({ code: "abc", code_verifier: saved.verifier, code_challenge_method: "S256" });
    const [, args] = rpc.mock.calls.find((c) => c[0] === "set_ai_key")! as [string, { provider: string; key: string; key_hash: string }];
    expect(args.provider).toBe("openrouter");
    expect(args.key).toMatch(/^enc:v1:/);
    expect(args.key).not.toContain("sk-or");
    expect(open(args.key)).toBe(KEY);
    expect(args.key_hash).toBe(createHash("sha256").update(KEY).digest("hex"));
  });

  it("a code for another connect (wrong state, or no cookie) is never exchanged; declining connects nothing", async () => {
    const { value } = await start();
    const wrong = await callback(new Request("https://benchjot.vercel.app/api/ai-key/callback?code=abc&state=someone-elses", { headers: { cookie: value } }));
    expect(wrong.headers.get("location")).toContain("ai=failed");
    const none = await callback(new Request("https://benchjot.vercel.app/api/ai-key/callback?code=abc&state=x"));
    expect(none.headers.get("location")).toContain("ai=failed");
    const declined = await callback(new Request("https://benchjot.vercel.app/api/ai-key/callback", { headers: { cookie: value } }));
    expect(declined.headers.get("location")).toContain("ai=cancelled");
    expect(net).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("only returns to this site; signed out goes to sign-in; without the server's secret nothing starts", async () => {
    expect((await start("https://evil.example/x")).value).toContain(encodeURIComponent('"next":"/"'));
    signedIn = false;
    expect((await connect(new Request("https://benchjot.vercel.app/api/ai-key/connect"))).headers.get("location")).toContain("/login");
    signedIn = true;
    vi.stubEnv("KEY_ENCRYPTION_SECRET", "");
    const res = await connect(new Request("https://benchjot.vercel.app/api/ai-key/connect?next=/settings"));
    expect(res.headers.get("location")).toBe("https://benchjot.vercel.app/settings?ai=unavailable");
  });

  it("DELETE disconnects", async () => {
    expect((await DELETE(new Request("https://benchjot.vercel.app/api/ai-key", { method: "DELETE" }))).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("set_ai_key", { provider: "openrouter", key: "", key_hash: "" });
  });
});
