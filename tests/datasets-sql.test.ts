// The Data library's storage rules (supabase/migrations/20261126000000_datasets.sql) against the real
// SQL: only the owner sees, adds and removes their datasets, and an account stops at its quota.
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb } from "./sql/pg";

let db: PGlite;
beforeAll(async () => {
  db = await migratedDb();
  // Supabase gives signed-in users these on its storage schema; the stand-in doesn't.
  await db.exec("grant usage on schema storage to authenticated; grant select, insert, update, delete on storage.objects to authenticated;");
}, 60_000);

const ME = "9f000000-0000-4000-8000-0000000000d1";
const YOU = "9f000000-0000-4000-8000-0000000000d2";

async function as(tx: Transaction, user: string, sql: string, args: unknown[] = []) {
  await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
  await tx.exec("set local role authenticated");
  const r = await tx.query(sql, args); // on an error, the test's "rollback to savepoint" also undoes the role
  await tx.exec("reset role");
  return r;
}
const add = (tx: Transaction, user: string, name: string, size: number) =>
  as(tx, user, "insert into storage.objects (bucket_id, name, metadata) values ('datasets', $1, jsonb_build_object('size', $2::bigint))", [`${user}/${name}`, size]);

describe("the Data library", () => {
  it("is private: only the owner lists, adds and deletes", async () => {
    await db.transaction(async (tx) => {
      await tx.query("insert into auth.users (id) values ($1), ($2)", [ME, YOU]);
      await add(tx, ME, "iris.csv", 4_500);
      expect((await as(tx, ME, "select name from storage.objects where bucket_id = 'datasets'")).rows).toHaveLength(1);
      expect((await as(tx, YOU, "select name from storage.objects where bucket_id = 'datasets'")).rows).toHaveLength(0);
      await tx.exec("savepoint s");
      await expect(as(tx, YOU, "insert into storage.objects (bucket_id, name, metadata) values ('datasets', $1, '{}')", [`${ME}/evil.csv`])).rejects.toThrow(/row-level security/);
      await tx.exec("rollback to savepoint s");
      await as(tx, YOU, "delete from storage.objects where bucket_id = 'datasets'");
      expect((await as(tx, ME, "select public.data_bytes() as b")).rows[0]).toEqual({ b: 4500 });
      await tx.rollback();
    });
  });
  it("stops adding once the account's datasets reach 250 MB", async () => {
    await db.transaction(async (tx) => {
      await tx.query("insert into auth.users (id) values ($1)", [ME]);
      await add(tx, ME, "big.parquet", 262_144_000);
      await tx.exec("savepoint s");
      await expect(add(tx, ME, "one-more.csv", 10)).rejects.toThrow(/row-level security/);
      await tx.exec("rollback to savepoint s");
      await tx.rollback();
    });
  });
});
