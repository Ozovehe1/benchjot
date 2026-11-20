// Recently Deleted and pins against the real SQL (every migration applied to PGlite): a deleted
// note leaves search and links but still syncs, pinning or deleting keeps the edit time, and the
// daily job removes only notes deleted more than 30 days ago.
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb } from "./sql/pg";

const OWNER = "9f200000-0000-4000-8000-000000000001";
const A = "9f200000-0000-4000-8000-0000000000a1";
const B = "9f200000-0000-4000-8000-0000000000b1";

let db: PGlite;
beforeAll(async () => {
  db = await migratedDb();
}, 60_000);

/** OWNER's notes A (links to B, edited three hours ago) and B (five hours ago); rolled back after. */
async function inTx(fn: (tx: Transaction) => Promise<void>) {
  await db.transaction(async (tx) => {
    await tx.query("insert into auth.users (id) values ($1)", [OWNER]);
    await tx.query(
      `insert into public.notes (id, user_id, title, notes, updated_at, changed_at) values
        ($1, $3, 'Alpha', 'see [[Beta|${B}]]', now() - interval '3 hours', now() - interval '3 hours'),
        ($2, $3, 'Beta', 'beta body', now() - interval '5 hours', now() - interval '5 hours')`,
      [A, B, OWNER],
    );
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [OWNER]);
    await tx.exec("set local role authenticated");
    await fn(tx);
    await tx.rollback();
  });
}
const ids = async (tx: Transaction, sql: string) => (await tx.query<{ id: string }>(sql)).rows.map((r) => r.id);
const updated = async (tx: Transaction, id: string) => (await tx.query<{ old: boolean }>("select updated_at < now() - interval '1 hour' as old from public.notes where id = $1", [id])).rows[0]!.old;

describe("Recently Deleted", () => {
  it("takes a deleted note out of search and links, keeps its edit time, and still syncs it", async () => {
    await inTx(async (tx) => {
      await tx.query("update public.notes set deleted_at = now() where id = $1", [A]);
      expect(await ids(tx, "select id from public.search_notes()")).toEqual([B]);
      expect((await tx.query("select * from public.note_links()")).rows).toEqual([]);
      expect(await updated(tx, A)).toBe(true);
      const c = (await tx.query<{ c: { notes: { id: string; deleted_at: string | null }[] } }>("select public.sync_changes(now() - interval '1 hour') as c")).rows[0]!.c;
      expect(c.notes.map((n) => n.id)).toEqual([A]);
      expect(c.notes[0]!.deleted_at).not.toBeNull();
      // Restored: back in search, still not edited.
      await tx.query("update public.notes set deleted_at = null where id = $1", [A]);
      expect((await ids(tx, "select id from public.search_notes()")).sort()).toEqual([A, B].sort());
      expect(await updated(tx, A)).toBe(true);
    });
  });

  it("an edit still moves the edit time", async () => {
    await inTx(async (tx) => {
      await tx.query("update public.notes set title = 'Alpha 2' where id = $1", [A]);
      expect(await updated(tx, A)).toBe(false);
    });
  });

  it("empties only notes deleted more than 30 days ago", async () => {
    await inTx(async (tx) => {
      await tx.query("update public.notes set deleted_at = now() - interval '31 days' where id = $1", [A]);
      await tx.query("update public.notes set deleted_at = now() - interval '29 days' where id = $1", [B]);
      await tx.exec("reset role");
      expect((await tx.query<{ n: number }>("select private.empty_recently_deleted() as n")).rows[0]!.n).toBe(1);
      expect(await ids(tx, "select id from public.notes")).toEqual([B]);
      expect(await ids(tx, "select id from public.deleted_rows")).toEqual([A]);
    });
  });
});

describe("pins", () => {
  it("lists pinned notes first and keeps their edit time", async () => {
    await inTx(async (tx) => {
      await tx.query("update public.notes set pinned_at = now() where id = $1", [B]);
      expect(await ids(tx, "select id from public.search_notes()")).toEqual([B, A]);
      expect(await updated(tx, B)).toBe(true);
    });
  });
});

describe("the migration on existing notes", () => {
  it("keeps each note's edit time", async () => {
    // The database as it was before that migration: it and every later one left out.
    const { readdirSync } = await import("node:fs");
    const later = readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter((n) => n.endsWith(".sql") && n >= "20261120020000_recently_deleted_and_pins.sql");
    const fresh = await migratedDb(later);
    await fresh.query("insert into auth.users (id) values ($1)", [OWNER]);
    await fresh.query("insert into public.notes (id, user_id, updated_at) values ($1, $2, now() - interval '3 days')", [A, OWNER]);
    const { readFileSync } = await import("node:fs");
    await fresh.exec(readFileSync(new URL("../supabase/migrations/20261120020000_recently_deleted_and_pins.sql", import.meta.url), "utf8"));
    const r = (await fresh.query<{ same: boolean; old: boolean }>("select updated_at = changed_at as same, updated_at < now() - interval '2 days' as old from public.notes")).rows[0]!;
    expect(r).toEqual({ same: true, old: true });
  }, 60_000);
});
