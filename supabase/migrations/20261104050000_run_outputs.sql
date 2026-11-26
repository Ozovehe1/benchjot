-- Figures, tables and charts from runs (src/lib/run/outputs.ts): files in a private
-- bucket under {user id}/{snippet id}/{run id}/, referenced from snippets.last_run.
-- Owner-only, by the first folder of the path, like every table's RLS.

insert into storage.buckets (id, name, public, file_size_limit)
values ('run-outputs', 'run-outputs', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists "run outputs: owner reads" on storage.objects;
drop policy if exists "run outputs: owner adds" on storage.objects;
drop policy if exists "run outputs: owner updates" on storage.objects;
drop policy if exists "run outputs: owner deletes" on storage.objects;

create policy "run outputs: owner reads" on storage.objects for select to authenticated
  using (bucket_id = 'run-outputs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "run outputs: owner adds" on storage.objects for insert to authenticated
  with check (bucket_id = 'run-outputs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "run outputs: owner updates" on storage.objects for update to authenticated
  using (bucket_id = 'run-outputs' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'run-outputs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "run outputs: owner deletes" on storage.objects for delete to authenticated
  using (bucket_id = 'run-outputs' and (storage.foldername(name))[1] = (select auth.uid())::text);
