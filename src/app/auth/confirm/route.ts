import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { serverSupabase } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safe-next";

const TYPES: readonly EmailOtpType[] = ["signup", "email", "recovery", "invite", "magiclink", "email_change"];

/**
 * Where users land back from outside: the link in a confirmation email (token_hash)
 * or Google sign-in (PKCE code). Finishes the sign-in, then sends them on.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = safeNext(params.get("next"));
  const auth = (await serverSupabase()).auth;

  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;

  let ok = false;
  if (code) ok = !(await auth.exchangeCodeForSession(code)).error;
  else if (tokenHash && type && TYPES.includes(type)) ok = !(await auth.verifyOtp({ token_hash: tokenHash, type })).error;
  if (ok) return NextResponse.redirect(new URL(next, request.url));

  const url = new URL("/login", request.url);
  url.searchParams.set("error", code || params.has("error_description") ? "google" : "link");
  return NextResponse.redirect(url);
}
