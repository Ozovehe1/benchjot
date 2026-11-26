-- Sharing with people (as Google Docs and Notion do): a note's link has a general access, either
-- "people" (only the people its owner invited, signed in) or "link" (anyone with the link). Invited
-- people keep the note in their "Shared with me" list until the owner removes them or stops
-- sharing. New links start as "people". Everything that opens a shared note checks this: the page
-- (shared_note), its files (share_file_ok), copying (copy_shared_note).

alter table public.note_shares add column if not exists access text not null default 'people' check (access in ('people', 'link'));
-- Links made before this (by the first sharing migration) were anyone-with-the-link.
update public.note_shares set access = 'link' where created_at < now();
grant insert (access) on public.note_shares to authenticated;
grant update (access) on public.note_shares to authenticated;

create or replace function private.note_shares_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists note_shares_touch on public.note_shares;
create trigger note_shares_touch before update on public.note_shares
  for each row when (old.show_code is distinct from new.show_code or old.allow_copy is distinct from new.allow_copy
    or old.indexable is distinct from new.indexable or old.expires_at is distinct from new.expires_at or old.token is distinct from new.token
    or old.access is distinct from new.access)
  execute function private.note_shares_touch();

create table if not exists public.note_share_people (
  entry_id  uuid not null references public.note_shares(entry_id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  added_at  timestamptz not null default now(),
  -- "invite": the owner added them (they keep access until removed); "link": they opened it through
  -- an anyone-with-the-link link while signed in (it stays in their list while the link is open to all).
  via       text not null default 'invite' check (via in ('invite', 'link')),
  primary key (entry_id, user_id)
);
create index if not exists note_share_people_user_idx on public.note_share_people (user_id, added_at desc);
alter table public.note_share_people enable row level security;
-- Read only: the owner sees who has access, each person sees their own rows. Changes go through
-- share_invite / share_remove, which check the owner and find people by username.
drop policy if exists "note_share_people owner or person reads" on public.note_share_people;
create policy "note_share_people owner or person reads" on public.note_share_people for select to authenticated
  using (user_id = (select auth.uid())
    or exists (select 1 from public.note_shares s where s.entry_id = note_share_people.entry_id and s.user_id = (select auth.uid())));
revoke all on public.note_share_people from anon, authenticated;
grant select on public.note_share_people to authenticated;

-- Whether the caller may open this link's note: anyone for a link-access note; else its owner or an invited person.
create or replace function private.can_view(sh public.note_shares) returns boolean
language sql stable security definer set search_path = '' as $$
  -- Never null: a signed-out caller (no auth.uid()) is a plain no for a people-only note.
  select coalesce(sh.entry_id is not null and (
    sh.access = 'link'
    or sh.user_id = (select auth.uid())
    or exists (select 1 from public.note_share_people p where p.entry_id = sh.entry_id and p.user_id = (select auth.uid()) and p.via = 'invite')), false);
$$;
revoke all on function private.can_view(public.note_shares) from public, anon, authenticated;

-- Invite someone by username to the caller's shared note. Answers who it was.
create or replace function public.share_invite(note uuid, name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  person uuid;
  shown text;
begin
  if not exists (select 1 from public.note_shares s where s.entry_id = note and s.user_id = (select auth.uid())) then
    raise exception 'This note isn''t shared' using errcode = 'P0002';
  end if;
  select p.user_id, p.username into person, shown from public.profiles p where lower(p.username) = lower(trim(leading '@' from trim(name)));
  if person is null then raise exception 'No one has that username' using errcode = 'P0002'; end if;
  if person = (select auth.uid()) then raise exception 'That’s you: you already have this note' using errcode = '22023'; end if;
  insert into public.note_share_people (entry_id, user_id, via) values (note, person, 'invite')
    on conflict (entry_id, user_id) do update set via = 'invite', added_at = now();
  return jsonb_build_object('user_id', person, 'username', shown);
end $$;
revoke all on function public.share_invite(uuid, text) from public, anon;
grant execute on function public.share_invite(uuid, text) to authenticated;

-- Remove someone's access to the caller's shared note.
create or replace function public.share_remove(note uuid, person uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.note_share_people p
   where p.entry_id = note and p.user_id = person
     and exists (select 1 from public.note_shares s where s.entry_id = note and s.user_id = (select auth.uid()));
$$;
revoke all on function public.share_remove(uuid, uuid) from public, anon;
grant execute on function public.share_remove(uuid, uuid) to authenticated;

-- Who has access to the caller's shared note: username and when they were added.
create or replace function public.share_people(note uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('user_id', p.user_id, 'username', pr.username, 'added_at', p.added_at) order by p.added_at), '[]'::jsonb)
    from public.note_share_people p
    join public.note_shares s on s.entry_id = p.entry_id and s.user_id = (select auth.uid())
    left join public.profiles pr on pr.user_id = p.user_id
   where p.entry_id = note and p.via = 'invite';
$$;
revoke all on function public.share_people(uuid) from public, anon;
grant execute on function public.share_people(uuid) to authenticated;

-- The notes others shared with the caller, newest first: those they were added to, and those they
-- opened through a link that is still open to anyone (all while sharing hasn't stopped or ended).
create or replace function public.shared_with_me() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'entry_id', e.id, 'title', e.title, 'outcome', e.outcome, 'token', s.token,
           'author', (select pr.username from public.profiles pr where pr.user_id = e.user_id),
           'added_at', p.added_at, 'updated_at', e.updated_at) order by p.added_at desc), '[]'::jsonb)
    from public.note_share_people p
    join public.note_shares s on s.entry_id = p.entry_id and (s.expires_at is null or s.expires_at > now())
    join public.entries e on e.id = s.entry_id
   where p.user_id = (select auth.uid()) and (p.via = 'invite' or s.access = 'link');
