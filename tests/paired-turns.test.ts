import { describe, expect, it, vi } from "vitest";
// The server's Supabase client is never used here, only imported.
vi.mock("@/lib/server/session", () => ({ apiError: () => new Response(), jsonError: () => new Response() }));
import { pairedMessages, pairedTurn } from "@/lib/server/llm";

// The conversation that failed on 27 Nov 2026 (400: "`code_execution` tool use … without a corresponding
// `code_execution_tool_result` block"): the Assistant's turn made an app tool call and started a
// code_execution that never ran, and every later step sent that turn back.
describe("server-side calls without a result are not sent back", () => {
  const stuck = [
    { type: "tool_use", id: "toolu_1", name: "add_cell", input: {} },
    { type: "server_tool_use", id: "srvtoolu_1", name: "code_execution", input: { code: "x" } },
  ];

  it("drops the unanswered server call and keeps the app's own call", () => {
    expect(pairedTurn(stuck)).toEqual([stuck[0]]);
  });

  it("keeps a server call with its result, and drops a result without its call", () => {
    const done = [
      { type: "server_tool_use", id: "srvtoolu_2", name: "web_search", input: {} },
      { type: "web_search_tool_result", tool_use_id: "srvtoolu_2", content: [] },
      { type: "code_execution_tool_result", tool_use_id: "srvtoolu_9", content: {} },
      { type: "text", text: "Found it." },
    ];
    expect(pairedTurn(done)).toEqual([done[0], done[1], done[3]]);
  });

  it("repairs the stuck conversation, so Try again works", () => {
    const messages = [
      { role: "user" as const, content: [{ type: "text" as const, text: "go" }] },
      { role: "assistant" as const, content: stuck as never },
      { role: "user" as const, content: [{ type: "tool_result" as const, tool_use_id: "toolu_1", content: "ok" }] },
    ];
    const fixed = pairedMessages(messages);
    expect(fixed[1]!.content).toEqual([stuck[0]]);
    expect(fixed[2]).toBe(messages[2]);
  });

  it("drops an assistant turn left with nothing", () => {
    const only = [{ role: "assistant" as const, content: [stuck[1]] as never }];
    expect(pairedMessages(only)).toEqual([]);
  });
});
