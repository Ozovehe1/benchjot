// Server-side only: the user's own AI through OpenRouter, the only file that talks to it. OpenRouter's
// OAuth (PKCE) is made for this: the user taps Authorize on openrouter.ai and the app receives an API
// key the user controls and can revoke there; the app never sees their password. With it, Fix and the
// Assistant ask OpenRouter's free models on the user's own allowance instead of the app's shared limit.
import { createHash, randomBytes } from "node:crypto";

const AUTH_URL = "https://openrouter.ai/auth";
const EXCHANGE_URL = "https://openrouter.ai/api/v1/auth/keys";
/** Chat completions (OpenAI-compatible), for a connected user's requests. */
export const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
/**
 * The free models a connected user's requests ask, strongest first; OpenRouter tries the next when
 * one is unavailable. First the most capable free model on OpenRouter (2026-11-18): NVIDIA
 * Nemotron 3 Ultra, 550B parameters with 55B active, a frontier reasoning model. It has no strict
 * JSON mode, so Fix's answers are read from the text (readJsonReply); the Assistant uses native tool
 * calls, which every model here supports. Then Nemotron 3.5 Super (newer, tools and JSON mode), and
 * last OpenRouter's own router over every free model, so a request is still answered when free models
 * come and go. Checked against OpenRouter's live model list, 2026-11-20.
 */
export const OPENROUTER_MODELS = ["nvidia/nemotron-3-ultra-550b-a55b:free", "nvidia/nemotron-3.5-super-vl:free", "openrouter/free"] as const;
/** Names the app to OpenRouter (their app attribution headers). */
export const OPENROUTER_HEADERS = { "HTTP-Referer": "https://benchjot.vercel.app", "X-Title": "Benchjot" } as const;

/** The cookie that holds one connect's verifier and state (sent only to /api/ai-key). */
export const CONNECT_COOKIE = "bj_ai_connect";

const b64url = (b: Buffer) => b.toString("base64url");

/** A fresh PKCE pair and state for one connect: the verifier and state stay in the user's cookie. */
export function newConnect(): { verifier: string; challenge: string; state: string } {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()), state: b64url(randomBytes(16)) };
}

/** Where the user authorizes: OpenRouter's page, coming back to `callback` with ?code and ?state. */
export function authorizeUrl(callback: string, challenge: string, state: string): string {
  const q = new URLSearchParams({ callback_url: callback, code_challenge: challenge, code_challenge_method: "S256", key_label: "Benchjot", state });
  return `${AUTH_URL}?${q}`;
}

/** Exchanges the code for the user's key; null when OpenRouter refuses it (expired, used, wrong verifier). */
export async function exchangeCode(code: string, verifier: string): Promise<string | null> {
  const res = await fetch(EXCHANGE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!res?.ok) return null;
  const key = ((await res.json().catch(() => null)) as { key?: unknown } | null)?.key;
  return typeof key === "string" && key.length >= 20 && key.length <= 300 ? key : null;
}

/** OpenRouter's handle for a key: its SHA-256 (the owner's page for it is openrouter.ai/keys/<hash>). */
export const keyHash = (key: string) => createHash("sha256").update(key).digest("hex");
