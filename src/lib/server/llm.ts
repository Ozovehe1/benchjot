// Server-side only: the one way an API route asks a language model for a JSON answer (Fix and the
// note Assistant). They run only on the user's own connected AI: their OpenRouter key and its free
// models, within OpenRouter's free allowance. Benchjot has no model of its own and pays for no
// one's AI; without a connection the answer is a notice the screens turn into a Connect AI prompt.
// Prompts and answers are never logged.
import { NextResponse } from "next/server";
import { FIX_LIMITS } from "@/config/app";
import { errorFacts, FriendlyError, upstreamFailure, type ErrorAction } from "../ui/user-message";
import { OPENROUTER_CHAT_URL, OPENROUTER_HEADERS, OPENROUTER_MODELS } from "./openrouter";
import { open } from "./secret-box";
import { apiError, jsonError, type Session } from "./session";
import type { ChatMessage, NativeToolCall } from "./llm-types";
import { limitMessage } from "../ai/budget";
export type { ChatMessage, NativeToolCall };

const TIMEOUT_MS = 50_000;


/**
 * Native tool calling (the Assistant): the model acts through `tools` instead of writing JSON in its
 * text, so a call can't be lost in prose, cut into unreadable JSON, or shown raw. `read` gets the
 * text it wrote and the calls it made. `cut` reads a reply that stopped at the length limit.
 */
export type NativeTools<T> = { tools: readonly unknown[]; read: (content: string, calls: NativeToolCall[]) => T; cut: (content: string) => T };

/** The caller's own connected OpenRouter key (ai_key, opened here), or null; a failed read counts as none. */
async function ownKey(session: Session): Promise<string | null> {
  const r = await Promise.resolve(session.db.rpc("ai_key")).catch((e: unknown) => ({ data: null, error: e }));
  if (r.error) console.error("ai_key failed", r.error);
  return open((r.data as { key?: string } | null)?.key);
}

/** How the model answers: Fix wants the same fix every time; the Assistant talks, so it gets some range. */
/** `timeoutMs`: how long one answer may take (a slow free model writing a long reply needs more than the default). */
type ModelStyle = { readonly temperature: number; readonly reasoning: "low" | "medium" | "high"; readonly maxTokens: number; readonly timeoutMs?: number };
const EXACT: ModelStyle = { temperature: 0, reasoning: "low", maxTokens: FIX_LIMITS.maxReplyTokens };

/** A second try is only made with at least this much of the request's time left. */
const RETRY_MIN_MS = 15_000;

/**
 * What one try gave: the response to send, whether it is an answer, and whether trying again could
 * help. `cut`: the reply so far, when it stopped at the length limit (it can be continued).
 */
type Attempt = { response: NextResponse; ok: boolean; retry: boolean; cut?: string };

/**
 * Long answers (the Assistant): a reply cut off at max_tokens is continued in up to `batches` more
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
 * answer the user should hear about in plain words (422), anything else for an unreadable one.
 * An unreadable or refused answer, or a passing provider failure (5xx, network), is tried once
 * more while time allows.
 */
export async function askModel<T>(session: Session, action: ErrorAction, messages: ChatMessage[], read: (content: string) => T, style: ModelStyle = EXACT, long?: LongAnswers, native?: NativeTools<unknown>): Promise<NextResponse> {
  const key = await ownKey(session);
  if (!key) return NextResponse.json({ error: CONNECT_FIRST, code: "notice", offer: "own_key" }, { status: 403 });
  const perCall = style.timeoutMs ?? TIMEOUT_MS;
  const deadline = Date.now() + Math.max(long?.budgetMs ?? 0, perCall);
  const left = () => Math.min(perCall, deadline - Date.now());
  let attempt = await askOnce(key, action, messages, read, style, left(), native);
  if (!attempt.ok && attempt.retry && left() >= RETRY_MIN_MS) attempt = await askOnce(key, action, messages, read, style, left(), native);
  if (long && !native && attempt.cut !== undefined) attempt = await finishLong(key, messages, read, style, long, attempt, left);
  // Counted for the user's own usage page (a count, never the content); a failed count changes nothing.
  if (attempt.ok) await Promise.resolve(session.db.rpc("ai_own_used")).catch(() => null);
  return attempt.response;
}

/** Said when Fix or the Assistant is asked without a connected AI (the client offers Connect AI with it). */
const CONNECT_FIRST = "Connect your free AI to use Fix and the Assistant: Settings → Connect AI. It takes about a minute.";
/** The user's own allowance on OpenRouter is used up for now. */
const OWN_LIMIT = "Your free AI allowance on OpenRouter is used up for now. It refills daily; see Settings → Usage.";

