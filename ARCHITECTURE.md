# Architecture

Benchjot is a Next.js app (App Router) with a database and auth (Supabase), a sandbox for server runs (Modal) and AI (Claude, through the Anthropic SDK). Code runs in the browser first: Python (Pyodide in a Web Worker) and R (WebR).

## Layers

```
src/app/          routes: pages (server components) and API routes. Thin: read input, call lib, render.
src/components/   React UI, by screen area. Talks to lib only, never to a provider.
src/lib/          everything else, by domain (below). Pure logic where possible, so it's testable.
src/config/       app-wide constants: name, limits.
public/workers/   the browser's Python runner and the capture module both runners share.
supabase/         the database: migrations (schema, RLS, functions) applied in order.
scripts/          build, fixture and end-to-end scripts (scripts/README.md).
tests/            vitest (TypeScript), unittest (Python), PGlite (SQL).
```

| `src/lib/…` | What it holds |
|---|---|
| `notes/` | The domain model: schemas (zod), outcome, parent tree, links, cell notes, the research map graph |
| `data/` | Reading and writing notes, cells and projects from the browser (SWR hooks + mutations), search |
| `account/` | Sign-in and account settings from the browser (`auth.ts`), whether AI is connected, usernames |
| `editor/` | The live Markdown note editor: parsing, formatting, note links |
| `code/` | Code cells: languages, detection, CodeMirror setup, folding, theme, file upload |
| `run/` | Running code: browser runner, server client, outputs (figures, tables, charts, animations), CPU/GPU choice |
| `ai/` | Fix and the assistant (the agent): prompts, budgets, parsing, the step loop, its checks (no faked results, done only when its cells run), the plan and Undo (pure; the call itself is `server/llm.ts`) |
| `files/` | Downloads: save, zip, PDF |
| `ui/` | Hooks and helpers for components: formatting, plain-language errors, brand |
| `web/` | Web plumbing: env, URL paths, safe redirects, CSP reports |
| `server/` | Server-only: sessions, the signed-in account, run admission, sandbox and model access |

`components/` mirrors it: `ui/` (primitives), `app/` (shell, providers, error and legal pages), `notes/`, `code/`, `outputs/`, `map/`, `account/`.

## Providers and how to move off one

Each provider sits behind a few modules; `tests/boundaries.test.ts` fails if anything else reaches it.

| Provider | Only these files touch it | To replace it |
|---|---|---|
| Database + auth (Supabase) | `lib/data/*`, `lib/account/auth.ts`, `lib/server/account.ts`, `lib/server/session.ts`, `lib/run/output-store.ts` (file storage), `middleware.ts` | Rewrite those modules against the new provider and port `supabase/migrations` (plain Postgres: tables, row-level security, SQL functions) |
| AI (Claude via `@anthropic-ai/sdk`, `ANTHROPIC_API_KEY`) | `lib/server/llm.ts` only: `askModel` (text and tool calls, the agent's live conversation), `askVision` (the seer), the allowance (`ai_check`, `ai_spent` with each answer's cost in credits) | Another provider: the same two functions, turning the chat and tool shapes into its own |
| The user's Hugging Face (OAuth with a Client ID Metadata Document, PKCE) | `lib/server/huggingface.ts` (talks to Hugging Face), `lib/server/hf-grant.ts` (stored grant, renewal, HF_TOKEN for runs), `/.well-known/oauth-cimd`, `/api/hf/*` | Another data host with OAuth: the same authorize URL, code exchange and refresh |
| Search by meaning (gte-small in a Supabase Edge Function, pgvector) | `supabase/functions/note-search` (embeds and matches), `supabase/migrations/20261120030000_note_embeddings.sql`, called only by `lib/data/index.ts` (`closeInMeaning`) | Any embedding model: a function that answers `{ query \| note }` with `[{ id, similarity }]`; re-embed every note (one model per index) |
| Server runs (Modal) | `lib/server/modal.ts`, behind `lib/server/sandbox.ts` | A new `modal.ts` with the same five functions: run and wait, start in background, live status, is running, stop |
| Hosting (Vercel) | `next.config.ts` (output tracing), `scripts/modal-image.mjs --on-vercel` (postbuild) | Any Node host that runs `next build && next start` |

## Rules that keep it readable

- Server-only code lives in `lib/server/` and imports nothing from components.
- Limits and plan rules are enforced on the server and in the database (RLS, SQL functions); the UI only shows them.
- Text shown to users comes from `lib/ui/user-message.ts` (errors) or the component itself; provider messages never reach the screen.
- Files the Android app copies keep their paths: `public/workers/bj_capture.py`, `tests/fixtures/`. The landing's example note (`src/lib/sample-note.ts`, `src/lib/sample-run.json`, `public/sample-outputs/<cell>/`) has two cells, each cell's outputs in its own folder; the Android app copies it in that shape.
