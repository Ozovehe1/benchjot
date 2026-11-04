-- Note nesting and note links.
--
-- Nesting: entries.parent_id, an optional parent note. The composite FK
-- (parent_id, user_id) -> entries (id, user_id) means a parent is always one
-- of the owner's own notes; deleting a parent un-nests its children. A trigger
-- refuses cycles (a note can't sit under itself or under one of its own sub-notes).
--
-- Links: written in the note body as [[Title|<note id>]] (src/lib/links.ts).
-- The body is the single source of truth; nothing is stored separately.
-- note_links() derives the links from the bodies on read, so a link can never
-- go stale and renaming a note never breaks one (the id is what counts).

alter table public.entries add column if not exists parent_id uuid;
alter table public.entries add constraint entries_parent_fkey
  foreign key (parent_id, user_id) references public.entries (id, user_id) on delete set null (parent_id);
alter table public.entries add constraint entries_parent_not_self check (parent_id is null or parent_id <> id);
create index if not exists entries_parent_idx on public.entries (parent_id);

create or replace function public.entries_parent_no_cycle()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.parent_id is null then
    return new;
  end if;
  -- Serialise re-parenting per owner so two concurrent moves can't form a cycle together.
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
  if exists (
    with recursive up(id, parent_id, depth) as (
      select e.id, e.parent_id, 1 from public.entries e where e.id = new.parent_id
      union all
      select e.id, e.parent_id, up.depth + 1
        from public.entries e join up on e.id = up.parent_id
       where up.depth < 10000
    )
    select 1 from up where up.id = new.id
  ) then
    raise exception 'A note can''t be nested under itself or one of its sub-notes'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger entries_parent_no_cycle
  before insert or update of parent_id on public.entries
  for each row execute function public.entries_parent_no_cycle();

-- Every [[label]] / [[label|id]] link in the caller's notes (RLS applies:
-- security invoker). The pattern matches LINK_PATTERN in src/lib/links.ts.
-- `target` is the id when the link carries one; label-only links are
-- resolved by title in the app.
create or replace function public.note_links()
returns table (source uuid, label text, target uuid)
language sql stable security invoker set search_path = '' as $$
  select e.id, m[1], m[2]::uuid
    from public.entries e,
         regexp_matches(e.notes, '\[\[([^]|[\n]+)(?:\|([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}))?\]\]', 'g') as m
   where strpos(e.notes, '[[') > 0
$$;
revoke all on function public.note_links() from anon, public;
grant execute on function public.note_links() to authenticated;
