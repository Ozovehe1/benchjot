// The product name lives here and only here. Renaming the app = editing this file.
export const APP_NAME = "Benchjot";
export const APP_DESCRIPTION = "A research jotter for your code.";

// The newest Android APK, always: GitHub's stable redirect to the latest release's benchjot.apk asset.
// It keeps working while every release uploads an asset named exactly benchjot.apk and is a full
// release (not a draft or prerelease); the Android repo's release workflow fails if either changes.
export const ANDROID_APK_URL = "https://github.com/Ozovehe1/benchjot-android/releases/latest/download/benchjot.apk";
export const ANDROID_APP_LABEL = "Get the Android app";

// Fix, sized for Groq's free plan for openai/gpt-oss-120b (org-wide 30 RPM, 1K RPD, 8K TPM, 200K TPD;
// user-approved 2026-11-05). Per signed-in user, counted in the database by fix_take: perMinute in
// any minute, perDay in a rolling 24 hours; /api/fix and /api/helper answer 429 with retryAfter past
// either. One counter for both: a Helper request uses the same Groq quota as a Fix.
export const FIX_RATE = { perMinute: 6, perDay: 10 } as const;
// maxCodeChars / maxErrorChars: what a request may send (longer code is refused as too long; the
// error's tail is kept). maxReplyTokens: Groq's max_completion_tokens (gpt-oss reasoning counts
// too, so reasoning_effort is "low"); a cut-off answer says "This code is too long for Fix…".
export const FIX_LIMITS = { maxCodeChars: 16_000, maxErrorChars: 4_000, maxReplyTokens: 3_000 } as const;
// The note Helper (/api/helper), on the same model, limits and counter as Fix. maxRequestChars: what
// the user types. maxContextChars: the note as sent (body, then each code cell, then its last error),
// cut from its end at a line start; each cell's error keeps its last maxErrorChars, cut at a line start.
export const HELPER_LIMITS = { maxRequestChars: 2_000, maxContextChars: FIX_LIMITS.maxCodeChars, maxErrorChars: FIX_LIMITS.maxErrorChars, maxReplyTokens: FIX_LIMITS.maxReplyTokens } as const;
