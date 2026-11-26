-- Usernames: unique, lowercase a-z 0-9 _, 3 to 20 characters. Null until chosen
-- (Google sign-ups and older accounts pick one on first visit).
alter table public.profiles add column if not exists username text;

do $$ begin
  alter table public.profiles add constraint profiles_username_format check (username ~ '^[a-z0-9_]{3,20}$');
exception when duplicate_object then null; end $$;

create unique index if not exists profiles_username_key on public.profiles (username);

-- One authoritative validity rule, used by every function below.
create or replace function private.valid_username(name text) returns boolean
  language sql immutable set search_path = '' as $$
  select name ~ '^[a-z0-9_]{3,20}$'
$$;

-- New accounts take the username they signed up with, when it's valid and free.
create or replace function private.create_profile() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  wanted text := lower(new.raw_user_meta_data ->> 'username');
begin
  if wanted is not null and private.valid_username(wanted) then
    begin
      insert into public.profiles (user_id, username) values (new.id, wanted) on conflict (user_id) do nothing;
      return new;
    exception when unique_violation then
      null; -- taken in a race: fall through and let the user pick another
    end;
  end if;
  insert into public.profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end $$;

-- Is this username free? (Signup form check; reveals only taken/free.)
create or replace function public.username_available(name text) returns boolean
  language sql stable security definer set search_path = '' as $$
  select private.valid_username(lower(name))
     and not exists (select 1 from public.profiles where username = lower(name))
$$;

-- Set or change the caller's own username. Raises on invalid or taken names.
create or replace function public.set_username(name text) returns text
  language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  wanted text := lower(trim(name));
begin
  if me is null then raise exception 'Sign in first' using errcode = '28000'; end if;
  if not private.valid_username(wanted) then
    raise exception 'Use 3 to 20 letters, numbers or underscores.' using errcode = '22023';
  end if;
  begin
    insert into public.profiles (user_id, username) values (me, wanted)
      on conflict (user_id) do update set username = excluded.username;
  exception when unique_violation then
    raise exception 'That username is taken.' using errcode = '23505';
  end;
  return wanted;
end $$;

-- Sign-in by username: returns the account's email only when the password is
-- right, so usernames never reveal emails. The client then signs in with it.
create or replace function public.login_email(username text, password text) returns text
  language sql stable security definer set search_path = '' as $$
  select u.email
  from public.profiles p
  join auth.users u on u.id = p.user_id
  where p.username = lower(login_email.username)
    and u.encrypted_password is not null
    and u.encrypted_password <> ''
    and u.encrypted_password = extensions.crypt(login_email.password, u.encrypted_password)
$$;

revoke all on function public.username_available(text) from public;
revoke all on function public.set_username(text) from public;
revoke all on function public.login_email(text, text) from public;
grant execute on function public.username_available(text) to anon, authenticated;
grant execute on function public.set_username(text) to authenticated;
grant execute on function public.login_email(text, text) to anon, authenticated;

-- Profiles can now be read for the username too (still own row only, via the existing policy).
