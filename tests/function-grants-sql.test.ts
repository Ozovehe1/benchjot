// Which API role may call which function, on a database with every migration applied and
// Supabase's default (new functions executable by anon and authenticated) in the stand-ins.
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb } from "./sql/pg";

let db: PGlite;
beforeAll(async () => {
  db = await migratedDb();
}, 60_000);

async function callable(role: string): Promise<string[]> {
  const { rows } = await db.query<{ proname: string }>(
    "select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege($1, p.oid, 'execute') order by 1",
    [role],
  );
  return rows.map((r) => r.proname);
}

describe("function grants", () => {
  it("signed out: only sign-in, the sign-up name check, a background run sending its result, and a shared note's page (token-checked)", async () => {
    // shared_note reads a note only through its link's token; share_file_ok is the storage rule's check of that token.
    expect(await callable("anon")).toEqual(["complete_server_run", "login_email", "server_run_meta", "share_file_ok", "shared_note", "username_available"]);
  });

  it("signed in: the app's functions, no trigger functions", async () => {
    const fns = await callable("authenticated");
    for (const f of ["run_take", "set_username", "search_notes", "note_links", "new_attempt", "login_email", "username_available"]) expect(fns).toContain(f);
    for (const f of ["touch_parent_note", "touch_updated_at", "notes_parent_no_cycle", "notes_derived_no_cycle", "assistant_condense"]) expect(fns).not.toContain(f);
  });

  it("a function a later migration adds isn't open to anon by default", async () => {
    await db.exec("create function public.bj_probe() returns int language sql as 'select 1'");
    expect(await callable("anon")).not.toContain("bj_probe");
    await db.exec("drop function public.bj_probe()");
  });

  it("triggers still fire after the revokes", async () => {
    await db.transaction(async (tx) => {
      const U = "9f000000-0000-4000-8000-0000000000c1";
      await tx.query("insert into auth.users (id) values ($1)", [U]);
      const { rows } = await tx.query<{ id: string; updated_at: string }>("insert into public.notes (user_id, notes) values ($1, '') returning id, updated_at", [U]);
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [U]);
      await tx.exec("set local role authenticated");
      await tx.query("update public.notes set notes = 'x' where id = $1", [rows[0]!.id]);
      await tx.rollback();
    });
  });
});
