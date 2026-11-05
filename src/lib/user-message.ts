// Every error the app shows, in plain words. One table of error kinds to text, one
// classifier over platform-neutral facts (status, code, message, retryAfter). The Android
// app mirrors both (core UserMessage.kt), checked by the error_messages.json fixture
// that scripts/web-fixtures.mjs writes from this file. Raw details go to the console only.
// Not for the user's own code: run tracebacks and lint diagnostics are shown as they are.

export const ERROR_KINDS = ["offline", "timeout", "rate_limited", "session", "permission", "too_large", "conflict", "not_found", "server", "unknown"] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

export const ERROR_TEXT: Record<ErrorKind, string> = {
  offline: "You seem to be offline. Check your connection and try again.",
  timeout: "This is taking too long. Try again in a moment.",
  rate_limited: "Too many requests right now. Try again in {wait}.",
  session: "Your session has ended. Sign in again to continue.",
  permission: "You don’t have access to this.",
  too_large: "That’s too large. Try something smaller.",
  conflict: "That’s already taken. Try a different one.",
  not_found: "This couldn’t be found. It may have been deleted.",
  server: "Something went wrong on our side. Try again in a moment.",
  unknown: "Something went wrong. Try again.",
};

/** After an action's prefix, an unknown failure says only this. */
export const RETRY_TEXT = "Try again.";

/** What the user was doing, said first: "Couldn’t save your note. You seem to be offline…". */
export const ACTION_TEXT = {
  save_note: "Couldn’t save your note.",
  save_output: "Couldn’t save the output.",
  save_figures: "Couldn’t save the figures.",
  load_figures: "Couldn’t load the figures.",
  load: "Couldn’t load this.",
  load_notes: "Couldn’t load your notes.",
  outcome: "Couldn’t save the outcome.",
  parent: "Couldn’t set the parent note.",
  move: "Couldn’t move the note.",
  project: "Couldn’t update the project.",
  upload: "Couldn’t add the file.",
  download: "Couldn’t prepare the file.",
  sign_in: "Couldn’t sign you in.",
  sign_up: "Couldn’t create your account.",
  resend: "Couldn’t resend the link.",
  username: "Couldn’t save your username.",
  fix: "Fix couldn’t finish.",
  run_server: "The server run couldn’t finish.",
  runner_start: "The runner couldn’t start.",
} as const;
export type ErrorAction = keyof typeof ACTION_TEXT;

/** Whole messages that replace prefix + kind text for one action and kind. */
export const ACTION_OVERRIDES: Partial<Record<ErrorAction, Partial<Record<ErrorKind, string>>>> = {
  fix: { rate_limited: "Fix has hit its limit for now. Try again in {wait}." },
  run_server: { rate_limited: "Server runs have hit their limit for now. Try again in {wait}." },
  sign_in: { rate_limited: "Too many attempts. Try again in {wait}." },
  username: { conflict: "That username is taken. Try another." },
  sign_up: { conflict: "An account with this email already exists. Sign in instead." },
};

/** What both platforms know about a failure. `friendly` is text the app wrote itself, shown as is. */
export interface ErrorFacts {
  status?: number;
  code?: string;
  message?: string;
  retryAfter?: number; // seconds
  friendly?: string;
}

const test = (re: RegExp, s?: string) => !!s && re.test(s);

/** The kind of a failure. Order matters: the first rule that fits wins. */
export function errorKind(f: ErrorFacts): ErrorKind {
  const { status, code, message: m } = f;
  if (code && (ERROR_KINDS as readonly string[]).includes(code)) return code as ErrorKind;
  if (code === "network" || test(/failed to fetch|networkerror|load failed|fetch failed|network request failed|unable to resolve host|failed to connect|connection (refused|reset)|no address associated|enotfound|econnrefused|econnreset|software caused connection abort/i, m)) return "offline";
  if (status === 429 || test(/rate.?limit|quota/i, code) || test(/^PT429$/, code) || test(/rate limit|too many requests|too many attempts|quota|tokens per (minute|day)|requests per (minute|day)/i, m)) return "rate_limited";
  if (code === "timeout" || status === 408 || status === 504 || test(/timed? ?out|timeout/i, m)) return "timeout";
  if (status === 401 || test(/^(PGRST30[123]|session_expired|session_not_found|refresh_token_not_found|refresh_token_already_used|bad_jwt|no_authorization)$/, code) || test(/jwt|refresh token|session (has )?expired|session missing|not authenticated|sign in first/i, m)) return "session";
  if (status === 403 || code === "42501" || test(/row-level security|permission denied|forbidden/i, m)) return "permission";
  if (status === 413 || test(/too large|exceeded the maximum allowed size/i, m)) return "too_large";
  if (status === 409 || code === "23505" || test(/^(user_already_exists|email_exists|identity_already_exists)$/, code) || test(/duplicate key|already exists|already registered|unique constraint/i, m)) return "conflict";
  if (status === 404 || code === "PGRST116" || test(/not found|no rows/i, m)) return "not_found";
  if ((status !== undefined && status >= 500) || test(/internal server error|bad gateway|service unavailable/i, m)) return "server";
  return "unknown";
}

