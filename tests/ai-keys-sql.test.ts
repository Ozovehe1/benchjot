// Connected AI keys against the real SQL (every migration applied to PGlite): saved sealed, only on
// your own row; the status never shows the key; reading it notes when it was last used; nobody else
// reads it; an unsealed key is refused. See supabase/migrations/20261118080000_connected_keys.sql.
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
const HASH = "ab".repeat(32);

async function as<T>(tx: Transaction, user: string, sql: string, args: unknown[] = []): Promise<T> {
  await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
  await tx.exec("set local role authenticated");
  const { rows } = await tx.query<{ r: T }>(sql, args);
  await tx.exec("reset role");
  return rows[0]!.r;
}

describe("connected AI keys", () => {
  it("saves the sealed key, shows only its handle and dates, notes its use, and removes", async () => {
    await db.transaction(async (tx) => {
      await tx.query("insert into auth.users (id) values ($1), ($2)", [ME, YOU]);
      expect(await as(tx, ME, "select public.ai_key_status() as r")).toEqual({});
      await as(tx, ME, "select public.set_ai_key('openrouter', $1, $2) as r", [SEALED, HASH]);
      const before = await as<Record<string, unknown>>(tx, ME, "select public.ai_key_status() as r");
      expect(before).toMatchObject({ provider: "openrouter", key_hash: HASH, used_at: null });
      expect(JSON.stringify(before)).not.toContain("enc:v1");
      expect(await as(tx, ME, "select public.ai_key() as r")).toEqual({ provider: "openrouter", key: SEALED });
      expect((await as<{ used_at: string | null }>(tx, ME, "select public.ai_key_status() as r")).used_at).not.toBeNull();
      expect(await as(tx, YOU, "select public.ai_key() as r")).toEqual({}); // someone else's key is never read
      await as(tx, ME, "select public.set_ai_key('openrouter', '', '') as r");
      expect(await as(tx, ME, "select public.ai_key() as r")).toEqual({});
      await tx.rollback();
    });
  });

  it("refuses a key that isn't sealed or another provider; the table and functions are closed to anon", async () => {
    await db.transaction(async (tx) => {
      await tx.query("insert into auth.users (id) values ($1)", [ME]);
      for (const [provider, key] of [["openrouter", "sk-or-v1-in-the-clear-0123456789"], ["other", SEALED]] as const) {
        await tx.exec("savepoint s");
        await expect(as(tx, ME, "select public.set_ai_key($1, $2, $3) as r", [provider, key, HASH])).rejects.toThrow(/check constraint/);
        await tx.exec("rollback to savepoint s");
      }
      for (const role of ["anon", "authenticated"]) {
        await tx.exec("savepoint r");
        await tx.exec(`set local role ${role}`);
        await expect(tx.query("select * from private.ai_keys")).rejects.toThrow(/permission denied/);
        await tx.exec("rollback to savepoint r");
      }
      await tx.exec("savepoint a");
      await tx.exec("set local role anon");
      await expect(tx.query("select public.ai_key()")).rejects.toThrow(/permission denied/);
      await tx.exec("rollback to savepoint a");
      await tx.rollback();
    });
  });
});
