// Helper history against the real SQL (every migration applied to PGlite): owner-only turns and
// summaries, and helper_condense() folding turns older than 30 days into the note's summary.
import { readFileSync } from "node:fs";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { HELPER_HISTORY } from "@/config/app";
import { migratedDb } from "./sql/pg";

const OWNER = "9f000000-0000-4000-8000-000000000001";
const OTHER = "9f000000-0000-4000-8000-000000000002";
const NOTE = "9f000000-0000-4000-8000-0000000000e1";
const NOTE2 = "9f000000-0000-4000-8000-0000000000e2";
const SQL = readFileSync(new URL("../supabase/migrations/20261107030000_helper_history.sql", import.meta.url), "utf8");

let db: PGlite;
beforeAll(async () => {
  db = await migratedDb();
}, 60_000);

/** OWNER's two notes and OTHER's one; `fn` runs as postgres (no RLS) unless it switches; all rolled back. */
async function inTx(fn: (tx: Transaction) => Promise<void>) {
  await db.transaction(async (tx) => {
    await tx.query("insert into auth.users (id) values ($1), ($2)", [OWNER, OTHER]);
    await tx.query("insert into public.entries (id, user_id, notes) values ($1, $3, ''), ($2, $3, '')", [NOTE, NOTE2, OWNER]);
    await fn(tx);
    await tx.rollback();
  });
}
async function as(tx: Transaction, user: string) {
  await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
  await tx.exec("set local role authenticated");
}
/** The statement's error message ('' when it succeeded); the transaction goes on either way. */
async function fails(tx: Transaction, sql: string, params: unknown[] = []): Promise<string> {
  await tx.exec("savepoint try");
  try {
    await tx.query(sql, params);
    await tx.exec("release savepoint try");
    return "";
  } catch (e) {
    await tx.exec("rollback to savepoint try");
    return (e as Error).message;
  }
}
const TURN_SQL = "insert into public.helper_turns (entry_id, user_id, task, request, answer) values ($1, $2, $3, 'q', $4::jsonb)";
const code = (summary: string) => JSON.stringify({ kind: "code", code: "plot()", summary, language: "python" });
const prose = (text: string) => JSON.stringify({ kind: "prose", text });
async function turn(tx: Transaction, entry: string, task: string, request: string, answer: string, daysAgo: number) {
  await tx.query("insert into public.helper_turns (entry_id, user_id, task, request, answer, created_at) values ($1, $2, $3, $4, $5::jsonb, timestamptz '2026-11-07 12:00Z' - make_interval(days => $6))", [entry, OWNER, task, request, answer, daysAgo]);
}
const condense = (tx: Transaction) => tx.query<{ n: number }>("select public.helper_condense(timestamptz '2026-11-07 12:00Z' - interval '30 days') as n");

describe("helper_turns and helper_summaries (RLS)", () => {
  it("the owner saves, reads and deletes turns on their own note; nobody edits one", async () => {
    await inTx(async (tx) => {
      await as(tx, OWNER);
      const { rows } = await tx.query<{ id: string; user_id: string }>("insert into public.helper_turns (entry_id, task, request, answer) values ($1, 'ask', 'q', $2::jsonb) returning id, user_id", [NOTE, prose("a")]);
      expect(rows[0]!.user_id).toBe(OWNER);
      expect((await tx.query("update public.helper_turns set request = 'x' returning id")).rows).toEqual([]);
      expect((await tx.query("select id from public.helper_turns")).rows).toHaveLength(1);
      expect((await tx.query("delete from public.helper_turns where id = $1 returning id", [rows[0]!.id])).rows).toHaveLength(1);
    });
  });
  it("another user sees, deletes and adds nothing on the owner's note", async () => {
    await inTx(async (tx) => {
      await turn(tx, NOTE, "ask", "q", prose("a"), 0);
      await tx.query("insert into public.helper_summaries (entry_id, user_id, summary, turns) values ($1, $2, 's', 1)", [NOTE, OWNER]);
      await as(tx, OTHER);
      expect((await tx.query("select * from public.helper_turns")).rows).toEqual([]);
      expect((await tx.query("select * from public.helper_summaries")).rows).toEqual([]);
      expect((await tx.query("delete from public.helper_turns returning id")).rows).toEqual([]);
      expect(await fails(tx, TURN_SQL, [NOTE, OTHER, "ask", prose("a")])).toMatch(/row-level security/);
      expect(await fails(tx, TURN_SQL, [NOTE, OWNER, "ask", prose("a")])).toMatch(/row-level security/);
    });
  });
  it("only the condenser writes a summary; the owner reads and clears it", async () => {
    await inTx(async (tx) => {
      await tx.query("insert into public.helper_summaries (entry_id, user_id, summary, turns) values ($1, $2, 's', 1)", [NOTE, OWNER]);
      await as(tx, OWNER);
      expect(await fails(tx, "insert into public.helper_summaries (entry_id, user_id, summary, turns) values ($1, $2, 's', 1)", [NOTE2, OWNER])).toMatch(/row-level security/);
      expect((await tx.query("update public.helper_summaries set summary = 'x' returning entry_id")).rows).toEqual([]);
      expect((await tx.query("select summary from public.helper_summaries")).rows).toEqual([{ summary: "s" }]);
      expect((await tx.query("delete from public.helper_summaries returning entry_id")).rows).toHaveLength(1);
      expect(await fails(tx, "select public.helper_condense()")).toMatch(/permission denied/);
    });
  });
  it("an answer that isn't one of the two shapes is refused", async () => {
    await inTx(async (tx) => {
      for (const bad of [{ kind: "prose" }, { kind: "code", code: 1 }, { kind: "other", text: "a" }, ["prose"]]) expect(await fails(tx, TURN_SQL, [NOTE, OWNER, "ask", JSON.stringify(bad)])).toMatch(/helper_turns_answer_check/);
      expect(await fails(tx, TURN_SQL, [NOTE, OWNER, "run", prose("a")])).toMatch(/helper_turns_task_check/);
      expect(await fails(tx, TURN_SQL, [NOTE, OWNER, "ask", prose("a")])).toBe("");
    });
  });
});

