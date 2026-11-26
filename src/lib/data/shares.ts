"use client";
// The owner's side of sharing (note_shares and note_share_people, owner-only by RLS and checked
// functions), and the reader's "Shared with me" list. Read and changed straight through Supabase
// like the rest of the note; every change then clears the shared page's cache (/api/share/refresh),
// so a lock or a removal holds for everyone at once. Sharing needs a connection: these calls fail
// plainly offline.
import useSWR, { mutate } from "swr";
import { z } from "zod";
import { supabase } from "./supabase/client";
import { shareRow, type ShareRow } from "../share/share";

const key = (noteId: string) => ["share", noteId] as const;
const peopleKey = (noteId: string) => ["share-people", noteId] as const;
const SHARED_WITH_ME_KEY = ["shared-with-me"] as const;

function check<T>(r: { data: T; error: { message: string; code?: string } | null }): T {
  if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code, friendly: friendlyShareError(r.error) });
  return r.data;
}

/** The database's own words for the cases a person can fix ("No one has that username"). */
function friendlyShareError(e: { message: string; code?: string }): string | undefined {
  if (e.code === "P0002" || e.code === "22023") return e.message;
  return undefined;
}

/** Drops the shared page's cached copy for these links, so the change holds for every visitor now. */
async function refresh(...tokens: (string | null | undefined)[]) {
  const list = tokens.filter((t): t is string => Boolean(t));
  if (!list.length) return;
  await fetch("/api/share/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tokens: list }) }).catch(() => undefined);
}

async function read(noteId: string): Promise<ShareRow | null> {
  const row = check(await supabase().from("note_shares").select("*").eq("note_id", noteId).maybeSingle());
  return row ? shareRow.parse(row) : null;
}

/** The note's sharing, or null when it isn't shared. */
export function useShare(noteId: string) {
  return useSWR(key(noteId), () => read(noteId), { revalidateOnFocus: true });
}

async function userId(): Promise<string> {
  const { data } = await supabase().auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw Object.assign(new Error("no session"), { status: 401 });
  return id;
}

/** Starts sharing: only the people invited (none yet) can open it; code shown, copies allowed, not listed. */
export async function startSharing(noteId: string, access: ShareRow["access"] = "people"): Promise<ShareRow> {
  const row = shareRow.parse(check(await supabase().from("note_shares").insert({ note_id: noteId, user_id: await userId(), access }).select("*").single()));
  await mutate(key(noteId), row, { revalidate: false });
  return row;
}

export type ShareOptions = Partial<Pick<ShareRow, "show_code" | "allow_copy" | "indexable" | "expires_at" | "access">>;

export async function updateShare(noteId: string, patch: ShareOptions): Promise<ShareRow> {
  const row = shareRow.parse(check(await supabase().from("note_shares").update(patch).eq("note_id", noteId).select("*").single()));
  await mutate(key(noteId), row, { revalidate: false });
  await refresh(row.token);
  return row;
}

/** A new link; the old one stops working at once. Invited people keep access (through the new link). */
export async function resetShare(noteId: string, oldToken: string): Promise<ShareRow | null> {
  check(await supabase().rpc("share_reset", { note: noteId }));
  const row = (await mutate(key(noteId), read(noteId), { revalidate: false })) ?? null;
  await refresh(oldToken, row?.token);
  return row;
}

/** Stops sharing (locks the note): the link and everyone's access end at once. */
export async function stopSharing(noteId: string, token: string): Promise<void> {
  check(await supabase().from("note_shares").delete().eq("note_id", noteId));
  await mutate(key(noteId), null, { revalidate: false });
  await mutate(peopleKey(noteId), [], { revalidate: false });
  await refresh(token);
}

const person = z.object({ user_id: z.string(), username: z.string().nullable(), added_at: z.string(), accepted: z.boolean().catch(true) });
type SharePerson = z.output<typeof person>;

/** Who the owner shared the note with. */
export function useSharePeople(noteId: string, shared: boolean) {
  return useSWR(shared ? peopleKey(noteId) : null, async () => z.array(person).parse(check(await supabase().rpc("share_people", { note: noteId }))));
}

/** Adds someone by username; they can open it now and find it in Shared with me. */
export async function inviteToShare(noteId: string, username: string): Promise<void> {
  const res = await fetch("/api/share/invite", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ noteId, username }) });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw Object.assign(new Error(data.error ?? `invite answered ${res.status}`), { status: res.status, friendly: res.status === 400 ? data.error : undefined });
  await mutate(peopleKey(noteId));
}

/** Removes someone's access at once. */
export async function removeFromShare(noteId: string, personId: string, token: string): Promise<void> {
  check(await supabase().rpc("share_remove", { note: noteId, person: personId }));
  await mutate(peopleKey(noteId), (list: SharePerson[] | undefined) => list?.filter((p) => p.user_id !== personId), { revalidate: true });
  await refresh(token);
}

const sharedWithMe = z.object({
  note_id: z.string(),
  title: z.string(),
  outcome: z.string().nullable(),
  token: z.string(),
  author: z.string().nullable(),
  added_at: z.string(),
  updated_at: z.string(),
  /** An invitation not answered yet (Accept / Decline). */
  pending: z.boolean().catch(false),
});
export type SharedWithMe = z.output<typeof sharedWithMe>;

/** Answers an invitation: accept keeps it in Shared with me; decline removes you from the note. */
export async function respondToShare(noteId: string, accept: boolean): Promise<void> {
  check(await supabase().rpc("share_respond", { note: noteId, accept }));
  await mutate(SHARED_WITH_ME_KEY);
}

/** Notes others shared with the signed-in user (they stay until the owner removes them or stops sharing). */
export function useSharedWithMe() {
  return useSWR(SHARED_WITH_ME_KEY, async () => z.array(sharedWithMe).parse(check(await supabase().rpc("shared_with_me"))), { revalidateOnFocus: true });
}
