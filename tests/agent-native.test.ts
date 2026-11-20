// The Assistant's request to the model (lib/server/llm.ts askModel with native tools): the tools go
// with it, JSON mode doesn't, and the model's tool calls come back as the agent's reply.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// The server's Supabase client is never used here (the session is a stand-in), only imported.
vi.mock("@/lib/server/session", () => ({ apiError: (kind: string, status: number) => new Response(JSON.stringify({ code: kind }), { status }), jsonError: (status: number, error: string) => new Response(JSON.stringify({ error }), { status }) }));
import { askModel } from "@/lib/server/llm";
import { seal } from "@/lib/server/secret-box";
import { AGENT_TOOLS, agentMessages, agentRequest, cutNativeReply, parseAgentReply, readNativeReply } from "@/lib/ai/agent";
import { AGENT_STYLE } from "@/config/app";
import type { Session } from "@/lib/server/session";

const realFetch = globalThis.fetch;
let sent: Record<string, unknown>[] = [];
const reply = (message: unknown, finish_reason = "tool_calls") => (sent.push({}), new Response(JSON.stringify({ choices: [{ message, finish_reason }] }), { status: 200 }));

beforeEach(() => {
  process.env.KEY_ENCRYPTION_SECRET = "x".repeat(40);
  sent = [];
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function session(): Session {
  const key = seal("sk-or-test");
  return { db: { rpc: async (name: string) => (name === "ai_key" ? { data: { key }, error: null } : { data: null, error: null }) } } as unknown as Session;
}

const input = agentRequest.parse({ request: "run cell 1", language: "python", title: "T", note: "[Cell 1]\nprint(1)", steps: [] });
const native = { tools: AGENT_TOOLS, read: (c: string, calls: Parameters<typeof readNativeReply>[2]) => readNativeReply("python", c, calls), cut: cutNativeReply };

describe("the Assistant asks with native tools", () => {
  it("sends the tools (not JSON mode) and reads the calls the model makes", async () => {
    const bodies: Record<string, unknown>[] = [];
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init!.body)));
      return reply({ content: "Running cell 1.", tool_calls: [{ id: "a", type: "function", function: { name: "run_cell", arguments: '{"cell": 1}' } }] });
    }) as typeof fetch;
    const res = await askModel(session(), "agent", agentMessages(input), (c) => parseAgentReply("python", c), AGENT_STYLE, undefined, native);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ message: "Running cell 1.", calls: [{ tool: "run_cell", cell: 1 }] });
    expect(bodies[0]!.tools).toHaveLength(AGENT_TOOLS.length);
    expect(bodies[0]!.tool_choice).toBe("auto");
    expect(bodies[0]!.response_format).toBeUndefined();
    expect(bodies[0]!.max_tokens).toBe(AGENT_STYLE.maxTokens);
  });
  it("finish comes back as the end, with its answer", async () => {
    globalThis.fetch = vi.fn(async () => reply({ content: null, tool_calls: [{ id: "f", type: "function", function: { name: "finish", arguments: '{"answer": "It prints 1."}' } }] })) as typeof fetch;
    const res = await askModel(session(), "agent", agentMessages(input), (c) => parseAgentReply("python", c), AGENT_STYLE, undefined, native);
    expect(await res.json()).toMatchObject({ message: "It prints 1.", calls: [], finished: true });
  });
  it("a reply cut off at the length limit isn't an error: it's marked cut, so the agent writes less", async () => {
    globalThis.fetch = vi.fn(async () => reply({ content: "Writing the cell", tool_calls: [{ id: "a", type: "function", function: { name: "add_cell", arguments: '{"language": "python", "code": "import num' } }] }, "length")) as typeof fetch;
    const res = await askModel(session(), "agent", agentMessages(input), (c) => parseAgentReply("python", c), AGENT_STYLE, undefined, native);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "Writing the cell", calls: [], done: false, cut: true });
  });
});
