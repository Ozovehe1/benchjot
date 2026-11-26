// Sharing a note with a link, against the real SQL (every migration applied to PGlite): only the
// owner makes and changes a link and never picks its token; the page reads only through the token;
// the storage rule opens only the shared note's current files, and only with the token in the
// request's header; code hidden stays hidden; New link, the end date and Stop sharing close it;
// copying follows the owner's choice and lands in the copier's account.
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb } from "./sql/pg";

const A = "9f200000-0000-4000-8000-0000000000a1";
const B = "9f200000-0000-4000-8000-0000000000b1";
const NOTE = "9f200000-0000-4000-8000-0000000000e1";
const LINKED = "9f200000-0000-4000-8000-0000000000e2";
const CELL = "9f200000-0000-4000-8000-0000000000c1";
const RUN = "9f200000-0000-4000-8000-0000000000d1";
const OLD_RUN = "9f200000-0000-4000-8000-0000000000d0";

let db: PGlite;
beforeAll(async () => {
  db = await migratedDb();
  // pg.ts grants every table to authenticated after the migrations; put note_shares back as the migration leaves it.
  await db.exec(`
    revoke all on public.note_shares from anon, authenticated;
    grant select, delete on public.note_shares to authenticated;
    grant insert (note_id, user_id, show_code, allow_copy, indexable, expires_at, access) on public.note_shares to authenticated;
    grant update (show_code, allow_copy, indexable, expires_at, access) on public.note_shares to authenticated;
    revoke all on public.note_share_people from anon, authenticated;
    grant select on public.note_share_people to authenticated;
    grant usage on schema storage to anon, authenticated; grant select on storage.objects to anon, authenticated;`);
}, 60_000);

async function as(tx: Transaction, user: string | null, headers?: Record<string, string>) {
  await tx.exec("reset role");
  await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [user ?? ""]);
  await tx.query("select set_config('request.headers', $1, true)", [headers ? JSON.stringify(headers) : ""]);
  await tx.exec(`set local role ${user ? "authenticated" : "anon"}`);
}

/** A's note (linking a second note) with one cell whose current run made one file, plus an old run's file and B's file; rolled back after. */
async function inTx(fn: (tx: Transaction) => Promise<void>) {
  await db.transaction(async (tx) => {
    await tx.query("insert into auth.users (id) values ($1), ($2)", [A, B]);
    await tx.query("insert into public.profiles (user_id, username) values ($1, 'ada') on conflict (user_id) do update set username = 'ada'", [A]);
    await tx.query("insert into public.notes (id, user_id, title, notes, outcome) values ($1, $3, 'Do 4 layers beat 2?', $4, 'success'), ($2, $3, 'Other', '', null)", [NOTE, LINKED, A, `See [[Other|${LINKED}]] and [[Private]].`]);
    await tx.query("insert into public.cells (id, user_id, note_id, content, position, last_run, note_before) values ($1, $2, $3, 'print(1)', 0, $4, 'Expect 1')", [
      CELL,
      A,
      NOTE,
      JSON.stringify({ outcome: "ok", stdout: "1\n", outputs: { dir: `${A}/${CELL}/${RUN}`, items: [], notes: [] } }),
    ]);
    await tx.query("insert into storage.objects (bucket_id, name) values ('run-outputs', $1), ('run-outputs', $2), ('run-outputs', $3)", [`${A}/${CELL}/${RUN}/0.png`, `${A}/${CELL}/${OLD_RUN}/0.png`, `${B}/x/y/0.png`]);
    await fn(tx);
    await tx.rollback();
  });
}

/** A statement that must be refused; kept inside a savepoint so the test's transaction goes on. */
async function refused(tx: Transaction, sql: string, params: unknown[], why: RegExp) {
  await tx.exec("savepoint refused");
  let error: unknown = null;
  try {
    await tx.query(sql, params);
  } catch (e) {
    error = e;
  }
  await tx.exec("rollback to savepoint refused");
  expect(String((error as Error | null)?.message ?? "no error")).toMatch(why);
}

/** A shares a note; anyone-with-the-link unless `access` says only invited people. */
async function share(tx: Transaction, note = NOTE, access: "link" | "people" = "link"): Promise<string> {
  await as(tx, A);
  const { rows } = await tx.query<{ token: string }>("insert into public.note_shares (note_id, user_id, access) values ($1, $2, $3) returning token", [note, A, access]);
  return rows[0]!.token;
}

