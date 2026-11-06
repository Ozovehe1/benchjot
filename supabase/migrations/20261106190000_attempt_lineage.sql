-- Attempt lineage: entries.derived_from, and new_attempt() to make one.
--
-- derived_from is the note a note is a new attempt of. The composite FK
-- (derived_from, user_id) -> entries (id, user_id) means it is always one of the
-- owner's own notes; deleting the origin clears the link (the attempt stays).
-- A trigger refuses cycles, like entries_parent_no_cycle. The Research Map draws
-- these as origin -> attempt arrows (src/lib/graph.ts, kind "derived").

alter table public.entries add column if not exists derived_from uuid;
alter table public.entries add constraint entries_derived_fkey
  foreign key (derived_from, user_id) references public.entries (id, user_id) on delete set null (derived_from);
alter table public.entries add constraint entries_derived_not_self check (derived_from is null or derived_from <> id);
create index if not exists entries_derived_idx on public.entries (derived_from);

create or replace function public.entries_derived_no_cycle()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.derived_from is null then
    return new;
  end if;
  -- Serialise lineage changes per owner so two concurrent updates can't form a cycle together.
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 1));
  if exists (
    with recursive up(id, derived_from, depth) as (
      select e.id, e.derived_from, 1 from public.entries e where e.id = new.derived_from
      union all
      select e.id, e.derived_from, up.depth + 1
        from public.entries e join up on e.id = up.derived_from
       where up.depth < 10000
    )
    select 1 from up where up.id = new.id
  ) then
    raise exception 'A note can''t be an attempt of itself or of one of its own attempts'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger entries_derived_no_cycle
  before insert or update of derived_from on public.entries
  for each row execute function public.entries_derived_no_cycle();

-- A new attempt of one of the caller's notes, in one transaction (RLS applies:
-- security invoker). Copies the body, project and parent, and every code cell's
-- filename, language, content and position. Not the cells' runs (a copied run
-- would claim a result this attempt never produced) and not the outcome.
-- Title: "<base> (attempt N)": base is the origin's title without a trailing
-- " (attempt N)" ('Untitled' when empty); N = notes in the lineage family (the
-- root and every note derived from it) + 1. Both apps call this; neither builds
-- the title itself.
create or replace function public.new_attempt(p_from uuid)
returns uuid
language plpgsql volatile security invoker set search_path = '' as $$
declare
  src public.entries;
  root uuid;
  family integer;
  base text;
  suffix text;
  new_id uuid;
begin
  select * into src from public.entries where id = p_from;
  if not found then
    raise exception 'Note not found' using errcode = 'P0002';
  end if;

  with recursive up(id, derived_from, depth) as (
    select e.id, e.derived_from, 1 from public.entries e where e.id = p_from
    union all
    select e.id, e.derived_from, up.depth + 1
      from public.entries e join up on e.id = up.derived_from
     where up.depth < 10000
  )
  select u.id into root from up u where u.derived_from is null or not exists (select 1 from public.entries x where x.id = u.derived_from)
   order by u.depth desc limit 1;

  with recursive down(id, depth) as (
    select root, 1
    union all
    select e.id, down.depth + 1
      from public.entries e join down on e.derived_from = down.id
     where down.depth < 10000
  )
  select count(distinct id) into family from down;

  base := nullif(btrim(regexp_replace(src.title, '\s*\(attempt \d+\)\s*$', '')), '');
  base := coalesce(base, 'Untitled');
  suffix := ' (attempt ' || (family + 1) || ')';
  base := left(base, 200 - char_length(suffix));

  insert into public.entries (user_id, title, notes, project_id, parent_id, derived_from)
  values (src.user_id, base || suffix, src.notes, src.project_id, src.parent_id, src.id)
  returning id into new_id;

  insert into public.snippets (user_id, entry_id, filename, language, content, position)
  select s.user_id, new_id, s.filename, s.language, s.content, s.position
    from public.snippets s
   where s.entry_id = src.id
   order by s.position, s.created_at;

  return new_id;
end $$;
revoke all on function public.new_attempt(uuid) from anon, public;
grant execute on function public.new_attempt(uuid) to authenticated;
