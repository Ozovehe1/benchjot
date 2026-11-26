-- Username sign-in limits, take 2 (2026-11-17). Replaces login_email from 20261105180000_rate_limits.sql.
--
-- Before: 5 failures for a username (from anywhere) locked that username for 15 minutes, so anyone
-- could keep someone else's username sign-in locked; and when cf-connecting-ip was missing, the IP
-- was the first x-forwarded-for entry, which the client writes itself.
--
-- Now, within 15 minutes:
--   * 5 failures for one username from one IP lock that username for that IP only;
--   * 30 failures for one username from all IPs together lock it everywhere (a distributed guess);
--   * 20 failures from one IP lock that IP (campus networks share IPs);
--   * with no trusted IP, the old rule: 5 failures for a username lock it.
-- The IP is cf-connecting-ip only: Cloudflare, in front of Supabase, sets it and a client can't.
-- A success clears that username's failures from that IP, not the all-IP count.
-- Refusal stays SQLSTATE PT429 (HTTP 429), so the apps need no change.

create or replace function public.login_email(username text, password text) returns text
  language plpgsql volatile security definer set search_path = '' as $$
declare
  name text := lower(login_email.username);
  headers json := nullif(current_setting('request.headers', true), '')::json;
  ip text := nullif(trim(coalesce(headers ->> 'cf-connecting-ip', '')), '');
  ukey text := 'u:' || name;                         -- this username, any IP
  uikey text := 'ui:' || name || '|' || coalesce(ip, ''); -- this username from this IP
  ikey text := 'ip:' || coalesce(ip, '');            -- this IP, any username
  since timestamptz := now() - interval '15 minutes';
  found text;
begin
  delete from private.login_failures where at < now() - interval '1 day';
  if (ip is null and (select count(*) from private.login_failures where key = ukey and at > since) >= 5)
     or (ip is not null and (select count(*) from private.login_failures where key = uikey and at > since) >= 5)
     or (select count(*) from private.login_failures where key = ukey and at > since) >= 30
     or (ip is not null and (select count(*) from private.login_failures where key = ikey and at > since) >= 20) then
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
    if ip is not null then
      insert into private.login_failures (key) values (uikey), (ikey);
    end if;
  else
    delete from private.login_failures where key = case when ip is null then ukey else uikey end;
  end if;
  return found;
end $$;

revoke all on function public.login_email(text, text) from public;
grant execute on function public.login_email(text, text) to anon, authenticated;
