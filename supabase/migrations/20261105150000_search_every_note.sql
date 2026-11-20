-- Lists showed at most 500 notes (search_entries had 'limit 500'): return every match, in a
-- stable order, and let the apps page through it (src/lib/data.ts allRows, PostgREST's 1000-row cap).
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
                      coalesce((select string_agg(s.content, ' ') from public.snippets s where s.entry_id = e.id), '')),
                lower(t)) = 0
     )
   order by e.updated_at desc, e.id
$$;
revoke all on function public.search_entries(text[], uuid, boolean, text) from anon, public;
grant execute on function public.search_entries(text[], uuid, boolean, text) to authenticated;
