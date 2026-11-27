// Server-side only: the one way an API route asks the AI (Fix, the Assistant, the seer). Everyone
// uses Benchjot's own Claude account (ANTHROPIC_API_KEY on the server) through the Anthropic SDK,
// on the model they picked (Sonnet or Haiku, config/app.ts AI). Each account gets AI.perDay answers
// a day and AI.creditsPerMonth credits a month: the database keeps both (ai_check before asking,
// ai_spent with the answer's real cost after it came back, so a failed request never counts).
// Prompts and answers are never logged.
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { AI, FIX_LIMITS, type AiModel } from "@/config/app";
import { FriendlyError, type ErrorAction } from "../ui/user-message";
import { apiError, jsonError, type Session } from "./session";
import type { ChatMessage, NativeToolCall } from "./llm-types";
export type { ChatMessage, NativeToolCall };

const TIMEOUT_MS = 50_000;

/**
 * Native tool calling (the Assistant): the model acts through `tools` instead of writing JSON in its
 * text, so a call can't be lost in prose, cut into unreadable JSON, or shown raw. `read` gets the
 * text it wrote and the calls it made. `cut` reads a reply that stopped at the length limit.
 * `tools` are in the chat-function shape the agent defines them in ({type:"function", function:{…}}).
 */
export type NativeTools<T> = { tools: readonly unknown[]; read: (content: string, calls: NativeToolCall[], turn: ClaudeTurn) => T; cut: (content: string) => T };

/** Claude's own reply, block by block (thinking, text, tool calls), as it goes back to it unchanged in the next request. */
export type ClaudeTurn = Anthropic.Beta.BetaContentBlockParam[];
/** A conversation already in Claude's shape (the agent's transcript). */
export type ClaudeChat = { system: string; messages: Anthropic.Beta.BetaMessageParam[] };

/** How the model answers: Fix wants a short exact fix; the Assistant thinks a little more. */
type ModelStyle = { readonly effort: "low" | "medium" | "high"; readonly maxTokens: number; readonly timeoutMs?: number };
const EXACT: ModelStyle = { effort: "low", maxTokens: FIX_LIMITS.maxReplyTokens };

/** The model the request asked for (the X-Benchjot-Model header: "sonnet" or "haiku"), else the default. */
export function modelFrom(request: Request): AiModel {
  const asked = request.headers.get("x-benchjot-model");
  return asked && asked in AI.models ? (asked as AiModel) : AI.defaultModel;
}

/** A second try is only made with at least this much of the request's time left. */
const RETRY_MIN_MS = 15_000;

/** Said when the server has no Claude key yet (ANTHROPIC_API_KEY in Vercel). */
const NOT_SET_UP = "The AI isn't set up on the server yet. Running cells works as usual.";

let client: Anthropic | null = null;
/** The one client, made on first use; null without a key. The SDK retries a dropped connection, 429 and 5xx once itself. */
function claude(): Anthropic | null {
  // Trimmed: a key pasted with a trailing space or line break is otherwise refused (401).
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  // fetch is looked up on each request (tests stand in for it).
  client ??= new Anthropic({ apiKey, maxRetries: 1, fetch: (url, init) => globalThis.fetch(url, init) });
  return client;
}

/** When a limit frees up, in words. */
function inWords(seconds: number): string {
  const mins = Math.max(1, Math.ceil(seconds / 60));
  if (mins >= 36 * 60) return `${Math.round(mins / 1440)} days`;
  return mins >= 90 ? `about ${Math.round(mins / 60)} hours` : mins >= 60 ? "about an hour" : `${mins} minute${mins === 1 ? "" : "s"}`;
}

/** The allowance that's used up, said plainly with when it comes back. */
export function limitMessage(waitSeconds: number, why: "day" | "month" = "day"): string {
  return why === "month"
    ? `You've used this month's ${AI.creditsPerMonth.toLocaleString("en")} AI credits. They renew in ${inWords(waitSeconds)}. Running cells yourself works as usual.`
    : `You've used today's ${AI.perDay} AI requests. The next one frees up in ${inWords(waitSeconds)}. Running cells yourself works as usual.`;
}

/**
 * Whether the caller may ask now: null when yes, else the response to send (a limit is used up).
 * A failed check lets the request through: the count is a fair-use limit, not a lock.
 */
async function allowance(session: Session): Promise<NextResponse | null> {
  const r = await Promise.resolve(session.db.rpc("ai_check", { per_day: AI.perDay, per_month: AI.creditsPerMonth })).catch((e: unknown) => ({ data: null, error: e }));
  if (r.error) console.error("ai_check failed", r.error);
  const d = (r.data ?? {}) as { wait?: unknown; why?: unknown };
  const wait = typeof d.wait === "number" ? d.wait : 0;
  return wait > 0 ? jsonError(429, limitMessage(wait, d.why === "month" ? "month" : "day"), wait) : null;
}

