-- Cell notes: per code cell, a "Note before run" (above the cell) and a "Note after run" (below its
-- output). Markdown, written only by the user, edited like the note body. Empty = collapsed row.
-- The snippets RLS policies (owner only, by user_id) already cover the new columns.
-- new_attempt() is unchanged on purpose: a new attempt starts with empty cell notes.

alter table public.snippets
  add column if not exists note_before text not null default '' check (char_length(note_before) <= 100000),
  add column if not exists note_after  text not null default '' check (char_length(note_after) <= 100000);

-- [[links]] in cell notes count like links in the body (backlinks and the map). Same pattern as
-- LINK_PATTERN in src/lib/links.ts (a test checks it); `source` is the note the cell belongs to.
-- security invoker: RLS on entries and snippets applies.
create or replace function public.note_links()
returns table (source uuid, label text, target uuid)
language sql stable security invoker set search_path = '' as $$
  select t.source, m[1], m[2]::uuid
    from (
      select e.id as source, e.notes as body from public.entries e where strpos(e.notes, '[[') > 0
      union all
      select s.entry_id, s.note_before from public.snippets s where strpos(s.note_before, '[[') > 0
      union all
      select s.entry_id, s.note_after from public.snippets s where strpos(s.note_after, '[[') > 0
    ) t,
         regexp_matches(t.body, '\[\[([^]|[\n]+)(?:\|([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}))?\]\]', 'g') as m
$$;
revoke all on function public.note_links() from anon, public;
grant execute on function public.note_links() to authenticated;

-- Search matches cell notes too (otherwise as 20261105150000_search_every_note.sql).
create or replace function public.search_entries(
  terms     text[]  default '{}',
  p_project uuid    default null,
  p_unfiled boolean default false,
  p_outcome text    default null
)
returns setof public.entries
language sql stable security invoker set search_path = public as $$
  select e.*
    from public.entries e
   where (p_project is null or e.project_id = p_project)
     and (not coalesce(p_unfiled, false) or e.project_id is null)
     and (p_outcome is null
          or (p_outcome = 'unmarked' and e.outcome is null)
          or e.outcome = p_outcome)
     and not exists (
       select 1
         from unnest(coalesce(terms, '{}')) as t
        where strpos(
                lower(e.title || ' ' || e.notes || ' ' ||
                      case e.outcome when 'success' then 'successful' when 'failed' then 'failed' else '' end || ' ' ||
                      coalesce((select string_agg(s.content || ' ' || s.note_before || ' ' || s.note_after, ' ')
                                  from public.snippets s where s.entry_id = e.id), '')),
                lower(t)) = 0
     )
   order by e.updated_at desc, e.id
$$;
revoke all on function public.search_entries(text[], uuid, boolean, text) from anon, public;
grant execute on function public.search_entries(text[], uuid, boolean, text) to authenticated;
