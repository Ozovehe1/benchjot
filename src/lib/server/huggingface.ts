// Server-side only: "Connect Hugging Face", the only file that talks to Hugging Face's sign-in.
// Hugging Face's OAuth takes a Client ID Metadata Document (CIMD): the app's client_id is the URL of
// a small JSON page it serves itself (/.well-known/oauth-cimd), so there is nothing to register and
// no client secret. With PKCE, the user taps Connect, signs in on huggingface.co, taps Allow and
// comes back; the app receives a read-only token for the models and datasets their account can
// already open (gated ones they've been granted, and their private ones). Server runs get it as
// HF_TOKEN. It expires, so it's kept with its refresh token and renewed before a run when needed.
import { createHash, randomBytes } from "node:crypto";

const AUTHORIZE_URL = "https://huggingface.co/oauth/authorize";
const TOKEN_URL = "https://huggingface.co/oauth/token";
const USERINFO_URL = "https://huggingface.co/oauth/userinfo";
/** Who they are, and the repos their account can read (gated ones they are granted, their private ones; read-only). */
const HF_SCOPES = "openid profile read-repos gated-repos";

/** The cookie that holds one connect's verifier and state (sent only to /api/hf). */
export const HF_CONNECT_COOKIE = "bj_hf_connect";
const CIMD_PATH = "/.well-known/oauth-cimd";
const CALLBACK_PATH = "/api/hf/callback";

export { appOrigin } from "./background-runs";
const clientId = (origin: string) => `${origin}${CIMD_PATH}`;

/** The app's Client ID Metadata Document, served at its own client_id. */
export function clientMetadata(origin: string) {
  return {
    client_id: clientId(origin),
    client_name: "Benchjot",
    client_uri: origin,
    logo_uri: `${origin}/icons/icon-192.png`,
    redirect_uris: [`${origin}${CALLBACK_PATH}`],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: HF_SCOPES,
  };
}

const b64url = (b: Buffer) => b.toString("base64url");

/** A fresh PKCE pair and state for one connect: the verifier and state stay in the user's cookie. */
export function newHfConnect(): { verifier: string; challenge: string; state: string } {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()), state: b64url(randomBytes(16)) };
}

/** Hugging Face's sign-in and Allow page, coming back to the callback with ?code and ?state. */
export function hfAuthorizeUrl(origin: string, challenge: string, state: string): string {
  const q = new URLSearchParams({
    client_id: clientId(origin),
    redirect_uri: `${origin}${CALLBACK_PATH}`,
    response_type: "code",
    scope: HF_SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${AUTHORIZE_URL}?${q}`;
}

/**
 * What's stored (sealed) for a connected account: the access token, its refresh token, when it
 * expires (ms since epoch) and the username. Short keys: the sealed value has a size limit.
 */
export interface HfGrant {
  a: string;
  r?: string;
  e?: number;
  u?: string;
}

/** Hugging Face's OAuth tokens are long (signed tokens); a few thousand characters at most. */
const isToken = (v: unknown): v is string => typeof v === "string" && v.length >= 8 && v.length <= 4000 && !/\s/.test(v);

async function tokenRequest(form: Record<string, string>): Promise<HfGrant | null> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(15_000),
  }).catch((e: unknown) => {
    console.error("hf token request failed", form.grant_type, e);
    return null;
  });
  if (!res) return null;
  if (!res.ok) {
    console.error("hf token request refused", form.grant_type, res.status, (await res.text().catch(() => "")).slice(0, 300));
    return null;
  }
  const t = (await res.json().catch(() => null)) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown } | null;
  if (!t || !isToken(t.access_token)) {
    const a = (t as { access_token?: unknown } | null)?.access_token;
    console.error("hf token answer has no usable access token", Object.keys(t ?? {}).join(","), typeof a, typeof a === "string" ? a.length : 0);
    return null;
  }
  const grant: HfGrant = { a: t.access_token };
  if (isToken(t.refresh_token)) grant.r = t.refresh_token;
  if (typeof t.expires_in === "number" && t.expires_in > 0) grant.e = Date.now() + t.expires_in * 1000;
  return grant;
}

/** Exchanges the code for the user's tokens; null when Hugging Face refuses it (expired, used, wrong verifier). */
export function exchangeHfCode(origin: string, code: string, verifier: string): Promise<HfGrant | null> {
  return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: `${origin}${CALLBACK_PATH}`, client_id: clientId(origin), code_verifier: verifier });
}

/** A new access token from the refresh token; the old refresh token is kept when no new one comes back. */
export async function refreshHfGrant(origin: string, grant: HfGrant): Promise<HfGrant | null> {
  if (!grant.r) return null;
  const fresh = await tokenRequest({ grant_type: "refresh_token", refresh_token: grant.r, client_id: clientId(origin) });
  return fresh ? { ...fresh, r: fresh.r ?? grant.r, ...(grant.u ? { u: grant.u } : {}) } : null;
}

/** The Hugging Face username for a token, or undefined when it can't be read. */
export async function hfUsername(access: string): Promise<string | undefined> {
  const res = await fetch(USERINFO_URL, { headers: { authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!res?.ok) return undefined;
  const u = ((await res.json().catch(() => null)) as { preferred_username?: unknown } | null)?.preferred_username;
  return typeof u === "string" && /^[\w.-]{1,64}$/.test(u) ? u : undefined;
}

/** A stored grant (JSON from a connect) or a pasted token ("hf_…"), as a grant. */
export function readHfGrant(plain: string | null | undefined): HfGrant | null {
  if (!plain) return null;
  if (!plain.startsWith("{")) return { a: plain };
  try {
    const g = JSON.parse(plain) as Partial<HfGrant>;
    return isToken(g.a) ? { a: g.a, ...(isToken(g.r) ? { r: g.r } : {}), ...(typeof g.e === "number" ? { e: g.e } : {}), ...(typeof g.u === "string" ? { u: g.u } : {}) } : null;
  } catch {
    return null;
  }
}

/** Whether the token should be renewed before a run: it expires within the next 70 minutes (a run can last an hour). */
export const needsRefresh = (g: HfGrant, now = Date.now()) => Boolean(g.r && g.e && g.e - now < 70 * 60_000);