/** What Claude charged for one answer, in credits (US cents), from its token counts. Haiku's price is five times as much past 100k input tokens. */
export function creditsFor(model: AiModel, usage: Partial<Record<"input_tokens" | "output_tokens" | "cache_creation_input_tokens" | "cache_read_input_tokens", number | null>> & { server_tool_use?: { web_search_requests?: number | null } | null }): number {
  const n = (k: "input_tokens" | "output_tokens" | "cache_creation_input_tokens" | "cache_read_input_tokens") => usage[k] ?? 0;
  const [inp, out, write, read] = AI.prices[model];
  const prompt = n("input_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens");
  const x = model === "haiku" && prompt > 100_000 ? 5 : 1;
  // A web search costs US$10 per 1,000 (one credit each); reading a page costs only its tokens.
  const searches = usage.server_tool_use?.web_search_requests ?? 0;
  const dollars = (x * (n("input_tokens") * inp + n("output_tokens") * out + n("cache_creation_input_tokens") * write + n("cache_read_input_tokens") * read)) / 1e6 + searches * 0.01;
  return Math.round(dollars * 100 * 10_000) / 10_000;
}

/** Counts one answer and its cost for the caller (Settings → Usage, the allowance); a failed count changes nothing. */
const counted = (session: Session, credits: number) => Promise.resolve(session.db.rpc("ai_spent", { credits })).catch(() => null);

// ------------------------------------------------------------------ the chat format → Claude's

type Block = Anthropic.Beta.BetaContentBlockParam;

/** The chat messages as Claude takes them: the system turn apart, tool results in the user turn after the call. */
export function toClaude(messages: readonly ChatMessage[]): { system: string; messages: Anthropic.Beta.BetaMessageParam[] } {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  const push = (role: "user" | "assistant", blocks: Block[]) => {
    if (!blocks.length) return;
    const last = out[out.length - 1];
    if (last && last.role === role) (last.content as Block[]).push(...blocks);
    else out.push({ role, content: blocks });
  };
  const text = (t: string): Block[] => (t.trim() ? [{ type: "text", text: t }] : []);
  for (const m of messages) {
    if (m.role === "tool") push("user", [{ type: "tool_result", tool_use_id: m.tool_call_id, content: m.content || "No result." }]);
    else if (m.role === "user") push("user", text(m.content));
    else if (m.role === "assistant") {
      const calls: Block[] = (m.tool_calls ?? []).map((c) => ({ type: "tool_use", id: c.id, name: c.function.name, input: parseArgs(c.function.arguments) }));
      push("assistant", [...text(m.content.trimEnd()), ...calls]);
    }
  }
  // Tool results come first in their user turn (Claude's rule); text after them stays in order.
  for (const m of out) if (m.role === "user" && Array.isArray(m.content)) m.content.sort((a, b) => Number(b.type === "tool_result") - Number(a.type === "tool_result"));
  return { system, messages: out };
}

function parseArgs(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json || "{}") as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The agent's tools ({type:"function", function:{name, description, parameters}}) as Claude's tools. */
export function toClaudeTools(tools: readonly unknown[]): Anthropic.Beta.BetaTool[] {
  return tools.map((t) => {
    const f = (t as { function: { name: string; description: string; parameters: Anthropic.Beta.BetaTool.InputSchema } }).function;
    return { name: f.name, description: f.description, input_schema: f.parameters };
  });
}

/**
 * What Claude answered: its text, its tool calls (in the chat shape the readers take), why it
 * stopped, what it cost (credits), and the reply itself, block by block, to send back unchanged
 * (thinking blocks included: Claude keeps its reasoning across the agent's steps).
 */
function fromClaude(model: AiModel, msg: Anthropic.Beta.BetaMessage): { content: string; calls: NativeToolCall[]; stop: string | null; credits: number; turn: ClaudeTurn } {
  let content = "";
  const calls: NativeToolCall[] = [];
  const turn: ClaudeTurn = [];
  for (const b of msg.content) {
    if (b.type === "text") {
      content += b.text;
      turn.push({ type: "text", text: b.text });
    } else {
      if (b.type === "tool_use") calls.push({ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } });
      turn.push(b as unknown as Anthropic.Beta.BetaContentBlockParam);
    }
  }
  return { content, calls, stop: msg.stop_reason, credits: creditsFor(model, msg.usage ?? {}), turn };
}

