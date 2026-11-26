-- The database says what the app says: notes (was entries), cells (was snippets), the Assistant
-- (was the helper). Tables, columns, functions, indexes, constraints, triggers, policies, the
-- JSON the functions return, the sync's deletion kinds and the hourly job are renamed; the data
-- and every grant stay as they are. Also drops profiles.plan, which nothing reads any more.

alter table public.entries rename to notes;
alter table public.snippets rename to cells;
alter table public.helper_turns rename to assistant_turns;
alter table public.helper_summaries rename to assistant_summaries;
alter table public.cells rename column entry_id to note_id;
alter table public.assistant_turns rename column entry_id to note_id;
alter table public.assistant_summaries rename column entry_id to note_id;
alter table public.note_shares rename column entry_id to note_id;
alter table public.note_share_people rename column entry_id to note_id;
alter table public.server_runs rename column snippet_id to cell_id;

-- Constraints (and the indexes behind them), other indexes, triggers and policies with the old words.
do $$
declare
  r record;
begin
  for r in select c.conrelid::regclass as tbl, c.conname as old from pg_constraint c
            where c.connamespace = 'public'::regnamespace and c.conname ~ '(entr|snippet|helper)' loop
    execute format('alter table %s rename constraint %I to %I', r.tbl, r.old,
      replace(replace(replace(replace(replace(r.old, 'entries', 'notes'), 'entry', 'note'), 'snippets', 'cells'), 'snippet', 'cell'), 'helper', 'assistant'));
  end loop;
  for r in select i.relname as old from pg_class i
            where i.relnamespace = 'public'::regnamespace and i.relkind = 'i' and i.relname ~ '(entr|snippet|helper)' loop
    execute format('alter index public.%I rename to %I', r.old,
      replace(replace(replace(replace(replace(r.old, 'entries', 'notes'), 'entry', 'note'), 'snippets', 'cells'), 'snippet', 'cell'), 'helper', 'assistant'));
  end loop;
  for r in select t.tgrelid::regclass as tbl, t.tgname as old from pg_trigger t
            join pg_class c on c.oid = t.tgrelid
            where not t.tgisinternal and c.relnamespace = 'public'::regnamespace and t.tgname ~ '(entr|snippet|helper)' loop
    execute format('alter trigger %I on %s rename to %I', r.old, r.tbl,
      replace(replace(replace(replace(replace(r.old, 'entries', 'notes'), 'entry', 'note'), 'snippets', 'cells'), 'snippet', 'cell'), 'helper', 'assistant'));
  end loop;
  for r in select p.policyname as old, p.tablename as tbl from pg_policies p
            where p.schemaname = 'public' and p.policyname ~ '(entr|snippet|helper)' loop
    execute format('alter policy %I on public.%I rename to %I', r.old, r.tbl,
      replace(replace(replace(replace(replace(r.old, 'entries', 'notes'), 'entry', 'note'), 'snippets', 'cells'), 'snippet', 'cell'), 'helper', 'assistant'));
  end loop;
end $$;

-- Functions with the old words in their names: renamed (their grants come along), then rewritten below.
alter function private.helper_keep_tail(text, integer) rename to assistant_keep_tail;
alter function private.helper_line(text, text, jsonb, timestamptz) rename to assistant_line;
alter function public.helper_condense(timestamptz) rename to assistant_condense;
alter function public.search_entries(text[], uuid, boolean, text) rename to search_notes;
alter function public.entries_derived_no_cycle() rename to notes_derived_no_cycle;
alter function public.entries_parent_no_cycle() rename to notes_parent_no_cycle;
alter function public.touch_parent_entry() rename to touch_parent_note;

-- Deletions the sync reads: their kinds are 'note', 'cell' and 'project' now.
alter table public.deleted_rows drop constraint deleted_rows_kind_check;
update public.deleted_rows set kind = case kind when 'entry' then 'note' when 'snippet' then 'cell' else kind end;
alter table public.deleted_rows add constraint deleted_rows_kind_check check (kind in ('note', 'cell', 'project'));
drop trigger notes_deleted on public.notes;
create trigger notes_deleted after delete on public.notes for each row execute function private.note_deleted('note');
drop trigger cells_deleted on public.cells;
create trigger cells_deleted after delete on public.cells for each row execute function private.note_deleted('cell');

-- Every function that names them, with the new names (bodies otherwise unchanged).

