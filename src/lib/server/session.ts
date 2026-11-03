// Server-side only: used by API routes.
import { NextResponse } from "next/server";
import { asPlan, type Plan } from "../plan";
import { serverSupabase } from "../supabase/server";

export interface Session {
  userId: string;
  plan: Plan;
}

/** The signed-in user and their plan, or a 401 response to return as is. */
export async function requireSession(): Promise<Session | NextResponse> {
  const sb = await serverSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return jsonError(401, "Sign in first");
  const { data } = await sb.from("profiles").select("plan").eq("user_id", user.id).maybeSingle();
  return { userId: user.id, plan: asPlan(data?.plan) };
}

export function jsonError(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
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
