// Server-side only: the one way an API route asks Groq for a JSON answer (Fix and the note Helper).
// The key stays on the server (GROQ_API_KEY). Every call takes from the caller's one limit
// (fix_take, FIX_RATE), so Fix and Helper share a quota. Prompts and answers are never logged.
import { NextResponse } from "next/server";
import { FIX_LIMITS, FIX_RATE } from "@/config/app";
import { errorFacts, FriendlyError, upstreamFailure, waitText, type ErrorAction } from "../user-message";
import { apiError, jsonError, type Session } from "./session";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";
const TIMEOUT_MS = 50_000;

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** The daily cap's text, shared by Fix and Helper because they share the counter. */
export function dailyCapText(waitSeconds: number): string {
  return `You’ve used today’s ${FIX_RATE.perDay} Fix and Helper requests. More in ${waitText(waitSeconds)}.`;
}

/** A 429 when the caller is past the shared limit; null to go ahead. If the counter itself fails, the call still goes ahead. */
async function takeLimit(session: Session, action: ErrorAction): Promise<NextResponse | null> {
  const { data: wait, error } = await session.db.rpc("fix_take", { per_minute: FIX_RATE.perMinute, per_day: FIX_RATE.perDay });
  if (error) {
    console.error("fix_take failed", error);
    return null;
  }
  if (typeof wait !== "number" || wait <= 0) return null;
  // A minute's wait is at most 60 s, so a longer one is the daily cap.
  return wait > 60 ? jsonError(429, dailyCapText(wait), wait) : apiError("rate_limited", 429, action, wait);
}

/**
 * Asks Groq once and answers with `read(content)` as JSON. `read` throws a FriendlyError for an
 * answer the user should hear about in plain words (422), anything else for an unreadable one.
 * A cut-off answer (token cap) is `too_large`; provider failures map to the shared error kinds.
 */
export async function askGroq<T>(session: Session, action: ErrorAction, messages: ChatMessage[], read: (content: string) => T): Promise<NextResponse> {
  const limited = await takeLimit(session, action);
  if (limited) return limited;

  const key = process.env.GROQ_API_KEY;
  if (!key) {
    console.error(`${action}: GROQ_API_KEY is not set`);
    return apiError("server", 503, action);
  }
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, temperature: 0, max_completion_tokens: FIX_LIMITS.maxReplyTokens, reasoning_effort: "low", response_format: { type: "json_object" }, messages }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((e: unknown) => e as Error);
  if (res instanceof Error || !res.ok) {
    // Raw provider detail stays in the server log; the client gets a stable code.
    const body = res instanceof Error ? "" : await res.text().catch(() => "");
    console.error("groq failed", res instanceof Error ? res : `${res.status} ${body}`);
    // JSON mode refuses an answer it had to cut off at the token cap: the input was too long.
    if (!(res instanceof Error) && res.status === 400 && /max_(completion_)?tokens|finish_reason.{0,8}length|max completion tokens/i.test(body)) return apiError("too_large", 413, action);
    const facts = res instanceof Error ? errorFacts(res) : { status: res.status, message: body, retryAfterHeader: res.headers.get("retry-after") };
    const f = upstreamFailure(facts);
    return apiError(f.kind, f.status, action, f.retryAfter);
  }
  let content = "";
  try {
    const data = (await res.json()) as { choices?: { message?: { content?: string }; finish_reason?: string }[] };
    const choice = data.choices?.[0];
    content = choice?.message?.content ?? "";
    if (choice?.finish_reason === "length") {
      console.error("groq answer hit max_completion_tokens", FIX_LIMITS.maxReplyTokens);
      return apiError("too_large", 413, action);
    }
    return NextResponse.json(read(content));
  } catch (e) {
    if (e instanceof FriendlyError) return jsonError(422, e.message);
    console.error("groq answer unreadable", e);
    // JSON that stops mid-way (no closing brace) is a cut-off answer, not a model fault.
    const cutOff = e instanceof SyntaxError && content.trim() !== "" && !content.trim().replace(/\s*```$/, "").endsWith("}");
    return cutOff ? apiError("too_large", 413, action) : apiError("server", 502, action);
  }
}
