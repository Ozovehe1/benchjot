-- Connected keys (2026-11-18). Two changes:
--
-- 1) The user's own AI is connected through OpenRouter (its OAuth: the user taps Authorize there and
--    the app receives a key the user controls and can revoke), not by pasting a Groq key, which
--    Groq's terms don't allow sharing. private.ai_keys is rebuilt for that (it was a day old).
-- 2) Keys are stored encrypted. The app's server seals them (AES-256-GCM, lib/server/secret-box.ts:
--    "enc:v1:…") before they get here and opens them when it uses them; the database never sees one
--    in the clear, so its shape check on the Hugging Face token goes (the server
--    checks the shape before sealing). A value saved earlier, unsealed, still works.

drop function if exists public.set_ai_key(text, text);
drop function if exists public.ai_key_status();
drop function if exists public.ai_key();
drop table if exists private.ai_keys;

create table private.ai_keys (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  provider   text not null check (provider in ('openrouter')),
  key        text not null check (key like 'enc:v1:%' and length(key) <= 600),
  -- SHA-256 of the key: OpenRouter's own handle for it (openrouter.ai/keys/<hash>, owner only).
  key_hash   text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  used_at    timestamptz
);
alter table private.ai_keys enable row level security;

-- Saves the caller's sealed key; an empty key removes it.
create function public.set_ai_key(provider text, key text, key_hash text) returns void
  language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = 'PT401';
  end if;
  if coalesce(set_ai_key.key, '') = '' then
    delete from private.ai_keys where user_id = uid;
    return;
  end if;
  insert into private.ai_keys (user_id, provider, key, key_hash) values (uid, set_ai_key.provider, set_ai_key.key, set_ai_key.key_hash)
    on conflict (user_id) do update set provider = excluded.provider, key = excluded.key, key_hash = excluded.key_hash, created_at = now(), used_at = null;
end $$;

-- What Settings shows: never the key.
create function public.ai_key_status() returns json
  language sql stable security definer set search_path = '' as $$
  select coalesce((select json_build_object('provider', k.provider, 'key_hash', k.key_hash, 'connected_at', k.created_at, 'used_at', k.used_at)
    from private.ai_keys k where k.user_id = auth.uid()), '{}'::json)
$$;

-- The sealed key, for the app's server to open and use; notes when it was last used.
create function public.ai_key() returns json
  language plpgsql volatile security definer set search_path = '' as $$
declare
  r json;
begin
  update private.ai_keys k set used_at = now() where k.user_id = auth.uid()
    returning json_build_object('provider', k.provider, 'key', k.key) into r;
  return coalesce(r, '{}'::json);
end $$;

revoke all on function public.set_ai_key(text, text, text) from public, anon;
revoke all on function public.ai_key_status() from public, anon;
revoke all on function public.ai_key() from public, anon;
grant execute on function public.set_ai_key(text, text, text) to authenticated;
grant execute on function public.ai_key_status() to authenticated;
grant execute on function public.ai_key() to authenticated;

-- Hugging Face token: sealed by the server, so its shape check goes.
do $$
declare
  c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'private.data_tokens'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%hf_token%' loop
    execute format('alter table private.data_tokens drop constraint %I', c.conname);
  end loop;
end $$;
alter table private.data_tokens add constraint data_tokens_sealed_sizes check (coalesce(length(hf_token), 0) <= 600);