describe("helper_condense()", () => {
  it("folds turns older than 30 days into one summary per note, oldest first, and deletes them", async () => {
    await inTx(async (tx) => {
      await turn(tx, NOTE, "write", "Plot   the\nresults", code("Plots accuracy per epoch."), 40);
      await turn(tx, NOTE, "ask", "What is lr?", prose("The learning rate:\nstep size."), 35);
      await turn(tx, NOTE, "write", "Plot it", code(""), 31);
      await turn(tx, NOTE, "ask", "Recent", prose("kept"), 29);
      await turn(tx, NOTE2, "ask", "Other note", prose("its own"), 60);
      expect((await condense(tx)).rows[0]!.n).toBe(2);
      const s = (await tx.query<{ entry_id: string; summary: string; turns: number }>("select entry_id, summary, turns from public.helper_summaries order by entry_id")).rows;
      expect(s).toEqual([
        { entry_id: NOTE, turns: 3, summary: "2026-09-28 Write: Plot the results — Plots accuracy per epoch.\n2026-10-03 Ask: What is lr? — The learning rate: step size.\n2026-10-07 Write: Plot it — Proposed python code." },
        { entry_id: NOTE2, turns: 1, summary: "2026-09-08 Ask: Other note — its own" },
      ]);
      expect((await tx.query("select request from public.helper_turns")).rows).toEqual([{ request: "Recent" }]);
      // Run again: nothing old is left, so nothing changes.
      expect((await condense(tx)).rows[0]!.n).toBe(0);
    });
  });
  it("adds to an existing summary and keeps its newest lines within 4,000 characters", async () => {
    await inTx(async (tx) => {
      const lines: string[] = [];
      while ([...lines, `2026-08-01 Ask: q${lines.length} — ${"a".repeat(80)}`].join("\n").length <= 4000) lines.push(`2026-08-01 Ask: q${lines.length} — ${"a".repeat(80)}`);
      const old = lines.join("\n");
      await tx.query("insert into public.helper_summaries (entry_id, user_id, summary, turns) values ($1, $2, $3, 60)", [NOTE, OWNER, old]);
      await turn(tx, NOTE, "ask", "newest", prose(`answer ${"b".repeat(150)}`), 31);
      await condense(tx);
      const { summary, turns } = (await tx.query<{ summary: string; turns: number }>("select summary, turns from public.helper_summaries")).rows[0]!;
      expect(turns).toBe(61);
      expect(summary.length).toBeLessThanOrEqual(4000);
      expect(summary.endsWith(`2026-10-07 Ask: newest — answer ${"b".repeat(150)}`)).toBe(true);
      expect(old.split("\n")).toContain(summary.split("\n")[0]);
      expect(summary).not.toContain("q0 ");
    });
  });
  it("cuts long requests and answers to 160 characters each", async () => {
    await inTx(async (tx) => {
      await turn(tx, NOTE, "ask", "r".repeat(500), prose("p".repeat(500)), 31);
      await condense(tx);
      const { summary } = (await tx.query<{ summary: string }>("select summary from public.helper_summaries")).rows[0]!;
      expect(summary).toBe(`2026-10-07 Ask: ${"r".repeat(160)} — ${"p".repeat(160)}`);
    });
  });
  it("a deleted note takes its turns and summary with it", async () => {
    await inTx(async (tx) => {
      await turn(tx, NOTE, "ask", "q", prose("a"), 40);
      await condense(tx);
      await tx.query("delete from public.entries where id = $1", [NOTE]);
      expect((await tx.query("select * from public.helper_summaries")).rows).toEqual([]);
    });
  });
});

describe("the migration and the app agree", () => {
  it("30 days, 4,000 characters, hourly where pg_cron exists", () => {
    expect(SQL).toContain(`now() - interval '${HELPER_HISTORY.days} days'`);
    expect(SQL.match(/helper_keep_tail\([^)]*, (\d+)\)/g)?.every((m) => m.endsWith(`, ${HELPER_HISTORY.maxStoredSummaryChars})`))).toBe(true);
    expect(SQL).toContain(`char_length(summary) <= ${HELPER_HISTORY.maxStoredSummaryChars}`);
    expect(SQL).toContain("cron.schedule('benchjot-helper-condense', '17 * * * *', 'select public.helper_condense()')");
  });
});
