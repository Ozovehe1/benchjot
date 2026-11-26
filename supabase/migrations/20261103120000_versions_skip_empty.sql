-- Versions: don't record an empty snippet as v1, and let a burst of edits
-- (within 60 s) fold into the latest version, including v1.
create or replace function public.snippets_record_version()
returns trigger language plpgsql as $$
declare
  latest public.snippet_versions%rowtype;
begin
  if tg_op = 'UPDATE' and new.content is not distinct from old.content then
    return new;
  end if;
  if tg_op = 'INSERT' and new.content = '' then
    return new;
  end if;

  select * into latest from public.snippet_versions
   where snippet_id = new.id order by version desc limit 1;

  if found and latest.updated_at > now() - interval '60 seconds' then
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
