-- Recently Deleted and pinned notes (as Apple Notes has them).
--
-- deleted_at: a deleted note waits in Recently Deleted for 30 days, then a daily job removes it for
-- good (its cells, turns and shares go with it, and devices hear of it through deleted_rows).
-- Restoring clears it. While it waits it is out of search, links, the map and shared links.
-- pinned_at: pinned notes come first in the lists, the most recently pinned on top.
-- changed_at: moves on every change, so devices that sync (sync_changes) see pins and deletions;
-- updated_at stays the time the note itself was last edited, which the lists show and sort by.

alter table public.notes
  add column deleted_at timestamptz,
  add column pinned_at timestamptz,
  add column changed_at timestamptz not null default now();
-- Copied with the edit-time trigger off, so the copy doesn't count as an edit.
alter table public.notes disable trigger notes_touch;
update public.notes set changed_at = updated_at;
alter table public.notes enable trigger notes_touch;
create index notes_changed_idx on public.notes (user_id, changed_at);
-- Only the few pinned or deleted notes are indexed, so these stay small at any size.
create index notes_deleted_idx on public.notes (user_id, deleted_at) where deleted_at is not null;
create index notes_pinned_idx on public.notes (user_id, pinned_at) where pinned_at is not null;

-- Pinning, deleting or restoring isn't an edit: those keep updated_at; anything else moves it.
create or replace function public.notes_touch()
returns trigger language plpgsql set search_path = '' as $function$
begin
  new.changed_at := now();
  if (new.pinned_at is distinct from old.pinned_at or new.deleted_at is distinct from old.deleted_at)
     and (to_jsonb(new) - array['pinned_at', 'deleted_at', 'updated_at', 'changed_at'])
       = (to_jsonb(old) - array['pinned_at', 'deleted_at', 'updated_at', 'changed_at']) then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  return new;
end $function$;
create or replace trigger notes_touch before update on public.notes for each row execute function public.notes_touch();

-- Empties Recently Deleted: notes deleted more than 30 days ago go for good, 500 at a time so one
-- run never holds a long lock however many there are.
create or replace function private.empty_recently_deleted()
returns integer language plpgsql security definer set search_path = '' as $function$
declare n integer := 0; part integer;
begin
  loop
    delete from public.notes where id in (
      select id from public.notes where deleted_at < now() - interval '30 days' limit 500);
    get diagnostics part = row_count;
    n := n + part;
    exit when part < 500;
  end loop;
  return n;
end $function$;
revoke all on function private.empty_recently_deleted() from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('benchjot-empty-recently-deleted', '23 2 * * *', 'select private.empty_recently_deleted()');
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.search_notes(terms text[] DEFAULT '{}'::text[], p_project uuid DEFAULT NULL::uuid, p_unfiled boolean DEFAULT false, p_outcome text DEFAULT NULL::text)
 RETURNS SETOF notes
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select e.*
  from public.notes e
  where e.deleted_at is null
  and (p_project is null or e.project_id = p_project)
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
  from public.cells s where s.note_id = e.id), '')),
  lower(t)) = 0
  )
  order by e.pinned_at desc nulls last, e.updated_at desc, e.id
  $function$;