/**
 * A turn with its server-side calls answered: a call Anthropic ran on its side (web_search, web_fetch,
 * code_execution: a server_tool_use) whose result isn't in the same turn is dropped, and so is a result
 * without its call. Claude refuses a conversation holding one (400), so a reply that stopped at the
 * app's own tool call before its code_execution ran would otherwise block every later step.
 */
export function pairedTurn<T extends { type: string }>(turn: readonly T[]): T[] {
  const id = (b: T, key: "id" | "tool_use_id") => (b as unknown as Record<string, unknown>)[key];
  const results = new Set(turn.filter((b) => b.type.endsWith("_tool_result")).map((b) => id(b, "tool_use_id")));
  const calls = new Set(turn.filter((b) => b.type === "server_tool_use").map((b) => id(b, "id")));
  return turn.filter((b) => (b.type === "server_tool_use" ? results.has(id(b, "id")) : b.type.endsWith("_tool_result") && b.type !== "tool_result" ? calls.has(id(b, "tool_use_id")) : true));
}

/** The conversation with every assistant turn's server-side calls answered (pairedTurn); a turn left empty goes. */
export function pairedMessages(messages: Anthropic.Beta.BetaMessageParam[]): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of messages) {
    if (m.role !== "assistant" || typeof m.content === "string" || !m.content) {
      out.push(m);
      continue;
    }
    const content = pairedTurn(m.content);
    if (content.length) out.push(content.length === m.content.length ? m : { ...m, content });
  }
  return out;
}

/**
 * The Assistant's web tools, run on Anthropic's side: search the web and read a page (docs, a paper,
 * a dataset's download address). Sonnet gets the current versions (they filter results with code);
 * Haiku the basic ones. A few uses per step, so one step can't run up the bill.
 */
export function webTools(model: AiModel): Anthropic.Beta.BetaToolUnion[] {
  return model === "sonnet"
    ? [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }, { type: "web_fetch_20260209", name: "web_fetch", max_uses: 5 }]
    : [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }, { type: "web_fetch_20250910", name: "web_fetch", max_uses: 5 }];
}

/** Sonnet falls back on Anthropic's side when its safety check declines (server-side fallbacks); Haiku has none. */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * One request to Claude. The system prompt (and the tools before it) is cached, and with tools the
 * conversation too (its end moves on each step; the agent's next step reads the rest from the cache).
 */
async function ask(model: AiModel, system: string, messages: Anthropic.Beta.BetaMessageParam[], style: ModelStyle, timeoutMs: number, tools?: Anthropic.Beta.BetaToolUnion[]): Promise<Anthropic.Beta.BetaMessage> {
  const api = claude()!;
  const sonnet = model === "sonnet";
  return api.beta.messages.create(
    {
      model: AI.models[model],
      max_tokens: style.maxTokens,
      system: system ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] : undefined,
      messages,
      output_config: { effort: style.effort },
      ...(tools?.length ? { tools, cache_control: { type: "ephemeral" as const } } : {}),
      ...(sonnet ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
    },
    { timeout: timeoutMs },
  );
}

/** Said when the provider refuses the server's key or doesn't know the model: waiting won't fix it, so it isn't retried. */
export const AI_REFUSED_KEY = "The AI can't answer right now: the server's AI key was refused. Running cells works as usual.";

/** The response for a failed request: the limit, a timeout, or a plain server error; never the raw detail. */
function failure(e: unknown, action: ErrorAction): NextResponse {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError || e instanceof Anthropic.NotFoundError) {
    console.error("AI provider refused the request", e.status, e.constructor.name);
    return jsonError(503, AI_REFUSED_KEY);
  }
  if (e instanceof Anthropic.APIConnectionTimeoutError) return apiError("timeout", 504, action);
  if (e instanceof Anthropic.RateLimitError) {
    const wait = Number(e.headers?.get?.("retry-after"));
    return apiError("rate_limited", 429, action, Number.isFinite(wait) ? wait : 60);
  }
  if (e instanceof Anthropic.BadRequestError && /prompt is too long|too many tokens|max_tokens/i.test(e.message)) return apiError("too_large", 413, action);
  return apiError("server", 502, action);
}

/** Whether trying again could help: a dropped connection or a server error (the SDK already retried once). */
const passing = (e: unknown) => !(e instanceof Anthropic.APIConnectionTimeoutError) && (e instanceof Anthropic.APIConnectionError || (e instanceof Anthropic.APIError && (e.status ?? 0) >= 500));

/**
 * Where a 400 says the request was malformed ("messages.3.content.1: ..."), without anything the user
 * wrote: quoted text is cut out and the rest is capped.
 */