CREATE OR REPLACE FUNCTION private.can_view(sh note_shares)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- Never null: a signed-out caller (no auth.uid()) is a plain no for a people-only note.
  select coalesce(sh.note_id is not null and (
    sh.access = 'link'
    or sh.user_id = (select auth.uid())
    or exists (select 1 from public.note_share_people p where p.note_id = sh.note_id and p.user_id = (select auth.uid()) and p.via = 'invite')), false);
$function$
;


CREATE OR REPLACE FUNCTION private.copy_allowed(t text)
 RETURNS note_shares
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare sh public.note_shares;
begin
  sh := private.live_share(t);
  if sh.note_id is null or not private.can_view(sh) or not sh.allow_copy or not sh.show_code then
    raise exception 'This note can''t be copied' using errcode = 'P0002';
  end if;
  return sh;
end $function$
;


CREATE OR REPLACE FUNCTION private.assistant_keep_tail(t text, max_chars integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
    when char_length(t) <= max_chars then t
    else coalesce(
      (select string_agg(line, E'\n' order by i)
         from (select line, i, sum(char_length(line) + 1) over (order by i desc) - 1 as acc
                 from unnest(string_to_array(t, E'\n')) with ordinality as u(line, i)) x
        where acc <= max_chars),
      right(t, max_chars))
  end
$function$
;


CREATE OR REPLACE FUNCTION private.assistant_line(task text, request text, answer jsonb, created_at timestamp with time zone)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') || ' '
      || case task when 'write' then 'Write' else 'Ask' end || ': '
      || left(btrim(regexp_replace(request, '\s+', ' ', 'g')), 160) || ' — '
      || left(btrim(regexp_replace(
           case answer ->> 'kind'
             when 'code' then coalesce(nullif(btrim(answer ->> 'summary'), ''), 'Proposed ' || coalesce(nullif(answer ->> 'language', ''), 'code') || ' code.')
             else answer ->> 'text'
           end, '\s+', ' ', 'g')), 160)
$function$
;


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
end $function$
;


CREATE OR REPLACE FUNCTION public.notes_derived_no_cycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.derived_from is null then
    return new;
  end if;
  -- Serialise lineage changes per owner so two concurrent updates can't form a cycle together.
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 1));
  if exists (
    with recursive up(id, derived_from, depth) as (
      select e.id, e.derived_from, 1 from public.notes e where e.id = new.derived_from
      union all
      select e.id, e.derived_from, up.depth + 1
        from public.notes e join up on e.id = up.derived_from
       where up.depth < 10000
    )
    select 1 from up where up.id = new.id
  ) then
    raise exception 'A note can''t be an attempt of itself or of one of its own attempts'
      using errcode = 'check_violation';
  end if;
  return new;
end $function$
;


CREATE OR REPLACE FUNCTION public.notes_parent_no_cycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.parent_id is null then
    return new;
  end if;
  -- Serialise re-parenting per owner so two concurrent moves can't form a cycle together.
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
  if exists (
    with recursive up(id, parent_id, depth) as (
      select e.id, e.parent_id, 1 from public.notes e where e.id = new.parent_id
      union all
      select e.id, e.parent_id, up.depth + 1
        from public.notes e join up on e.id = up.parent_id
       where up.depth < 10000
    )
    select 1 from up where up.id = new.id
  ) then
    raise exception 'A note can''t be nested under itself or one of its sub-notes'
      using errcode = 'check_violation';
  end if;
  return new;
end $function$
;


CREATE OR REPLACE FUNCTION public.assistant_condense(p_before timestamp with time zone DEFAULT (now() - '30 days'::interval))
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  n integer;
begin
  with old as (
    delete from public.assistant_turns t where t.created_at < p_before
    returning t.id, t.note_id, t.user_id, t.task, t.request, t.answer, t.created_at
  ), lines as (
    select o.note_id, o.user_id,
           string_agg(private.assistant_line(o.task, o.request, o.answer, o.created_at), E'\n' order by o.created_at, o.id) as text,
           count(*)::integer as c
      from old o
     group by o.note_id, o.user_id
  )
  insert into public.assistant_summaries as s (note_id, user_id, summary, turns)
  select l.note_id, l.user_id, private.assistant_keep_tail(l.text, 4000), l.c
    from lines l
   where exists (select 1 from public.notes e where e.id = l.note_id)
  on conflict (note_id) do update
     set summary = private.assistant_keep_tail(s.summary || E'\n' || excluded.summary, 4000),
         turns = s.turns + excluded.turns,
         updated_at = now();
  get diagnostics n = row_count;
  return n;
