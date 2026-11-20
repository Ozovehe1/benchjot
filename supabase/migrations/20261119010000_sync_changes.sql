-- Sync by changes. Devices keep a full copy of the account (offline first) and, once they have
-- one, ask only for what changed since they last asked: sync_changes(since) returns the notes and
-- cells edited after `since` and what was deleted after it, so a sync costs what changed, not the
-- size of the account. Deletions are kept as ids only (deleted_rows) for 90 days; a device away
-- longer reads the whole account again.
--
-- Also, for many users: cells get an index by owner (every per-account read of cells used to scan
-- all users' cells), and the Helper history policies read the user once per query, not per row.

create table if not exists public.deleted_rows (
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('entry', 'snippet', 'project')),
  id         uuid not null,
  deleted_at timestamptz not null default now(),
  primary key (kind, id)
);
create index if not exists deleted_rows_user_idx on public.deleted_rows (user_id, deleted_at);
alter table public.deleted_rows enable row level security;
drop policy if exists "deleted_rows owner select" on public.deleted_rows;
create policy "deleted_rows owner select" on public.deleted_rows
  for select to authenticated using (user_id = (select auth.uid()));
revoke insert, update, delete on public.deleted_rows from anon, authenticated;

-- Records a deleted note, cell or project (argument: its kind), and forgets this user's records
-- older than 90 days. Skipped while the account itself is being deleted (its rows go with it).
create or replace function private.note_deleted() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from auth.users u where u.id = old.user_id) then
    return old;
  end if;
  insert into public.deleted_rows (user_id, kind, id) values (old.user_id, tg_argv[0], old.id)
    on conflict (kind, id) do update set deleted_at = excluded.deleted_at, user_id = excluded.user_id;
  delete from public.deleted_rows d where d.user_id = old.user_id and d.deleted_at < now() - interval '90 days';
  return old;
end $$;
revoke all on function private.note_deleted() from public, anon, authenticated;

drop trigger if exists entries_deleted on public.entries;
create trigger entries_deleted after delete on public.entries
  for each row execute function private.note_deleted('entry');
drop trigger if exists snippets_deleted on public.snippets;
create trigger snippets_deleted after delete on public.snippets
  for each row execute function private.note_deleted('snippet');
drop trigger if exists projects_deleted on public.projects;
create trigger projects_deleted after delete on public.projects
  for each row execute function private.note_deleted('project');

-- What changed in the caller's account since `since` (with two minutes of overlap, so a change
-- saved while the last sync was being read is never missed; resending a row is harmless).
-- `complete` is false when `since` is older than the deletions kept: read the whole account then.
create or replace function public.sync_changes(since timestamptz)
returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'at', now(),
    'complete', since > now() - interval '89 days',
    'entries', coalesce((select jsonb_agg(to_jsonb(e)) from public.entries e
                          where e.user_id = (select auth.uid()) and e.updated_at > since - interval '2 minutes'), '[]'::jsonb),
    'snippets', coalesce((select jsonb_agg(to_jsonb(s)) from public.snippets s
                           where s.user_id = (select auth.uid()) and s.updated_at > since - interval '2 minutes'), '[]'::jsonb),
    'deleted', coalesce((select jsonb_agg(jsonb_build_object('kind', d.kind, 'id', d.id)) from public.deleted_rows d
                          where d.user_id = (select auth.uid()) and d.deleted_at > since - interval '2 minutes'), '[]'::jsonb)
  )
$$;
revoke all on function public.sync_changes(timestamptz) from anon, public;
grant execute on function public.sync_changes(timestamptz) to authenticated;

-- Indexes for per-account reads and for removing an account.
create index if not exists snippets_user_idx on public.snippets (user_id, updated_at);
create index if not exists helper_turns_user_idx on public.helper_turns (user_id);
create index if not exists helper_summaries_user_idx on public.helper_summaries (user_id);
create index if not exists android_waitlist_user_idx on private.android_waitlist (user_id);

-- The Helper history policies: the signed-in user read once per query.
alter policy "helper_turns owner select" on public.helper_turns using (user_id = (select auth.uid()));
alter policy "helper_turns owner delete" on public.helper_turns using (user_id = (select auth.uid()));
alter policy "helper_turns owner insert" on public.helper_turns with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.entries e where e.id = helper_turns.entry_id and e.user_id = (select auth.uid()))
);
alter policy "helper_summaries owner select" on public.helper_summaries using (user_id = (select auth.uid()));
alter policy "helper_summaries owner delete" on public.helper_summaries using (user_id = (select auth.uid()));
