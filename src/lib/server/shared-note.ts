// Server only (it signs files with the link token); imported by the shared page and its routes.
// The shared page's data on the server: the note through shared_note() and its figures signed
// through Storage with the link's token in a header (the storage rule checks it, and who may open it).
//
// A note shared with anyone who has the link is read as nobody and cached per link (tag share:<token>)
// for SHARE_CACHE_SECONDS, so a link opened by many people at once costs the database about one read
// per interval; the owner's changes (lock, new link, remove someone, options) clear the cache at
// once (/api/share/refresh). A note shared with invited people is read as the signed-in visitor, per
// request, never cached. Figures are signed for SIGNED_SECONDS: after a lock, an address already
// handed out stops working within that, and the page itself closes at once.
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../web/env";
import { serverSupabase } from "../data/supabase/server";
import { OUTPUTS_BUCKET, outputPaths } from "../run/outputs";
import { SHARE_HEADER, SHARE_TOKEN, sharedNote, type SharedNote } from "../share/share";
import { bearerToken } from "./bearer";

const SHARE_CACHE_SECONDS = 30;
const SIGNED_SECONDS = 2 * 60;

export const shareTag = (token: string) => `share:${token}`;

/** A client that carries the link's token, as nobody or as the signed-in visitor (their access token). */
function linkClient(token: string, accessToken?: string | null) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { [SHARE_HEADER]: token, ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** The visitor's access token: a native app's bearer, else the browser's sign-in cookie; null when signed out. */
export async function visitorToken(request?: Request): Promise<string | null> {
  const bearer = bearerToken(request?.headers.get("authorization"));
  if (bearer) return bearer;
  const sb = await serverSupabase();
  const { data } = await sb.auth.getUser(); // checks the cookie's session with Supabase before trusting it
  if (!data.user) return null;
  return (await sb.auth.getSession()).data.session?.access_token ?? null;
}

interface SharedPage {
  note: SharedNote;
  /** Each cell's output files by name (signed addresses). */
  urls: Record<string, string>[];
}

/** What a link opens: the note, "restricted" (shared with invited people, and this visitor isn't one), or nothing. */
type SharedResult = { kind: "note"; page: SharedPage } | { kind: "restricted"; signedIn: boolean } | null;

type Read = { kind: "note"; page: SharedPage } | { kind: "restricted" } | null;
/** A read and when it was made (a cached copy past its interval is never served; see loadShared). */
type Timed = { at: number; read: Read };

async function readNow(token: string, accessToken: string | null): Promise<Read> {
  const sb = linkClient(token, accessToken);
  const { data, error } = await sb.rpc("shared_note", { t: token, seen: false });
  if (error) throw new Error(error.message, { cause: error });
  if (!data) return null;
  if ((data as { restricted?: boolean }).restricted) return { kind: "restricted" };
  const note = sharedNote.parse(data);
  const urls = await Promise.all(
    note.cells.map(async (c) => {
      const o = c.last_run?.outputs;
      const paths = o ? outputPaths(o) : [];
      if (!o || !paths.length) return {};
      const { data: signed } = await sb.storage.from(OUTPUTS_BUCKET).createSignedUrls(paths, SIGNED_SECONDS);
      const out: Record<string, string> = {};
      for (const row of signed ?? []) if (row.signedUrl && row.path) out[row.path.slice(o.dir.length + 1)] = row.signedUrl;
      return out;
    }),
  );
  return { kind: "note", page: { note, urls } };
}

/**
 * The read as nobody, cached per link; cleared the moment the owner changes the link. The cache
 * refreshes in the background, so it can hand back a copy older than its interval once; such a copy
 * is never served (a lock must hold even if the owner's refresh didn't reach us): it's read again.
 */
async function readPublic(token: string): Promise<Read> {
  const cached = await unstable_cache(async (): Promise<Timed> => ({ at: Date.now(), read: await readNow(token, null) }), ["shared-note", token], {
    revalidate: SHARE_CACHE_SECONDS,
    tags: [shareTag(token)],
  })();
  return Date.now() - cached.at <= SHARE_CACHE_SECONDS * 1000 ? cached.read : readNow(token, null);
}

/** The note behind a link for this visitor (one read per request, shared by the page, its metadata and its card). */
export const loadShared = cache(async (token: string): Promise<SharedResult> => {
  if (!SHARE_TOKEN.test(token)) return null;
  const open = await readPublic(token);
  if (open?.kind === "note") {
    // A cached page outlives its end date by at most the cache's interval; never past it.
    if (open.page.note.expires_at && Date.parse(open.page.note.expires_at) <= Date.now()) return null;
    return open;
  }
  if (!open) return null;
  // Shared with invited people: read as this visitor, never cached.
  const visitor = await visitorToken();
  if (!visitor) return { kind: "restricted", signedIn: false };
  const mine = await readNow(token, visitor);
  return mine?.kind === "note" ? mine : mine ? { kind: "restricted", signedIn: true } : null;
});

/** Counts one view (the page asks once per browser per day; link previews and bots aren't counted). */
export async function countView(token: string, accessToken: string | null): Promise<void> {
  if (!SHARE_TOKEN.test(token)) return;
  await linkClient(token, accessToken).rpc("shared_note", { t: token, seen: true });
}

/** Storage as the link's holder (and the visitor, for a note shared with people): only that note's current files (copying uses it). */
export const linkStorage = (token: string, accessToken: string | null) => linkClient(token, accessToken).storage;
