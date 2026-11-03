# Benchjot

Live: https://benchjot.vercel.app

Notes and code. Each note has a title, a Markdown body and any number of code blocks.

The product name is set in one place: `src/config/app.ts` (`APP_NAME`).

Stack: Next.js (App Router) · TypeScript · Tailwind CSS · Supabase (Postgres, Auth, RLS) · CodeMirror 6 · Vercel.

## Develop

```bash
cp .env.example .env.local   # fill in Supabase URL + anon key
npm ci
npm run dev
npm run check                # typecheck + lint + tests
```

## Database

Two tables, `entries` and `snippets`, both owner-only via Row Level Security (`auth.uid() = user_id`).
Migrations live in `supabase/migrations/` and are applied through the Supabase Management API:

```bash
SUPABASE_PROJECT_REF=xxxx SUPABASE_ACCESS_TOKEN=sbp_... npm run db:migrate
```

## Checks against production

`scripts/e2e_smoke.py` (Playwright, phone + desktop) and `scripts/rls_check.py` (a second user can't see or change the first user's rows).