export function requestFault(e: InstanceType<typeof Anthropic.APIError>): string {
  const body = e.error as { error?: { message?: unknown } } | undefined;
  const message = typeof body?.error?.message === "string" ? body.error.message : e.message;
  return message.replace(/"[^"]{40,}"|'[^']{40,}'|`[^`]{40,}`/g, "…").slice(0, 400);
}

/** The request's shape for the log: each message's role and its blocks' types, never their text. */
export const requestShape = (messages: Anthropic.Beta.BetaMessageParam[]) =>
  messages.map((m, i) => `${i}:${m.role}[${typeof m.content === "string" ? "text" : (m.content ?? []).map((b) => b.type).join(",")}]`).join(" ");

const REFUSED = "The AI declined this request. Try asking it another way.";

/**
 * Long answers (Fix's JSON): a reply cut off at max_tokens is continued in up to `batches` more
 * requests, each picking up where the last stopped, while `budgetMs` allows; what still doesn't
 * finish is turned into an answer by `salvage` (the part written so far) instead of an error.
 */
type LongAnswers = { batches: number; budgetMs: number; salvage?: (partial: string) => unknown };

/** Asked after a reply cut off at the length limit, with that reply as the model's own turn. */
const CONTINUE_PROMPT =
  "Your JSON reply above was cut off at the length limit. Write only what comes next, starting exactly at the character where it stopped: don't repeat anything, no preamble, no code fence. Together the two parts must be the complete JSON reply.";

/**
 * The reply so far joined with what the model wrote next: a fence it opened with is dropped, the
 * words it repeated from the end of the first part are written once, and a reply it started over
 * ({"message"…) replaces the first part.
 */