$$;
revoke all on function public.shared_with_me() from public, anon;
grant execute on function public.shared_with_me() to authenticated;

-- The page: as before, plus the access; a people-only note answers only {"restricted": true} to
-- anyone else (the page asks them to sign in, or says they don't have access).
create or replace function public.shared_note(t text, seen boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  sh public.note_shares;
  e public.entries;
  out jsonb;
begin
  sh := private.live_share(t);
  if sh.entry_id is null then return null; end if;
  if not private.can_view(sh) then return jsonb_build_object('restricted', true); end if;
  select * into e from public.entries where id = sh.entry_id;
  if e.id is null then return null; end if;
  if seen then
    update public.note_shares set views = views + 1 where entry_id = sh.entry_id;
    -- A signed-in reader who opened it through the link keeps it in their Shared with me list.
    if (select auth.uid()) is not null and (select auth.uid()) <> sh.user_id then
      insert into public.note_share_people (entry_id, user_id, via) values (sh.entry_id, (select auth.uid()), 'link') on conflict do nothing;
    end if;
  end if;
  select jsonb_build_object(
    'token', sh.token,
    'access', sh.access,
    'mine', sh.user_id = (select auth.uid()),
    'show_code', sh.show_code,
    'allow_copy', sh.allow_copy and sh.show_code,
    'indexable', sh.indexable and sh.access = 'link',
    'expires_at', sh.expires_at,
    'author', (select p.username from public.profiles p where p.user_id = e.user_id),
    'entry', jsonb_build_object('id', e.id, 'title', e.title, 'notes', e.notes, 'outcome', e.outcome,
      'updated_at', greatest(e.updated_at, (select max(s.updated_at) from public.snippets s where s.entry_id = e.id))),
    'snippets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'filename', s.filename, 'language', s.language,
        'content', case when sh.show_code then s.content else '' end,
        'last_run', s.last_run, 'note_before', s.note_before, 'note_after', s.note_after) order by s.position, s.created_at)
      from public.snippets s where s.entry_id = e.id), '[]'::jsonb),
    'links', coalesce((
      select jsonb_object_agg(o.entry_id, o.token)
      from public.note_shares o
      where o.user_id = e.user_id and o.entry_id <> e.id and private.can_view(o)
        and (o.expires_at is null or o.expires_at > now())
        and o.entry_id in (
          select lower(m[2])::uuid from regexp_matches(e.notes,
            '\[\[([^]|[\n]+)(?:\|([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}))?\]\]', 'g') m
          where m[2] is not null)), '{}'::jsonb)
  ) into out;
  return out;
