const SHORT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const LONG = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

/** Quiet list date: time today, "3 Nov" this year, "3 Nov 2025" otherwise. */
export function listDate(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (d.toDateString() === now.toDateString()) return TIME.format(d);
  return d.getFullYear() === now.getFullYear() ? SHORT.format(d) : LONG.format(d);
}

export function displayTitle(title: string): string {
  return title.trim() || "Untitled";
}

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
