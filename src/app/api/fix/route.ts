// POST /api/fix — ask Groq for the smallest fix to code given its last error.
// The key stays on the server (GROQ_API_KEY); any signed-in user may call it.
import { NextResponse } from "next/server";
import { fixMessages, fixRequest, parseFixAnswer } from "@/lib/fix";
import { jsonError, readBody, requireSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const maxDuration = 60;

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const input = await readBody(request, (v) => fixRequest.safeParse(v));
  if (input instanceof NextResponse) return input;

  const key = process.env.GROQ_API_KEY;
  if (!key) return jsonError(503, "Fix is not configured");
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, temperature: 0, response_format: { type: "json_object" }, messages: fixMessages(input) }),
    signal: AbortSignal.timeout(50_000),
  }).catch((e: unknown) => e as Error);
  if (res instanceof Error || !res.ok) {
    console.error("groq failed", res instanceof Error ? res.message : `${res.status} ${await res.text()}`);
    return jsonError(502, "Fix couldn't reach the model. Try again in a moment.");
  }
  try {
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return NextResponse.json(parseFixAnswer(data.choices?.[0]?.message?.content ?? ""));
  } catch (e) {
    console.error("groq answer unreadable", e);
    return jsonError(502, "The model's answer couldn't be read. Try again.");
  }
}