async function page(tx: Transaction, token: string, seen = false, who: string | null = null) {
  await as(tx, who);
  const { rows } = await tx.query<{ p: Record<string, unknown> | null }>("select public.shared_note($1, $2) as p", [token, seen]);
  return rows[0]!.p as null | { author: string; allow_copy: boolean; note: { title: string }; cells: { content: string; note_before: string }[]; links: Record<string, string> };
}

async function files(tx: Transaction, token: string | null, who: string | null = null) {
  await as(tx, who, token ? { "x-bj-share": token } : undefined);
  // Only A's files: a signed-in B also sees their own folder, as always.
  return (await tx.query<{ name: string }>("select name from storage.objects where name like $1 order by name", [`${A}/%`])).rows.map((r) => r.name);
}

describe("sharing a note with a link", () => {
  it("only the owner makes a link; the database makes its token (22 URL-safe characters, never the client's)", async () => {
    await inTx(async (tx) => {
      const token = await share(tx);
      expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
      await as(tx, A);
      await refused(tx, "update public.note_shares set token = 'chosen-by-the-client-x' where note_id = $1", [NOTE], /permission denied/);
    });
    await inTx(async (tx) => {
      await as(tx, B);
      await refused(tx, "insert into public.note_shares (note_id, user_id) values ($1, $2)", [NOTE, B], /./);
    });
  });

  it("the page reads the note through its token only; nobody reads the links table", async () => {
    await inTx(async (tx) => {
      const token = await share(tx);
      const linked = await share(tx, LINKED);
      const p = await page(tx, token);
      expect(p?.note.title).toBe("Do 4 layers beat 2?");
      expect(p?.author).toBe("ada");
      expect(p?.cells[0]).toMatchObject({ content: "print(1)", note_before: "Expect 1" });
      expect(p?.links).toEqual({ [LINKED]: linked }); // a linked note that's shared too opens as shared
      expect(await page(tx, "nope-nope-nope-nope-no")).toBeNull();
      await as(tx, null);
      await refused(tx, "select * from public.note_shares", [], /permission denied/);
      await as(tx, B);
      expect((await tx.query("select * from public.note_shares")).rows).toEqual([]);
    });
  });

  it("files: with the token, only the shared note's current run; without it or with another, nothing", async () => {
    await inTx(async (tx) => {
      const token = await share(tx);
      expect(await files(tx, token)).toEqual([`${A}/${CELL}/${RUN}/0.png`]);
      expect(await files(tx, null)).toEqual([]);
      expect(await files(tx, "wrong-token-wrong-tok0")).toEqual([]);
    });
  });

  it("results only: the code is left out and the note can't be copied", async () => {
    await inTx(async (tx) => {
      const token = await share(tx);
      await as(tx, A);
      await tx.query("update public.note_shares set show_code = false where note_id = $1", [NOTE]);
      const p = await page(tx, token);
      expect(p?.cells[0]?.content).toBe("");
      expect(p?.allow_copy).toBe(false);
      await as(tx, B);
      await refused(tx, "select public.copy_shared_note($1)", [token], /can't be copied/);
    });
  });

  it("New link, the end date and Stop sharing each close the link (and its files)", async () => {
    await inTx(async (tx) => {
      const token = await share(tx);
      await as(tx, B);
      await refused(tx, "select public.share_reset($1)", [NOTE], /isn't shared/);
      await as(tx, A);
      const fresh = (await tx.query<{ t: string }>("select public.share_reset($1) as t", [NOTE])).rows[0]!.t;
      expect(fresh).not.toBe(token);
      expect(await page(tx, token)).toBeNull();
      expect(await files(tx, token)).toEqual([]);
      await as(tx, A);
      await tx.query("update public.note_shares set expires_at = now() - interval '1 minute' where note_id = $1", [NOTE]);
      expect(await page(tx, fresh)).toBeNull();
      expect(await files(tx, fresh)).toEqual([]);
      await as(tx, A);
      await tx.query("delete from public.note_shares where note_id = $1", [NOTE]);
      expect(await page(tx, fresh)).toBeNull();
    });
  });

  it("views count only when asked; deleting the note deletes its link", async () => {
    await inTx(async (tx) => {
      const token = await share(tx);
      await page(tx, token, false);
      await page(tx, token, true);
      await page(tx, token, true);
      await tx.exec("reset role");
      expect((await tx.query<{ views: number }>("select views from public.note_shares where note_id = $1", [NOTE])).rows[0]!.views).toBe(2);
      await tx.query("delete from public.notes where id = $1", [NOTE]);
      expect((await tx.query("select 1 from public.note_shares where note_id = $1", [NOTE])).rows).toEqual([]);
    });
  });

  it("a signed-in reader copies it into their own account: text with where it came from, cells without the owner's files", async () => {
    await inTx(async (tx) => {
      const token = await share(tx);
      await as(tx, null);
      await refused(tx, "select public.copy_shared_note($1)", [token], /permission denied/);
      await as(tx, B);
      const made = (await tx.query<{ c: { id: string; cells: { id: string; outputs: { dir: string } }[] } }>("select public.copy_shared_note($1) as c", [token])).rows[0]!.c;
      expect(made.cells[0]!.outputs.dir).toBe(`${A}/${CELL}/${RUN}`); // for the app to copy the files over
      await tx.exec("reset role");
      const note = (await tx.query<{ user_id: string; notes: string }>("select user_id, notes from public.notes where id = $1", [made.id])).rows[0]!;
      expect(note.user_id).toBe(B);
      expect(note.notes).toMatch(/^> Copied from a note by @ada shared on Benchjot/);
      expect(note.notes).toContain("See Other and Private."); // links to the owner's notes become their titles
      const cell = (await tx.query<{ user_id: string; content: string; last_run: Record<string, unknown> }>("select user_id, content, last_run from public.cells where note_id = $1", [made.id])).rows[0]!;
      expect(cell).toMatchObject({ user_id: B, content: "print(1)" });
      expect(cell.last_run).not.toHaveProperty("outputs");
    });
  });

  it("a new link is for invited people only; others (signed out or not invited) are told it's restricted, and get no files", async () => {
    await inTx(async (tx) => {
      await as(tx, A);
      const token = (await tx.query<{ token: string; access: string }>("insert into public.note_shares (note_id, user_id) values ($1, $2) returning token, access", [NOTE, A])).rows[0]!;
      expect(token.access).toBe("people");
      expect(await page(tx, token.token)).toEqual({ restricted: true });
      expect(await page(tx, token.token, false, B)).toEqual({ restricted: true });
      expect(await files(tx, token.token)).toEqual([]);
      expect(await files(tx, token.token, B)).toEqual([]);
      expect((await page(tx, token.token, false, A))?.note.title).toBe("Do 4 layers beat 2?"); // the owner can always open it
    });
  });

  it("an invited person opens it, keeps it in Shared with me, and loses it the moment they're removed or sharing stops", async () => {
    await inTx(async (tx) => {
      const token = await share(tx, NOTE, "people");
      await as(tx, B);
      await refused(tx, "select public.share_invite($1, 'ada')", [NOTE], /isn't shared/); // only the owner invites
      await as(tx, A);
      await refused(tx, "select public.share_invite($1, 'nobody-here')", [NOTE], /No one has that username/);
      await refused(tx, "select public.share_invite($1, '@ada')", [NOTE], /That’s you/);
      await tx.exec("reset role");
      await tx.query("insert into public.profiles (user_id, username) values ($1, 'bea') on conflict (user_id) do update set username = 'bea'", [B]);
      await as(tx, A);
      expect((await tx.query<{ r: { username: string } }>("select public.share_invite($1, '@Bea') as r", [NOTE])).rows[0]!.r.username).toBe("bea");
      expect((await tx.query<{ r: { username: string }[] }>("select public.share_people($1) as r", [NOTE])).rows[0]!.r.map((p) => p.username)).toEqual(["bea"]);
      expect((await page(tx, token, false, B))?.note.title).toBe("Do 4 layers beat 2?");
      expect(await files(tx, token, B)).toEqual([`${A}/${CELL}/${RUN}/0.png`]);
      await as(tx, B);
      const mine = (await tx.query<{ r: { title: string; author: string; token: string }[] }>("select public.shared_with_me() as r")).rows[0]!.r;
      expect(mine).toEqual([expect.objectContaining({ title: "Do 4 layers beat 2?", author: "ada", token })]);
      await refused(tx, "delete from public.note_share_people", [], /permission denied/); // a person can't change who has access
      await as(tx, A);
      await tx.query("select public.share_remove($1, $2)", [NOTE, B]);
      expect(await page(tx, token, false, B)).toEqual({ restricted: true });
      expect(await files(tx, token, B)).toEqual([]);
      await as(tx, B);
      expect((await tx.query<{ r: unknown[] }>("select public.shared_with_me() as r")).rows[0]!.r).toEqual([]);
    });
  });

  it("a signed-in reader who opens a link keeps the note in Shared with me while the link is open to anyone; the owner's lock still decides", async () => {
    await inTx(async (tx) => {
      const token = await share(tx);
      await page(tx, token, true, B); // B opens the link, signed in
      await as(tx, B);
      expect((await tx.query<{ r: { token: string }[] }>("select public.shared_with_me() as r")).rows[0]!.r.map((n) => n.token)).toEqual([token]);
      await as(tx, A);
      expect((await tx.query<{ r: unknown[] }>("select public.share_people($1) as r", [NOTE])).rows[0]!.r).toEqual([]); // not listed as invited
      await tx.query("update public.note_shares set access = 'people' where note_id = $1", [NOTE]);
      expect(await page(tx, token, false, B)).toEqual({ restricted: true }); // opening the link gave no lasting access
      await as(tx, B);
      expect((await tx.query<{ r: unknown[] }>("select public.shared_with_me() as r")).rows[0]!.r).toEqual([]);
    });
  });

  it("an invitation waits for an answer: Accept keeps it in Shared with me, Decline removes the person", async () => {
    await inTx(async (tx) => {
      const token = await share(tx, NOTE, "people");
      await tx.exec("reset role");
      await tx.query("insert into public.profiles (user_id, username) values ($1, 'bea') on conflict (user_id) do update set username = 'bea'", [B]);
      await as(tx, A);
      await tx.query("select public.share_invite($1, 'bea')", [NOTE]);
      expect((await tx.query<{ r: { accepted: boolean }[] }>("select public.share_people($1) as r", [NOTE])).rows[0]!.r).toEqual([expect.objectContaining({ accepted: false })]);
      await as(tx, B);
      const mine = async () => (await tx.query<{ r: { pending: boolean }[] }>("select public.shared_with_me() as r")).rows[0]!.r;
      expect(await mine()).toEqual([expect.objectContaining({ pending: true })]);
      expect((await page(tx, token, false, B))?.note.title).toBe("Do 4 layers beat 2?"); // they can look before deciding
      await as(tx, B);
      await tx.query("select public.share_respond($1, true)", [NOTE]);
      expect(await mine()).toEqual([expect.objectContaining({ pending: false })]);
      await tx.query("select public.share_respond($1, false)", [NOTE]);
      expect(await mine()).toEqual([]);
      expect(await page(tx, token, false, B)).toEqual({ restricted: true });
      await as(tx, A);
      expect((await tx.query<{ r: unknown[] }>("select public.share_people($1) as r", [NOTE])).rows[0]!.r).toEqual([]);
    });
  });

  it("browser notifications are gone; the invited person still finds the invitation (what the Android app alerts for)", async () => {
    await inTx(async (tx) => {
      await tx.exec("reset role");
      const gone = (await tx.query<{ n: number }>("select (select count(*) from pg_proc where proname in ('share_notice', 'push_gone'))::int + (select count(*) from pg_class where relname = 'push_subscriptions')::int as n")).rows[0]!.n;
      expect(gone).toBe(0);
      await tx.query("insert into public.profiles (user_id, username) values ($1, 'bea') on conflict (user_id) do update set username = 'bea'", [B]);
      await share(tx, NOTE, "people");
      await tx.query("select public.share_invite($1, 'bea')", [NOTE]);
      await as(tx, B);
      const mine = (await tx.query<{ r: { pending?: boolean; title?: string }[] }>("select public.shared_with_me() as r")).rows[0]!.r;
      expect(mine).toEqual([expect.objectContaining({ pending: true, title: "Do 4 layers beat 2?" })]);
    });
  });
});
