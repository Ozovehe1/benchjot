-- Dataset keys (2026-11-18): each user's own Hugging Face token, so server runs can download gated
-- Hugging Face datasets and models. A shared token in the deployment would be readable by anyone's
-- code, so it is per user.
--
-- The table is in the private schema (not exposed by the API). Three functions, each on the
-- caller's own row only:
--   set_data_tokens(hf_token): null keeps the value, '' removes it;
--   data_tokens_status(): whether one is saved, never the token (Settings);
--   data_tokens(): the token, for the server run to pass to the sandbox as HF_TOKEN (the user's
--   own code sees it there anyway).

create table if not exists private.data_tokens (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  hf_token   text check (hf_token is null or hf_token ~ '^hf_[A-Za-z0-9]{16,128}$'),
  updated_at timestamptz not null default now()
);
alter table private.data_tokens enable row level security;

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
