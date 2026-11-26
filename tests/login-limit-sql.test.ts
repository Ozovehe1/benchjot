// login_email's limits against the real SQL (every migration applied to PGlite): failures from one
// IP can't lock the username for another IP, x-forwarded-for isn't trusted, and the per-IP and
// all-IP caps still hold. See supabase/migrations/20261117000000_login_limit_per_ip.sql.
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb } from "./sql/pg";

const USER = "9f000000-0000-4000-8000-0000000000a1";

let db: PGlite;
beforeAll(async () => {
  db = await migratedDb();
}, 60_000);

async function inTx(fn: (tx: Transaction) => Promise<void>) {
  await db.transaction(async (tx) => {
    await tx.query(
      "insert into auth.users (id, email, encrypted_password, raw_user_meta_data) values ($1, 'ada@example.com', extensions.crypt('right-pw', extensions.gen_salt('bf', 4)), '{\"username\":\"ada\"}')",
      [USER],
    );
    await fn(tx);
    await tx.rollback();
  });
}

/** login_email as the anon role with these request headers: the email, null, or "429". */
async function login(tx: Transaction, password: string, headers: Record<string, string> = {}, username = "ada"): Promise<string | null> {
  await tx.exec("savepoint try");
  try {
    await tx.query("select set_config('request.headers', $1, true)", [JSON.stringify(headers)]);
    await tx.exec("set local role anon");
    const { rows } = await tx.query<{ email: string | null }>("select public.login_email($1, $2) as email", [username, password]);
    await tx.exec("reset role");
    await tx.exec("release savepoint try");
    return rows[0]!.email;
  } catch (e) {
    await tx.exec("rollback to savepoint try");
    if (/Too many attempts/.test((e as Error).message)) return "429";
    throw e;
  }
}
const ip = (a: string) => ({ "cf-connecting-ip": a });
async function failTimes(tx: Transaction, n: number, headers: Record<string, string>, username = "ada") {
  for (let i = 0; i < n; i++) expect(await login(tx, "wrong", headers, username)).toBeNull();
}

describe("login_email limits", () => {
  it("signs in with the right password", async () => {
    await inTx(async (tx) => {
      expect(await login(tx, "right-pw", ip("1.1.1.1"))).toBe("ada@example.com");
    });
  });

  it("5 failures from one IP lock that IP out of the username, not the real user's IP", async () => {
    await inTx(async (tx) => {
      await failTimes(tx, 5, ip("6.6.6.6"));
      expect(await login(tx, "right-pw", ip("6.6.6.6"))).toBe("429");
      expect(await login(tx, "right-pw", ip("1.1.1.1"))).toBe("ada@example.com");
    });
  });

  it("x-forwarded-for is not trusted: changing it doesn't get past the limit", async () => {
    await inTx(async (tx) => {
      // No cf-connecting-ip: the no-IP rule (5 per username) applies, whatever x-forwarded-for says.
      for (let i = 0; i < 5; i++) expect(await login(tx, "wrong", { "x-forwarded-for": `10.0.0.${i}` })).toBeNull();
      expect(await login(tx, "right-pw", { "x-forwarded-for": "10.0.0.99" })).toBe("429");
    });
  });

  it("30 failures across many IPs lock the username everywhere (distributed guessing)", async () => {
    await inTx(async (tx) => {
      for (let i = 0; i < 30; i++) expect(await login(tx, "wrong", ip(`7.7.${i}.1`))).toBeNull();
      expect(await login(tx, "right-pw", ip("1.1.1.1"))).toBe("429");
    });
  });

  it("20 failures from one IP across usernames lock that IP", async () => {
    await inTx(async (tx) => {
      for (let i = 0; i < 20; i++) expect(await login(tx, "wrong", ip("8.8.8.8"), `nobody${i}`)).toBeNull();
      expect(await login(tx, "right-pw", ip("8.8.8.8"))).toBe("429");
      expect(await login(tx, "right-pw", ip("1.1.1.1"))).toBe("ada@example.com");
    });
  });

  it("a success clears that IP's failures for the username", async () => {
    await inTx(async (tx) => {
      await failTimes(tx, 4, ip("1.1.1.1"));
      expect(await login(tx, "right-pw", ip("1.1.1.1"))).toBe("ada@example.com");
      await failTimes(tx, 4, ip("1.1.1.1"));
      expect(await login(tx, "right-pw", ip("1.1.1.1"))).toBe("ada@example.com");
    });
  });
});