CREATE OR REPLACE FUNCTION public.note_links()
 RETURNS TABLE(source uuid, label text, target uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select t.source, m[1], m[2]::uuid
  from (
  select e.id as source, e.notes as body from public.notes e where strpos(e.notes, '[[') > 0 and e.deleted_at is null
  union all
  select s.note_id, s.note_before from public.cells s where strpos(s.note_before, '[[') > 0
  and not exists (select 1 from public.notes d where d.id = s.note_id and d.deleted_at is not null)
  union all
  select s.note_id, s.note_after from public.cells s where strpos(s.note_after, '[[') > 0
  and not exists (select 1 from public.notes d where d.id = s.note_id and d.deleted_at is not null)
  ) t,
  regexp_matches(t.body, '\[\[([^]|[\n]+)(?:\|([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}))?\]\]', 'g') as m
  $function$;

CREATE OR REPLACE FUNCTION public.shared_note(t text, seen boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
    declare
      sh public.note_shares;
        e public.notes;
          out jsonb;
          begin
            sh := private.live_share(t);
              if sh.note_id is null then return null; end if;
                if not private.can_view(sh) then return jsonb_build_object('restricted', true); end if;
                  select * into e from public.notes where id = sh.note_id;
  if e.id is null or e.deleted_at is not null then return null; end if;
  if seen then
  update public.note_shares set views = views + 1 where note_id = sh.note_id;
  -- A signed-in reader who opened it through the link keeps it in their Shared with me list.
  if (select auth.uid()) is not null and (select auth.uid()) <> sh.user_id then
  insert into public.note_share_people (note_id, user_id, via) values (sh.note_id, (select auth.uid()), 'link') on conflict do nothing;
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
  'note', jsonb_build_object('id', e.id, 'title', e.title, 'notes', e.notes, 'outcome', e.outcome,
  'updated_at', greatest(e.updated_at, (select max(s.updated_at) from public.cells s where s.note_id = e.id))),
  'cells', coalesce((
  select jsonb_agg(jsonb_build_object(
  'id', s.id, 'filename', s.filename, 'language', s.language,
  'content', case when sh.show_code then s.content else '' end,
  'last_run', s.last_run, 'note_before', s.note_before, 'note_after', s.note_after) order by s.position, s.created_at)
  from public.cells s where s.note_id = e.id), '[]'::jsonb),
  'links', coalesce((
  select jsonb_object_agg(o.note_id, o.token)
  from public.note_shares o
  where o.user_id = e.user_id and o.note_id <> e.id and private.can_view(o)
  and (o.expires_at is null or o.expires_at > now())
  and o.note_id in (
  select lower(m[2])::uuid from regexp_matches(e.notes,
  '\[\[([^]|[\n]+)(?:\|([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}))?\]\]', 'g') m
  where m[2] is not null)), '{}'::jsonb)
  ) into out;
  return out;
  end $function$;

CREATE OR REPLACE FUNCTION public.shared_with_me()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
  'note_id', e.id, 'title', e.title, 'outcome', e.outcome, 'token', s.token,
  'author', (select pr.username from public.profiles pr where pr.user_id = e.user_id),
  'added_at', p.added_at, 'updated_at', e.updated_at, 'pending', p.accepted_at is null) order by p.added_at desc), '[]'::jsonb)
  from public.note_share_people p
  join public.note_shares s on s.note_id = p.note_id and (s.expires_at is null or s.expires_at > now())
  join public.notes e on e.id = s.note_id
  where p.user_id = (select auth.uid()) and (p.via = 'invite' or s.access = 'link') and e.deleted_at is null;
  $function$;

CREATE OR REPLACE FUNCTION public.copy_shared_note(t text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  declare
  me uuid := (select auth.uid());
  sh public.note_shares;
  e public.notes;
  author text;
  new_id uuid := gen_random_uuid();
  cell_id uuid;
  cells jsonb := '[]'::jsonb;
  r record;
  begin
  if me is null then raise exception 'Sign in first' using errcode = '28000'; end if;
  sh := private.copy_allowed(t);
  select * into e from public.notes where id = sh.note_id;
  if e.deleted_at is not null then raise exception 'Note not found' using errcode = 'P0002'; end if;
  select p.username into author from public.profiles p where p.user_id = e.user_id;
  insert into public.notes (id, user_id, title, notes)
  values (new_id, me, e.title, left(
  '> Copied from a note' || coalesce(' by @' || author, '') || ' shared on Benchjot, ' || to_char(now(), 'DD Mon YYYY') || '.' || E'\n\n' ||
  regexp_replace(e.notes, '\[\[([^]|[\n]+)(?:\|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})?\]\]', '\1', 'g'),
  200000));
  for r in select * from public.cells s where s.note_id = e.id order by s.position, s.created_at loop
  cell_id := gen_random_uuid();
  insert into public.cells (id, user_id, note_id, language, content, position, filename, last_run, note_before, note_after)
  values (cell_id, me, new_id, r.language, r.content, r.position, r.filename,
  case when r.last_run is null then null else r.last_run - 'outputs' end, r.note_before, r.note_after);
  cells := cells || jsonb_build_object('id', cell_id, 'outputs', r.last_run -> 'outputs');
  end loop;
  return jsonb_build_object('id', new_id, 'cells', cells);
  end $function$;

CREATE OR REPLACE FUNCTION public.sync_changes(since timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
  'at', now(),
  'complete', since > now() - interval '89 days',
  'notes', coalesce((select jsonb_agg(to_jsonb(e)) from public.notes e
  where e.user_id = (select auth.uid()) and e.changed_at > since - interval '2 minutes'), '[]'::jsonb),
  'cells', coalesce((select jsonb_agg(to_jsonb(s)) from public.cells s
  where s.user_id = (select auth.uid()) and s.updated_at > since - interval '2 minutes'), '[]'::jsonb),
  'deleted', coalesce((select jsonb_agg(jsonb_build_object('kind', d.kind, 'id', d.id)) from public.deleted_rows d
  where d.user_id = (select auth.uid()) and d.deleted_at > since - interval '2 minutes'), '[]'::jsonb)
  )
  $function$;
