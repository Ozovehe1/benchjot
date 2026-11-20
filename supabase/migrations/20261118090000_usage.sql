-- Usage and required connections (2026-11-18).
--
-- 1) Usage, for transparency: how many AI requests and server runs each account made. Counts only,
--    never content. Requests on the shared limit are already counted (private.fix_calls, a day's
--    worth) and server runs too (private.run_calls); requests answered by the user's own connected
--    AI are counted here (private.ai_own_calls, kept 30 days). my_usage() shows a user their own
--    numbers. Nothing in the app shows one account's numbers to anyone else.
-- 2) connection_gate() says what the caller has connected. No connection is required to use the
--    app. ai_required means Benchjot's own model no longer answers free accounts (lib/server/llm.ts):
--    true once somebody has connected AI successfully, so the feature is never switched off before
--    connecting is known to work.

create table if not exists private.ai_own_calls (
  user_id uuid not null references auth.users(id) on delete cascade,
  at      timestamptz not null default now()
);
create index if not exists ai_own_calls_user_at on private.ai_own_calls (user_id, at);
alter table private.ai_own_calls enable row level security;

-- Counts one request answered by the caller's own connected AI.
create or replace function public.ai_own_used() returns void
  language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    return;
  end if;
  delete from private.ai_own_calls where user_id = uid and at < now() - interval '30 days';
  insert into private.ai_own_calls (user_id) values (uid);
end $$;

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

revoke all on function public.ai_own_used() from public, anon;
revoke all on function public.my_usage() from public, anon;
revoke all on function public.connection_gate() from public, anon;
grant execute on function public.ai_own_used() to authenticated;
grant execute on function public.my_usage() to authenticated;
grant execute on function public.connection_gate() to authenticated;
