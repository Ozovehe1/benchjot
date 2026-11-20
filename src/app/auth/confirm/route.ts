import { NextResponse, type NextRequest } from "next/server";
import { finishSignIn } from "@/lib/server/account";
import { safeNext } from "@/lib/web/safe-next";

/**
 * Where users land back from outside: the link in a confirmation email (token_hash)
 * or Google sign-in (PKCE code). Finishes the sign-in, then sends them on.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  if (await finishSignIn(params)) return NextResponse.redirect(new URL(safeNext(params.get("next")), request.url));
  const url = new URL("/login", request.url);
  url.searchParams.set("error", params.get("code") || params.has("error_description") ? "google" : "link");
  return NextResponse.redirect(url);
}
