// POST /api/fix — ask Groq for the smallest fix to code given its last error.
// The key stays on the server (GROQ_API_KEY); any signed-in user may call it.
import { NextResponse } from "next/server";
import { fixMessages, fixRequest, parseFixAnswer } from "@/lib/fix";
import { apiError, readBody, requireSession } from "@/lib/server/session";
import { errorFacts, upstreamFailure } from "@/lib/user-message";
import { FIX_MAX_REPLY_TOKENS, FIX_RATE } from "@/config/app";

export const runtime = "nodejs";
export const maxDuration = 60;

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const input = await readBody(request, (v) => fixRequest.safeParse(v));
  if (input instanceof NextResponse) return input;

  // Per-user limit, counted in the database (fix_take). If the counter itself fails, Fix still works.
  const { data: wait, error: rateError } = await session.db.rpc("fix_take", { per_minute: FIX_RATE.perMinute, per_day: FIX_RATE.perDay });
  if (rateError) console.error("fix_take failed", rateError);
  else if (typeof wait === "number" && wait > 0) return apiError("rate_limited", 429, "fix", wait);

  const key = process.env.GROQ_API_KEY;
  if (!key) {
    console.error("fix: GROQ_API_KEY is not set");
    return apiError("server", 503, "fix");
  }
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, temperature: 0, max_completion_tokens: FIX_MAX_REPLY_TOKENS, response_format: { type: "json_object" }, messages: fixMessages(input) }),
    signal: AbortSignal.timeout(50_000),
  }).catch((e: unknown) => e as Error);
  if (res instanceof Error || !res.ok) {
    // Raw provider detail stays in the server log; the client gets a stable code.
    const body = res instanceof Error ? "" : await res.text().catch(() => "");
    console.error("groq failed", res instanceof Error ? res : `${res.status} ${body}`);
    const facts = res instanceof Error ? errorFacts(res) : { status: res.status, message: body, retryAfterHeader: res.headers.get("retry-after") };
    // JSON mode refuses an answer it had to cut off at the token cap: that is code too long for Fix.
    if (!(res instanceof Error) && res.status === 400 && /max_(completion_)?tokens|finish_reason.{0,8}length|max completion tokens/i.test(body)) return apiError("too_large", 413, "fix");
    const f = upstreamFailure(facts);
    return apiError(f.kind, f.status, "fix", f.retryAfter);
  }
  let content = "";
  try {
    const data = (await res.json()) as { choices?: { message?: { content?: string }; finish_reason?: string }[] };
    const choice = data.choices?.[0];
    content = choice?.message?.content ?? "";
    // Cut off at max_completion_tokens: the answer would be partial code, so say the code is too long.
    if (choice?.finish_reason === "length") {
      console.error("groq answer hit max_completion_tokens", FIX_MAX_REPLY_TOKENS);
      return apiError("too_large", 413, "fix");
    }
    return NextResponse.json(parseFixAnswer(content));
  } catch (e) {
    console.error("groq answer unreadable", e);
    // JSON that stops mid-way (no closing brace) is a cut-off answer, not a model fault.
    const cutOff = e instanceof SyntaxError && content.trim() !== "" && !content.trim().replace(/\s*```$/, "").endsWith("}");
    return cutOff ? apiError("too_large", 413, "fix") : apiError("server", 502, "fix");
  }
}
