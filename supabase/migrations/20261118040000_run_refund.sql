-- Free server runs: a run that never executed isn't counted (2026-11-18). run_take counts a run
-- before it starts; when the server then can't start it (the sandbox fails, the provider is down),
-- the app gives it back with run_refund.
--
-- A user must not be able to refund themselves (that would be unlimited runs), so run_refund
-- needs a key only the app's server has (its RUN_REFUND_KEY). The database keeps the key's
-- SHA-256 in private.server_keys, set once per project outside the migrations:
--   insert into private.server_keys (name, hash) values ('run_refund', '<sha256 hex of the key>')
--     on conflict (name) do update set hash = excluded.hash;
-- Without that row (or without the server's key) nothing is refunded and everything else works.

create table if not exists private.server_keys (
  name text primary key,
  hash text not null
);
alter table private.server_keys enable row level security;

-- Gives back the caller's latest counted run from the last 10 minutes. False (and nothing
-- changes) without the right key, without a user, or with nothing to give back.
create or replace function public.run_refund(key text) returns boolean
  language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or key is null then
    return false;
  end if;
  if not exists (select 1 from private.server_keys k where k.name = 'run_refund' and k.hash = encode(extensions.digest(run_refund.key, 'sha256'), 'hex')) then
    return false;
  end if;
  delete from private.run_calls c
   where c.ctid = (select r.ctid from private.run_calls r where r.user_id = uid and r.at > now() - interval '10 minutes' order by r.at desc limit 1);
  return found;
end $$;

revoke all on function public.run_refund(text) from public, anon;
grant execute on function public.run_refund(text) to authenticated;
