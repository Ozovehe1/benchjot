// Usage counts and the connection gate against the real SQL (every migration applied to PGlite).
// See supabase/migrations/20261118090000_usage.sql.
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb } from "./sql/pg";

let db: PGlite;
beforeAll(async () => {
  db = await migratedDb();
}, 60_000);

const ME = "9f000000-0000-4000-8000-000000000001";
const YOU = "9f000000-0000-4000-8000-000000000002";
const SEALED = "enc:v1:" + "n".repeat(16) + "." + "c".repeat(90);

async function as<T>(tx: Transaction, user: string, sql: string, args: unknown[] = []): Promise<T> {
  await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
  await tx.exec("set local role authenticated");
  const { rows } = await tx.query<{ r: T }>(sql, args);
  await tx.exec("reset role");
  return rows[0]!.r;
}
const users = async (tx: Transaction) => {
  await tx.query("insert into auth.users (id) values ($1), ($2)", [ME, YOU]);
  await tx.query("insert into public.profiles (user_id, username) values ($1, 'meuser'), ($2, 'youuser') on conflict (user_id) do update set username = excluded.username", [ME, YOU]);
};

describe("usage", () => {
  it("a user sees their own counts: AI on their connection, server runs, whether AI is connected", async () => {
    await db.transaction(async (tx) => {
      await users(tx);
      await as(tx, ME, "select public.ai_own_used() as r");
      await as(tx, ME, "select public.ai_own_used() as r");
      await as(tx, ME, "select public.run_take(5) as r");
      await as(tx, YOU, "select public.ai_own_used() as r");
      expect(await as(tx, ME, "select public.my_usage() as r")).toMatchObject({ ai_own_24h: 2, ai_own_30d: 2, server_runs_24h: 1, ai_connected: false });
      expect(await as(tx, YOU, "select public.my_usage() as r")).toMatchObject({ ai_own_24h: 1 });
      await tx.rollback();
    });
  });

  it("nobody sees another account's numbers: the tables and the per-account function are closed", async () => {
    await db.transaction(async (tx) => {
      await users(tx);
      await as(tx, YOU, "select public.ai_own_used() as r");
      expect(await as(tx, ME, "select public.my_usage() as r")).toMatchObject({ ai_own_24h: 0 });
      for (const sql of ["select private.usage_of('" + YOU + "')", "select * from private.ai_own_calls"]) {
        await tx.exec("savepoint s");
        await tx.exec("set local role authenticated");
        await expect(tx.query(sql)).rejects.toThrow(/permission denied/);
        await tx.exec("rollback to savepoint s");
      }
      await tx.exec("set local role anon");
      await expect(tx.query("select public.my_usage()")).rejects.toThrow(/permission denied/);
      await tx.rollback();
    });
  });
});

describe("connection gate", () => {
  it("AI is required once somebody has connected it, for everyone who hasn't", async () => {
    await db.transaction(async (tx) => {
      await users(tx);
      expect(await as(tx, YOU, "select public.connection_gate() as r")).toEqual({ ai_connected: false, ai_required: false });
      await as(tx, ME, "select public.set_ai_key('openrouter', $1, $2) as r", [SEALED, "ab".repeat(32)]);
      expect(await as(tx, YOU, "select public.connection_gate() as r")).toEqual({ ai_connected: false, ai_required: true });
      expect(await as(tx, ME, "select public.connection_gate() as r")).toMatchObject({ ai_connected: true, ai_required: true });
      await tx.rollback();
    });
  });
});
