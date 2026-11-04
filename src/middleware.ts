import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

// Signed-out visitors may see these; signed-in users are sent home from /login.
const AUTH_PATHS = ["/login"];
// Reachable signed in or out (the email confirmation link).
const OPEN_PATHS = ["/auth/", "/privacy", "/terms"];
const LANDING = "/";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const sb = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await sb.auth.getUser();
  const path = request.nextUrl.pathname;
  const isAuthPage = AUTH_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

  // API routes answer 401 themselves instead of redirecting.
  if (OPEN_PATHS.some((p) => path.startsWith(p))) return response;
  if (!user && !isAuthPage && path !== LANDING && !path.startsWith("/api/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  if (user && isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|sw.js|offline.html|workers/|vendor/|icons/|.*\\.(?:svg|png|jpg|webp|wasm|html|txt)$).*)"],
};
