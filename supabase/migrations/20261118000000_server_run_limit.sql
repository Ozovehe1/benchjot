-- Server runs for free accounts (2026-11-18): run_take(per_day) counts the caller's runs on the
-- server (/api/run); it returns 0 and records one when allowed, else the seconds until one is.
-- The route passes the limit from src/config/app.ts (SERVER_FREE) and calls it only for free
-- accounts. Calling it directly only spends the caller's own quota.

create table if not exists private.run_calls (
  user_id uuid not null,
  at      timestamptz not null default now()
);
create index if not exists run_calls_user_at on private.run_calls (user_id, at);

create or replace function public.run_take(per_day int) returns int
  language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  wait int;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = 'PT401';
  end if;
  perform pg_advisory_xact_lock(hashtext('run:' || uid::text));
  delete from private.run_calls where user_id = uid and at < now() - interval '1 day';
  if (select count(*) from private.run_calls where user_id = uid) >= per_day then
    select ceil(extract(epoch from (min(at) + interval '1 day' - now())))::int into wait from private.run_calls where user_id = uid;
    return greatest(wait, 1);
  end if;
  insert into private.run_calls (user_id) values (uid);
  return 0;
end $$;

revoke all on function public.run_take(int) from public;
grant execute on function public.run_take(int) to authenticated;