end
$function$
;


CREATE OR REPLACE FUNCTION public.new_attempt(p_from uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  src public.notes;
  root uuid;
  family integer;
  base text;
  suffix text;
  new_id uuid;
begin
  select * into src from public.notes where id = p_from;
  if not found then
    raise exception 'Note not found' using errcode = 'P0002';
  end if;

  with recursive up(id, derived_from, depth) as (
    select e.id, e.derived_from, 1 from public.notes e where e.id = p_from
    union all
    select e.id, e.derived_from, up.depth + 1
      from public.notes e join up on e.id = up.derived_from
     where up.depth < 10000
  )
  select u.id into root from up u where u.derived_from is null or not exists (select 1 from public.notes x where x.id = u.derived_from)
   order by u.depth desc limit 1;

  with recursive down(id, depth) as (
    select root, 1
    union all
    select e.id, down.depth + 1
      from public.notes e join down on e.derived_from = down.id
     where down.depth < 10000
  )
  select count(distinct id) into family from down;

  base := nullif(btrim(regexp_replace(src.title, '\s*\(attempt \d+\)\s*$', '')), '');
  base := coalesce(base, 'Untitled');
  suffix := ' (attempt ' || (family + 1) || ')';
  base := left(base, 200 - char_length(suffix));

  insert into public.notes (user_id, title, notes, project_id, parent_id, derived_from)
  values (src.user_id, base || suffix, src.notes, src.project_id, src.parent_id, src.id)
  returning id into new_id;

  insert into public.cells (user_id, note_id, filename, language, content, position)
  select s.user_id, new_id, s.filename, s.language, s.content, s.position
    from public.cells s
   where s.note_id = src.id
   order by s.position, s.created_at;

  return new_id;
end $function$
;


CREATE OR REPLACE FUNCTION public.note_links()
 RETURNS TABLE(source uuid, label text, target uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select t.source, m[1], m[2]::uuid
    from (
      select e.id as source, e.notes as body from public.notes e where strpos(e.notes, '[[') > 0
      union all
      select s.note_id, s.note_before from public.cells s where strpos(s.note_before, '[[') > 0
      union all
      select s.note_id, s.note_after from public.cells s where strpos(s.note_after, '[[') > 0
    ) t,
         regexp_matches(t.body, '\[\[([^]|[\n]+)(?:\|([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}))?\]\]', 'g') as m
$function$
;


CREATE OR REPLACE FUNCTION public.search_notes(terms text[] DEFAULT '{}'::text[], p_project uuid DEFAULT NULL::uuid, p_unfiled boolean DEFAULT false, p_outcome text DEFAULT NULL::text)
 RETURNS SETOF public.notes
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select e.*
    from public.notes e
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
                                  from public.cells s where s.note_id = e.id), '')),
                lower(t)) = 0
     )
   order by e.updated_at desc, e.id
$function$
;


CREATE OR REPLACE FUNCTION public.share_file_ok(name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
      from private.live_share(nullif(nullif(current_setting('request.headers', true), '')::json ->> 'x-bj-share', '')) sh
      join public.cells s on s.note_id = sh.note_id and s.user_id = sh.user_id
     where sh.note_id is not null and private.can_view(sh)
       and s.last_run -> 'outputs' ->> 'dir' = (sh.user_id::text || '/' || s.id::text || '/' || split_part(name, '/', 3))
       and split_part(name, '/', 1) = sh.user_id::text
       and split_part(name, '/', 2) = s.id::text
       and split_part(name, '/', 5) = ''
  );
$function$
;


