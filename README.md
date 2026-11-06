# Benchjot

Live: https://benchjot.vercel.app

Notes and code. Each note has a title, a Markdown body and any number of code blocks (typed or uploaded); notes can be filed in plain projects (folders).

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

Three tables, `projects`, `entries` and `snippets`, all owner-only via Row Level Security (`auth.uid() = user_id`).
Each snippet keeps its latest run in `snippets.last_run` (stdout and stderr capped at 64 KB each, the error line, time, browser or server, a hash of the code it ran, when), so output survives reloads; the UI marks it "Output from an earlier version" once the code changes, and Clear removes it. Saving a run doesn't count as editing the note.
Each note has an optional `entries.outcome` (`success` | `failed`, null = unmarked). Only the user sets it, from the note page; nothing sets it automatically. The list filter (All, Successful, Failed, Unmarked) is the `p_outcome` argument of `search_entries`, so it combines with search and the project scope; Fix gets the outcome as context.
Notes nest: `entries.parent_id` is an optional parent note (same owner via a composite FK, `on delete set null`; a trigger refuses cycles). The note page shows the ancestors as a breadcrumb, a Parent picker, and Sub-notes with New sub-note.
Notes link with `[[Title|<note id>]]` in the body (typing `[[` offers titles; the id keeps links working after a rename, the title is only a fallback label; a hand-typed `[[Title]]` resolves by title). The body is the only copy: `note_links()` derives every link from the bodies on read for Linked from (backlinks) and the map, and the preview renders links as the note's current title (muted when the note is gone). `/map` draws all notes with d3-force: links solid, parent → sub-note dashed; drag/pinch/wheel to pan and zoom, tap to open.

Each code cell has two optional notes of the user's own: "Note before run" directly above the cell and "Note after run" directly below its run output (`snippets.note_before` / `note_after`, Markdown, edited with the same live editor as the body, autosaved). An empty one is a single 48 px "+ Note before run" row, so notes without them look as before. Only the user writes them (the Fix helper never does), and their `[[links]]` and words count for backlinks, the map and search like the body's (`note_links()`, `search_entries()` in `20261106200000_cell_notes.sql`). `tests/cell-notes-sql.test.ts` runs those functions on a real Postgres (PGlite) with every migration applied, against the cases Android shares (`tests/fixtures/cell_notes.json`).

Migrations live in `supabase/migrations/` and are applied through the Supabase Management API:

```bash
SUPABASE_PROJECT_REF=xxxx SUPABASE_ACCESS_TOKEN=sbp_... npm run db:migrate
```

## Checks against production

`scripts/e2e_smoke.py` (Playwright, phone + desktop) and `scripts/rls_check.py` (a second user can't see or change the first user's rows).

## Pro server runs and Fix

- `POST /api/run` runs Python, C, C++, Go, Rust or Java in a Modal Sandbox (2 CPU, 2–4 GiB, 60 s default). Pro only: the route reads `profiles.plan`, which users can read but never write.
- Per-snippet options are comments: `# pip: torch transformers`, `# gpu: T4` (Python only; T4, L4, A10G, A100), `# timeout: 120` (5–240 s; use the language's own comment token).
- `POST /api/fix` sends the code and its last error to Groq and returns the corrected file; the UI shows a minimal diff to accept or reject.
- `POST /api/helper` is the note Helper (top bar → Helper, "Online helper"): write code for the note or ask it a question. The browser sends the note as read on that tap (body, then each code cell and its last error, cut to 16,000 chars as Android cuts it). Code is only proposed: "Insert into note" adds it as a new code cell; it never runs by itself and never writes the note's text, cell notes or outcome. Turns stay in the panel for the session only. Fix and Helper share one Groq call (`src/lib/server/groq.ts`) and one per-user limit (`fix_take`, 6/min, 10/24 h).
- Server env: `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`, `GROQ_API_KEY` (optional `GROQ_MODEL`, default `openai/gpt-oss-120b`).
