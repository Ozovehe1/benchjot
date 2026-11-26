-- Fix and Helper: a request the model didn't answer isn't counted (2026-11-18). fix_take counts a
-- request before the model is asked; when no usable answer comes back (the provider fails or times
-- out, or its answer can't be read or is refused), the app gives it back with fix_refund.
--
-- Same rule as run_refund: a user must not refund themselves, so fix_refund needs the server's key
-- (RUN_REFUND_KEY; the database checks its SHA-256 in private.server_keys, row 'run_refund').
-- Without that row, or without the server's key, nothing is refunded and everything else works.

-- Gives back the caller's latest counted Fix / Helper request from the last 2 minutes (a request
-- lasts at most a minute). False (and nothing changes) without the right key, without a user, or
-- with nothing to give back.
create or replace function public.fix_refund(key text) returns boolean
  language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or key is null then
    return false;
  end if;
  if not exists (select 1 from private.server_keys k where k.name = 'run_refund' and k.hash = encode(extensions.digest(fix_refund.key, 'sha256'), 'hex')) then
    return false;
  end if;
  delete from private.fix_calls c
   where c.ctid = (select f.ctid from private.fix_calls f where f.user_id = uid and f.at > now() - interval '2 minutes' order by f.at desc limit 1);
  return found;
end $$;

revoke all on function public.fix_refund(text) from public, anon;
grant execute on function public.fix_refund(text) to authenticated;
