// Background server runs (supabase/migrations/20261118030000_server_runs.sql) on the real SQL:
// owners see only their runs; the sandbox, signed out, can read the run's meta and complete it
// only with that run's token, and only while it runs.
import { createHash } from "node:crypto";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb } from "./sql/pg";

const A = "9f000000-0000-4000-8000-0000000000f1";
const B = "9f000000-0000-4000-8000-0000000000f2";
const RUN = "9f000000-0000-4000-8000-0000000000f9";
const TOKEN = "a".repeat(64);
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

let db: PGlite;
beforeAll(async () => {
  db = await migratedDb();
}, 60_000);

async function inTx(fn: (tx: Transaction) => Promise<void>) {
  await db.transaction(async (tx) => {
    await tx.query("insert into auth.users (id) values ($1), ($2)", [A, B]);
    await tx.query("insert into public.server_runs (id, user_id, limit_sec, token_hash, meta) values ($1, $2, 60, $3, $4)", [RUN, A, hash(TOKEN), JSON.stringify({ language: "python", gpu: null, network: "datasets" })]);
    await fn(tx);
    await tx.rollback();
  });
}
async function as(tx: Transaction, user: string | null) {
  await tx.exec("reset role");
  await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [user ?? ""]);
  await tx.exec(user ? "set local role authenticated" : "set local role anon");
}
const one = async <T>(tx: Transaction, sql: string, params: unknown[] = []) => (await tx.query<{ v: T }>(`select ${sql} as v`, params)).rows[0]!.v;

describe("server_runs", () => {
  it("owners only", async () => {
    await inTx(async (tx) => {
      await as(tx, A);
      expect((await tx.query("select id from public.server_runs")).rows).toHaveLength(1);
      await as(tx, B);
      expect((await tx.query("select id from public.server_runs")).rows).toHaveLength(0);
      expect((await tx.query("update public.server_runs set status = 'stopped' returning id")).rows).toHaveLength(0);
      await as(tx, null);
      await tx.exec("savepoint s");
      await expect(tx.query("select id from public.server_runs")).rejects.toThrow(/permission denied/);
      await tx.exec("rollback to savepoint s");
    });
  });

  it("the sandbox (signed out) gets the meta and completes the run with the right token only", async () => {
    await inTx(async (tx) => {
      await as(tx, null);
      expect(await one(tx, "public.server_run_meta($1, $2)", [RUN, "b".repeat(64)])).toBeNull();
      expect(await one(tx, "public.server_run_meta($1, $2)", [RUN, TOKEN])).toEqual({ language: "python", gpu: null, network: "datasets" });
      expect(await one(tx, "public.complete_server_run($1, $2, $3)", [RUN, "b".repeat(64), JSON.stringify({ outcome: "ok" })])).toBe(false);
      expect(await one(tx, "public.complete_server_run($1, $2, $3)", [RUN, TOKEN, JSON.stringify({ outcome: "ok" })])).toBe(true);
      // Once done, the token can't change it again or read the meta.
      expect(await one(tx, "public.complete_server_run($1, $2, $3)", [RUN, TOKEN, JSON.stringify({ outcome: "error" })])).toBe(false);
      expect(await one(tx, "public.server_run_meta($1, $2)", [RUN, TOKEN])).toBeNull();
      await as(tx, A);
      expect((await tx.query<{ status: string; result: unknown }>("select status, result from public.server_runs")).rows[0]).toEqual({ status: "done", result: { outcome: "ok" } });
    });
  });

  it("a run the owner stopped can't be completed afterwards", async () => {
    await inTx(async (tx) => {
      await as(tx, A);
      await tx.query("update public.server_runs set status = 'stopped' where id = $1", [RUN]);
      await as(tx, null);
      expect(await one(tx, "public.complete_server_run($1, $2, $3)", [RUN, TOKEN, JSON.stringify({ outcome: "ok" })])).toBe(false);
    });
  });
});
