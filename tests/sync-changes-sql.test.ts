// sync_changes against the real SQL (every migration applied to PGlite): a device asks only for what
// changed since it last asked, deletions included, for its own account only.
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb } from "./sql/pg";

const OWNER = "9f100000-0000-4000-8000-000000000001";
const OTHER = "9f100000-0000-4000-8000-000000000002";
const OLD = "9f100000-0000-4000-8000-0000000000e1";
const EDITED = "9f100000-0000-4000-8000-0000000000e2";
const THEIRS = "9f100000-0000-4000-8000-0000000000e3";
const CELL = "9f100000-0000-4000-8000-0000000000c1";

let db: PGlite;
beforeAll(async () => {
  db = await migratedDb();
}, 60_000);

type Changes = { at: string; complete: boolean; notes: { id: string; title: string }[]; cells: { id: string }[]; deleted: { kind: string; id: string }[] };

/** OWNER's two notes (one with a cell) and OTHER's one, all last edited three hours ago; rolled back after. */
async function inTx(fn: (tx: Transaction) => Promise<void>) {
  await db.transaction(async (tx) => {
    await tx.query("insert into auth.users (id) values ($1), ($2)", [OWNER, OTHER]);
    await tx.query(
      `insert into public.notes (id, user_id, notes, updated_at, changed_at) values ($1, $3, '', now() - interval '3 hours', now() - interval '3 hours'), ($2, $3, '', now() - interval '3 hours', now() - interval '3 hours'), ($4, $5, '', now() - interval '3 hours', now() - interval '3 hours')`,
      [OLD, EDITED, OWNER, THEIRS, OTHER],
    );
    await tx.query("insert into public.cells (id, user_id, note_id, content, position, updated_at) values ($1, $2, $3, 'print(1)', 0, now() - interval '3 hours')", [CELL, OWNER, OLD]);
    // The cell's insert touched its note; put the note back three hours ago.
    await tx.query("alter table public.notes disable trigger notes_touch");
    await tx.query("update public.notes set updated_at = now() - interval '3 hours', changed_at = now() - interval '3 hours' where id = $1", [OLD]);
    await tx.query("alter table public.notes enable trigger notes_touch");
    await fn(tx);
    await tx.rollback();
  });
}
async function as(tx: Transaction, user: string) {
  await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
  await tx.exec("set local role authenticated");
}
const changes = async (tx: Transaction, since: string) => (await tx.query<{ c: Changes }>(`select public.sync_changes(${since}) as c`)).rows[0]!.c;

describe("sync_changes", () => {
  it("returns only what the caller changed since then", async () => {
    await inTx(async (tx) => {
      await as(tx, OWNER);
      await tx.query("update public.notes set title = 'Edited' where id = $1", [EDITED]);
      const c = await changes(tx, "now() - interval '1 hour'");
      expect(c.complete).toBe(true);
      expect(c.notes.map((e) => [e.id, e.title])).toEqual([[EDITED, "Edited"]]);
      expect(c.cells).toEqual([]);
      expect(c.deleted).toEqual([]);
      // Everything since before the notes were made: the caller's own rows, never another account's.
      const all = await changes(tx, "now() - interval '1 day'");
      expect(all.notes.map((e) => e.id).sort()).toEqual([OLD, EDITED].sort());
      expect(all.cells.map((s) => s.id)).toEqual([CELL]);
    });
  });

  it("lists deletions, a note's cells with it, to its owner only", async () => {
    await inTx(async (tx) => {
      await as(tx, OWNER);
      await tx.query("delete from public.notes where id = $1", [OLD]);
      const c = await changes(tx, "now() - interval '1 hour'");
      expect(c.deleted).toEqual(expect.arrayContaining([{ kind: "note", id: OLD }, { kind: "cell", id: CELL }]));
      expect(c.notes.map((e) => e.id)).not.toContain(OLD);
      await as(tx, OTHER);
      expect((await changes(tx, "now() - interval '1 hour'")).deleted).toEqual([]);
    });
  });

  it("says when the device has been away longer than deletions are kept", async () => {
    await inTx(async (tx) => {
      await as(tx, OWNER);
      expect((await changes(tx, "now() - interval '120 days'")).complete).toBe(false);
    });
  });

  it("nobody writes deletion records by hand", async () => {
    await inTx(async (tx) => {
      await as(tx, OWNER);
      await tx.exec("savepoint try");
      await expect(tx.query("insert into public.deleted_rows (user_id, kind, id) values ($1, 'note', $2)", [OWNER, THEIRS])).rejects.toThrow();
      await tx.exec("rollback to savepoint try");
    });
  });

  it("deleting an account removes its rows and leaves no deletion records", async () => {
    await inTx(async (tx) => {
      await tx.query("delete from auth.users where id = $1", [OWNER]);
      expect((await tx.query("select 1 from public.deleted_rows where user_id = $1", [OWNER])).rows).toEqual([]);
      expect((await tx.query("select 1 from public.notes where user_id = $1", [OWNER])).rows).toEqual([]);
    });
  });
});

describe("touch_updated_at", () => {
  it("has a fixed search path and still stamps edits", async () => {
    const cfg = await db.query<{ cfg: string[] | null }>("select proconfig as cfg from pg_proc where proname = 'touch_updated_at'");
    expect(cfg.rows[0]!.cfg).toEqual(['search_path=""']);
    await inTx(async (tx) => {
      await tx.query("update public.notes set title = 'x' where id = $1", [OLD]);
      const { rows } = await tx.query<{ fresh: boolean }>("select updated_at > now() - interval '1 minute' as fresh from public.notes where id = $1", [OLD]);
      expect(rows[0]!.fresh).toBe(true);
    });
  });
});
