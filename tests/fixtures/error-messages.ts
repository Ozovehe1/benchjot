// Failures as both apps see them (platform-neutral facts), with the kind each must get.
// Shared with the Android app: its scripts/web-fixtures.mjs writes error_messages.json with the
// web's own text for each case, and core UserMessage.kt must give the same.
import type { ErrorAction, ErrorFacts, ErrorKind } from "@/lib/user-message";

export const ERROR_CASES: [name: string, facts: ErrorFacts, action: ErrorAction | null, kind: ErrorKind][] = [
  ["offline (browser)", { code: "network", message: "TypeError: Failed to fetch" }, "save_note", "offline"],
  ["offline (android)", { message: "Unable to resolve host \"x.supabase.co\": No address associated with hostname" }, null, "offline"],
  ["timeout", { code: "timeout" }, "load_notes", "timeout"],
  ["groq 429 with retry-after", { status: 429, code: "rate_limited", retryAfter: 90 }, "fix", "rate_limited"],
  ["groq tokens per day", { message: "Rate limit reached for model `openai/gpt-oss-120b` on tokens per day (TPD): Limit 200000, Used 199000. Please try again in 7m12.5s." }, "fix", "rate_limited"],
  ["groq quota exhausted", { status: 400, message: "You exceeded your current quota, please check your plan and billing details." }, "fix", "rate_limited"],
  ["login lockout", { code: "PT429", message: "Too many attempts. Try again in a few minutes." }, "sign_in", "rate_limited"],
  ["server run limit", { status: 429 }, "run_server", "rate_limited"],
  ["jwt expired", { code: "PGRST303", message: "JWT expired" }, "save_note", "session"],
  ["refresh failed", { status: 400, code: "refresh_token_not_found", message: "Invalid Refresh Token: Refresh Token Not Found" }, null, "session"],
  ["rls", { code: "42501", message: "new row violates row-level security policy for table \"entries\"" }, "move", "permission"],
  ["unique violation", { code: "23505", message: "duplicate key value violates unique constraint \"profiles_username_key\"" }, "username", "conflict"],
  ["email taken", { status: 422, code: "user_already_exists", message: "User already registered" }, "sign_up", "conflict"],
  ["413", { status: 413, message: "The object exceeded the maximum allowed size" }, "save_figures", "too_large"],
  ["not found", { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" }, "outcome", "not_found"],
  ["5xx", { status: 502 }, "fix", "server"],
  ["unknown", { message: "Something odd: undefined" }, "upload", "unknown"],
  ["unknown, no action", {}, null, "unknown"],
];
