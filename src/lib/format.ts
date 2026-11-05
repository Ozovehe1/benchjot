const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** A wall-clock moment in the reader's own zone: year, month 1–12, day, hour, minute. */
export type LocalStamp = readonly [year: number, month: number, day: number, hour: number, minute: number];

const pad = (n: number) => String(n).padStart(2, "0");
const dayNumber = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 86_400_000;

/**
 * The list's date for a note (one rule; the Android app's core listDate matches it by fixture):
 * today "14:05", yesterday "Yesterday", up to 6 days back "Mon", earlier this year "3 Nov",
 * older "3 Nov 2025". A date after `now` (clock skew) shows as its date.
 */
export function listDateLocal(then: LocalStamp, now: LocalStamp): string {
  const [y, m, d, h, min] = then;
  const days = dayNumber(now[0], now[1], now[2]) - dayNumber(y, m, d);
  if (days === 0) return `${pad(h)}:${pad(min)}`;
  if (days === 1) return "Yesterday";
  if (days > 1 && days <= 6) return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
  return y === now[0] ? `${d} ${MONTHS[m - 1]}` : `${d} ${MONTHS[m - 1]} ${y}`;
}

const local = (t: Date): LocalStamp => [t.getFullYear(), t.getMonth() + 1, t.getDate(), t.getHours(), t.getMinutes()];

/** listDateLocal in the browser's time zone. */
export function listDate(iso: string, now = new Date()): string {
  return listDateLocal(local(new Date(iso)), local(now));
}

export function displayTitle(title: string): string {
  return title.trim() || "Untitled";
}

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
