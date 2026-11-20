// Dataset keys (supabase/migrations/20261118020000_data_tokens.sql, 20261118100000, 20261118110000) on the real SQL:
// only the Hugging Face token; each user sets and reads only their own; the status never shows it;
// anon can't call any of it.
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb } from "./sql/pg";

const A = "9f000000-0000-4000-8000-0000000000d1";
const B = "9f000000-0000-4000-8000-0000000000d2";
const HF = "hf_abcdefghijklmnopqrstuvwxyz012345";

let db: PGlite;
beforeAll(async () => {
  db = await migratedDb();
}, 60_000);

async function inTx(fn: (tx: Transaction) => Promise<void>) {
  await db.transaction(async (tx) => {
    await tx.query("insert into auth.users (id) values ($1), ($2)", [A, B]);
    await fn(tx);
    await tx.rollback();
  });
}
async function as(tx: Transaction, user: string) {
  await tx.exec("reset role");
  await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
  await tx.exec("set local role authenticated");
}
const one = async <T>(tx: Transaction, sql: string, params: unknown[] = []) => (await tx.query<{ v: T }>(`select ${sql} as v`, params)).rows[0]!.v;

describe("data tokens", () => {
  it("save, read back, keep it with null, remove it with ''", async () => {
    await inTx(async (tx) => {
      await as(tx, A);
      expect(await one(tx, "public.data_tokens()")).toEqual({});
      await tx.query("select public.set_data_tokens($1)", [HF]);
      expect(await one(tx, "public.data_tokens()")).toEqual({ hf_token: HF });
      await tx.query("select public.set_data_tokens(null)"); // keeps it
      expect(await one(tx, "public.data_tokens()")).toEqual({ hf_token: HF });
      await tx.query("select public.set_data_tokens('')"); // removes it
      expect(await one(tx, "public.data_tokens()")).toEqual({ hf_token: null });
    });
  });

  it("holds only the Hugging Face token: no other column, no other setter", async () => {
    await inTx(async (tx) => {
      const cols = (await tx.query<{ c: string }>("select column_name as c from information_schema.columns where table_schema = 'private' and table_name = 'data_tokens' order by 1")).rows.map((r) => r.c);
      expect(cols).toEqual(["hf_token", "updated_at", "user_id"]);
      const setters = (await tx.query<{ a: string }>("select pg_get_function_identity_arguments(p.oid) as a from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'set_data_tokens'")).rows.map((r) => r.a);
      expect(setters).toEqual(["hf_token text"]);
    });
  });

  it("each user sees only their own", async () => {
    await inTx(async (tx) => {
      await as(tx, A);
      await tx.query("select public.set_data_tokens($1)", [HF]);
      await as(tx, B);
      expect(await one(tx, "public.data_tokens()")).toEqual({});
      await expect(tx.query("select * from private.data_tokens")).rejects.toThrow(/permission denied/);
    });
  });

  it("takes a sealed token (the server checks its shape before sealing) and refuses an oversized value", async () => {
    await inTx(async (tx) => {
      await as(tx, A);
      await tx.query("select public.set_data_tokens($1)", ["enc:v1:" + "n".repeat(16) + "." + "d".repeat(80)]);
      await tx.query("select public.set_data_tokens($1)", ["enc:v1:" + "n".repeat(16) + "." + "d".repeat(10_000)]); // Connect Hugging Face's long tokens (20261118110000)
    });
    await inTx(async (tx) => {
      await as(tx, A);
      await expect(tx.query("select public.set_data_tokens($1)", ["x".repeat(16_001)])).rejects.toThrow(/check constraint/);
    });
  });

  it("anon can't call any of them", async () => {
    await inTx(async (tx) => {
      await tx.exec("set local role anon");
      for (const f of ["public.data_tokens()", "public.set_data_tokens('x')"]) {
        await tx.exec("savepoint s");
        await expect(tx.query(`select ${f}`)).rejects.toThrow(/permission denied/);
        await tx.exec("rollback to savepoint s");
      }
    });
  });

  it("the cleanup update removes columns and checks left from before, keeping the token", async () => {
    const { readFileSync } = await import("node:fs");
    const update = readFileSync(new URL("../supabase/migrations/20261118100000_dataset_keys_hf_only.sql", import.meta.url), "utf8");
    await inTx(async (tx) => {
      await tx.exec("alter table private.data_tokens add column old_name text check (old_name is null or length(old_name) < 70)");
      await tx.query("insert into private.data_tokens (user_id, hf_token, old_name) values ($1, $2, 'x')", [A, HF]);
      await tx.exec(update);
      await tx.exec(update); // twice is fine
      const cols = (await tx.query<{ c: string }>("select column_name as c from information_schema.columns where table_schema = 'private' and table_name = 'data_tokens' order by 1")).rows.map((r) => r.c);
      expect(cols).toEqual(["hf_token", "updated_at", "user_id"]);
      expect((await tx.query<{ h: string }>("select hf_token as h from private.data_tokens where user_id = $1", [A])).rows[0]!.h).toBe(HF);
    });
  });
});
