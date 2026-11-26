-- Helper history (user-approved 2026-11-06). Each answered helper turn is saved with its note, owner
-- only, on web and Android alike. Turns are kept whole for 30 days; then helper_condense() folds them
-- into the note's one summary, built from the records themselves (no model call): one line per turn,
-- "YYYY-MM-DD Write: <request> — <answer's summary>", oldest first, at most 4,000 characters with the
-- newest lines kept. The numbers match HELPER_HISTORY in src/config/app.ts (a test checks).
-- pg_cron runs helper_condense() hourly where the extension exists (Supabase); elsewhere nothing is
-- scheduled (tests call the function directly).

create table if not exists public.helper_turns (
  id         uuid primary key default gen_random_uuid(),
  entry_id   uuid not null references public.entries (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task       text not null check (task in ('write', 'ask')),
  request    text not null check (char_length(request) between 1 and 2000),
  -- {kind:"code", code, summary, language} or {kind:"prose", text}: the answer as the panel shows it.
  answer     jsonb not null check (coalesce(
               jsonb_typeof(answer) = 'object'
               and ((answer ->> 'kind' = 'code' and jsonb_typeof(answer -> 'code') = 'string')
                 or (answer ->> 'kind' = 'prose' and jsonb_typeof(answer -> 'text') = 'string'))
               and octet_length(answer::text) <= 200000, false)),
  created_at timestamptz not null default now()
);
create index if not exists helper_turns_entry_idx on public.helper_turns (entry_id, created_at);
create index if not exists helper_turns_created_idx on public.helper_turns (created_at);

alter table public.helper_turns enable row level security;
drop policy if exists "helper_turns owner select" on public.helper_turns;
create policy "helper_turns owner select" on public.helper_turns for select to authenticated
  using (user_id = auth.uid());
-- A turn goes only on the user's own note. Turns are never edited.
drop policy if exists "helper_turns owner insert" on public.helper_turns;
create policy "helper_turns owner insert" on public.helper_turns for insert to authenticated
  with check (user_id = auth.uid()
              and exists (select 1 from public.entries e where e.id = entry_id and e.user_id = auth.uid()));
drop policy if exists "helper_turns owner delete" on public.helper_turns;
create policy "helper_turns owner delete" on public.helper_turns for delete to authenticated
  using (user_id = auth.uid());
revoke update on public.helper_turns from anon, authenticated;

create table if not exists public.helper_summaries (
  entry_id   uuid primary key references public.entries (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  summary    text not null check (char_length(summary) <= 4000),
  turns      integer not null check (turns > 0),
  updated_at timestamptz not null default now()
);
alter table public.helper_summaries enable row level security;
-- Read and Clear (delete) only; only helper_condense() writes it.
drop policy if exists "helper_summaries owner select" on public.helper_summaries;
create policy "helper_summaries owner select" on public.helper_summaries for select to authenticated
  using (user_id = auth.uid());
drop policy if exists "helper_summaries owner delete" on public.helper_summaries;
create policy "helper_summaries owner delete" on public.helper_summaries for delete to authenticated
  using (user_id = auth.uid());
revoke insert, update on public.helper_summaries from anon, authenticated;

-- The newest whole lines of `t` that fit in `max_chars` (a single longer line keeps its end).
create or replace function private.helper_keep_tail(t text, max_chars integer)
returns text language sql immutable set search_path = '' as $$
  select case
    when char_length(t) <= max_chars then t
    else coalesce(
      (select string_agg(line, E'\n' order by i)
         from (select line, i, sum(char_length(line) + 1) over (order by i desc) - 1 as acc
                 from unnest(string_to_array(t, E'\n')) with ordinality as u(line, i)) x
        where acc <= max_chars),
      right(t, max_chars))
  end
$$;

-- One turn as one summary line: its day (UTC), task, request and the answer's own summary.
create or replace function private.helper_line(task text, request text, answer jsonb, created_at timestamptz)
returns text language sql immutable set search_path = '' as $$
  select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') || ' '
      || case task when 'write' then 'Write' else 'Ask' end || ': '
      || left(btrim(regexp_replace(request, '\s+', ' ', 'g')), 160) || ' — '
      || left(btrim(regexp_replace(
           case answer ->> 'kind'
             when 'code' then coalesce(nullif(btrim(answer ->> 'summary'), ''), 'Proposed ' || coalesce(nullif(answer ->> 'language', ''), 'code') || ' code.')
             else answer ->> 'text'
           end, '\s+', ' ', 'g')), 160)
$$;

-- Folds every turn older than `p_before` into its note's summary and deletes it. Returns how many
-- notes' summaries changed. Run by pg_cron; not callable by app users.
create or replace function public.helper_condense(p_before timestamptz default now() - interval '30 days')
returns integer language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  with old as (
    delete from public.helper_turns t where t.created_at < p_before
    returning t.id, t.entry_id, t.user_id, t.task, t.request, t.answer, t.created_at
  ), lines as (
    select o.entry_id, o.user_id,
           string_agg(private.helper_line(o.task, o.request, o.answer, o.created_at), E'\n' order by o.created_at, o.id) as text,
           count(*)::integer as c
      from old o
     group by o.entry_id, o.user_id
  )
  insert into public.helper_summaries as s (entry_id, user_id, summary, turns)
  select l.entry_id, l.user_id, private.helper_keep_tail(l.text, 4000), l.c
    from lines l
   where exists (select 1 from public.entries e where e.id = l.entry_id)
  on conflict (entry_id) do update
     set summary = private.helper_keep_tail(s.summary || E'\n' || excluded.summary, 4000),
         turns = s.turns + excluded.turns,
         updated_at = now();
  get diagnostics n = row_count;
  return n;
end
$$;
revoke all on function public.helper_condense(timestamptz) from public, anon, authenticated;
revoke all on function private.helper_keep_tail(text, integer) from public, anon, authenticated;
revoke all on function private.helper_line(text, text, jsonb, timestamptz) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('benchjot-helper-condense', '17 * * * *', 'select public.helper_condense()');
  end if;
end
$$;
