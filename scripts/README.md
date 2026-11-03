# Scripts

- `migrate.mjs` — apply `supabase/migrations/*.sql` through the Supabase Management API (`npm run db:migrate`).
- `e2e_smoke.py` — Playwright smoke test of the deployed app on phone and desktop (sign up → new note → write → add code → reload → search code → delete), saves screenshots.
- `e2e_server.py` — Pro server runs and Fix: free user sees the Pro note and gets 403; Pro user runs Python (with `# pip:`) and C on Modal, Fix proposes a minimal diff, Accept, re-run.
- `rls_check.py` — proves a second account can't read or modify the first account's rows, or raise its own plan.

Python deps: `pip install playwright requests && python -m playwright install chromium`.
