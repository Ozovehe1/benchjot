-- Who may call the app's functions (2026-11-18). Supabase grants EXECUTE on every new function in
-- public to anon (signed out) by default, so `revoke ... from public` in earlier migrations left
-- anon able to call fix_take, run_take and set_username (each refuses without a user, but anon
-- shouldn't reach them) and the trigger functions (which nobody should call directly).
--
-- After this: signed-out visitors can call only login_email and username_available (sign-in and the
-- sign-up name check); trigger functions are callable by no API role (triggers still fire: EXECUTE is
-- checked when a trigger is created, not when it runs). New functions no longer get anon by default,
-- so each migration grants what it means to.

revoke execute on function public.fix_take(int, int) from public, anon;
revoke execute on function public.run_take(int) from public, anon;
revoke execute on function public.set_username(text) from public, anon;
grant execute on function public.fix_take(int, int) to authenticated;
grant execute on function public.run_take(int) to authenticated;
grant execute on function public.set_username(text) to authenticated;

revoke execute on function public.touch_parent_entry() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
revoke execute on function public.entries_parent_no_cycle() from public, anon, authenticated;
revoke execute on function public.entries_derived_no_cycle() from public, anon, authenticated;

-- Future functions: no anon (or PUBLIC) EXECUTE unless a migration grants it. PUBLIC's EXECUTE is a
-- global default (a per-schema rule can't remove it); Supabase's grant to anon is per-schema.
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;
