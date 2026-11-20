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

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

/**
 * The heading a note sits under in the list, by when it was last edited (Apple Notes' groups; the
 * Android app's core listGroupLocal matches it by fixture): "Today", "Yesterday", "Previous 7 days",
 * "Previous 30 days", then the month this year ("October"), then the year ("2025").
 */
export function listGroupLocal(then: LocalStamp, now: LocalStamp): string {
  const days = dayNumber(now[0], now[1], now[2]) - dayNumber(then[0], then[1], then[2]);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days <= 7) return "Previous 7 days";
  if (days <= 30) return "Previous 30 days";
  return then[0] === now[0] ? MONTH_NAMES[then[1] - 1]! : String(then[0]);
}

/** How long a note stays in Recently Deleted. */
export const RECENTLY_DELETED_DAYS = 30;

/** What Recently Deleted says of a note deleted at `deletedIso`: "12 days left", "1 day left", "Removed today". */
export function daysLeftText(deletedIso: string, now = new Date()): string {
  const left = RECENTLY_DELETED_DAYS - Math.floor((now.getTime() - new Date(deletedIso).getTime()) / 86_400_000);
  return left <= 0 ? "Removed today" : `${left} ${left === 1 ? "day" : "days"} left`;
}

const local = (t: Date): LocalStamp => [t.getFullYear(), t.getMonth() + 1, t.getDate(), t.getHours(), t.getMinutes()];

/** listDateLocal in the browser's time zone. */
export function listDate(iso: string, now = new Date()): string {
  return listDateLocal(local(new Date(iso)), local(now));
}

/** listGroupLocal in the browser's time zone. */
export function listGroup(iso: string, now = new Date()): string {
  return listGroupLocal(local(new Date(iso)), local(now));
}

export function displayTitle(title: string): string {
  return title.trim() || "Untitled";
}

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** A note's opening words as plain text, for a list: links read as their titles, Markdown marks and math dropped, one line. */
export function plainExcerpt(md: string, max = 180): string {
  const text = md
    .replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