/** A connection OpenRouter no longer accepts (revoked there, or expired). */
const OWN_KEY_REFUSED = "OpenRouter no longer accepts your connection. Connect AI again in Settings.";

/** Continues a cut-off reply batch by batch (LongAnswers), then salvages what didn't finish. */
async function finishLong<T>(key: string, messages: ChatMessage[], read: (content: string) => T, style: ModelStyle, long: LongAnswers, first: Attempt, left: () => number): Promise<Attempt> {
  let partial = first.cut!;
  for (let round = 0; round < long.batches && left() >= RETRY_MIN_MS; round++) {
    const next = await askMore(key, messages, partial, style, left());
    if (!next) break;
    const joined = joinBatch(partial, next.content);
    try {
      return { response: NextResponse.json(read(joined)), ok: true, retry: false };
    } catch (e) {
      if (e instanceof FriendlyError) return { response: jsonError(422, e.message), ok: false, retry: false };
      partial = joined;
      if (!next.cut) break; // it finished but isn't readable: salvage below
    }
  }
  const saved = long.salvage?.(partial);
  return saved ? { response: NextResponse.json(saved), ok: true, retry: false } : first;
}

/** One more batch: the conversation, the reply so far as the model's turn, and CONTINUE_PROMPT. Null when the request fails. */
async function askMore(key: string, messages: ChatMessage[], partial: string, style: ModelStyle, timeoutMs: number): Promise<{ content: string; cut: boolean } | null> {
  const res = await fetch(OPENROUTER_CHAT_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...OPENROUTER_HEADERS },
    // No JSON mode: what comes next is the rest of a JSON reply, not a whole one.
    body: JSON.stringify({ model: OPENROUTER_MODELS[0], models: OPENROUTER_MODELS, temperature: style.temperature, max_tokens: style.maxTokens, reasoning: { effort: "low", exclude: true }, messages: [...messages, { role: "assistant", content: partial }, { role: "user", content: CONTINUE_PROMPT }] }),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((e: unknown) => e as Error);
  if (res instanceof Error || !res.ok) {
    console.error("llm continuation failed", res instanceof Error ? res : res.status);
    return null;
  }
  const data = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string }; finish_reason?: string }[] } | null;
  const choice = data?.choices?.[0];
  const content = choice?.message?.content ?? "";
  return content ? { content, cut: choice?.finish_reason === "length" } : null;
}

