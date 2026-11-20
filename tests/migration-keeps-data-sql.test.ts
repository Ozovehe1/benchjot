// Every new migration must leave existing notes and cells as they were: their text, outcome and
// edit times. The newest migration is applied to a database that already holds data, and nothing
// may move. (A migration that copied a column once re-stamped every note as edited "now".)
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { migratedDb } from "./sql/pg";

const MIGRATIONS = new URL("../supabase/migrations/", import.meta.url);
const newest = readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort().at(-1)!;
const USER = "9f300000-0000-4000-8000-000000000001";

const snapshot = async (db: Awaited<ReturnType<typeof migratedDb>>) => ({
  notes: (await db.query("select id, title, notes, outcome, created_at, updated_at from public.notes order by id")).rows,
  cells: (await db.query("select id, content, last_run, created_at, updated_at from public.cells order by id")).rows,
});

describe(`the newest migration (${newest})`, () => {
  it("leaves existing notes and cells as they were", async () => {
    const db = await migratedDb([newest]);
    await db.query("insert into auth.users (id) values ($1)", [USER]);
    await db.query(
      `insert into public.notes (id, user_id, title, notes, outcome, updated_at) values
        ('9f300000-0000-4000-8000-0000000000a1', $1, 'Old', 'body', 'success', now() - interval '40 days'),
        ('9f300000-0000-4000-8000-0000000000a2', $1, '', '', null, now() - interval '2 days')`,
      [USER],
    );
    await db.query("insert into public.cells (id, user_id, note_id, content, position, updated_at) values ('9f300000-0000-4000-8000-0000000000c1', $1, '9f300000-0000-4000-8000-0000000000a1', 'print(1)', 0, now() - interval '40 days')", [USER]);
    // The cell's insert touched its note; that's the data as it stands before the migration.
    const before = await snapshot(db);
    await db.exec(readFileSync(new URL(newest, MIGRATIONS), "utf8"));
    expect(await snapshot(db)).toEqual(before);
  }, 60_000);
});
