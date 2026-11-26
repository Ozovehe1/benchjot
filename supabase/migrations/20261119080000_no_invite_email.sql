-- Invitations are no longer emailed: people learn of them in Benchjot (Invitations on their home),
-- by a notification in each browser where they allowed them, and on the Android phone. The server's
-- notice no longer reads anyone's email address, and the email on/off setting goes away.

create or replace function public.share_notice(note uuid, person uuid, key text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
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
    join public.note_share_people p on p.entry_id = s.entry_id and p.user_id = person and p.via = 'invite' and p.accepted_at is null
    join public.entries e on e.id = s.entry_id
    left join public.profiles pr on pr.user_id = person
   where s.entry_id = note and s.user_id = (select auth.uid());
  return out;
end $$;
revoke all on function public.share_notice(uuid, uuid, text) from public, anon;
grant execute on function public.share_notice(uuid, uuid, text) to authenticated;

drop function if exists public.set_invite_emails(boolean);
drop function if exists public.invite_emails_on();
alter table public.profiles drop column if exists invite_emails;
