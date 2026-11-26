-- Share a note with a read-only link (/s/<token>).
--
-- One link per note, off until the owner turns it on. The token is 128 random bits, made here (never
-- chosen by a client), so a link can't be guessed; Reset gives a new one and the old link stops
-- working; Stop sharing deletes the row and the link is gone. Options: show the code (or only the
-- results), let viewers copy the note into their own account, let search engines list it (off by
-- default), and an end date. The page is live: it shows the note as it is saved now.
--
-- The page reads through shared_note(token), which returns only what the page shows. Its figures
-- are files in the private run-outputs bucket: the storage rule below lets a request read a file
-- only when it carries a valid link's token (header x-bj-share) and the file is in the current run
-- of a cell of that link's note, so nothing else can be read or listed, and turning sharing off or
-- letting the link expire cuts the files off at once.

create table if not exists public.note_shares (
  entry_id    uuid primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  token       text not null unique default translate(rtrim(encode(extensions.gen_random_bytes(16), 'base64'), '='), '+/', '-_'),
  show_code   boolean not null default true,
  allow_copy  boolean not null default true,
  indexable   boolean not null default false,
  expires_at  timestamptz,
  views       integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (entry_id, user_id) references public.entries(id, user_id) on delete cascade
);
create index if not exists note_shares_user_idx on public.note_shares (user_id);

alter table public.note_shares enable row level security;
drop policy if exists "note_shares owner select" on public.note_shares;
create policy "note_shares owner select" on public.note_shares
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "note_shares owner insert" on public.note_shares;
create policy "note_shares owner insert" on public.note_shares
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "note_shares owner update" on public.note_shares;
create policy "note_shares owner update" on public.note_shares
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "note_shares owner delete" on public.note_shares;
create policy "note_shares owner delete" on public.note_shares
  for delete to authenticated using (user_id = (select auth.uid()));

-- The owner sets the options; the token, the count and the times are the database's.
revoke all on public.note_shares from anon, authenticated;
grant select, delete on public.note_shares to authenticated;
grant insert (entry_id, user_id, show_code, allow_copy, indexable, expires_at) on public.note_shares to authenticated;
grant update (show_code, allow_copy, indexable, expires_at) on public.note_shares to authenticated;

create or replace function private.note_shares_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists note_shares_touch on public.note_shares;
create trigger note_shares_touch before update on public.note_shares
  for each row when (old.show_code is distinct from new.show_code or old.allow_copy is distinct from new.allow_copy
    or old.indexable is distinct from new.indexable or old.expires_at is distinct from new.expires_at or old.token is distinct from new.token)
  execute function private.note_shares_touch();

-- Reset: a new token for the caller's note; the old link stops working. Returns the new token.
create or replace function public.share_reset(note uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare t text;
begin
  update public.note_shares
     set token = translate(rtrim(encode(extensions.gen_random_bytes(16), 'base64'), '='), '+/', '-_')
   where entry_id = note and user_id = (select auth.uid())
  returning token into t;
  if t is null then raise exception 'This note isn''t shared' using errcode = 'P0002'; end if;
  return t;
end $$;
revoke all on function public.share_reset(uuid) from public, anon;
grant execute on function public.share_reset(uuid) to authenticated;

-- A link that works now: its row, or nothing (no such token, or it has expired).
create or replace function private.live_share(t text) returns public.note_shares
language sql stable security definer set search_path = '' as $$
  select * from public.note_shares s
   where t is not null and length(t) between 16 and 64 and s.token = t
     and (s.expires_at is null or s.expires_at > now());
$$;
revoke all on function private.live_share(text) from public, anon, authenticated;

-- What a shared note's page shows: the note (title, text, outcome, when it changed), its author's
-- username, the link's options, its cells in order (code only when the owner shows it), and the
-- notes it links to that are shared too (id -> token), so those links open as shared pages.
-- `seen` counts the view (the page passes false for link previews and bots).
create or replace function public.shared_note(t text, seen boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  sh public.note_shares;
  e public.entries;
  out jsonb;
begin
  sh := private.live_share(t);
  if sh.entry_id is null then return null; end if;
  select * into e from public.entries where id = sh.entry_id;
  if e.id is null then return null; end if;
  if seen then
    update public.note_shares set views = views + 1 where entry_id = sh.entry_id;
  end if;
  select jsonb_build_object(
    'token', sh.token,
    'show_code', sh.show_code,
    'allow_copy', sh.allow_copy and sh.show_code,
    'indexable', sh.indexable,
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
      where o.user_id = e.user_id and o.entry_id <> e.id
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

-- The storage rule's check (public schema so the anon role can run it; it reveals nothing but
-- whether a file belongs to the link given in the request's own header).
create or replace function public.share_file_ok(name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from private.live_share(nullif(nullif(current_setting('request.headers', true), '')::json ->> 'x-bj-share', '')) sh
      join public.snippets s on s.entry_id = sh.entry_id and s.user_id = sh.user_id
     where sh.entry_id is not null
       and s.last_run -> 'outputs' ->> 'dir' = (sh.user_id::text || '/' || s.id::text || '/' || split_part(name, '/', 3))
       and split_part(name, '/', 1) = sh.user_id::text
       and split_part(name, '/', 2) = s.id::text
       and split_part(name, '/', 5) = ''
  );
$$;
revoke all on function public.share_file_ok(text) from public, authenticated;
grant execute on function public.share_file_ok(text) to anon;

drop policy if exists "run outputs: shared note reads" on storage.objects;
create policy "run outputs: shared note reads" on storage.objects for select to anon
  using (bucket_id = 'run-outputs'
    and (nullif(current_setting('request.headers', true), '')::json ->> 'x-bj-share') is not null
    and public.share_file_ok(name));

-- Copy a shared note into the caller's account (when its owner allows copies and shows the code):
-- the text (with a line saying where it came from; links to the owner's other notes become plain
-- titles), each cell's code and notes, and its run without the files. Returns the new note's id and,
-- per cell, the new cell's id and the source run's outputs, so the app can copy the files over.
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
  sh := private.live_share(t);
  if sh.entry_id is null or not sh.allow_copy or not sh.show_code then
    raise exception 'This note can''t be copied' using errcode = 'P0002';
  end if;
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
