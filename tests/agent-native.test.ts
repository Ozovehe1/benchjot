// The Assistant's request to Claude (lib/server/llm.ts askModel with native tools): the tools go
// with it as Claude's tools, the chat turns become Claude's messages, and its tool_use blocks come
// back as the agent's reply. Also: the daily allowance and the count.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// The server's Supabase client is never used here (the session is a stand-in), only imported.
vi.mock("@/lib/server/session", () => ({ apiError: (kind: string, status: number) => new Response(JSON.stringify({ code: kind }), { status }), jsonError: (status: number, error: string) => new Response(JSON.stringify({ error }), { status }) }));
import { AI_REFUSED_KEY, askModel, askVision, creditsFor, limitMessage, modelFrom, toClaude } from "@/lib/server/llm";
import { AGENT_TOOLS, agentMessages, agentRequest, cutNativeReply, parseAgentReply, readNativeReply } from "@/lib/ai/agent";
import { AGENT_STYLE, AI } from "@/config/app";
import type { Session } from "@/lib/server/session";

const realFetch = globalThis.fetch;
const message = (content: unknown[], stop_reason = "tool_use") =>
  new Response(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5", content, stop_reason, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200, headers: { "content-type": "application/json" } });

let rpcs: { name: string; args: unknown }[] = [];
let wait = 0;
beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  rpcs = [];
  wait = 0;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function session(): Session {
  return { db: { rpc: async (name: string, args: unknown) => (rpcs.push({ name, args }), { data: name === "ai_check" ? { wait, why: wait ? "day" : null } : null, error: null }) } } as unknown as Session;
}

const input = agentRequest.parse({ request: "run cell 1", language: "python", title: "T", note: "[Cell 1]\nprint(1)", steps: [] });
const native = { tools: AGENT_TOOLS, read: (c: string, calls: Parameters<typeof readNativeReply>[2]) => readNativeReply("python", c, calls), cut: cutNativeReply };
const ask = () => askModel(session(), "sonnet", "agent", agentMessages(input), (c) => parseAgentReply("python", c), AGENT_STYLE, undefined, native);

describe("the Assistant asks Claude with native tools", () => {
  it("sends Claude's tools, the chosen model and a cached system prompt, and reads the calls", async () => {
    const bodies: Record<string, unknown>[] = [];
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init!.body)));
      return message([{ type: "text", text: "Running cell 1." }, { type: "tool_use", id: "toolu_1", name: "run_cell", input: { cell: 1 } }]);
    }) as typeof fetch;
    const res = await ask();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ message: "Running cell 1.", calls: [{ tool: "run_cell", cell: 1 }] });
    const b = bodies[0]!;
    expect(b.model).toBe(AI.models.sonnet);
    // The note's tools, then the web's (run on Anthropic's side).
    expect(b.tools).toHaveLength(AGENT_TOOLS.length + 2);
    expect((b.tools as { type?: string; name: string }[]).slice(-2)).toMatchObject([{ type: "web_search_20260209", name: "web_search" }, { type: "web_fetch_20260209", name: "web_fetch" }]);
    expect((b.tools as { name: string; input_schema: unknown }[])[0]).toMatchObject({ name: "add_cell", input_schema: { type: "object" } });
    expect(b.max_tokens).toBe(AGENT_STYLE.maxTokens);
    expect(b.temperature).toBeUndefined();
    expect((b.system as { cache_control?: unknown }[])[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(b.fallbacks).toBe("default");
    expect(rpcs.map((r) => r.name)).toEqual(["ai_check", "ai_spent"]);
    expect(rpcs[0]!.args).toEqual({ per_day: AI.perDay, per_month: AI.creditsPerMonth });
    // 10 input and 5 output tokens on Sonnet: (10 × $2 + 5 × $10) / 1M = $0.00007 = 0.007 credits.
    expect(rpcs[1]!.args).toEqual({ credits: 0.007 });
  });
  it("finish comes back as the end, with its answer", async () => {
    globalThis.fetch = vi.fn(async () => message([{ type: "tool_use", id: "toolu_f", name: "finish", input: { answer: "It prints 1." } }])) as typeof fetch;
    expect(await (await ask()).json()).toMatchObject({ message: "It prints 1.", calls: [], finished: true });
  });
  it("a reply cut off at the length limit isn't an error: it's marked cut, so the agent writes less", async () => {
    globalThis.fetch = vi.fn(async () => message([{ type: "text", text: "Writing the cell" }], "max_tokens")) as typeof fetch;
    const res = await ask();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "Writing the cell", calls: [], done: false, cut: true });
  });
  it("a paused turn (a long web search) goes on, and the two parts make one reply", async () => {
    let n = 0;
    globalThis.fetch = vi.fn(async () => (++n === 1 ? message([{ type: "server_tool_use", id: "srv_1", name: "web_search", input: { query: "iris dataset" } }], "pause_turn") : message([{ type: "tool_use", id: "t9", name: "finish", input: { answer: "Found it." } }], "tool_use"))) as typeof fetch;
    expect(await (await ask()).json()).toMatchObject({ message: "Found it.", finished: true });
    expect(n).toBe(2);
  });
  it("Haiku is asked as Haiku, without Sonnet's fallback", async () => {
    const bodies: Record<string, unknown>[] = [];
    globalThis.fetch = vi.fn(async (_u: unknown, init?: RequestInit) => (bodies.push(JSON.parse(String(init!.body))), message([{ type: "tool_use", id: "t", name: "finish", input: { answer: "ok" } }]))) as typeof fetch;
    await askModel(session(), "haiku", "agent", agentMessages(input), (c) => parseAgentReply("python", c), AGENT_STYLE, undefined, native);
    expect(bodies[0]!.model).toBe(AI.models.haiku);
    expect(bodies[0]!.fallbacks).toBeUndefined();
  });
});

