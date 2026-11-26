// The chat format the agent and Fix build their requests in, shared by the server (llm.ts turns it
// into Claude's messages) and the agent's messages (lib/ai/agent.ts). Types only.

/** A tool call as the model makes it. */
export type NativeToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: NativeToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
