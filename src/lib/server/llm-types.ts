// The chat format the model is asked in (OpenAI's, which OpenRouter speaks for every model), shared
// by the server (llm.ts) and the agent's messages (lib/ai/agent.ts). Types only.

/** A tool call as the model makes it. */
export type NativeToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: NativeToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