CREATE OR REPLACE FUNCTION public.share_invite(note uuid, name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  person uuid;
  shown text;
begin
  if not exists (select 1 from public.note_shares s where s.note_id = note and s.user_id = (select auth.uid())) then
    raise exception 'This note isn''t shared' using errcode = 'P0002';
  end if;
  select p.user_id, p.username into person, shown from public.profiles p where lower(p.username) = lower(trim(leading '@' from trim(name)));
  if person is null then raise exception 'No one has that username' using errcode = 'P0002'; end if;
  if person = (select auth.uid()) then raise exception 'That’s you: you already have this note' using errcode = '22023'; end if;
  insert into public.note_share_people (note_id, user_id, via, accepted_at) values (note, person, 'invite', null)
    on conflict (note_id, user_id) do update set via = 'invite',
      added_at = case when public.note_share_people.via = 'invite' then public.note_share_people.added_at else now() end,
      accepted_at = case when public.note_share_people.via = 'invite' then public.note_share_people.accepted_at else null end;
  return jsonb_build_object('user_id', person, 'username', shown);
end $function$
;


CREATE OR REPLACE FUNCTION public.share_notice(note uuid, person uuid, key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  out jsonb;
begin
  if key is null or not exists (select 1 from private.server_keys k where k.name = 'notify' and k.hash = encode(extensions.digest(key, 'sha256'), 'hex')) then
    return null;
  end if;
  select jsonb_build_object(
    'username', pr.username,
    'title', e.title,
    'inviter', (select o.username from public.profiles o where o.user_id = s.user_id),
    'token', s.token,
    'push', coalesce((select jsonb_agg(jsonb_build_object('endpoint', ps.endpoint, 'p256dh', ps.p256dh, 'auth', ps.auth)) from public.push_subscriptions ps where ps.user_id = person), '[]'::jsonb))
    into out
    from public.note_shares s
    join public.note_share_people p on p.note_id = s.note_id and p.user_id = person and p.via = 'invite' and p.accepted_at is null
    join public.notes e on e.id = s.note_id
    left join public.profiles pr on pr.user_id = person
   where s.note_id = note and s.user_id = (select auth.uid());
  return out;
end $function$
;


CREATE OR REPLACE FUNCTION public.share_people(note uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object('user_id', p.user_id, 'username', pr.username, 'added_at', p.added_at, 'accepted', p.accepted_at is not null) order by p.added_at), '[]'::jsonb)
    from public.note_share_people p
    join public.note_shares s on s.note_id = p.note_id and s.user_id = (select auth.uid())
    left join public.profiles pr on pr.user_id = p.user_id
   where p.note_id = note and p.via = 'invite';
$function$
;


CREATE OR REPLACE FUNCTION public.share_remove(note uuid, person uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  delete from public.note_share_people p
   where p.note_id = note and p.user_id = person
     and exists (select 1 from public.note_shares s where s.note_id = note and s.user_id = (select auth.uid()));
$function$
;


CREATE OR REPLACE FUNCTION public.share_reset(note uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t text;
begin
  update public.note_shares
     set token = translate(rtrim(encode(extensions.gen_random_bytes(16), 'base64'), '='), '+/', '-_')
   where note_id = note and user_id = (select auth.uid())
  returning token into t;
  if t is null then raise exception 'This note isn''t shared' using errcode = 'P0002'; end if;
  return t;
end $function$
;


CREATE OR REPLACE FUNCTION public.share_respond(note uuid, accept boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if accept then
    update public.note_share_people set accepted_at = coalesce(accepted_at, now())
     where note_id = note and user_id = (select auth.uid()) and via = 'invite';
  else
    delete from public.note_share_people where note_id = note and user_id = (select auth.uid());
  end if;
end $function$
;


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
  if e.id is null then return null; end if;
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
end $function$
;


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
   where p.user_id = (select auth.uid()) and (p.via = 'invite' or s.access = 'link');
$function$
;


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
                          where e.user_id = (select auth.uid()) and e.updated_at > since - interval '2 minutes'), '[]'::jsonb),
    'cells', coalesce((select jsonb_agg(to_jsonb(s)) from public.cells s
                           where s.user_id = (select auth.uid()) and s.updated_at > since - interval '2 minutes'), '[]'::jsonb),
    'deleted', coalesce((select jsonb_agg(jsonb_build_object('kind', d.kind, 'id', d.id)) from public.deleted_rows d
                          where d.user_id = (select auth.uid()) and d.deleted_at > since - interval '2 minutes'), '[]'::jsonb)
  )
$function$
;


CREATE OR REPLACE FUNCTION public.touch_parent_note()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.notes set updated_at = now()
   where id = coalesce(new.note_id, old.note_id);
  return null;
end $function$
;

-- The hourly job that condenses old Assistant turns, under its new name.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'benchjot-helper-condense';
    perform cron.schedule('benchjot-assistant-condense', '17 * * * *', 'select public.assistant_condense()');
  end if;
end $$;

-- Nothing reads the plan any more (one free plan for everyone).
alter table public.profiles drop column if exists plan;
