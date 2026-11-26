// The AI allowance as the user sees it: the line under the Assistant's composer. Pure.
import { AI } from "@/config/app";

/** The line under the composer: what's left of the day's AI requests (Benchjot's own count). */
export function aiUsedText(used: number): string {
  const left = Math.max(0, AI.perDay - used);
  return `${left} of ${AI.perDay} AI requests left today · each step counts as one`;
}
