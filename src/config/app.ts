// The product name lives here and only here. Renaming the app = editing this file.
export const APP_NAME = "Benchjot";
export const APP_DESCRIPTION = "A research jotter for your code.";

// The newest Android APK, always: GitHub's stable redirect to the latest release's benchjot.apk asset.
// It keeps working while every release uploads an asset named exactly benchjot.apk and is a full
// release (not a draft or prerelease); the Android repo's release workflow fails if either changes.
export const ANDROID_APK_URL = "https://github.com/Ozovehe1/benchjot-android/releases/latest/download/benchjot.apk";
export const ANDROID_APP_LABEL = "Get the Android app";

// Fix requests per signed-in user (counted in the database by fix_take; /api/fix answers 429 with
// retryAfter past either). Groq's own limits are on top of these.
export const FIX_RATE = { perMinute: 6, perDay: 100 } as const;
// The most Groq may write for one Fix answer (max_completion_tokens). A longer answer is cut off
// and /api/fix answers too_large ("This code is too long for Fix. Try a smaller part.").
export const FIX_MAX_REPLY_TOKENS = 8192;
