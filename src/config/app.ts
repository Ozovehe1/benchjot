// The product name lives here and only here. Renaming the app = editing this file.
export const APP_NAME = "Benchjot";
export const APP_DESCRIPTION = "A research jotter for your code.";

// Fix and the Assistant run on the user's own OpenRouter account (lib/server/openrouter.ts), within
// its free allowance; Benchjot keeps no AI limit of its own.
// maxCodeChars / maxErrorChars: what a request may send (longer code is refused as too long; the
// error's tail is kept). maxReplyTokens: OpenRouter's max_tokens (a reasoning model's thinking
// counts too, so reasoning effort is "low"); a cut-off answer says "This code is too long for Fix…".
export const FIX_LIMITS = { maxCodeChars: 16_000, maxErrorChars: 4_000, maxReplyTokens: 6_000 } as const;
// The Assistant (POST /api/agent), on the same models as Fix. maxRequestChars: what
// the user types. maxContextChars: the note and its history as sent together (the history first, the
// note cut from its end at a line start to the room left). The note is the body, then each code cell
// with its "Note before run", its code, its last run's output (the stdout's last maxOutputChars and the
// figures and tables it made) or its last error's last maxErrorChars, and its "Note after run".
export const ASSISTANT_LIMITS = { maxRequestChars: 2_000, maxContextChars: 100_000, maxErrorChars: FIX_LIMITS.maxErrorChars, maxOutputChars: 2_000 } as const;
// Assistant history (user-approved 2026-11-06): each answered turn is saved per note (assistant_turns),
// kept whole for `days`, then condensed by the database (assistant_condense, hourly) into the note's one
// summary (assistant_summaries, at most maxStoredSummaryChars, newest lines kept). Online sends the
// summary's newest maxSummaryChars and the last `turns` turns, each request cut to maxTurnRequestChars
// and each answer to maxTurnAnswerChars. The database holds the same numbers (a test checks).
// An agent answer cut off at maxTokens is continued in up to `batches` more requests within budgetMs
// (the route may live 300 s); what still doesn't finish is shown as far as it got, never as an error.
export const ASSISTANT_LONG = { batches: 3, budgetMs: 240_000 } as const;
// The voice agent (/api/agent, user-asked 2026-11-19): carries a spoken or typed request out in the
// note with tools (add a cell, change one, run one), one model call per step, at most `steps` steps.
// Each tool result it reads back is cut to maxResultChars; code it wrote earlier is shown again cut to
// maxHistoryCodeChars (the whole code is in the note it reads each step).
export const AGENT_LIMITS = { steps: 8, callsPerStep: 4, maxCodeChars: 30_000, maxResultChars: 3_000, maxHistoryCodeChars: 1_500, maxMessageChars: 4_000 } as const;
// Reasoning stays low: on the free models each step's thinking costs tens of seconds, and the agent
// thinks across steps anyway (it reads each run back). One answer may take up to 110 s (a long cell).
// 12k tokens a reply: a whole simulation cell fits in one tool call (6k cut long cells off, the most
// frequent agent error in the logs, 2026-11-20).
export const AGENT_STYLE = { temperature: 0.2, reasoning: "low", maxTokens: 12_000, timeoutMs: 110_000 } as const;
// Dictation: the browser's (or the phone's) own speech recognition; it stops listening at maxSeconds.
export const VOICE_LIMITS = { maxSeconds: 120 } as const;
export const ASSISTANT_HISTORY = { days: 30, turns: 6, maxSummaryChars: 1_500, maxStoredSummaryChars: 4_000, maxTurnRequestChars: 400, maxTurnAnswerChars: 1_200 } as const;
// Server runs (Modal) for every account (user-approved 2026-11-18): a GPU when the code needs one,
// up to an hour in the background. Runs that get a GPU count: perDay in a rolling 24 hours, per
// account (run_take). CPU runs aren't counted; at most MAX_ACTIVE_RUNS go at once per account.
export const GPU_RUNS = { perDay: 10 } as const;

/** The Android app: always the newest build (GitHub serves the latest release's APK at this address). */
export const ANDROID_APK_URL = "https://github.com/Ozovehe1/benchjot-android/releases/latest/download/benchjot.apk";
/** The same app for older 32-bit phones (benchjot.apk is for 64-bit ones, almost every phone now). */
export const ANDROID_APK_32_URL = "https://github.com/Ozovehe1/benchjot-android/releases/latest/download/benchjot-32bit.apk";
/** Its release notes and every earlier build. */
export const ANDROID_RELEASES_URL = "https://github.com/Ozovehe1/benchjot-android/releases";
