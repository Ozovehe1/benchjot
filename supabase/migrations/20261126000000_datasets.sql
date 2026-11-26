-- The Data library (2026-11-26): each account's datasets, kept once and used by any run by name.
-- Files live in the private "datasets" bucket under the owner's folder (<user id>/<file name>);
-- only the owner can list, read, add, replace or delete them. Limits: 50 MB a file (the bucket's
-- file_size_limit), DATA_QUOTA bytes an account (checked when a file is added or replaced).
insert into storage.buckets (id, name, public, file_size_limit)
values ('datasets', 'datasets', false, 52428800)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

-- How many bytes the caller's datasets take (the Data page shows it; the policies check it).
create or replace function public.data_bytes() returns bigint
  language sql stable security definer set search_path = '' as $$
  select coalesce(sum((o.metadata->>'size')::bigint), 0)
    from storage.objects o
   where o.bucket_id = 'datasets' and (storage.foldername(o.name))[1] = (select auth.uid())::text
$$;
revoke all on function public.data_bytes() from public, anon;
grant execute on function public.data_bytes() to authenticated;

create policy "datasets: owner reads" on storage.objects for select to authenticated
  using (bucket_id = 'datasets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "datasets: owner adds" on storage.objects for insert to authenticated
  with check (bucket_id = 'datasets' and (storage.foldername(name))[1] = (select auth.uid())::text and public.data_bytes() < 262144000);
create policy "datasets: owner replaces" on storage.objects for update to authenticated
  using (bucket_id = 'datasets' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'datasets' and (storage.foldername(name))[1] = (select auth.uid())::text and public.data_bytes() < 262144000);
create policy "datasets: owner deletes" on storage.objects for delete to authenticated
  using (bucket_id = 'datasets' and (storage.foldername(name))[1] = (select auth.uid())::text);