describe("run_take (free server runs)", () => {
  it("allows per_day runs in 24 hours, then the seconds until the oldest is a day old; each user their own", async () => {
    await db.transaction(async (tx) => {
      const OTHER = "9f000000-0000-4000-8000-0000000000a2";
      await tx.query("insert into auth.users (id) values ($1), ($2)", [USER, OTHER]);
      const take = async (user: string) => {
        await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
        await tx.exec("set local role authenticated");
        const { rows } = await tx.query<{ w: number }>("select public.run_take(3) as w");
        await tx.exec("reset role");
        return rows[0]!.w;
      };
      expect([await take(USER), await take(USER), await take(USER)]).toEqual([0, 0, 0]);
      const wait = await take(USER);
      expect(wait).toBeGreaterThan(86_000);
      expect(wait).toBeLessThanOrEqual(86_400);
      expect(await take(OTHER)).toBe(0);
      await tx.query("update private.run_calls set at = at - interval '25 hours' where user_id = $1", [USER]);
      expect(await take(USER)).toBe(0);
      await tx.rollback();
    });
  });

  it("anon can't call it", async () => {
    await db.transaction(async (tx) => {
      await tx.exec("set local role anon");
      await expect(tx.query("select public.run_take(3)")).rejects.toThrow(/permission denied/);
      await tx.rollback();
    });
  });
});

describe("run_refund (a run that never executed isn't counted)", () => {
  const KEY = "server-only-key-0123456789abcdef";
  const take = async (tx: Transaction) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [USER]);
    await tx.exec("set local role authenticated");
    const { rows } = await tx.query<{ w: number }>("select public.run_take(2) as w");
    await tx.exec("reset role");
    return rows[0]!.w;
  };
  const refund = async (tx: Transaction, key: string | null) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [USER]);
    await tx.exec("set local role authenticated");
    const { rows } = await tx.query<{ ok: boolean }>("select public.run_refund($1) as ok", [key]);
    await tx.exec("reset role");
    return rows[0]!.ok;
  };

  it("with the server's key, the latest counted run comes back; a user without it can't refund themselves", async () => {
    await db.transaction(async (tx) => {
      await tx.query("insert into auth.users (id) values ($1)", [USER]);
      await tx.query("insert into private.server_keys (name, hash) values ('run_refund', encode(extensions.digest($1, 'sha256'), 'hex'))", [KEY]);
      expect([await take(tx), await take(tx)]).toEqual([0, 0]);
      expect(await take(tx)).toBeGreaterThan(0); // at the limit
      expect(await refund(tx, "a guess")).toBe(false);
      expect(await refund(tx, null)).toBe(false);
      expect(await take(tx)).toBeGreaterThan(0); // still at the limit
      expect(await refund(tx, KEY)).toBe(true);
      expect(await take(tx)).toBe(0); // one run back
      await tx.rollback();
    });
  });

  it("refunds nothing older than 10 minutes, and nothing when no key is set up", async () => {
    await db.transaction(async (tx) => {
      await tx.query("insert into auth.users (id) values ($1)", [USER]);
      expect(await take(tx)).toBe(0);
      expect(await refund(tx, KEY)).toBe(false); // no key in the database yet
      await tx.query("insert into private.server_keys (name, hash) values ('run_refund', encode(extensions.digest($1, 'sha256'), 'hex'))", [KEY]);
      await tx.query("update private.run_calls set at = at - interval '11 minutes'");
      expect(await refund(tx, KEY)).toBe(false);
      await tx.rollback();
    });
  });
});
