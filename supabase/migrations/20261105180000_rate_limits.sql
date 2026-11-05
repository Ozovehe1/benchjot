-- Rate limits (2026-11-05).
-- 1) Username sign-in (login_email): after 5 failed tries for one username, or 20 from one IP
--    (campus networks share IPs), within 15 minutes, further tries are refused until the oldest
--    of those failures is 15 minutes old. Refusal is SQLSTATE PT429, which PostgREST answers as
--    HTTP 429; the apps show it from their shared error table (sign_in + rate_limited).
-- 2) Fix (/api/fix): fix_take(per_minute, per_day) counts the caller's Fix requests; it returns 0
--    and records one when allowed, else the seconds until one is allowed. The route passes the
--    limits from src/config/app.ts. Calling it directly only spends the caller's own quota.

create schema if not exists private;
revoke all on schema private from anon, authenticated;

create table if not exists private.login_failures (
  key text not null,          -- 'u:<username>' or 'ip:<address>'
  at  timestamptz not null default now()
);
create index if not exists login_failures_key_at on private.login_failures (key, at);

create table if not exists private.fix_calls (
  user_id uuid not null,
  at      timestamptz not null default now()
);
create index if not exists fix_calls_user_at on private.fix_calls (user_id, at);

drop function if exists public.login_email(text, text);
create function public.login_email(username text, password text) returns text
  language plpgsql volatile security definer set search_path = '' as $$
declare
  name text := lower(login_email.username);
  headers json := nullif(current_setting('request.headers', true), '')::json;
  ip text := nullif(trim(coalesce(headers ->> 'cf-connecting-ip', split_part(headers ->> 'x-forwarded-for', ',', 1), '')), '');
  ukey text := 'u:' || name;
  ikey text := 'ip:' || coalesce(ip, '');
  found text;
begin
  delete from private.login_failures where at < now() - interval '1 day';
  if (select count(*) from private.login_failures where key = ukey and at > now() - interval '15 minutes') >= 5
     or (ip is not null and (select count(*) from private.login_failures where key = ikey and at > now() - interval '15 minutes') >= 20) then
    raise exception 'Too many attempts. Try again in a few minutes.' using errcode = 'PT429';
  end if;

  select u.email into found
  from public.profiles p
  join auth.users u on u.id = p.user_id
  where p.username = name
    and u.encrypted_password is not null
    and u.encrypted_password <> ''
    and u.encrypted_password = extensions.crypt(login_email.password, u.encrypted_password);

  if found is null then
    insert into private.login_failures (key) values (ukey);
    if ip is not null then insert into private.login_failures (key) values (ikey); end if;
  else
    delete from private.login_failures where key = ukey;
  end if;
  return found;
end $$;

revoke all on function public.login_email(text, text) from public;
grant execute on function public.login_email(text, text) to anon, authenticated;

create or replace function public.fix_take(per_minute int, per_day int) returns int
  language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  wait int;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = 'PT401';
  end if;
  perform pg_advisory_xact_lock(hashtext('fix:' || uid::text));
  delete from private.fix_calls where user_id = uid and at < now() - interval '1 day';
  if (select count(*) from private.fix_calls where user_id = uid) >= per_day then
    select ceil(extract(epoch from (min(at) + interval '1 day' - now())))::int into wait from private.fix_calls where user_id = uid;
    return greatest(wait, 1);
  end if;
  if (select count(*) from private.fix_calls where user_id = uid and at > now() - interval '1 minute') >= per_minute then
    select ceil(extract(epoch from (min(at) + interval '1 minute' - now())))::int into wait
      from private.fix_calls where user_id = uid and at > now() - interval '1 minute';
    return greatest(wait, 1);
  end if;
  insert into private.fix_calls (user_id) values (uid);
  return 0;
end $$;

revoke all on function public.fix_take(int, int) from public;
grant execute on function public.fix_take(int, int) to authenticated;
