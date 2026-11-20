# Benchjot

A notebook for coding experiments: https://benchjot.vercel.app

Each note holds what you meant to try, the code you ran, what it printed and drew, and whether it worked. Notes link to each other, so a line of work (attempt 1, attempt 2, the fix that finally worked) stays in one place instead of being spread across scripts and chat logs. Each note has an Assistant that does the work in it and can draw on your other notes.

There's also an [Android app](https://github.com/Ozovehe1/benchjot-android) that uses the same account.

## What it does

- Notes have a Markdown body with LaTeX math and any number of code cells. Each cell can have a note before the run (what you expect) and after it (what happened). You mark a note Successful or Failed yourself; nothing else changes that.
- Python and R run in the browser (Pyodide and WebR). Packages load on demand, and most of PyPI works.
- Code a browser can't run goes to the server on Modal: Python with TensorFlow, PyTorch, JAX and most of PyPI, plus R, Julia, Octave (for MATLAB code), C, C++ and Fortran. A GPU is picked automatically when the code needs one, up to 10 GPU runs a day per account. Python runs can last an hour and keep going when you close the page.
- Code written for a GPU (PyTorch `.cuda()`, CuPy) still runs where there's no GPU; it's moved to the CPU.
- Figures, tables, animations and interactive charts (Plotly, Altair, Bokeh) are saved with the run. Each opens on its own page and downloads as PNG, SVG, PDF, CSV, MP4, GIF or HTML.
- Export a whole note as a Jupyter notebook, a single web page or Markdown.
- Fix proposes a corrected program after an error, as a diff you accept or reject.
- The Assistant answers questions about a note and can do the work in it: write and run cells until they work, and write in the note. Type or speak. It shows each step as it goes, and Undo puts everything back.
- It works from the note's context graph: a short card for the note and each cell (what it's for, how it last ran, what it printed and showed), built from the saved note. A vision model looks at the figures, charts and animations a run made and its description is kept with that run.
- Notes connect: the Assistant finds your other notes by words or by meaning (pgvector), reads their graphs, and asks their own agents, which answer read-only and can pass a question on once. It proposes changes to other notes; they're applied only when you tap Apply.
- Projects, sub-notes, `[[links]]` between notes, and New attempt to start again from an earlier note. The Research Map shows how they connect.
- Share a note with people by username, or with a link anyone can open. Invitations wait on the person's home; the Android app also alerts them on the phone.
- Deleted notes wait in Recently deleted for 30 days. Notes can be pinned, and the list is grouped by date.

Everything is free. Fix and the Assistant run on each person's own free OpenRouter account, connected with one tap; Benchjot doesn't pay for anyone's AI and has no model of its own. Finding related notes by meaning runs inside Supabase and doesn't use that allowance.

## Run it locally

You need Node.js 20+ and a Supabase project.

```bash
cp .env.example .env.local   # set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
npm ci
npm run dev                  # http://localhost:3000
npm run check                # typecheck, lint and tests
npm run build
```

Environment variables (never commit their values):

| Variable | For |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Everything. Public; data is protected by Row Level Security |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google sign-in (optional) |
| `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET` | Server runs |
| `RUN_REFUND_KEY` | Giving a GPU run back when the server couldn't start |
| `KEY_ENCRYPTION_SECRET` | Encrypting the keys people connect. 32+ random characters; never change it |
| `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN` | `npm run db:migrate` only |

Apply the database migrations in `supabase/migrations/` with:

```bash
SUPABASE_PROJECT_REF=<ref> SUPABASE_ACCESS_TOKEN=<token> npm run db:migrate
```

Each production build on Vercel also builds the server's Python image on Modal, so the first run after a change doesn't wait for it. To build it by hand: `npm run modal:image`.

## How it's built

Next.js 15, React 19, TypeScript and Tailwind CSS v4 on Vercel; pushes to main deploy. Supabase holds the data (Postgres with Row Level Security on every table), sign-in and run outputs. Server runs happen in Modal sandboxes, and AI requests go to OpenRouter from the server, never from the browser. Search by meaning uses the gte-small model inside a Supabase Edge Function (`supabase/functions/note-search`) and pgvector; deploy it with `supabase functions deploy note-search`. [ARCHITECTURE.md](ARCHITECTURE.md) has the folder layout and how to swap the database, sandbox or model provider.

The Android app shares this app's rules through JSON fixtures in `tests/fixtures/`, and its CI fails if the two drift apart.

## Credits

Built with AI coding assistance from Claude Code, Anthropic's coding agent. The author designed the product, directed the work, reviewed it, and tested it.

In the product, Fix and the Assistant use free models on the user's own OpenRouter account. Voice uses the browser's own speech recognition.

Fonts: Newsreader, Inter and JetBrains Mono, under the SIL Open Font License. Libraries are listed in `package.json`, including Next.js, React, CodeMirror, Supabase JS, Ruff, d3-force, KaTeX, SWR and zod. Pyodide, WebR, Plotly.js, Vega and BokehJS load when needed. Each is under its own license.

## Limits

- Server runs cost money on Modal, so GPU runs are capped at 10 a day per account, and at most 3 runs go at once.
- Python in the browser can only use what Pyodide supports. TensorFlow, PyTorch, JAX and similar libraries go to the server automatically.
- How well the Assistant works depends on OpenRouter's free models and their daily allowance (about 50 requests a day). Each step, each look at a figure and each question to another note is one; asking other notes is capped at 12 requests per request.
- Voice doesn't work in Firefox, which has no speech recognition.
- Confirmation emails go through Gmail, so about 500 can go out a day.

## License

All rights reserved. See [LICENSE](LICENSE). The code is published for viewing only; using or copying it needs written permission.
