// Server-side only: used by API routes.
import { NextResponse } from "next/server";
import { asPlan, type Plan } from "../plan";
import { serverSupabase, tokenSupabase } from "../supabase/server";
import { bearerToken } from "./bearer";
import { messageFor, type ErrorAction, type ErrorKind } from "../user-message";

export interface Session {
  userId: string;
  plan: Plan;
  /** The caller's own Supabase client (their token, so RLS and auth.uid() apply). */
  db: { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };
}

/**
 * The signed-in user and their plan, or a 401 response to return as is.
 * Browsers are signed in by cookie; native apps send `Authorization: Bearer <access token>`.
 */
export async function requireSession(request?: Request): Promise<Session | NextResponse> {
  const token = bearerToken(request?.headers.get("authorization"));
  const sb = token ? tokenSupabase(token) : await serverSupabase();
  const {
    data: { user },
  } = token ? await sb.auth.getUser(token) : await sb.auth.getUser();
  if (!user) return apiError("session", 401);
  const { data } = await sb.from("profiles").select("plan").eq("user_id", user.id).maybeSingle();
  return { userId: user.id, plan: asPlan(data?.plan), db: sb as unknown as Session["db"] };
}

/**
 * An error answer every client can read: `error` is always text for the user (older apps show it),
 * `code` is a stable kind (src/lib/user-message.ts) or "notice" when `error` is the app's own text
 * to show as is, `retryAfter` is seconds. Provider text never goes in; log it server-side instead.
 */
export function jsonError(status: number, error: string): NextResponse {
  return NextResponse.json({ error, code: "notice" }, { status });
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
