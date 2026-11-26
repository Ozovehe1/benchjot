-- One AI for everyone (2026-11-25): Fix, the Assistant and the seer run on Benchjot's own Claude
-- account, so each account gets an allowance (src/config/app.ts AI, passed in by the server):
-- per_day answers in a rolling 24 hours, and per_month credits in the calendar month (UTC), where
-- one credit is one US cent of what Claude charged for the answer (the server works it out from the
-- tokens). ai_check says whether the caller may ask now; it counts nothing. ai_spent(credits)
-- records an answer after it came back, so a failed request never counts. Calling either directly
-- only changes the caller's own numbers (a negative amount counts as 0).

alter table private.ai_own_calls add column if not exists credits numeric(10, 4) not null default 0;

create or replace function public.ai_spent(credits numeric) returns void
  language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    return;
  end if;
  delete from private.ai_own_calls where user_id = uid and at < date_trunc('month', now() at time zone 'utc') at time zone 'utc' - interval '31 days';
  insert into private.ai_own_calls (user_id, credits) values (uid, greatest(coalesce(ai_spent.credits, 0), 0));
end $$;

-- {wait: seconds until the caller may ask (0 = now), why: 'day' | 'month' | null}.
create or replace function public.ai_check(per_day int, per_month numeric) returns json
  language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  month_start timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  wait int;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = 'PT401';
  end if;
  if (select coalesce(sum(c.credits), 0) from private.ai_own_calls c where c.user_id = uid and c.at >= month_start) >= per_month then
    return json_build_object('wait', greatest(ceil(extract(epoch from (month_start + interval '1 month' - now())))::int, 1), 'why', 'month');
  end if;
  if (select count(*) from private.ai_own_calls c where c.user_id = uid and c.at > now() - interval '1 day') < per_day then
    return json_build_object('wait', 0, 'why', null);
  end if;
  select ceil(extract(epoch from (c.at + interval '1 day' - now())))::int into wait
    from private.ai_own_calls c where c.user_id = uid and c.at > now() - interval '1 day'
    order by c.at desc offset per_day - 1 limit 1;
  return json_build_object('wait', greatest(coalesce(wait, 1), 1), 'why', 'day');
end $$;

revoke all on function public.ai_spent(numeric) from public, anon;
revoke all on function public.ai_check(int, numeric) from public, anon;
grant execute on function public.ai_spent(numeric) to authenticated;
grant execute on function public.ai_check(int, numeric) to authenticated;

-- Settings → Usage: requests in the last 24 hours and when the oldest of them leaves it, credits
-- used this month, and server runs.
create or replace function private.usage_of(uid uuid) returns json
  language plpgsql stable security definer set search_path = '' as $$
declare
  month_start timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
begin
  return json_build_object(
    'ai_own_24h', (select count(*) from private.ai_own_calls c where c.user_id = uid and c.at > now() - interval '1 day'),
    'ai_oldest_at', (select min(c.at) from private.ai_own_calls c where c.user_id = uid and c.at > now() - interval '1 day'),
    'ai_credits_month', (select round(coalesce(sum(c.credits), 0), 1) from private.ai_own_calls c where c.user_id = uid and c.at >= month_start),
    'ai_month_resets_at', month_start + interval '1 month',
    'server_runs_24h', (select count(*) from private.run_calls c where c.user_id = uid and c.at > now() - interval '1 day')
  );
end $$;
revoke all on function private.usage_of(uuid) from public, anon, authenticated;
