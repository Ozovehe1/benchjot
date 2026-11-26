// Sharing a note with a read-only link (/s/<token>): what the database's shared_note() returns, the
// link's options, and the pieces both the shared page and the Share sheet use. The database makes
// and checks the token (supabase/migrations/20261119040000_note_shares.sql).
import { z } from "zod";
import { lastRun } from "../notes/schemas";
import { OUTCOMES } from "../notes/outcome";
import { linkRe } from "../notes/links";

/** A link's token: 128 random bits, base64url (22 characters); anything else is no link. */
export const SHARE_TOKEN = /^[A-Za-z0-9_-]{22}$/;

/** The header that unlocks a shared note's files in Storage (the storage rule reads it). */
export const SHARE_HEADER = "x-bj-share";

export const sharePath = (token: string) => `/s/${token}`;
export const sharedOutputPath = (token: string, cell: number, index: number) => `${sharePath(token)}/out/${cell}/${index}`;

/** A day picked in the Share sheet's calendar (yyyy-mm-dd, the device's own day) as the moment sharing ends: the end of that day. */
export function endOfDay(day: string): string | null {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 23, 59, 59).toISOString();
}

/** The device's own day (yyyy-mm-dd) of a moment, for the calendar. */
export function localDay(at: string | number | Date): string {
  const t = new Date(at);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

/** A link's options as the owner sees them (a note_shares row). */
export const shareRow = z.object({
  note_id: z.string(),
  token: z.string(),
  show_code: z.boolean(),
  allow_copy: z.boolean(),
  indexable: z.boolean(),
  expires_at: z.string().nullable(),
  access: z.enum(["people", "link"]),
  views: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ShareRow = z.output<typeof shareRow>;

const sharedCell = z.object({
  id: z.string(),
  filename: z.string(),
  language: z.string(),
  content: z.string(),
  last_run: lastRun.nullable().catch(null),
  note_before: z.string(),
  note_after: z.string(),
});

/** What the shared page shows (shared_note()). */
export const sharedNote = z.object({
  token: z.string(),
  /** "people": only people its owner invited; "link": anyone with the link. */
  access: z.enum(["people", "link"]).catch("people"),
  /** The visitor is its owner. */
  mine: z.boolean().nullable().catch(null),
  show_code: z.boolean(),
  allow_copy: z.boolean(),
  indexable: z.boolean(),
  expires_at: z.string().nullable(),
  author: z.string().nullable(),
  note: z.object({
    id: z.string(),
    title: z.string(),
    notes: z.string(),
    outcome: z.enum(OUTCOMES).nullable().catch(null),
    updated_at: z.string(),
  }),
  cells: z.array(sharedCell),
  /** Notes it links to that are shared too: id -> token. */
  links: z.record(z.string(), z.string()),
});
export type SharedNote = z.output<typeof sharedNote>;

/**
 * The note's text as a viewer reads it: a [[link]] to a note that is shared too opens that note's
 * shared page; any other link reads as its title (the owner's other notes stay private).
 */
export function sharedBody(text: string, links: Readonly<Record<string, string>>): string {
  return text.replace(linkRe(), (_raw, label: string, id: string | undefined) => {
    const title = label.trim().replace(/([[\]\\])/g, "\\$1");
    const token = id ? links[id.toLowerCase()] : undefined;
    return token ? `[${title}](${sharePath(token)})` : title;
  });
}

/** The first lines of the text, plain, for a link preview's description. */
export function shareDescription(text: string, max = 180): string {
  const plain = text
    .replace(linkRe(), (_raw, label: string) => label.trim())
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(^|\s)[-+]\s/g, " ") // list bullets; hyphens inside words stay
    .replace(/[#>*_`~|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

/** Link-preview fetchers and crawlers: they see the page but aren't counted as views. */
export function isBot(userAgent: string | null | undefined): boolean {
  return !userAgent || /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|slack|discord|embedly|vkshare|skype|linkedin|pinterest|redditbot|quora|headless|lighthouse/i.test(userAgent);
}

/** "Shared 3 days ago"-style: how long until the link stops working, or null when it doesn't. */
export function expiryText(expires: string | null, now = Date.now()): string | null {
  if (!expires) return null;
  const ms = Date.parse(expires) - now;
  if (ms <= 0) return "Ended";
  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return `Ends in ${Math.max(hours, 1)} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `Ends in ${days} day${days === 1 ? "" : "s"}`;
}
