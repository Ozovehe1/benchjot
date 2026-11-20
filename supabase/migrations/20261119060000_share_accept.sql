-- Invitations are accepted (as Figma and Notion do it): a note shared with someone by username
-- arrives as an invitation at the top of their home ("@ada shared … with you", Accept / Decline).
-- They can open it before deciding; Accept moves it into Shared with me; Decline removes them (the
-- owner sees they're no longer there). Reading through an anyone-with-the-link link needs no accepting.

alter table public.note_share_people add column if not exists accepted_at timestamptz;
-- Everyone already there before this (invited or by link) counts as having accepted.
update public.note_share_people set accepted_at = added_at where accepted_at is null;

-- Invite: a new invitation waits for an answer; inviting someone who already accepted changes nothing.
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
  insert into public.note_share_people (entry_id, user_id, via, accepted_at) values (note, person, 'invite', null)
    on conflict (entry_id, user_id) do update set via = 'invite',
      added_at = case when public.note_share_people.via = 'invite' then public.note_share_people.added_at else now() end,
      accepted_at = case when public.note_share_people.via = 'invite' then public.note_share_people.accepted_at else null end;
  return jsonb_build_object('user_id', person, 'username', shown);
end $$;
revoke all on function public.share_invite(uuid, text) from public, anon;
grant execute on function public.share_invite(uuid, text) to authenticated;

-- The caller answers an invitation: accept keeps it (Shared with me), decline removes them from the note.
create or replace function public.share_respond(note uuid, accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if accept then
    update public.note_share_people set accepted_at = coalesce(accepted_at, now())
     where entry_id = note and user_id = (select auth.uid()) and via = 'invite';
  else
    delete from public.note_share_people where entry_id = note and user_id = (select auth.uid());
  end if;
end $$;
revoke all on function public.share_respond(uuid, boolean) from public, anon;
grant execute on function public.share_respond(uuid, boolean) to authenticated;

-- Who has access, for the owner: username, when added, and whether they accepted yet.
create or replace function public.share_people(note uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('user_id', p.user_id, 'username', pr.username, 'added_at', p.added_at, 'accepted', p.accepted_at is not null) order by p.added_at), '[]'::jsonb)
    from public.note_share_people p
    join public.note_shares s on s.entry_id = p.entry_id and s.user_id = (select auth.uid())
    left join public.profiles pr on pr.user_id = p.user_id
   where p.entry_id = note and p.via = 'invite';
$$;
revoke all on function public.share_people(uuid) from public, anon;
grant execute on function public.share_people(uuid) to authenticated;

-- The caller's shared notes, newest first, each marked pending (an invitation not yet answered) or not.
create or replace function public.shared_with_me() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'entry_id', e.id, 'title', e.title, 'outcome', e.outcome, 'token', s.token,
           'author', (select pr.username from public.profiles pr where pr.user_id = e.user_id),
           'added_at', p.added_at, 'updated_at', e.updated_at, 'pending', p.accepted_at is null) order by p.added_at desc), '[]'::jsonb)
    from public.note_share_people p
    join public.note_shares s on s.entry_id = p.entry_id and (s.expires_at is null or s.expires_at > now())
    join public.entries e on e.id = s.entry_id
   where p.user_id = (select auth.uid()) and (p.via = 'invite' or s.access = 'link');
$$;
revoke all on function public.shared_with_me() from public, anon;
grant execute on function public.shared_with_me() to authenticated;

-- Opening through a link that's open to anyone keeps the note in Shared with me, already accepted.
alter table public.note_share_people alter column accepted_at set default now();