async function askOnce<T>(key: string, action: ErrorAction, messages: ChatMessage[], read: (content: string) => T, style: ModelStyle, timeoutMs: number, native?: NativeTools<unknown>): Promise<Attempt> {
  // Reasoning is kept short (its tokens count toward max_tokens). With tools the model acts through
  // them (and only models that support tools are routed to); without, JSON mode where a model has it.
  const answer = native ? { tools: native.tools, tool_choice: "auto", parallel_tool_calls: true } : { response_format: { type: "json_object" } };
  const res = await fetch(OPENROUTER_CHAT_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...OPENROUTER_HEADERS },
    body: JSON.stringify({ model: OPENROUTER_MODELS[0], models: OPENROUTER_MODELS, temperature: style.temperature, max_tokens: style.maxTokens, reasoning: { effort: style.reasoning, exclude: true }, ...answer, messages }),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((e: unknown) => e as Error);
  if (res instanceof Error || !res.ok) {
    // Raw provider detail stays in the server log; the client gets a stable code.
    const body = res instanceof Error ? "" : await res.text().catch(() => "");
    console.error("llm request failed", res instanceof Error ? res : `${res.status} ${body}`);
    // JSON mode refuses an answer it had to cut off at the token cap: the input was too long.
    if (!(res instanceof Error) && res.status === 400 && /max_(completion_)?tokens|finish_reason.{0,8}length|max completion tokens/i.test(body))
      return { response: apiError("too_large", 413, action), ok: false, retry: false };
    const facts = res instanceof Error ? errorFacts(res) : { status: res.status, message: body, retryAfterHeader: res.headers.get("retry-after") };
    const f = upstreamFailure(facts);
    if (!(res instanceof Error) && res.status === 401) return { response: jsonError(401, OWN_KEY_REFUSED), ok: false, retry: false };
    if (!(res instanceof Error) && (res.status === 429 || res.status === 402)) return { response: jsonError(429, limitMessage(body, Date.now(), OWN_LIMIT)), ok: false, retry: false };
    const timedOut = res instanceof Error && res.name === "TimeoutError";
    // Worth a second try: a dropped connection or a server error. Not: limits (429), our own request, a timeout.
    const passing = !timedOut && (res instanceof Error || res.status >= 500);
    return { response: apiError(f.kind, f.status, action, f.retryAfter), ok: false, retry: passing };
  }
  let content = "";
  try {
    const data = (await res.json()) as { choices?: { message?: { content?: string | null; tool_calls?: NativeToolCall[] }; finish_reason?: string }[] };
    const choice = data.choices?.[0];
    content = choice?.message?.content ?? "";
    if (native) {
      // Cut off at the length limit: its calls are incomplete, so none are made; the loop has it write less.
      if (choice?.finish_reason === "length") {
        console.error("llm answer hit max_completion_tokens", style.maxTokens);
        return { response: NextResponse.json(native.cut(content)), ok: true, retry: false };
      }
      return { response: NextResponse.json(native.read(content, choice?.message?.tool_calls ?? [])), ok: true, retry: false };
    }
    if (choice?.finish_reason === "length") {
      console.error("llm answer hit max_completion_tokens", style.maxTokens);
      return { response: apiError("too_large", 413, action), ok: false, retry: false, cut: content };
    }
    return { response: NextResponse.json(read(content)), ok: true, retry: false };
  } catch (e) {
    if (e instanceof FriendlyError) return { response: jsonError(422, e.message), ok: false, retry: true };
    // The answer was still being written when the time ran out: that's slow, not broken, and the same
    // request again would be as slow, so it isn't retried. Said as a timeout, not as our fault.
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
      console.error("llm answer took too long", style.timeoutMs ?? TIMEOUT_MS);
      return { response: apiError("timeout", 504, action), ok: false, retry: false };
    }
    console.error("llm answer unreadable", e);
    // JSON that stops mid-way (no closing brace) is a cut-off answer, not a model fault.
    const cutOff = e instanceof SyntaxError && content.trim() !== "" && !content.trim().replace(/\s*```$/, "").endsWith("}");
    return cutOff ? { response: apiError("too_large", 413, action), ok: false, retry: false, cut: content } : { response: apiError("server", 502, action), ok: false, retry: true };
  }
}

/** A message with pictures (the seer): text and images in one user turn, as OpenRouter takes them. */
export type VisionMessage = { role: "system"; content: string } | { role: "user"; content: ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[] };

/**
 * Asks a vision model (the seer) on the user's own connected AI and answers with `read(content)`.
 * One request, tried once more after a passing provider failure; limits, a refused key and a missing
 * connection answer as they do for the Assistant. Counted like any other AI request.
 */
export async function askVision<T>(session: Session, messages: VisionMessage[], models: readonly string[], read: (content: string) => T): Promise<NextResponse> {
  const key = await ownKey(session);
  if (!key) return NextResponse.json({ error: CONNECT_FIRST, code: "notice", offer: "own_key" }, { status: 403 });
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(OPENROUTER_CHAT_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...OPENROUTER_HEADERS },
      body: JSON.stringify({ model: models[0], models, temperature: 0, max_tokens: 1200, reasoning: { effort: "low", exclude: true }, messages }),
      signal: AbortSignal.timeout(60_000),
    }).catch((e: unknown) => e as Error);
    if (res instanceof Error || !res.ok) {
      const body = res instanceof Error ? "" : await res.text().catch(() => "");
      console.error("seer request failed", res instanceof Error ? res : `${res.status} ${body.slice(0, 300)}`);
      if (!(res instanceof Error) && res.status === 401) return jsonError(401, OWN_KEY_REFUSED);
      if (!(res instanceof Error) && (res.status === 429 || res.status === 402)) return jsonError(429, limitMessage(body, Date.now(), OWN_LIMIT));
      const passing = res instanceof Error ? res.name !== "TimeoutError" : res.status >= 500;
      if (passing && attempt === 0) continue;
      const f = upstreamFailure(res instanceof Error ? errorFacts(res) : { status: res.status, message: body, retryAfterHeader: res.headers.get("retry-after") });
      return apiError(f.kind, f.status, "agent", f.retryAfter);
    }
    const data = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string | null } }[] } | null;
    const content = data?.choices?.[0]?.message?.content ?? "";
    if (!content.trim()) {
      if (attempt === 0) continue;
      return apiError("server", 502, "agent");
    }
    await Promise.resolve(session.db.rpc("ai_own_used")).catch(() => null);
    return NextResponse.json(read(content));
  }
}
