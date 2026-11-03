-- Projects are plain folders: a name, owner-only. An entry is in at most one
-- project or unfiled. Deleting a project unfiles its entries.
create table public.projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, user_id)
);
create index projects_user_idx on public.projects (user_id, name);
create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();

alter table public.projects enable row level security;
alter table public.projects force row level security;
create policy owner_select on public.projects for select to authenticated using ((select auth.uid()) = user_id);
create policy owner_insert on public.projects for insert to authenticated with check ((select auth.uid()) = user_id);
create policy owner_update on public.projects for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy owner_delete on public.projects for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on public.projects from anon;
grant select, insert, update, delete on public.projects to authenticated;

-- (project_id, user_id) can only point at one of the user's own projects.
alter table public.entries add column project_id uuid;
alter table public.entries add constraint entries_project_fkey
  foreign key (project_id, user_id) references public.projects (id, user_id) on delete set null (project_id);
create index entries_project_idx on public.entries (project_id, updated_at desc);

-- Search, optionally within one project or among unfiled entries only.
drop function if exists public.search_entries(text[]);
create or replace function public.search_entries(
  terms     text[]  default '{}',
  p_project uuid    default null,
  p_unfiled boolean default false
)
returns setof public.entries
language sql stable security invoker set search_path = public as $$
  select e.*
    from public.entries e
   where (p_project is null or e.project_id = p_project)
     and (not coalesce(p_unfiled, false) or e.project_id is null)
     and not exists (
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
revoke all on function public.search_entries(text[], uuid, boolean) from anon, public;
grant execute on function public.search_entries(text[], uuid, boolean) to authenticated;