/** Seconds from "try again in 7m12.5s" / "1h2m" / "30s" (Groq's wording), or undefined. */
export function retryAfterFromText(m?: string): number | undefined {
  const r = m && /try again in ((?:\d+(?:\.\d+)?[hms])+)/i.exec(m);
  if (!r) return undefined;
  let s = 0;
  for (const [, n, u = "s"] of (r[1] ?? "").matchAll(/(\d+(?:\.\d+)?)([hms])/gi)) s += Number(n) * (u.toLowerCase() === "h" ? 3600 : u.toLowerCase() === "m" ? 60 : 1);
  return s;
}

/** "a minute", "5 minutes", "2 hours"; "a few minutes" when the wait is unknown. */
export function waitText(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return "a few minutes";
  if (seconds <= 60) return "a minute";
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} minutes`;
  const h = Math.ceil(seconds / 3600);
  return h === 1 ? "an hour" : `${h} hours`;
}

export function messageFor(kind: ErrorKind, action?: ErrorAction, retryAfter?: number): string {
  const override = action ? ACTION_OVERRIDES[action]?.[kind] : undefined;
  const text = override ?? (action ? `${ACTION_TEXT[action]} ${kind === "unknown" ? RETRY_TEXT : ERROR_TEXT[kind]}` : ERROR_TEXT[kind]);
  return text.replace("{wait}", waitText(retryAfter));
}

/** The text for these facts: the app's own text as is, else the kind's message. */
export function userText(f: ErrorFacts, action?: ErrorAction): string {
  if (f.friendly) return f.friendly;
  return messageFor(errorKind(f), action, f.retryAfter ?? retryAfterFromText(f.message));
}

/** An error whose message the app wrote for the user (validation, limits): shown as is. */
export class FriendlyError extends Error {}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\d+(\.\d+)?$/.test(v) ? Number(v) : undefined);
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** Facts from anything thrown on the web: Supabase (Postgrest, Auth, Storage) errors, fetch failures, API errors. */
export function errorFacts(e: unknown): ErrorFacts {
  if (e instanceof FriendlyError) return { friendly: e.message };
  if (typeof e === "string") return { message: e };
  const o = typeof e === "object" && e !== null ? (e as Record<string, unknown>) : {};
  const c = typeof o.cause === "object" && o.cause !== null ? (o.cause as Record<string, unknown>) : {};
  const pick = (k: string) => o[k] ?? c[k];
  const message = [o.message, c.message, pick("details"), pick("hint"), pick("error")].filter((v) => typeof v === "string" && v).join(" ") || undefined;
  let code = str(pick("code")) ?? (typeof pick("code") === "number" ? String(pick("code")) : undefined);
  const name = str(o.name);
  if (!code && (name === "TimeoutError" || name === "AbortError")) code = "timeout";
  if (!code && name === "TypeError" && test(/fetch|network|load failed/i, message)) code = "network";
  return { status: num(pick("status")) ?? num(pick("statusCode")), code, message, retryAfter: num(pick("retryAfter")) };
}

/** The one place a web error becomes text for the user. Logs the raw error for debugging. */
export function userMessage(e: unknown, action?: ErrorAction): string {
  const facts = errorFacts(e);
  if (!facts.friendly && process.env.NODE_ENV !== "test") console.error(`[benchjot] ${action ?? "error"}`, e);
  return userText(facts, action);
}

/**
 * How an API route answers when its upstream (Groq, Modal) failed: our status and kind, never the
 * provider's text. A limit (429, quota, tokens per minute/day) stays a limit with its wait; a slow
 * upstream is a timeout; anything else is our side.
 */
export function upstreamFailure(f: ErrorFacts & { retryAfterHeader?: string | null }): { kind: ErrorKind; status: number; retryAfter?: number } {
  const kind = errorKind({ ...f, code: f.code === "timeout" ? "timeout" : undefined });
  const header = f.retryAfterHeader ? Number(f.retryAfterHeader) : NaN;
  const retryAfter = Number.isFinite(header) && header > 0 ? header : retryAfterFromText(f.message);
  if (kind === "rate_limited") return { kind, status: 429, retryAfter };
  if (kind === "timeout") return { kind, status: 504 };
  return { kind: "server", status: 502 };
}