function joinBatch(partial: string, more: string): string {
  const next = more.replace(/^\s*```(?:json)?[ \t]*\n?/i, "");
  if (/^\s*\{\s*"message"\s*:/.test(next)) return next.trim();
  for (const rest of [next, next.trimStart()])
    for (let k = Math.min(200, partial.length, rest.length); k >= 12; k--) if (partial.endsWith(rest.slice(0, k))) return partial + rest.slice(k);
  return partial + next;
}

/**
 * Asks the model and answers with `read(content)` as JSON. `read` throws a FriendlyError for an
 * answer the user should hear about in plain words (422), anything else for an unreadable one. An
 * unreadable answer, or a passing failure, is tried once more while time allows. With `native`,
 * the model acts through tools and `native.read` makes the answer.
 */
export async function askModel<T>(session: Session, model: AiModel, action: ErrorAction, chat: ChatMessage[] | ClaudeChat, read: (content: string) => T, style: ModelStyle = EXACT, long?: LongAnswers, native?: NativeTools<unknown>): Promise<NextResponse> {
  if (!claude()) return jsonError(503, NOT_SET_UP);
  const limited = await allowance(session);
  if (limited) return limited;
  const { system, messages: sent } = Array.isArray(chat) ? toClaude(chat) : chat;
  const messages = pairedMessages(sent);
  let spent = 0;
  const tools: Anthropic.Beta.BetaToolUnion[] | undefined = native ? [...toClaudeTools(native.tools), ...webTools(model)] : undefined;
  const perCall = style.timeoutMs ?? TIMEOUT_MS;
  const deadline = Date.now() + Math.max(long?.budgetMs ?? 0, perCall);
  const left = () => Math.min(perCall, deadline - Date.now());

  let response: NextResponse | null = null;
  let ok = false;
  let cut: string | undefined;
  for (let attempt = 0; attempt < 2 && !ok; attempt++) {
    if (attempt === 1 && left() < RETRY_MIN_MS) break;
    let retry = false;
    try {
      const r = fromClaude(model, await ask(model, system, messages, style, left(), tools));
      spent += r.credits;
      // A long web search pauses the turn: it's sent back as it is, and Claude goes on where it stopped
      // (one reply in the end: its text, calls and blocks joined).
      for (let more = 0; r.stop === "pause_turn" && more < 3 && left() >= RETRY_MIN_MS; more++) {
        const next = fromClaude(model, await ask(model, system, [...messages, { role: "assistant", content: r.turn }], style, left(), tools));
        spent += next.credits;
        Object.assign(r, { content: r.content + next.content, calls: [...r.calls, ...next.calls], turn: [...r.turn, ...next.turn], stop: next.stop });
      }
      // Kept for the next step only with its server-side calls answered (a paused one is sent back whole above).
      r.turn = pairedTurn(r.turn);
      if (r.stop === "refusal") {
        response = jsonError(422, REFUSED);
        break;
      }
      if (native) {
        // Cut off at the length limit: its calls are incomplete, so none are made; the loop has it write less.
        response = NextResponse.json(r.stop === "max_tokens" ? native.cut(r.content) : native.read(r.content, r.calls, r.turn));
        ok = true;
      } else if (r.stop === "max_tokens") {
        response = apiError("too_large", 413, action);
        cut = r.content;
        break;
      } else {
        try {
          response = NextResponse.json(read(r.content));
          ok = true;
        } catch (e) {
          if (e instanceof FriendlyError) response = jsonError(422, e.message);
          else {
            console.error("llm answer unreadable", e);
            response = apiError("server", 502, action);
          }
          retry = true;
        }
      }
    } catch (e) {
      console.error("llm request failed", e instanceof Anthropic.APIError ? `${e.status} ${e.name}${e instanceof Anthropic.BadRequestError ? `: ${requestFault(e)} | ${requestShape(messages)}` : ""}` : e);
      response = failure(e, action);
      retry = passing(e);
    }
    if (!retry) break;
  }
  if (!ok && long && cut !== undefined) {
    const done = await finishLong(model, system, messages, read, style, long, cut, left);
    spent += done.credits;
    if (done.response) [response, ok] = [done.response, true];
  }
  if (ok) await counted(session, spent);
  return response ?? apiError("server", 502, action);
}

/** Continues a cut-off reply batch by batch (LongAnswers), then salvages what didn't finish; null when nothing came of it. */
async function finishLong<T>(model: AiModel, system: string, messages: Anthropic.Beta.BetaMessageParam[], read: (content: string) => T, style: ModelStyle, long: LongAnswers, first: string, left: () => number): Promise<{ response: NextResponse | null; credits: number }> {
  let partial = first;
  let credits = 0;
  for (let round = 0; round < long.batches && left() >= RETRY_MIN_MS; round++) {
    const more: Anthropic.Beta.BetaMessageParam[] = [...messages, { role: "assistant", content: partial.trimEnd() }, { role: "user", content: CONTINUE_PROMPT }];
    let next: { content: string; stop: string | null; credits: number };
    try {
      next = fromClaude(model, await ask(model, system, more, style, left()));
      credits += next.credits;
    } catch (e) {
      console.error("llm continuation failed", e instanceof Anthropic.APIError ? e.status : e);
      break;
    }
    if (!next.content) break;
    const joined = joinBatch(partial, next.content);
    try {
      return { response: NextResponse.json(read(joined)), credits };
    } catch (e) {
      if (e instanceof FriendlyError) return { response: jsonError(422, e.message), credits };
      partial = joined;
      if (next.stop !== "max_tokens") break; // it finished but isn't readable: salvage below
    }
  }
  const saved = long.salvage?.(partial);
  return { response: saved ? NextResponse.json(saved) : null, credits };
}

/** A picture for the seer: a data: URL of a PNG, JPEG, GIF or WebP. */
export type Picture = { url: string };

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

/**
 * Asks Claude to look at pictures (the seer) and answers with `read(content)`. One request, tried
 * once more after a passing failure or an empty answer; the allowance and the count are the same as
 * the Assistant's.
 */
export async function askVision<T>(session: Session, model: AiModel, system: string, prompt: string, pictures: readonly Picture[], read: (content: string) => T): Promise<NextResponse> {
  if (!claude()) return jsonError(503, NOT_SET_UP);
  const limited = await allowance(session);
  if (limited) return limited;
  const images: Block[] = pictures.flatMap((p) => {
    const m = /^data:([^;]+);base64,(.+)$/.exec(p.url);
    const type = IMAGE_TYPES.find((t) => t === m?.[1]);
    return m && type ? [{ type: "image" as const, source: { type: "base64" as const, media_type: type, data: m[2]! } }] : [];
  });
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: [{ type: "text", text: prompt }, ...images] }];
  let spent = 0;
  for (let attempt = 0; ; attempt++) {
    try {
      const r = fromClaude(model, await ask(model, system, messages, { effort: "low", maxTokens: 2_000 }, 60_000));
      spent += r.credits;
      if (r.stop === "refusal") return jsonError(422, REFUSED);
      if (!r.content.trim()) {
        if (attempt === 0) continue;
        return apiError("server", 502, "agent");
      }
      await counted(session, spent);
      return NextResponse.json(read(r.content));
    } catch (e) {
      console.error("seer request failed", e instanceof Anthropic.APIError ? `${e.status} ${e.name}` : e);
      if (passing(e) && attempt === 0) continue;
      return failure(e, "agent");
    }
  }
}
