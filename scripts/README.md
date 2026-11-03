# Scripts

- `migrate.mjs` — apply `supabase/migrations/*.sql` through the Supabase Management API (`npm run db:migrate`).
- `e2e_smoke.py` — Playwright smoke test of the deployed app on phone and desktop (sign up → new note → write → add code → reload → search code → delete), saves screenshots.
- `e2e_server.py` — Pro server runs and Fix: free user sees the Pro note and gets 403; Pro user runs Python (with `# pip:`) and C on Modal, Fix proposes a minimal diff, Accept, re-run.
- `e2e_last_run.py` — phone: a block's latest run (browser, and with `E2E_ONLY=server`/`SERVER=1` on a Pro account, server) survives leaving the note and reloading; editing marks it "Output from an earlier version"; Clear removes it for good.
- `e2e_outcome.py` — phone, fresh account: a failing run leaves the note unmarked; marking Successful/Failed/unmarked persists across reloads; list dots; the outcome filter alone, with search, and on a project page.
- `rls_check.py` — proves a second account can't read or modify the first account's rows, or raise its own plan.

Python deps: `pip install playwright requests && python -m playwright install chromium`.
