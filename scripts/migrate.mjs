#!/usr/bin/env node
// Applies supabase/migrations/*.sql in order through the Supabase Management API.
// Applied files are recorded in private.schema_migrations, so reruns are no-ops.
//
//   SUPABASE_PROJECT_REF=xxxx SUPABASE_ACCESS_TOKEN=sbp_... npm run db:migrate
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const ref = process.env.SUPABASE_PROJECT_REF;
if (!ref) {
  console.error("SUPABASE_PROJECT_REF is required");
  process.exit(1);
}
const token = process.env.SUPABASE_ACCESS_TOKEN;
const dir = new URL("../supabase/migrations/", import.meta.url).pathname;

async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body}`);
  return body ? JSON.parse(body) : [];
}

await query(`
  create schema if not exists private;
  revoke all on schema private from anon, authenticated;
  create table if not exists private.schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  );`);

const applied = new Set((await query("select name from private.schema_migrations")).map((r) => r.name));
const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

for (const file of files) {
  if (applied.has(file)) {
    console.log(`skip   ${file}`);
    continue;
  }
  const sql = await readFile(join(dir, file), "utf8");
  const name = file.replace(/'/g, "''");
  await query(`begin;\n${sql}\ninsert into private.schema_migrations (name) values ('${name}');\ncommit;`);
  console.log(`apply  ${file}`);
}
console.log("migrations up to date");
