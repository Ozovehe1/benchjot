// The shared cell-note cases against the real SQL: every migration applied to a Postgres (PGlite),
// then note_links() and search_entries() called as the signed-in owner, RLS on.
import { readFileSync } from "node:fs";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { LINK_PATTERN } from "@/lib/links";
import { searchTerms } from "@/lib/search";
import { LINK_CASES, SEARCH_CASES, type CellCase } from "./fixtures/cell-notes";
import { migratedDb } from "./sql/pg";

const OWNER = "9f000000-0000-4000-8000-000000000001";
const OTHER = "9f000000-0000-4000-8000-000000000002";
const MIGRATION = "../supabase/migrations/20261106200000_cell_notes.sql";

let db: PGlite;
beforeAll(async () => {
  db = await migratedDb();
}, 60_000);

/** Inserts the note and its cells for OWNER, runs `fn` as OWNER, then rolls everything back. */
async function withNote<T>(
  entry: { id: string; title?: string; notes: string; outcome?: string | null },
  cells: CellCase[],
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  let out!: T;
  await db.transaction(async (tx) => {
    await tx.query("insert into auth.users (id) values ($1), ($2)", [OWNER, OTHER]);
    await tx.query("insert into public.entries (id, user_id, title, notes, outcome) values ($1, $2, $3, $4, $5)", [
      entry.id, OWNER, entry.title ?? "", entry.notes, entry.outcome ?? null,
    ]);
    for (const c of cells) {
      await tx.query(
        "insert into public.snippets (entry_id, user_id, language, content, position, note_before, note_after) values ($1, $2, 'python', $3, $4, $5, $6)",
        [entry.id, OWNER, c.content, c.position, c.note_before, c.note_after],
      );
    }
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [OWNER]);
    await tx.exec("set local role authenticated");
    out = await fn(tx);
    await tx.rollback();
  });
  return out;
}

const key = (l: { source: string; label: string; id: string | null }) => `${l.source} ${l.label} ${l.id}`;

describe("note_links() with cell notes (cell_notes.json)", () => {
  for (const c of LINK_CASES) {
    it(c.name, async () => {
      const rows = await withNote(c.entry, c.snippets, async (tx) =>
        (await tx.query<{ source: string; label: string; target: string | null }>("select * from public.note_links()")).rows,
      );
      // The SQL returns links unordered; the apps read them as a set (useNoteLinks trims labels).
      const got = rows.map((r) => ({ source: r.source, label: r.label.trim(), id: r.target })).map(key).sort();
      expect(got).toEqual(c.links.map(key).sort());
    });
  }

  it("another user's cell notes are invisible (RLS)", async () => {
    let rows: unknown[] = [];
    await db.transaction(async (tx) => {
      await tx.query("insert into auth.users (id) values ($1), ($2)", [OWNER, OTHER]);
      const e = LINK_CASES[1]!;
      await tx.query("insert into public.entries (id, user_id, notes) values ($1, $2, '')", [e.entry.id, OWNER]);
      await tx.query("insert into public.snippets (entry_id, user_id, language, content, note_before) values ($1, $2, 'python', '', $3)", [e.entry.id, OWNER, e.snippets[0]!.note_before]);
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [OTHER]);
      await tx.exec("set local role authenticated");
      rows = (await tx.query("select * from public.note_links()")).rows;
      await tx.rollback();
    });
    expect(rows).toEqual([]);
  });
});

describe("search_entries() with cell notes (cell_notes.json)", () => {
  for (const c of SEARCH_CASES) {
    it(`${c.name}: ${c.match ? "matches" : "no match"}`, async () => {
      const ids = await withNote(c.entry, c.snippets, async (tx) =>
        (await tx.query<{ id: string }>("select id from public.search_entries($1::text[])", [searchTerms(c.query)])).rows.map((r) => r.id),
      );
      expect(ids).toEqual(c.match ? [c.entry.id] : []);
    });
  }
});

describe("cell notes columns", () => {
  it("default to '' (old cells read as empty) and cap at 100,000 characters", async () => {
    await withNote({ id: LINK_CASES[0]!.entry.id, notes: "" }, [], async (tx) => {
      await tx.query("insert into public.snippets (entry_id, user_id, language, content) values ($1, $2, 'python', 'x')", [LINK_CASES[0]!.entry.id, OWNER]);
      const row = (await tx.query<{ note_before: string; note_after: string }>("select note_before, note_after from public.snippets")).rows;
      expect(row).toEqual([{ note_before: "", note_after: "" }]);
      await tx.exec("savepoint ok");
      await expect(tx.query("update public.snippets set note_after = repeat('a', 100001)")).rejects.toThrow(/check constraint/);
      await tx.exec("rollback to savepoint ok");
      await expect(tx.query("update public.snippets set note_before = repeat('a', 100000)")).resolves.toBeTruthy();
    });
  });

  it("the owner can write them; another user can't (RLS)", async () => {
    await withNote({ id: LINK_CASES[0]!.entry.id, notes: "" }, [{ position: 0, content: "", note_before: "", note_after: "" }], async (tx) => {
      const mine = await tx.query("update public.snippets set note_before = 'mine' returning id");
      expect(mine.rows).toHaveLength(1);
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [OTHER]);
      const theirs = await tx.query("update public.snippets set note_after = 'theirs' returning id");
      expect(theirs.rows).toHaveLength(0);
    });
  });

  it("the migration keeps LINK_PATTERN identical", () => {
    expect(readFileSync(new URL(MIGRATION, import.meta.url), "utf8")).toContain(`'${LINK_PATTERN}'`);
  });
});
