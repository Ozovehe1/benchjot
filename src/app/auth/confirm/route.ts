import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { serverSupabase } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safe-next";

const TYPES: readonly EmailOtpType[] = ["signup", "email", "recovery", "invite", "magiclink", "email_change"];

/** Landing for the link in the confirmation email: verifies the token, signs the user in, sends them on. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const next = safeNext(params.get("next"));

  if (tokenHash && type && TYPES.includes(type)) {
    const { error } = await (await serverSupabase()).auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }
  const url = new URL("/login", request.url);
  url.searchParams.set("error", "link");
  return NextResponse.redirect(url);
}
