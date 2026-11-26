// POST /api/agent — one step of the agent (everything sent in the Assistant comes here). Claude
// (lib/server/llm.ts) answers with the tool calls to make next (lib/ai/agent.ts); the browser makes
// them on the note (it owns the cells and runs the code) and sends the next step. Nothing here reads
// or writes the note. Same models and allowance as Fix and the seer.
//
// The live conversation (input.live): the first step is built from the request, the history and the
// note; every later step adds to the end of what the browser sends back (Claude's own turns, kept
// unchanged, and a tool_result for each of its calls), so Claude keeps its reasoning from step to
// step and reads all but the newest part from the prompt cache. Old apps send `steps` instead: the
// request is rebuilt from them each time.
import { NextResponse } from "next/server";
import { AGENT_TOOLS, agentMessages, agentRequest, agentRules, cutNativeReply, liveAnswer, parseAgentReply, readNativeReply, salvageAgentReply, type LiveMessage } from "@/lib/ai/agent";
import { AGENT_STYLE, ASSISTANT_LONG } from "@/config/app";
import { askModel, modelFrom, toClaude, type ClaudeChat } from "@/lib/server/llm";
import { readBody, requireSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const maxDuration = 300; // a long answer comes in batches (ASSISTANT_LONG)

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const input = await readBody(request, (v) => agentRequest.safeParse(v));
  if (input instanceof NextResponse) return input;
  const read = (content: string) => parseAgentReply(input.language, content);
  if (!input.live) {
    // Native tool calling: the model acts through the tools (AGENT_TOOLS), never JSON in its text.
    return askModel(session, modelFrom(request), "agent", agentMessages(input), read, AGENT_STYLE, { ...ASSISTANT_LONG, salvage: salvageAgentReply }, {
      tools: AGENT_TOOLS,
      read: (content, calls) => readNativeReply(input.language, content, calls),
      cut: cutNativeReply,
    });
  }
  const before = input.transcript ?? [];
  const added: LiveMessage[] = [];
  if (!before.length) added.push(...(toClaude(agentMessages({ ...input, steps: [] })).messages as unknown as LiveMessage[]));
  else {
    const answer = liveAnswer(before.at(-1), input.results ?? [], input.notes ?? []);
    if (answer) added.push(answer);
  }
  const chat = { system: agentRules(input.language), messages: [...before, ...added] } as unknown as ClaudeChat;
  return askModel(session, modelFrom(request), "agent", chat, read, AGENT_STYLE, undefined, {
    tools: AGENT_TOOLS,
    read: (content, calls, turn) => ({ ...readNativeReply(input.language, content, calls), turns: [...added, { role: "assistant", content: turn }] }),
    // Cut off: its unfinished turn isn't kept (its calls were never whole); what was asked is.
    cut: (content) => ({ ...cutNativeReply(content), turns: added }),
  });
}
