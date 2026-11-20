// The free AI budget as the user sees it: the free OpenRouter models' daily limit, the line under the
// Assistant's composer, and the plain message when the day's requests are used up. Pure.

/** Free OpenRouter accounts get this many free-model requests a day (raised by adding credits there). */
export const FREE_AI_PER_DAY = 50;

/** The budget line under the composer. */
export function aiUsedText(used: number): string {
  const left = Math.max(0, FREE_AI_PER_DAY - used);
  return `${used} AI request${used === 1 ? "" : "s"} in the last 24 hours · about ${left} of ${FREE_AI_PER_DAY} free left · each step is one`;
}

/**
 * The day's free limit, said plainly with when it comes back: OpenRouter's 429 carries the reset time
 * (X-RateLimit-Reset, ms since the epoch) and whether it is the free models' daily limit.
 */
export function limitMessage(body: string, now: number, fallback: string): string {
  const daily = /free-models-per-day|free_tier_daily/.test(body);
  const reset = Number(/"X-RateLimit-Reset"\s*:\s*"?(\d{12,14})/.exec(body)?.[1]);
  if (!daily || !Number.isFinite(reset) || reset <= now) return fallback;
  const mins = Math.ceil((reset - now) / 60_000);
  const when = mins >= 90 ? `about ${Math.round(mins / 60)} hours` : mins >= 60 ? "about an hour" : `${mins} minute${mins === 1 ? "" : "s"}`;
  return `Today's free AI requests on your OpenRouter account are used up (free accounts get ${FREE_AI_PER_DAY} a day). They come back in ${when}. Running cells yourself works as usual.`;
}

