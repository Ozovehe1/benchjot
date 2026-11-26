// Search by meaning (supabase/migrations/20261120030000_note_embeddings.sql), on a real Postgres
// with pgvector: each user's embeddings are theirs alone, a note edited after its embedding is due
// again, and matches come closest first, never from Recently Deleted or the note asked about.
import { describe, expect, it } from "vitest";
import { migratedDb } from "./sql/pg";

const ME = "9f400000-0000-4000-8000-000000000001";
const OTHER = "9f400000-0000-4000-8000-000000000002";
const note = (n: number) => `9f400000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
/** A unit vector of 384 numbers pointing mostly along `axis`, tilted by `tilt` toward axis 1. */
const vec = (axis: number, tilt = 0) => {
  const v = Array.from({ length: 384 }, (_, i) => (i === axis ? 1 : i === 1 ? tilt : 0));
  const len = Math.hypot(...v);
  return `[${v.map((x) => x / len).join(",")}]`;
};

type Db = Awaited<ReturnType<typeof migratedDb>>;
async function as<T>(db: Db, user: string, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
    await tx.exec("set local role authenticated");
    return (await tx.query<T>(sql, params)).rows;
  });
}

async function seeded(): Promise<Db> {
  const db = await migratedDb();
  await db.query("insert into auth.users (id) values ($1), ($2)", [ME, OTHER]);
  for (const [n, user, title] of [[1, ME, "Grain growth"], [2, ME, "Annealing"], [3, ME, "Dropout"], [4, ME, "Deleted one"], [5, OTHER, "Theirs"]] as const)
    await db.query("insert into public.notes (id, user_id, title, updated_at) values ($1, $2, $3, now() - interval '1 day')", [note(n), user, title]);
  await db.query("update public.notes set deleted_at = now() where id = $1", [note(4)]);
  return db;
}

describe("note embeddings", () => {
  it("each user reads, writes and matches only their own", async () => {
    const db = await seeded();
    await as(db, ME, "insert into public.note_embeddings (note_id, embedding, source_hash) values ($1, $2, 'h1')", [note(1), vec(0)]);
    await as(db, OTHER, "insert into public.note_embeddings (note_id, embedding, source_hash) values ($1, $2, 'h5')", [note(5), vec(0)]);
    // Not their note: refused.
    await expect(as(db, OTHER, "insert into public.note_embeddings (note_id, embedding, source_hash) values ($1, $2, 'x')", [note(2), vec(0)])).rejects.toThrow();
    expect(await as(db, OTHER, "select note_id from public.note_embeddings")).toEqual([{ note_id: note(5) }]);
    expect((await as<{ id: string }>(db, OTHER, "select id from public.match_notes($1, 10)", [vec(0)])).map((r) => r.id)).toEqual([note(5)]);
  }, 60_000);

  it("the notes due: never embedded, or edited since; never Recently Deleted", async () => {
    const db = await seeded();
    await as(db, ME, "insert into public.note_embeddings (note_id, embedding, source_hash) values ($1, $2, 'h1'), ($3, $2, 'h2')", [note(1), vec(0), note(2)]);
    expect((await as<{ id: string }>(db, ME, "select id from public.stale_note_embeddings(10)")).map((r) => r.id)).toEqual([note(3)]);
    await db.query("update public.notes set title = 'Grain growth 2' where id = $1", [note(1)]);
    const due = await as<{ id: string; embedded_hash: string | null }>(db, ME, "select * from public.stale_note_embeddings(10)");
    expect(due).toEqual([{ id: note(1), embedded_hash: "h1" }, { id: note(3), embedded_hash: null }]);
  }, 60_000);

  it("matches come closest first, above the threshold, without the note asked about or deleted ones", async () => {
    const db = await seeded();
    await as(db, ME, "insert into public.note_embeddings (note_id, embedding, source_hash) values ($1, $2, 'a'), ($3, $4, 'b'), ($5, $6, 'c'), ($7, $8, 'd')", [note(1), vec(0), note(2), vec(0, 0.5), note(3), vec(2), note(4), vec(0)]);
    const all = await as<{ id: string; similarity: number }>(db, ME, "select * from public.match_notes($1, 10)", [vec(0, 0.1)]);
    expect(all.map((r) => r.id)).toEqual([note(1), note(2), note(3)]);
    expect(all[0]!.similarity).toBeGreaterThan(all[1]!.similarity);
    expect((await as<{ id: string }>(db, ME, "select id from public.match_notes($1, 10, null, 0.5)", [vec(0)])).map((r) => r.id)).toEqual([note(1), note(2)]);
    expect((await as<{ id: string }>(db, ME, "select id from public.similar_notes($1, 10)", [note(1)])).map((r) => r.id)).toEqual([note(2), note(3)]);
  }, 60_000);

  it("a note's embedding goes when the note is deleted for good", async () => {
    const db = await seeded();
    await as(db, ME, "insert into public.note_embeddings (note_id, embedding, source_hash) values ($1, $2, 'a')", [note(1), vec(0)]);
    await db.query("delete from public.notes where id = $1", [note(1)]);
    expect((await db.query("select count(*)::int as n from public.note_embeddings")).rows).toEqual([{ n: 0 }]);
  }, 60_000);
});
