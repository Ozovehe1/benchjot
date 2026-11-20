-- Deleting an account cascades into snippets, whose touch trigger updates the
-- parent entry. That ran as the deleting role (the auth admin has no rights on
-- public.entries), so account deletion failed. Run it as the owner instead; it
-- only bumps updated_at on the snippet's own parent row.
create or replace function public.touch_parent_entry()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.entries set updated_at = now()
   where id = coalesce(new.entry_id, old.entry_id);
  return null;
end $$;
