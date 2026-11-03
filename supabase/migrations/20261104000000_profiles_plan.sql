-- One profile row per user, holding the plan. 'free' by default; only the
-- service side (migrations, the dashboard, a future billing hook) can change it.
-- Users can read their own row and nothing else; there is no insert, update or
-- delete policy or grant, so a user can't raise their own plan.

create table if not exists public.profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  plan       text not null default 'free' check (plan in ('free', 'pro')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

-- Every new account gets a free profile.
create or replace function private.create_profile() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists create_profile on auth.users;
create trigger create_profile after insert on auth.users
  for each row execute function private.create_profile();

-- Backfill existing accounts, and make the owner Pro.
insert into public.profiles (user_id) select id from auth.users on conflict (user_id) do nothing;
update public.profiles set plan = 'pro'
  where user_id in (select id from auth.users where email = 'abdulcosman01@gmail.com');
