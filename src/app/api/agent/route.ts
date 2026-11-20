// POST /api/agent — one step of the agent (everything sent in the Assistant comes here): the request, the note as it is now and the steps so
// far go to the user's own connected AI, which answers with the tool calls to make next (lib/ai/agent.ts).
// The browser makes the calls on the note (it owns the cells and runs the code) and sends the next step.
// Nothing here reads or writes the note. Same key, models and limits as Fix and the Assistant.
import { NextResponse } from "next/server";
import { AGENT_TOOLS, agentMessages, agentRequest, cutNativeReply, parseAgentReply, readNativeReply, salvageAgentReply } from "@/lib/ai/agent";
import { AGENT_STYLE, ASSISTANT_LONG } from "@/config/app";
import { askModel } from "@/lib/server/llm";
import { readBody, requireSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const maxDuration = 300; // a long answer comes in batches (ASSISTANT_LONG)

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const input = await readBody(request, (v) => agentRequest.safeParse(v));
  if (input instanceof NextResponse) return input;
  // Native tool calling: the model acts through the tools (lib/ai/agent.ts AGENT_TOOLS), never JSON in its text.
  return askModel(session, "agent", agentMessages(input), (content) => parseAgentReply(input.language, content), AGENT_STYLE, { ...ASSISTANT_LONG, salvage: salvageAgentReply }, {
    tools: AGENT_TOOLS,
    read: (content, calls) => readNativeReply(input.language, content, calls),
    cut: cutNativeReply,
  });
}