describe("the live conversation", () => {
  it("Claude's reply comes back block by block, thinking and its signature unchanged, and the chat is sent as given", async () => {
    const bodies: Record<string, unknown>[] = [];
    globalThis.fetch = vi.fn(async (_u: unknown, init?: RequestInit) => (bodies.push(JSON.parse(String(init!.body))), message([{ type: "thinking", thinking: "", signature: "sig-1" }, { type: "tool_use", id: "toolu_2", name: "run_cell", input: { cell: 1 } }]))) as typeof fetch;
    let turn: unknown;
    const chat = { system: "rules", messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "Request: go" }] }] };
    const res = await askModel(session(), "sonnet", "agent", chat, () => null, AGENT_STYLE, undefined, { tools: AGENT_TOOLS, read: (c, calls, t) => ((turn = t), readNativeReply("python", c, calls)), cut: cutNativeReply });
    expect(await res.json()).toMatchObject({ calls: [{ tool: "run_cell", cell: 1 }], ids: ["toolu_2"] });
    expect(turn).toEqual([{ type: "thinking", thinking: "", signature: "sig-1" }, { type: "tool_use", id: "toolu_2", name: "run_cell", input: { cell: 1 } }]);
    expect(bodies[0]!.messages).toEqual(chat.messages);
    expect(bodies[0]!.cache_control).toEqual({ type: "ephemeral" });
  });
});

describe("the daily allowance", () => {
  it("the month's credits used up: said with when they renew", async () => {
    expect(limitMessage(3 * 86400, "month")).toBe(`You've used this month's 1,000 AI credits. They renew in 3 days. Running cells yourself works as usual.`);
  });
  it("used up: nothing is asked, and it says when the next request frees up", async () => {
    wait = 3 * 3600;
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    const res = await ask();
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe(limitMessage(3 * 3600));
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(limitMessage(3 * 3600)).toBe(`You've used today's ${AI.perDay} AI requests. The next one frees up in about 3 hours. Running cells yourself works as usual.`);
  });
  it("a failed request isn't counted", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "bad" } }), { status: 400 })) as typeof fetch;
    const res = await ask();
    expect(res.status).toBe(502);
    expect(rpcs.map((r) => r.name)).toEqual(["ai_check"]);
  });
  it("a refused key (401) says so plainly and isn't counted: the browser doesn't wait it out", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }), { status: 401 })) as typeof fetch;
    const res = await ask();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe(AI_REFUSED_KEY);
    expect(rpcs.map((r) => r.name)).toEqual(["ai_check"]);
  });
  it("without a key on the server it says so, and asks nothing", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await ask();
    expect(res.status).toBe(503);
    expect(rpcs).toEqual([]);
  });
});

