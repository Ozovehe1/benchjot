-- Letting invited people know (as Google Docs and Figma do): an invitation is also sent as an email
-- (when the app has a mail account set up, and the person hasn't turned these emails off) and as a
-- push notification to each browser where the person allowed notifications. The Android app checks
-- for new invitations itself and notifies on the phone.
--
-- The invitee's email address never reaches the person inviting: only the app's server reads it,
-- through share_notice(), which needs a key only the server has (NOTIFY_KEY; the database keeps
-- its SHA-256 in private.server_keys, set once per project outside the migrations, as for run_refund):
--   insert into private.server_keys (name, hash) values ('notify', '<sha256 hex of the key>')
--     on conflict (name) do update set hash = excluded.hash;

-- Browsers where the user allowed notifications (Web Push): their own rows only.
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now(),
  check (endpoint like 'https://%' and char_length(endpoint) <= 1000 and char_length(p256dh) <= 200 and char_length(auth) <= 100)
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists "push_subscriptions own" on public.push_subscriptions;
create policy "push_subscriptions own" on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, delete on public.push_subscriptions to authenticated;

-- Whether the user wants invitation emails (on unless turned off in Settings).
alter table public.profiles add column if not exists invite_emails boolean not null default true;

create or replace function public.set_invite_emails(wanted boolean) returns void
language sql security definer set search_path = '' as $$
  update public.profiles set invite_emails = wanted where user_id = (select auth.uid());
$$;
revoke all on function public.set_invite_emails(boolean) from public, anon;
grant execute on function public.set_invite_emails(boolean) to authenticated;

create or replace function public.invite_emails_on() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.invite_emails from public.profiles p where p.user_id = (select auth.uid())), true);
$$;
revoke all on function public.invite_emails_on() from public, anon;
grant execute on function public.invite_emails_on() to authenticated;

-- For the app's server, right after an invitation: whom to tell and how. Only with the server's key,
-- only for a person invited to that note and not yet answered, only by that note's owner.
create or replace function public.share_notice(note uuid, person uuid, key text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  out jsonb;
begin
  if key is null or not exists (select 1 from private.server_keys k where k.name = 'notify' and k.hash = encode(extensions.digest(key, 'sha256'), 'hex')) then
    return null;
  end if;
  select jsonb_build_object(
    'email', case when coalesce(pr.invite_emails, true) then u.email end,
    'username', pr.username,
    'title', e.title,
    'inviter', (select o.username from public.profiles o where o.user_id = s.user_id),
    'token', s.token,
    'push', coalesce((select jsonb_agg(jsonb_build_object('endpoint', ps.endpoint, 'p256dh', ps.p256dh, 'auth', ps.auth)) from public.push_subscriptions ps where ps.user_id = person), '[]'::jsonb))
    into out
    from public.note_shares s
    join public.note_share_people p on p.entry_id = s.entry_id and p.user_id = person and p.via = 'invite' and p.accepted_at is null
    join public.entries e on e.id = s.entry_id
    join auth.users u on u.id = person
    left join public.profiles pr on pr.user_id = person
   where s.entry_id = note and s.user_id = (select auth.uid());
  return out;
end $$;
revoke all on function public.share_notice(uuid, uuid, text) from public, anon;
grant execute on function public.share_notice(uuid, uuid, text) to authenticated;

-- A push address the push service said is gone (the browser unsubscribed): the server removes it.
create or replace function public.push_gone(endpoint text, key text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if key is null or not exists (select 1 from private.server_keys k where k.name = 'notify' and k.hash = encode(extensions.digest(key, 'sha256'), 'hex')) then
    return;
  end if;
  delete from public.push_subscriptions p where p.endpoint = push_gone.endpoint;
end $$;
revoke all on function public.push_gone(text, text) from public, anon;
grant execute on function public.push_gone(text, text) to authenticated;
