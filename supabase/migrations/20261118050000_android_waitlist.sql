-- Android app waitlist (2026-11-18): while the app is reworked around an on-device model, the
-- web's "Android app" button collects an email to tell when it's ready, instead of linking an APK.
--
-- The list is in the private schema: nobody reads it through the API, not even the person who
-- joined. public.join_android_waitlist is the only way in. Joining twice is a no-op. Limits: 5
-- joins an hour from one IP (cf-connecting-ip, set by Cloudflare in front of Supabase; a client
-- can't), and 300 an hour in all, so a script can't fill the list.

create table if not exists private.android_waitlist (
  email      text primary key check (length(email) <= 254 and email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  user_id    uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);
alter table private.android_waitlist enable row level security;

create table if not exists private.waitlist_calls (
  ip text,
  at timestamptz not null default now()
);
alter table private.waitlist_calls enable row level security;
create index if not exists waitlist_calls_at on private.waitlist_calls (at);

-- True when the email is on the list (now or already). False for an address that isn't one.
-- Raises PT429 past the limits.
create or replace function public.join_android_waitlist(email text) returns boolean
  language plpgsql volatile security definer set search_path = '' as $$
declare
  address text := lower(trim(coalesce(join_android_waitlist.email, '')));
  headers json := nullif(current_setting('request.headers', true), '')::json;
  caller_ip text := nullif(trim(coalesce(headers ->> 'cf-connecting-ip', '')), '');
  since timestamptz := now() - interval '1 hour';
begin
  if length(address) > 254 or address !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return false;
  end if;
  if exists (select 1 from private.android_waitlist w where w.email = address) then
    return true;
  end if;
  delete from private.waitlist_calls where at < now() - interval '1 day';
  if (caller_ip is not null and (select count(*) from private.waitlist_calls c where c.ip = caller_ip and c.at > since) >= 5)
     or (select count(*) from private.waitlist_calls c where c.at > since) >= 300 then
    raise exception 'Too many sign-ups right now. Try again later.' using errcode = 'PT429';
  end if;
  insert into private.waitlist_calls (ip) values (caller_ip);
  insert into private.android_waitlist (email, user_id) values (address, auth.uid()) on conflict do nothing;
  return true;
end $$;

revoke all on function public.join_android_waitlist(text) from public;
grant execute on function public.join_android_waitlist(text) to anon, authenticated;