describe("the chat turns as Claude's messages", () => {
  it("system apart; tool results in one user turn, first, with the note after them", () => {
    const steps = [{ message: "Running.", calls: [{ tool: "run_cell", cell: 1 }, { tool: "run_cell", cell: 2 }], results: ["printed 1", "printed 2"] }];
    const m = toClaude(agentMessages(agentRequest.parse({ ...input, steps })));
    expect(m.system).toContain("You act only through your tools");
    expect(m.messages.map((x) => x.role)).toEqual(["user", "assistant", "user"]);
    const assistant = m.messages[1]!.content as { type: string; id?: string; input?: unknown }[];
    expect(assistant.map((b) => b.type)).toEqual(["text", "tool_use", "tool_use"]);
    expect(assistant[1]).toMatchObject({ id: "s0c0", input: { cell: 1 } });
    const results = m.messages[2]!.content as { type: string; tool_use_id?: string; text?: string }[];
    expect(results.map((b) => b.type)).toEqual(["tool_result", "tool_result", "text"]);
    expect(results[2]!.text).toContain("The note as it is now");
  });
  it("the model header picks Sonnet or Haiku; anything else is the default", () => {
    const r = (h?: string) => new Request("https://x", { headers: h ? { "x-benchjot-model": h } : {} });
    expect(modelFrom(r("haiku"))).toBe("haiku");
    expect(modelFrom(r("sonnet"))).toBe("sonnet");
    expect(modelFrom(r("gpt"))).toBe(AI.defaultModel);
    expect(modelFrom(r())).toBe("sonnet");
  });
});

describe("the seer", () => {
  it("sends the pictures as Claude's images and reads the words", async () => {
    const bodies: Record<string, unknown>[] = [];
    globalThis.fetch = vi.fn(async (_u: unknown, init?: RequestInit) => (bodies.push(JSON.parse(String(init!.body))), message([{ type: "text", text: "A rising line." }], "end_turn"))) as typeof fetch;
    const res = await askVision(session(), "haiku", "rules", "What do these show?", [{ url: "data:image/png;base64,AAAA" }, { url: "data:text/html;base64,BBBB" }], (t) => ({ seen: t }));
    expect(await res.json()).toEqual({ seen: "A rising line." });
    const content = (bodies[0]!.messages as { content: { type: string; source?: unknown }[] }[])[0]!.content;
    expect(content.map((c) => c.type)).toEqual(["text", "image"]);
    expect(content[1]!.source).toEqual({ type: "base64", media_type: "image/png", data: "AAAA" });
  });
});

describe("credits", () => {
  it("a web search is one more credit", () => {
    expect(creditsFor("haiku", { server_tool_use: { web_search_requests: 3 } })).toBe(3);
  });
  it("one credit is one US cent of what Claude charged; cache reads are cheap", () => {
    expect(creditsFor("sonnet", { input_tokens: 1_000_000 })).toBe(200);
    expect(creditsFor("sonnet", { output_tokens: 100_000 })).toBe(100);
    expect(creditsFor("sonnet", { cache_read_input_tokens: 1_000_000 })).toBe(10);
    expect(creditsFor("haiku", { input_tokens: 50_000, output_tokens: 2_000 })).toBe(0.6);
    expect(creditsFor("haiku", { input_tokens: 200_000 })).toBe(10); // five times past 100k
  });
});
