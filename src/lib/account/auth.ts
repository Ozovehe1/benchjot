// Sign-in, sign-up and the account's own settings, from the browser. The one place the client talks
// to the auth provider (Supabase Auth and a few of its database functions today): screens call these
// and never the provider, so moving to another provider means rewriting this file only.
//
// Every call returns the provider's error as is (or null): screens turn it into plain words with
// lib/ui/user-message.ts, which reads its `code` / `message`.
import { supabase } from "@/lib/data/supabase/client";

type ProviderError = { code?: string; message: string };
type Outcome<T = undefined> = { data: T; error: null } | { data: null; error: ProviderError };

const done = <T>(data: T): Outcome<T> => ({ data, error: null });
const failed = <T>(error: ProviderError): Outcome<T> => ({ data: null, error });

/** The email behind a username, when the password matches (null: no such pair). */
export async function emailForUsername(username: string, password: string): Promise<Outcome<string | null>> {
  const { data, error } = await supabase().rpc("login_email", { username, password });
  return error ? failed(error) : done((data as string | null) ?? null);
}

export async function signInWithPassword(email: string, password: string): Promise<Outcome> {
  const { error } = await supabase().auth.signInWithPassword({ email, password });
  return error ? failed(error) : done(undefined);
}

export async function usernameAvailable(name: string): Promise<Outcome<boolean>> {
  const { data, error } = await supabase().rpc("username_available", { name });
  return error ? failed(error) : done(Boolean(data));
}

/** Creates the account. `signedIn` is false when the email must be confirmed first (a link is sent to `returnTo`). */
export async function signUp(email: string, password: string, username: string, returnTo: string): Promise<Outcome<{ signedIn: boolean }>> {
  const { data, error } = await supabase().auth.signUp({ email, password, options: { emailRedirectTo: returnTo, data: { username } } });
  return error ? failed(error) : done({ signedIn: Boolean(data.session) });
}

export async function resendConfirmation(email: string, returnTo: string): Promise<Outcome> {
  const { error } = await supabase().auth.resend({ type: "signup", email, options: { emailRedirectTo: returnTo } });
  return error ? failed(error) : done(undefined);
}

/** Google, by leaving for Google's page and coming back to `returnTo` (when the popup can't be used). */
export async function signInWithGoogleRedirect(returnTo: string): Promise<Outcome> {
  const { error } = await supabase().auth.signInWithOAuth({ provider: "google", options: { redirectTo: returnTo } });
  return error ? failed(error) : done(undefined);
}

/** Google, with the ID token its popup returned (`nonce`: the raw value whose hash Google got). */
export async function signInWithGoogleToken(token: string, nonce: string): Promise<Outcome> {
  const { error } = await supabase().auth.signInWithIdToken({ provider: "google", token, nonce });
  return error ? failed(error) : done(undefined);
}

export async function signOut(): Promise<void> {
  await supabase().auth.signOut();
}

export async function setUsername(name: string): Promise<Outcome> {
  const { error } = await supabase().rpc("set_username", { name });
  return error ? failed(error) : done(undefined);
}

/** Which dataset keys the account has saved (never the keys themselves). */
/** Hugging Face: connected or not, the username when it came from "Connect Hugging Face", and how it was connected. */
export type DatasetKeyStatus = { hf: boolean; hfUser: string | null; hfBy: "signin" | "token" | null; /** Access was removed on Hugging Face, so the connection was forgotten. */ hfRemoved?: boolean };
/** A change to the saved keys: null keeps a value, "" removes it. */
type DatasetKeyChange = { hf_token?: string | null };

export async function datasetKeyStatus(): Promise<DatasetKeyStatus | null> {
  const res = await fetch("/api/data-keys", { cache: "no-store" }).catch(() => null);
  return res?.ok ? ((await res.json().catch(() => null)) as DatasetKeyStatus | null) : null;
}

export async function setDatasetKeys(change: DatasetKeyChange): Promise<Outcome> {
  const { error } = await supabase().rpc("set_data_tokens", { hf_token: null, ...change });
  return error ? failed(error) : done(undefined);
}

/** Connected AI (the user's own OpenRouter key): when it was connected and last used, and OpenRouter's handle for it; null when not connected. */
export type AiStatus = { keyHash: string; connectedAt: string; usedAt: string | null } | null;

export async function aiStatus(): Promise<AiStatus> {
  const { data, error } = await supabase().rpc("ai_key_status");
  const s = data as { key_hash?: string; connected_at?: string; used_at?: string | null } | null;
  return error || !s?.key_hash || !s.connected_at ? null : { keyHash: s.key_hash, connectedAt: s.connected_at, usedAt: s.used_at ?? null };
}

/** Whether this user still has to connect AI for Fix and the Assistant (false when it can't be read). */
export async function aiNeeded(): Promise<boolean> {
  const { data, error } = await supabase().rpc("connection_gate");
  if (error || !data) return false;
  return (data as { ai_connected?: unknown }).ai_connected !== true;
}

/** Disconnects the user's AI here (they can also revoke the key on OpenRouter). */
export async function disconnectAi(): Promise<Outcome> {
  const res = await fetch("/api/ai-key", { method: "DELETE" }).catch(() => null);
  if (res?.ok) return done(undefined);
  const data = (await res?.json().catch(() => null)) as { error?: string } | null;
  return failed({ code: "notice", message: data?.error ?? "Couldn’t reach Benchjot. Check your connection and try again." });
}

/** Saves the Hugging Face token through the app's server, which seals it before it's stored. */
export async function saveHfToken(token: string): Promise<Outcome> {
  const res = await fetch("/api/data-keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hf_token: token }) }).catch(() => null);
  if (res?.ok) return done(undefined);
  const data = (await res?.json().catch(() => null)) as { error?: string } | null;
  return failed({ code: "notice", message: data?.error ?? "Couldn’t reach Benchjot. Check your connection and try again." });
}
