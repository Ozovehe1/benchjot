-- Benchlog schema: projects > experiments > (snippets > versions, runs).
-- Every table is owner-only via RLS (auth.uid() = user_id).
-- Child rows carry user_id too and reference their parent by (id, user_id),
-- so a row can never point at another user's parent.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- helpers
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------- projects
create table public.projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, user_id)
);
create index projects_user_idx on public.projects (user_id, updated_at desc);
create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- experiments
create table public.experiments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id  uuid,
  title       text not null check (char_length(title) between 1 and 200),
  hypothesis  text not null default '' check (char_length(hypothesis) <= 4000),
  status      text not null default 'planned'
              check (status in ('planned', 'running', 'done', 'failed', 'abandoned')),
  tags        text[] not null default '{}' check (cardinality(tags) <= 30),
  notes       text not null default '' check (char_length(notes) <= 200000),
  pinned      boolean not null default false,
  started_on  date,
  ended_on    date,
  fts         tsvector,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, user_id),
  foreign key (project_id, user_id) references public.projects (id, user_id) on delete cascade
);
create index experiments_user_idx on public.experiments (user_id, pinned desc, updated_at desc);
create index experiments_project_idx on public.experiments (project_id);
create index experiments_tags_idx on public.experiments using gin (tags);
create index experiments_fts_idx on public.experiments using gin (fts);

create or replace function public.experiments_fts_update()
returns trigger language plpgsql as $$
begin
  new.fts :=
    setweight(to_tsvector('english', coalesce(new.title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(array_to_string(new.tags, ' '), '')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.hypothesis, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(new.notes, '')), 'C');
  return new;
end $$;
create trigger experiments_fts before insert or update of title, tags, hypothesis, notes
  on public.experiments for each row execute function public.experiments_fts_update();
create trigger experiments_touch before update on public.experiments
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- snippets
create table public.snippets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  experiment_id uuid not null,
  filename      text not null default '' check (char_length(filename) <= 200),
  language      text not null default 'python' check (char_length(language) <= 40),
  content       text not null default '' check (char_length(content) <= 500000),
  position      integer not null default 0,
  fts           tsvector,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, user_id),
  foreign key (experiment_id, user_id) references public.experiments (id, user_id) on delete cascade
);
create index snippets_experiment_idx on public.snippets (experiment_id, position);
create index snippets_fts_idx on public.snippets using gin (fts);
create index snippets_language_idx on public.snippets (user_id, language);

create or replace function public.snippets_fts_update()
returns trigger language plpgsql as $$
begin
  new.fts :=
    setweight(to_tsvector('simple', coalesce(new.filename, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(new.content, '')), 'C');
  return new;
end $$;
create trigger snippets_fts before insert or update of filename, content
  on public.snippets for each row execute function public.snippets_fts_update();
create trigger snippets_touch before update on public.snippets
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- snippet versions
-- One authoritative place for versioning: a trigger. Every content change
-- becomes a version; rapid autosaves within 60 s are folded into the latest
-- version so history stays readable.
create table public.snippet_versions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  snippet_id  uuid not null,
  version     integer not null,
  content     text not null,
  language    text not null,
  filename    text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (snippet_id, version),
  foreign key (snippet_id, user_id) references public.snippets (id, user_id) on delete cascade
);
create index snippet_versions_snippet_idx on public.snippet_versions (snippet_id, version desc);

create or replace function public.snippets_record_version()
returns trigger language plpgsql as $$
declare
  latest public.snippet_versions%rowtype;
begin
  if tg_op = 'UPDATE' and new.content is not distinct from old.content then
    return new;
  end if;

  select * into latest from public.snippet_versions
   where snippet_id = new.id order by version desc limit 1;

  if found and latest.updated_at > now() - interval '60 seconds' and latest.version > 1 then
    update public.snippet_versions
       set content = new.content, language = new.language,
           filename = new.filename, updated_at = now()
     where id = latest.id;
  else
    insert into public.snippet_versions (user_id, snippet_id, version, content, language, filename)
    values (new.user_id, new.id, coalesce(latest.version, 0) + 1, new.content, new.language, new.filename);
  end if;
  return new;
end $$;
create trigger snippets_version after insert or update of content
  on public.snippets for each row execute function public.snippets_record_version();