end $$;
revoke all on function public.shared_note(text, boolean) from public;
grant execute on function public.shared_note(text, boolean) to anon, authenticated;

-- Files: the link's token in the header, the caller allowed to open it, and the note's current run.
create or replace function public.share_file_ok(name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from private.live_share(nullif(nullif(current_setting('request.headers', true), '')::json ->> 'x-bj-share', '')) sh
      join public.snippets s on s.entry_id = sh.entry_id and s.user_id = sh.user_id
     where sh.entry_id is not null and private.can_view(sh)
       and s.last_run -> 'outputs' ->> 'dir' = (sh.user_id::text || '/' || s.id::text || '/' || split_part(name, '/', 3))
       and split_part(name, '/', 1) = sh.user_id::text
       and split_part(name, '/', 2) = s.id::text
       and split_part(name, '/', 5) = ''
  );
$$;
revoke all on function public.share_file_ok(text) from public;
grant execute on function public.share_file_ok(text) to anon, authenticated;

-- Signed-in people (an invited person, or the owner) sign a shared note's files as themselves.
drop policy if exists "run outputs: shared note reads" on storage.objects;
create policy "run outputs: shared note reads" on storage.objects for select to anon, authenticated
  using (bucket_id = 'run-outputs'
    and (nullif(current_setting('request.headers', true), '')::json ->> 'x-bj-share') is not null
    and public.share_file_ok(name));

-- Copying needs access too.
create or replace function private.copy_allowed(t text) returns public.note_shares
language plpgsql stable security definer set search_path = '' as $$
declare sh public.note_shares;
begin
  sh := private.live_share(t);
  if sh.entry_id is null or not private.can_view(sh) or not sh.allow_copy or not sh.show_code then
    raise exception 'This note can''t be copied' using errcode = 'P0002';
  end if;
  return sh;
end $$;
revoke all on function private.copy_allowed(text) from public, anon, authenticated;

create or replace function public.copy_shared_note(t text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  sh public.note_shares;
  e public.entries;
  author text;
  new_id uuid := gen_random_uuid();
  cell_id uuid;
  cells jsonb := '[]'::jsonb;
  r record;
begin
  if me is null then raise exception 'Sign in first' using errcode = '28000'; end if;
  sh := private.copy_allowed(t);
  select * into e from public.entries where id = sh.entry_id;
  select p.username into author from public.profiles p where p.user_id = e.user_id;
  insert into public.entries (id, user_id, title, notes)
  values (new_id, me, e.title, left(
    '> Copied from a note' || coalesce(' by @' || author, '') || ' shared on Benchjot, ' || to_char(now(), 'DD Mon YYYY') || '.' || E'\n\n' ||
    regexp_replace(e.notes, '\[\[([^]|[\n]+)(?:\|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})?\]\]', '\1', 'g'),
    200000));
  for r in select * from public.snippets s where s.entry_id = e.id order by s.position, s.created_at loop
    cell_id := gen_random_uuid();
    insert into public.snippets (id, user_id, entry_id, language, content, position, filename, last_run, note_before, note_after)
    values (cell_id, me, new_id, r.language, r.content, r.position, r.filename,
            case when r.last_run is null then null else r.last_run - 'outputs' end, r.note_before, r.note_after);
    cells := cells || jsonb_build_object('id', cell_id, 'outputs', r.last_run -> 'outputs');
  end loop;
  return jsonb_build_object('id', new_id, 'cells', cells);
end $$;
revoke all on function public.copy_shared_note(text) from public, anon;
grant execute on function public.copy_shared_note(text) to authenticated;
