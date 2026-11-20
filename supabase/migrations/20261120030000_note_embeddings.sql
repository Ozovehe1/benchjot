-- Search by meaning (the Assistant's find_notes): one embedding per note, made by the gte-small model
-- inside the note-search Edge Function (supabase/functions/note-search), 384 numbers, normalised, so
-- the inner product is the cosine similarity. Owner-only like every table. A note edited after its
-- embedding (cell edits touch notes.updated_at) is embedded again the next time the user searches.

create extension if not exists vector with schema extensions;

create table if not exists public.note_embeddings (
  note_id uuid primary key references public.notes (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  embedding extensions.vector(384) not null,
  -- SHA-256 of the text embedded: an edit that leaves it the same isn't embedded again.
  source_hash text not null check (length(source_hash) <= 64),
  embedded_at timestamptz not null default now()
);

alter table public.note_embeddings enable row level security;

create policy "note embeddings: owner reads" on public.note_embeddings for select to authenticated using ((select auth.uid()) = user_id);
create policy "note embeddings: owner adds" on public.note_embeddings for insert to authenticated
  with check ((select auth.uid()) = user_id and exists (select 1 from public.notes n where n.id = note_id and n.user_id = (select auth.uid())));
create policy "note embeddings: owner updates" on public.note_embeddings for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "note embeddings: owner deletes" on public.note_embeddings for delete to authenticated using ((select auth.uid()) = user_id);

create index if not exists note_embeddings_user on public.note_embeddings (user_id);
create index if not exists note_embeddings_hnsw on public.note_embeddings using hnsw (embedding extensions.vector_ip_ops);

-- The user's notes whose embedding is missing or older than their last edit, newest first.
create or replace function public.stale_note_embeddings(p_limit int)
returns table (id uuid, embedded_hash text)
language sql stable security invoker set search_path = ''
as $$
  select n.id, e.source_hash
  from public.notes n
  left join public.note_embeddings e on e.note_id = n.id
  where n.user_id = (select auth.uid()) and n.deleted_at is null
    and (e.note_id is null or n.updated_at > e.embedded_at)
  order by n.updated_at desc
  limit least(greatest(p_limit, 0), 50);
$$;

-- The user's notes closest in meaning to an embedding (most similar first), never Recently Deleted.
create or replace function public.match_notes(p_embedding extensions.vector(384), p_count int, p_exclude uuid default null, p_min float default 0)
returns table (id uuid, similarity float)
language sql stable security invoker set search_path = ''
as $$
  select e.note_id, -(e.embedding operator(extensions.<#>) p_embedding)
  from public.note_embeddings e
  join public.notes n on n.id = e.note_id
  where e.user_id = (select auth.uid()) and n.deleted_at is null
    and (p_exclude is null or e.note_id <> p_exclude)
    and -(e.embedding operator(extensions.<#>) p_embedding) >= p_min
  order by e.embedding operator(extensions.<#>) p_embedding
  limit least(greatest(p_count, 0), 50);
$$;

-- The user's notes closest in meaning to one of their notes (by its stored embedding).
create or replace function public.similar_notes(p_note uuid, p_count int, p_min float default 0)
returns table (id uuid, similarity float)
language sql stable security invoker set search_path = ''
as $$
  select m.id, m.similarity
  from public.note_embeddings e,
       lateral public.match_notes(e.embedding, p_count, p_note, p_min) m
  where e.note_id = p_note and e.user_id = (select auth.uid());
$$;

-- Signed-in users only in practice: every function filters by auth.uid(), so anyone else gets no rows.
grant execute on function public.stale_note_embeddings(int) to authenticated;
grant execute on function public.match_notes(extensions.vector, int, uuid, float) to authenticated;
grant execute on function public.similar_notes(uuid, int, float) to authenticated;
