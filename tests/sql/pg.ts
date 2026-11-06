// A real Postgres (PGlite, WASM) with every migration in supabase/migrations applied in order, on
// top of minimal stand-ins for what Supabase provides (the auth and storage schemas, the roles,
// pgcrypto in `extensions`). Lets tests call the SQL functions themselves instead of a JS copy.
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);

const SUPABASE_STANDINS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema extensions;
  create extension pgcrypto with schema extensions;
  create schema auth;
  create table auth.users (id uuid primary key, email text, encrypted_password text, raw_user_meta_data jsonb not null default '{}');
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  -- scripts/migrate.mjs creates this before the first migration.
  create schema private;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
`;

/** A fresh database with the app's schema. */
export async function migratedDb(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_STANDINS);
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort()) {
    try {
      await db.exec(readFileSync(new URL(f, MIGRATIONS), "utf8"));
    } catch (e) {
      throw new Error(`${f}: ${(e as Error).message}`, { cause: e });
    }
  }
  await db.exec("grant usage on schema public to authenticated; grant select, insert, update, delete on all tables in schema public to authenticated;");
  return db;
}
