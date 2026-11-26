-- Experiment tracking: every run whose code called log() (bj_capture.py) is kept here with what it
-- logged, so a note can show its runs side by side (the Runs table) and how a metric moved. A run
-- is history: added once, never changed; it goes with its cell or note. Each cell keeps its newest
-- 500 runs. Owner-only.
create table if not exists public.experiment_runs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  note_id    uuid not null,
  cell_id    uuid not null,
  ran_at     timestamptz not null default now(),
  outcome    text not null check (outcome in ('ok', 'error', 'timeout', 'stopped')),
  ms         integer not null check (ms >= 0),
  "where"    text not null check ("where" in ('browser', 'server', 'phone')),
  code_hash  text not null check (char_length(code_hash) between 1 and 32),
  logged     jsonb not null check (jsonb_typeof(logged) = 'object' and logged <> '{}'::jsonb and octet_length(logged::text) <= 16384),
  foreign key (note_id, user_id) references public.notes(id, user_id) on delete cascade,
  foreign key (cell_id, user_id) references public.cells(id, user_id) on delete cascade
);
create index if not exists experiment_runs_note_idx on public.experiment_runs (note_id, ran_at desc);
create index if not exists experiment_runs_cell_idx on public.experiment_runs (cell_id, ran_at desc);
create index if not exists experiment_runs_user_idx on public.experiment_runs (user_id);

alter table public.experiment_runs enable row level security;
drop policy if exists "experiment_runs owner select" on public.experiment_runs;
create policy "experiment_runs owner select" on public.experiment_runs
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "experiment_runs owner insert" on public.experiment_runs;
create policy "experiment_runs owner insert" on public.experiment_runs
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "experiment_runs owner delete" on public.experiment_runs;
create policy "experiment_runs owner delete" on public.experiment_runs
  for delete to authenticated using (user_id = (select auth.uid()));

-- History: added and removed, never edited. The id and owner are the database's.
revoke all on public.experiment_runs from anon, authenticated;
grant select, delete on public.experiment_runs to authenticated;
grant insert (note_id, cell_id, ran_at, outcome, ms, "where", code_hash, logged) on public.experiment_runs to authenticated;

-- Each cell keeps its newest 500 runs.
create or replace function private.experiment_runs_trim() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  delete from public.experiment_runs r
   where r.cell_id = new.cell_id
     and r.id in (select id from public.experiment_runs where cell_id = new.cell_id order by ran_at desc, id desc offset 500);
  return null;
end $$;
revoke all on function private.experiment_runs_trim() from public;
drop trigger if exists experiment_runs_trim on public.experiment_runs;
create trigger experiment_runs_trim after insert on public.experiment_runs
  for each row execute function private.experiment_runs_trim();
