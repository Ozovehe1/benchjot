// Server-side only: the user's Hugging Face connection as stored (data_tokens.hf_token, sealed).
// It holds either a token they pasted ("hf_…") or a grant from "Connect Hugging Face" (an access
// token that expires, its refresh token, and their username). Server runs get the access token as
// HF_TOKEN, renewed first when it's close to expiring.
import { type HfGrant, needsRefresh, readHfGrant, refreshHfGrant } from "./huggingface";
import { open, seal } from "./secret-box";
import type { Session } from "./session";

/** The database keeps sealed values up to this length (data_tokens_sealed_sizes). */
const MAX_SEALED = 16_000;

async function storedGrant(session: Session): Promise<HfGrant | null> {
  const tokens = await Promise.resolve(session.db.rpc("data_tokens")).catch((e: unknown) => ({ data: null, error: e }));
  if (tokens.error) {
    console.error("data_tokens failed", tokens.error);
    return null;
  }
  const raw = (tokens.data && typeof tokens.data === "object" ? tokens.data : {}) as Record<string, unknown>;
  return readHfGrant(open(typeof raw.hf_token === "string" && raw.hf_token !== "" ? raw.hf_token : null));
}

/** Seals and saves a grant (tokens are at most 4,000 characters each, so it always fits). False when it couldn't be saved. */
export async function saveHfGrant(session: Session, grant: HfGrant): Promise<boolean> {
  const sealed = seal(JSON.stringify(grant));
  if (sealed.length > MAX_SEALED) {
    console.error("hf grant too long to store", grant.a.length, grant.r?.length ?? 0);
    return false;
  }
  const { error } = await session.db.rpc("set_data_tokens", { hf_token: sealed });
  if (error) console.error("set_data_tokens failed", error);
  return !error;
}

/** Asks Hugging Face whether a token still works: "ok", "refused" (it says no: removed or revoked), or "unknown" (it couldn't be asked). */
async function hfTokenWorks(access: string): Promise<"ok" | "refused" | "unknown"> {
  const res = await fetch("https://huggingface.co/api/whoami-v2", { headers: { authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(5_000) }).catch(() => null);
  if (!res) return "unknown";
  if (res.status === 401) return "refused";
  return res.ok ? "ok" : "unknown";
}

/** Forgets the stored connection (Hugging Face refused it: access was removed there). */
async function forgetHf(session: Session): Promise<void> {
  const { error } = await session.db.rpc("set_data_tokens", { hf_token: "" });
  if (error) console.error("forgetting a refused Hugging Face connection failed", error);
}

/**
 * How the user's Hugging Face connection looks in Settings; never the token. Hugging Face is asked
 * whether it still works (renewed first when it has expired), so access removed on huggingface.co
 * shows here: the connection is forgotten and `removed` says why. If Hugging Face can't be reached,
 * the connection is shown as it is stored.
 */
export async function hfStatus(session: Session, origin: string): Promise<{ connected: boolean; username: string | null; connectedBy: "signin" | "token" | null; removed: boolean }> {
  let g = await storedGrant(session);
  if (!g) return { connected: false, username: null, connectedBy: null, removed: false };
  if (g.e && g.e <= Date.now() && g.r) {
    const fresh = await refreshHfGrant(origin, g);
    if (fresh && (await saveHfGrant(session, fresh))) g = fresh;
  }
  if ((await hfTokenWorks(g.a)) === "refused") {
    await forgetHf(session);
    return { connected: false, username: null, connectedBy: null, removed: true };
  }
  return { connected: true, username: g.u ?? null, connectedBy: g.a.startsWith("hf_") && !g.r && !g.e ? "token" : "signin", removed: false };
}

/** The token a server run gets as HF_TOKEN, renewed first when it expires soon; undefined when none is usable. */
export async function hfRunToken(session: Session, origin: string): Promise<string | undefined> {
  const g = await storedGrant(session);
  if (!g) return undefined;
  if (!needsRefresh(g)) return g.e && g.e <= Date.now() ? undefined : g.a;
  const fresh = await refreshHfGrant(origin, g);
  if (!fresh) return g.e && g.e > Date.now() ? g.a : undefined;
  await saveHfGrant(session, fresh);
  return fresh.a;
}
