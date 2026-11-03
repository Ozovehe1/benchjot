# Research code notebook (working name)

The product name is set in one place: `src/config/app.ts` (`APP_NAME`).

Code notebook for ML/AI research experiments: projects → experiments → code snippets (versioned) and runs (params, env, metrics).

Stack: Next.js (App Router) · TypeScript · Tailwind CSS · Supabase (Postgres, Auth, RLS) · CodeMirror 6 · Vercel.

## Develop

```bash
cp .env.example .env.local   # fill in Supabase URL + anon key
npm ci
npm run dev
npm run check                # typecheck + lint + tests
```

## Database

Migrations live in `supabase/migrations/` and are applied through the Supabase Management API:

```bash
SUPABASE_PROJECT_REF=xxxx SUPABASE_ACCESS_TOKEN=sbp_... npm run db:migrate
```

Every table has owner-only Row Level Security (`auth.uid() = user_id`).
