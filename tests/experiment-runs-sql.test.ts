// Experiment tracking's table (supabase/migrations/20261126010000_experiment_runs.sql) against the
// real SQL: owner-only, history that can't be edited, the owner's own note and cell only, and each
// cell keeps its newest 500 runs.
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb } from "./sql/pg";

let db: PGlite;
beforeAll(async () => {
  db = await migratedDb();
}, 60_000);

const ME = "9f000000-0000-4000-8000-0000000000e1";
const YOU = "9f000000-0000-4000-8000-0000000000e2";
const NOTE = "9f000000-0000-4000-8000-0000000000e3";
const CELL = "9f000000-0000-4000-8000-0000000000e4";
const YOUR_NOTE = "9f000000-0000-4000-8000-0000000000e5";
const YOUR_CELL = "9f000000-0000-4000-8000-0000000000e6";

async function as(tx: Transaction, user: string, sql: string, args: unknown[] = []) {
  await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
  await tx.exec("set local role authenticated");
  const r = await tx.query(sql, args);
  await tx.exec("reset role");
  return r;
}

async function setup(tx: Transaction) {
  await tx.query("insert into auth.users (id) values ($1), ($2)", [ME, YOU]);
  await tx.query("insert into public.notes (id, user_id, notes) values ($1, $2, ''), ($3, $4, '')", [NOTE, ME, YOUR_NOTE, YOU]);
  await tx.query("insert into public.cells (id, note_id, user_id, language, content, position) values ($1, $2, $3, 'python', 'log(a=1)', 0), ($4, $5, $6, 'python', 'x', 0)", [CELL, NOTE, ME, YOUR_CELL, YOUR_NOTE, YOU]);
}
const ADD = `insert into public.experiment_runs (note_id, cell_id, outcome, ms, "where", code_hash, logged, ran_at) values ($1, $2, 'ok', 120, 'browser', 'abc', $3::jsonb, $4)`;

describe("experiment runs", () => {
  it("only the owner adds and sees runs, on their own note and cell", async () => {
    await db.transaction(async (tx) => {
      await setup(tx);
      await as(tx, ME, ADD, [NOTE, CELL, '{"accuracy": 0.96, "lr": 0.01}', new Date().toISOString()]);
      const mine = await as(tx, ME, "select logged, user_id from public.experiment_runs");
      expect(mine.rows).toEqual([{ logged: { accuracy: 0.96, lr: 0.01 }, user_id: ME }]);
      expect((await as(tx, YOU, "select 1 from public.experiment_runs")).rows).toHaveLength(0);
      await tx.exec("savepoint s");
      await expect(as(tx, YOU, ADD, [NOTE, CELL, '{"a": 1}', new Date().toISOString()])).rejects.toThrow(); // not their note
      await tx.exec("rollback to savepoint s");
      await expect(as(tx, ME, ADD, [YOUR_NOTE, YOUR_CELL, '{"a": 1}', new Date().toISOString()])).rejects.toThrow(); // someone else's note
      await tx.exec("rollback to savepoint s");
      await tx.rollback();
    });
  });
  it("is history: no edits, no empty or oversized logs", async () => {
    await db.transaction(async (tx) => {
      await setup(tx);
      await as(tx, ME, ADD, [NOTE, CELL, '{"a": 1}', new Date().toISOString()]);
      await tx.exec("savepoint s");
      await as(tx, ME, "update public.experiment_runs set logged = '{\"a\": 2}'").catch(() => tx.exec("rollback to savepoint s")); // refused, or changes nothing
      expect((await as(tx, ME, "select logged from public.experiment_runs")).rows).toEqual([{ logged: { a: 1 } }]);
      await tx.exec("savepoint s");
      await expect(as(tx, ME, ADD, [NOTE, CELL, "{}", new Date().toISOString()])).rejects.toThrow(/check/);
      await tx.exec("rollback to savepoint s");
      await expect(as(tx, ME, ADD, [NOTE, CELL, JSON.stringify({ big: "x".repeat(17_000) }), new Date().toISOString()])).rejects.toThrow(/check/);
      await tx.exec("rollback to savepoint s");
      await tx.rollback();
    });
  });
  it("goes with its cell, and a cell keeps its newest 500", async () => {
    await db.transaction(async (tx) => {
      await setup(tx);
      const t0 = Date.parse("2026-11-01T00:00:00Z");
      for (let i = 0; i < 503; i++) await as(tx, ME, ADD, [NOTE, CELL, JSON.stringify({ i }), new Date(t0 + i * 1000).toISOString()]);
      const kept = await as(tx, ME, "select min((logged->>'i')::int) as lo, count(*)::int as n from public.experiment_runs");
      expect(kept.rows[0]).toEqual({ lo: 3, n: 500 });
      await tx.query("delete from public.cells where id = $1", [CELL]);
      expect((await as(tx, ME, "select 1 from public.experiment_runs")).rows).toHaveLength(0);
      await tx.rollback();
    });
  }, 60_000);
});
