// Plans. The plan lives in public.profiles (one row per user, 'free' by default);
// users can read their own row but never write it (RLS), so the server can trust it.
export const PLANS = ["free", "pro"] as const;
export type Plan = (typeof PLANS)[number];

export function asPlan(value: unknown): Plan {
  return value === "pro" ? "pro" : "free";
}
