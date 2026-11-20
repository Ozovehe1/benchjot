-- Your own AI key (2026-11-18): a user may save their own Groq key, so Fix and the Helper answer on
-- their own free quota instead of the app's shared daily limit. Separate from data_tokens on purpose:
-- those go into the environment of the user's code on the server; this one never does.
--
-- Private table, three functions on the caller's own row only:
--   set_ai_key(provider, key): saves it ('' removes it); the app tests a key before saving it;
--   ai_key_status(): which provider and the key's last 4 characters (Settings): never the key;
--   ai_key(): the key, for the app's server to call the provider with.

create table if not exists private.ai_keys (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  provider   text not null check (provider in ('groq')),
  key        text not null check (key ~ '^gsk_[A-Za-z0-9]{20,200}$'),
  updated_at timestamptz not null default now()
);
alter table private.ai_keys enable row level security;

create or replace function public.set_ai_key(provider text, key text) returns void
  language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = 'PT401';
  end if;
  if coalesce(trim(set_ai_key.key), '') = '' then
    delete from private.ai_keys where user_id = uid;
    return;
  end if;
  insert into private.ai_keys (user_id, provider, key) values (uid, set_ai_key.provider, trim(set_ai_key.key))
    on conflict (user_id) do update set provider = excluded.provider, key = excluded.key, updated_at = now();
end $$;

create or replace function public.ai_key_status() returns json
  language sql stable security definer set search_path = '' as $$
  select coalesce((select json_build_object('provider', k.provider, 'last4', right(k.key, 4)) from private.ai_keys k where k.user_id = auth.uid()), '{}'::json)
$$;

create or replace function public.ai_key() returns json
  language sql stable security definer set search_path = '' as $$
  select coalesce((select json_build_object('provider', k.provider, 'key', k.key) from private.ai_keys k where k.user_id = auth.uid()), '{}'::json)
$$;

revoke all on function public.set_ai_key(text, text) from public, anon;
revoke all on function public.ai_key_status() from public, anon;
revoke all on function public.ai_key() from public, anon;
grant execute on function public.set_ai_key(text, text) to authenticated;
grant execute on function public.ai_key_status() to authenticated;
grant execute on function public.ai_key() to authenticated;
