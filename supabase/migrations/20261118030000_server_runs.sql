-- Background server runs (2026-11-18): a Python run on Modal that may outlast the request (up to an
-- hour for Pro). /api/runs starts it and adds a row here; the page polls the row; the sandbox sends
-- its result to /api/runs/<id>/complete, which stores it here even if no page is open; the page
-- that next shows the cell saves it as the cell's last run and clears `result`.
--
-- Rows are the owner's (RLS). The sandbox has no user session: it proves which run it finished with
-- that run's one-time token, kept here only as a SHA-256 hash; two functions check it, and they
-- are the only way to touch a row without being its owner.

create table if not exists public.server_runs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  snippet_id  uuid references public.snippets(id) on delete set null,
  status      text not null default 'running' check (status in ('running', 'done', 'stopped', 'failed')),
  meta        jsonb not null default '{}',   -- language, gpu, network, note: to build the result
  notice      text,                          -- where it ran (auto GPU), shown before its output
  limit_sec   int not null check (limit_sec between 1 and 3600),
  sandbox_id  text,
  token_hash  text not null,
  result      jsonb,                         -- the finished run, until the page saves it
  error       text,                          -- why a run failed without a result
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists server_runs_user_status on public.server_runs (user_id, status);
create index if not exists server_runs_snippet on public.server_runs (snippet_id, started_at desc);

alter table public.server_runs enable row level security;
drop policy if exists "server_runs owner select" on public.server_runs;
drop policy if exists "server_runs owner insert" on public.server_runs;
drop policy if exists "server_runs owner update" on public.server_runs;
drop policy if exists "server_runs owner delete" on public.server_runs;
create policy "server_runs owner select" on public.server_runs for select to authenticated using (user_id = (select auth.uid()));
create policy "server_runs owner insert" on public.server_runs for insert to authenticated with check (user_id = (select auth.uid()));
create policy "server_runs owner update" on public.server_runs for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "server_runs owner delete" on public.server_runs for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.server_runs from anon, public;
grant select, insert, update, delete on public.server_runs to authenticated;

-- The sandbox, with its run's token: what it needs to build the result (only while the run is running).
create or replace function public.server_run_meta(run_id uuid, token text) returns jsonb
  language sql stable security definer set search_path = '' as $$
  select r.meta from public.server_runs r
  where r.id = server_run_meta.run_id
    and r.status = 'running'
    and r.token_hash = encode(extensions.digest(server_run_meta.token, 'sha256'), 'hex')
$$;

-- The sandbox, with its run's token: stores the finished run. False when the token doesn't match or
-- the run isn't running any more (stopped meanwhile): nothing changes then.
create or replace function public.complete_server_run(run_id uuid, token text, result jsonb) returns boolean
  language plpgsql volatile security definer set search_path = '' as $$
begin
  update public.server_runs r
     set status = 'done', result = complete_server_run.result, finished_at = now()
   where r.id = complete_server_run.run_id
     and r.status = 'running'
     and r.token_hash = encode(extensions.digest(complete_server_run.token, 'sha256'), 'hex');
  return found;
end $$;

revoke all on function public.server_run_meta(uuid, text) from public;
revoke all on function public.complete_server_run(uuid, text, jsonb) from public;
-- The sandbox calls them signed out; the token is the check.
grant execute on function public.server_run_meta(uuid, text) to anon, authenticated;
grant execute on function public.complete_server_run(uuid, text, jsonb) to anon, authenticated;
