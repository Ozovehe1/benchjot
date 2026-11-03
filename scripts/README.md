# Scripts

- `migrate.mjs` — apply `supabase/migrations/*.sql` through the Supabase Management API (`npm run db:migrate`).
- `e2e_smoke.py` — Playwright smoke test of the deployed app (sign up → experiment → snippet → reload → history → notes → runs → compare → search → export → fork), saves phone + desktop screenshots.
- `rls_check.py` — proves a second account can't read or modify the first account's rows.

Python deps: `pip install playwright requests && python -m playwright install chromium`.
