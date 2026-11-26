-- Dataset keys hold only the Hugging Face token (2026-11-18). Runs happen in the browser and on
-- Benchjot's server, so the other saved keys and their columns go, and the functions that read or
-- report them take and return the Hugging Face token alone. Usage and the connection check stop
-- reporting them. Safe to run twice.

-- Every column but the user, the Hugging Face token and the time it changed, with any check on it.
do $$
declare
  c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'private.data_tokens'::regclass and contype = 'c' loop
    execute format('alter table private.data_tokens drop constraint %I', c.conname);
  end loop;
  for c in select column_name from information_schema.columns
            where table_schema = 'private' and table_name = 'data_tokens'
              and column_name not in ('user_id', 'hf_token', 'updated_at') loop
    execute format('alter table private.data_tokens drop column %I', c.column_name);
  end loop;
end $$;
alter table private.data_tokens add constraint data_tokens_sealed_sizes check (coalesce(length(hf_token), 0) <= 600);

-- The setter took three keys; it now takes the Hugging Face token alone.
drop function if exists public.set_data_tokens(text, text, text);

create or replace function public.set_data_tokens(hf_token text default null)
  returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = 'PT401';
  end if;
  insert into private.data_tokens (user_id) values (uid) on conflict (user_id) do nothing;
  update private.data_tokens t set
    hf_token   = case when set_data_tokens.hf_token is null then t.hf_token else nullif(trim(set_data_tokens.hf_token), '') end,
    updated_at = now()
  where t.user_id = uid;
end $$;

create or replace function public.data_tokens_status() returns json
  language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'hf', coalesce((select t.hf_token is not null from private.data_tokens t where t.user_id = auth.uid()), false)
  )
$$;

create or replace function public.data_tokens() returns json
  language sql stable security definer set search_path = '' as $$
  select coalesce((select json_build_object('hf_token', t.hf_token)
    from private.data_tokens t where t.user_id = auth.uid()), '{}'::json)
$$;

revoke all on function public.set_data_tokens(text) from public, anon;
revoke all on function public.data_tokens_status() from public, anon;
revoke all on function public.data_tokens() from public, anon;
grant execute on function public.set_data_tokens(text) to authenticated;
grant execute on function public.data_tokens_status() to authenticated;
grant execute on function public.data_tokens() to authenticated;

-- One account's numbers (used by my_usage; not callable from the API).
create or replace function private.usage_of(uid uuid) returns json
  language plpgsql stable security definer set search_path = '' as $$
begin
  return json_build_object(
    'ai_shared_24h', (select count(*) from private.fix_calls c where c.user_id = uid and c.at > now() - interval '1 day'),
    'ai_own_24h', (select count(*) from private.ai_own_calls c where c.user_id = uid and c.at > now() - interval '1 day'),
    'ai_own_30d', (select count(*) from private.ai_own_calls c where c.user_id = uid),
    'server_runs_24h', (select count(*) from private.run_calls c where c.user_id = uid and c.at > now() - interval '1 day'),
    'ai_connected', exists (select 1 from private.ai_keys k where k.user_id = uid),
    'ai_used_at', (select k.used_at from private.ai_keys k where k.user_id = uid)
  );
end $$;
revoke all on function private.usage_of(uuid) from public, anon, authenticated;

create or replace function public.my_usage() returns json
  language sql stable security definer set search_path = '' as $$
  select case when auth.uid() is null then '{}'::json else private.usage_of(auth.uid()) end
$$;

-- What the caller has connected, and whether AI now runs only on users' own connections.
create or replace function public.connection_gate() returns json
  language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'ai_connected', exists (select 1 from private.ai_keys k where k.user_id = auth.uid()),
    'ai_required', exists (select 1 from private.ai_keys)
  )
$$;

revoke all on function public.my_usage() from public, anon;
revoke all on function public.connection_gate() from public, anon;
grant execute on function public.my_usage() to authenticated;
grant execute on function public.connection_gate() to authenticated;
