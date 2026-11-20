// The signed-in person, for server pages and the sign-in callback. The one place server pages
// talk to the auth provider and the profiles table (Supabase today); API routes use session.ts.
import type { EmailOtpType } from "@supabase/supabase-js";
import { serverSupabase } from "@/lib/data/supabase/server";
import { cookies } from "next/headers";
import { SETUP_COOKIE } from "@/lib/web/setup";

type Account = { id: string; email: string; username: string | null };

/** Who is signed in, with their username (null until chosen); null when nobody is. */
export async function currentAccount(): Promise<Account | null> {
  const sb = await serverSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return null;
  const { data: profile } = await sb.from("profiles").select("username").eq("user_id", user.id).maybeSingle();
  return { id: user.id, email: user.email ?? "", username: profile?.username ?? null };
}

/** Whether anyone is signed in (cheaper than currentAccount: no profile read). */
export async function isSignedIn(): Promise<boolean> {
  const {
    data: { user },
  } = await (await serverSupabase()).auth.getUser();
  return Boolean(user);
}

const EMAIL_LINKS: readonly EmailOtpType[] = ["signup", "email", "recovery", "invite", "magiclink", "email_change"];

/**
 * Finishes a sign-in that came back from outside: Google's code (PKCE), or the token in an email
 * link. True when the person is now signed in.
 */
export async function finishSignIn(params: URLSearchParams): Promise<boolean> {
  const auth = (await serverSupabase()).auth;
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  if (code) return !(await auth.exchangeCodeForSession(code)).error;
  if (tokenHash && type && EMAIL_LINKS.includes(type)) return !(await auth.verifyOtp({ token_hash: tokenHash, type })).error;
  return false;
}

/** One of the signed-in person's projects (RLS: nobody else's), or null. */
export async function findProject(id: string): Promise<{ id: string; name: string } | null> {
  const { data } = await (await serverSupabase()).from("projects").select("id, name").eq("id", id).maybeSingle();
  return data ?? null;
}

/** What the signed-in person has connected (connection_gate). */
type Gate = { aiConnected: boolean };
export async function connectionGate(): Promise<Gate> {
  const { data } = await (await serverSupabase()).rpc("connection_gate");
  return { aiConnected: (data as { ai_connected?: unknown } | null)?.ai_connected === true };
}

/**
 * Whether to show the connect step (/welcome/boosts) before the app: AI isn't connected and this
 * browser hasn't been through the step yet (SETUP_COOKIE). Everyone passes through it once; nobody
 * is held there, and nothing is required.
 */
export async function setupPending(): Promise<boolean> {
  if ((await cookies()).get(SETUP_COOKIE)?.value) return false;
  return !(await connectionGate()).aiConnected;
}
