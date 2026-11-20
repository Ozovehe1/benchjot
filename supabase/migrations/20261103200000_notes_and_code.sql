-- Strip the schema down to two things: entries (title + Markdown note) and
-- their code snippets. Existing rows are kept (renamed in place); projects,
-- runs, versions, tags, status, pin and full-text machinery are dropped.

-- ---------------------------------------------------------------- functions & triggers no longer used
drop function if exists public.search_experiments(text, text[], text[], text, uuid);
drop function if exists public.fork_experiment(uuid);
drop function if exists public.my_tags();

drop trigger if exists snippets_version on public.snippets;
drop function if exists public.snippets_record_version();
drop trigger if exists experiments_fts on public.experiments;
drop function if exists public.experiments_fts_update();
drop trigger if exists snippets_fts on public.snippets;
drop function if exists public.snippets_fts_update();

-- ---------------------------------------------------------------- tables no longer used
drop table if exists public.runs;
drop table if exists public.snippet_versions;

-- ---------------------------------------------------------------- experiments -> entries
alter table public.experiments
  drop column project_id,
  drop column hypothesis,
  drop column status,
  drop column tags,
  drop column pinned,
  drop column started_on,
  drop column ended_on,
  drop column fts;
drop table if exists public.projects;

alter table public.experiments rename to entries;
alter table public.entries drop constraint experiments_title_check;
alter table public.entries alter column title set default '';
alter table public.entries add constraint entries_title_check check (char_length(title) <= 200);
alter table public.entries rename constraint experiments_notes_check to entries_notes_check;
alter table public.entries rename constraint experiments_pkey to entries_pkey;
alter table public.entries rename constraint experiments_id_user_id_key to entries_id_user_id_key;
alter table public.entries rename constraint experiments_user_id_fkey to entries_user_id_fkey;
alter trigger experiments_touch on public.entries rename to entries_touch;
create index entries_user_idx on public.entries (user_id, updated_at desc);

-- ---------------------------------------------------------------- snippets
drop index if exists public.snippets_language_idx;
alter table public.snippets drop column filename, drop column fts;
alter table public.snippets rename column experiment_id to entry_id;
alter index public.snippets_experiment_idx rename to snippets_entry_idx;
alter table public.snippets rename constraint snippets_experiment_id_user_id_fkey to snippets_entry_fkey;

-- Editing code counts as editing the entry (keeps the list ordered by last edit).
create or replace function public.touch_parent_entry()
returns trigger language plpgsql as $$
begin
  update public.entries set updated_at = now()
   where id = coalesce(new.entry_id, old.entry_id);
  return null;
end $$;
create trigger snippets_touch_entry after insert or update or delete on public.snippets
  for each row execute function public.touch_parent_entry();

-- ---------------------------------------------------------------- search
-- Plain, case-insensitive substring search: every term must appear somewhere
-- in the title, the note or the code. strpos() means no pattern syntax to
-- escape. Runs as the caller, so RLS applies.
create or replace function public.search_entries(terms text[] default '{}')
returns setof public.entries
language sql stable security invoker set search_path = public as $$
  select e.*
    from public.entries e
   where not exists (
     select 1
       from unnest(coalesce(terms, '{}')) as t
      where strpos(
              lower(e.title || ' ' || e.notes || ' ' ||
                    coalesce((select string_agg(s.content, ' ') from public.snippets s where s.entry_id = e.id), '')),
              lower(t)) = 0
   )
   order by e.updated_at desc
   limit 500
$$;
revoke all on function public.search_entries(text[]) from anon, public;
grant execute on function public.search_entries(text[]) to authenticated;
