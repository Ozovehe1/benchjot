// /api/helper and /api/fix on the shared Groq call (lib/server/groq.ts): signed-in only, one limit for
// both, the model and caps, and each failure as the shared error table's text. The session and Groq
// are stand-ins here (test only); the routes themselves are the shipped code.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import type { Session } from "@/lib/server/session";

// The Supabase client module reads these at import; CI sets the same placeholders.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "ci-placeholder";
});

const rpc = vi.fn<Session["db"]["rpc"]>();
let signedIn = true;
vi.mock("@/lib/server/session", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/session")>();
  return { ...real, requireSession: async () => (signedIn ? ({ userId: "u1", plan: "free", db: { rpc } } satisfies Session) : real.apiError("session", 401)) };
});

const { POST: helper } = await import("@/app/api/helper/route");
const { POST: fix } = await import("@/app/api/fix/route");

const groq = vi.fn<typeof fetch>();
const reply = (content: string, finish = "stop") => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: finish }] }), { status: 200 });
const post = (body: unknown) => new Request("http://localhost/api/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const write = { task: "write", request: "Plot the results", language: "python", title: "Warmup", note: "Does warmup help?\n\n```python\nprint(1)\n```" };
const json = async (r: NextResponse | Response) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> });

beforeEach(() => {
  signedIn = true;
  rpc.mockReset().mockResolvedValue({ data: 0, error: null });
  groq.mockReset();
  vi.stubGlobal("fetch", groq);
  vi.stubEnv("GROQ_API_KEY", "test-key");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("/api/helper", () => {
  it("is for signed-in users only, and asks nothing when signed out", async () => {
    signedIn = false;
    const r = await json(await helper(post(write)));
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("session");
    expect(groq).not.toHaveBeenCalled();
  });

  it("writes code with Fix's model, caps and JSON mode, on the shared limit", async () => {
    groq.mockResolvedValue(reply(JSON.stringify({ code: "import matplotlib.pyplot as plt\nplt.plot([1, 2])\nplt.show()", summary: "Plots it." })));
    const r = await json(await helper(post(write)));
    expect(r).toEqual({ status: 200, body: { kind: "code", code: "import matplotlib.pyplot as plt\nplt.plot([1, 2])\nplt.show()", summary: "Plots it.", language: "python" } });
    expect(rpc).toHaveBeenCalledWith("fix_take", { per_minute: 6, per_day: 10 });
    const [url, init] = groq.mock.calls[0]!;
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    const sent = JSON.parse(String(init!.body));
    expect(sent).toMatchObject({ model: "openai/gpt-oss-120b", temperature: 0, max_completion_tokens: 3000, reasoning_effort: "low", response_format: { type: "json_object" } });
    expect(sent.messages[1].content).toContain("Does warmup help?");
    expect(init!.headers).toMatchObject({ authorization: "Bearer test-key" });
  });

  it("answers a question about the note", async () => {
    groq.mockResolvedValue(reply('{"answer":"It tests a 500-step warmup."}'));
    const r = await json(await helper(post({ ...write, task: "ask", request: "Explain this code" })));
    expect(r).toEqual({ status: 200, body: { kind: "prose", text: "It tests a 500-step warmup." } });
  });

  it("Fix and Helper take from the same counter", async () => {
    groq.mockResolvedValue(reply('{"code":"print(2)","summary":"s"}'));
    await helper(post(write));
    await fix(post({ language: "python", code: "print(1", error: "SyntaxError" }));
    expect(rpc.mock.calls).toEqual([["fix_take", { per_minute: 6, per_day: 10 }], ["fix_take", { per_minute: 6, per_day: 10 }]]);
  });

  it("past the per-minute limit: the helper's own text and the wait", async () => {
    rpc.mockResolvedValue({ data: 30, error: null });
    const r = await json(await helper(post(write)));
    expect(r).toEqual({ status: 429, body: { error: "The helper has hit its limit for now. Try again in a minute.", code: "rate_limited", retryAfter: 30 } });
    expect(groq).not.toHaveBeenCalled();
  });

  it("past the daily cap: one text for both, since they share it", async () => {
    rpc.mockResolvedValue({ data: 7200, error: null });
    const h = await json(await helper(post(write)));
    const f = await json(await fix(post({ language: "python", code: "x", error: "e" })));
    expect(h.body).toEqual({ error: "You’ve used today’s 10 Fix and Helper requests. More in 2 hours.", code: "notice", retryAfter: 7200 });
    expect(f.body).toEqual(h.body);
  });

  it("a Python note never gets JavaScript back", async () => {
    groq.mockResolvedValue(reply(JSON.stringify({ code: "const xs = [1, 2].map((v) => v * 2);\nconsole.log(xs);", summary: "s" })));
    const r = await json(await helper(post(write)));
    expect(r).toEqual({ status: 422, body: { error: "The helper wrote JavaScript, not Python, so it was left out. Try again.", code: "notice" } });
  });

  it("an answer cut at the token cap is too_large, never partial code", async () => {
    groq.mockResolvedValue(reply('{"code":"print(1)', "length"));
    const r = await json(await helper(post(write)));
    expect(r).toEqual({ status: 413, body: { error: "The answer would be too long for the helper. Ask for something smaller.", code: "too_large" } });
  });

  it("refuses a note over the budget before asking", async () => {
    const r = await json(await helper(post({ ...write, note: "a".repeat(16_001) })));
    expect(r).toEqual({ status: 400, body: { error: "This note is too long for the helper", code: "notice" } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("provider failures become the shared kinds", async () => {
    groq.mockResolvedValueOnce(new Response("Rate limit reached", { status: 429, headers: { "retry-after": "90" } }));
    expect((await json(await helper(post(write)))).body).toEqual({ error: "The helper has hit its limit for now. Try again in 2 minutes.", code: "rate_limited", retryAfter: 90 });
    groq.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    expect((await json(await helper(post(write)))).body.code).toBe("server");
    groq.mockRejectedValueOnce(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }));
    expect((await json(await helper(post(write)))).body).toEqual({ error: "The helper couldn’t finish. This is taking too long. Try again in a moment.", code: "timeout" });
  });

  it("without the server key it says so plainly and calls nobody", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    const r = await json(await helper(post(write)));
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("server");
    expect(groq).not.toHaveBeenCalled();
  });
});
