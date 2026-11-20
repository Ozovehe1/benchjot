// Server-side only: used by API routes.
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonSupabase, serverSupabase, tokenSupabase } from "../data/supabase/server";
import { bearerToken } from "./bearer";
import { messageFor, type ErrorAction, type ErrorKind } from "../ui/user-message";

export interface Session {
  userId: string;
  /** The caller's own Supabase client (their token, so RLS and auth.uid() apply). */
  db: {
    rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
    /** Table access as the caller (RLS applies); the background-run routes use it. */
    from?: SupabaseClient["from"];
    /** Storage as the caller (the bucket rules apply); copying a shared note's files uses it. */
    storage?: SupabaseClient["storage"];
  };
}

/**
 * Database functions as nobody in particular, for callers that prove themselves another way (a
 * background run's one-time token): only functions that check that proof themselves may be called.
 */
export function anonymousDb(): Pick<Session["db"], "rpc"> {
  const sb = anonSupabase();
  return { rpc: (fn, args) => sb.rpc(fn, args) };
}

/**
 * The signed-in user, or a 401 response to return as is.
 * Browsers are signed in by cookie; native apps send `Authorization: Bearer <access token>`.
 */
export async function requireSession(request?: Request): Promise<Session | NextResponse> {
  const token = bearerToken(request?.headers.get("authorization"));
  const sb = token ? tokenSupabase(token) : await serverSupabase();
  const {
    data: { user },
  } = token ? await sb.auth.getUser(token) : await sb.auth.getUser();
  if (!user) return apiError("session", 401);
  // Bound: the client's methods read `this`, so a route may take them off `db` (const from = db.from).
  const db: Session["db"] = { rpc: (fn, args) => sb.rpc(fn, args), from: ((table: string) => sb.from(table)) as SupabaseClient["from"], storage: sb.storage };
  return { userId: user.id, db };
}

/**
 * An error answer every client can read: `error` is always text for the user (older apps show it),
 * `code` is a stable kind (src/lib/ui/user-message.ts) or "notice" when `error` is the app's own text
 * to show as is, `retryAfter` is seconds. Provider text never goes in; log it server-side instead.
 */
export function jsonError(status: number, error: string, retryAfter?: number): NextResponse {
  const wait = retryAfter !== undefined && retryAfter > 0 ? Math.ceil(retryAfter) : undefined;
  return NextResponse.json({ error, code: "notice", ...(wait !== undefined ? { retryAfter: wait } : {}) }, { status, headers: wait !== undefined ? { "retry-after": String(wait) } : undefined });
}

export function apiError(kind: ErrorKind, status: number, action?: ErrorAction, retryAfter?: number): NextResponse {
  const wait = retryAfter !== undefined && Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : undefined;
  return NextResponse.json(
    { error: messageFor(kind, action, wait), code: kind, ...(wait !== undefined ? { retryAfter: wait } : {}) },
    { status, headers: wait !== undefined ? { "retry-after": String(wait) } : undefined },
  );
}

/** Reads a JSON body against a zod-like schema; a 400 response when it doesn't fit. */
export async function readBody<T>(request: Request, parse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: { message: string }[] } }): Promise<T | NextResponse> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, "Body must be JSON");
  }
  const r = parse(raw);
  return r.success ? r.data : jsonError(400, r.error.issues[0]?.message ?? "Invalid request");
}