-- ---------------------------------------------------------------- runs
create table public.runs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  experiment_id uuid not null,
  name          text not null check (char_length(name) between 1 and 200),
  params        jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object'),
  env           jsonb not null default '{}'::jsonb check (jsonb_typeof(env) = 'object'),
  metrics       jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics) = 'object'),
  outcome       text not null default '' check (char_length(outcome) <= 20000),
  links         jsonb not null default '[]'::jsonb check (jsonb_typeof(links) = 'array'),
  ran_at        timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (experiment_id, user_id) references public.experiments (id, user_id) on delete cascade
);
create index runs_experiment_idx on public.runs (experiment_id, ran_at desc);
create trigger runs_touch before update on public.runs
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- RLS
do $$
declare t text;
begin
  foreach t in array array['projects', 'experiments', 'snippets', 'snippet_versions', 'runs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format($p$create policy owner_select on public.%I for select to authenticated using ((select auth.uid()) = user_id)$p$, t);
    execute format($p$create policy owner_insert on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)$p$, t);
    execute format($p$create policy owner_update on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)$p$, t);
    execute format($p$create policy owner_delete on public.%I for delete to authenticated using ((select auth.uid()) = user_id)$p$, t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- search
-- q_english / q_simple are tsquery strings built client-side by buildTsQuery()
-- (prefix-matching, sanitised). Runs as the caller, so RLS still applies.
create or replace function public.search_experiments(
  q          text default '',
  p_statuses text[] default null,
  p_tags     text[] default null,
  p_language text default null,
  p_project  uuid default null
)
returns setof public.experiments
language sql stable security invoker set search_path = public as $$
  with tq as (
    select case when coalesce(q, '') = '' then null else to_tsquery('english', q) end as e,
           case when coalesce(q, '') = '' then null else to_tsquery('simple', q) end as s
  ),
  code_hits as (
    select sn.experiment_id, max(ts_rank(sn.fts, tq.s)) as rank
      from public.snippets sn, tq
     where tq.s is not null and sn.fts @@ tq.s
     group by sn.experiment_id
  )
  select e.*
    from public.experiments e
    cross join tq
    left join code_hits ch on ch.experiment_id = e.id
   where (tq.e is null or e.fts @@ tq.e or e.fts @@ tq.s or ch.experiment_id is not null)
     and (p_statuses is null or cardinality(p_statuses) = 0 or e.status = any (p_statuses))
     and (p_tags is null or cardinality(p_tags) = 0 or e.tags @> p_tags)
     and (p_project is null or e.project_id = p_project)
     and (p_language is null or exists (
          select 1 from public.snippets l where l.experiment_id = e.id and l.language = p_language))
   order by e.pinned desc,
            (case when tq.e is null then 0
                  else ts_rank(e.fts, tq.e) + ts_rank(e.fts, tq.s) + coalesce(ch.rank, 0) end) desc,
            e.updated_at desc
   limit 200
$$;

-- ---------------------------------------------------------------- fork
create or replace function public.fork_experiment(p_id uuid)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  src public.experiments%rowtype;
  new_id uuid;
begin
  select * into src from public.experiments where id = p_id;
  if not found then
    raise exception 'experiment % not found', p_id using errcode = 'P0002';
  end if;

  insert into public.experiments (project_id, title, hypothesis, status, tags, notes)
  values (src.project_id, left(src.title || ' (fork)', 200), src.hypothesis, 'planned', src.tags, src.notes)
  returning id into new_id;

  insert into public.snippets (experiment_id, filename, language, content, position)
  select new_id, filename, language, content, position
    from public.snippets where experiment_id = p_id;

  return new_id;
end $$;

-- ---------------------------------------------------------------- tags & languages for filters
create or replace function public.my_tags()
returns table (tag text, uses bigint)
language sql stable security invoker set search_path = public as $$
  select t, count(*) from public.experiments, unnest(tags) as t group by t order by count(*) desc, t
$$;

revoke all on function public.search_experiments(text, text[], text[], text, uuid) from anon, public;
revoke all on function public.fork_experiment(uuid) from anon, public;
revoke all on function public.my_tags() from anon, public;
grant execute on function public.search_experiments(text, text[], text[], text, uuid) to authenticated;
grant execute on function public.fork_experiment(uuid) to authenticated;
grant execute on function public.my_tags() to authenticated;
