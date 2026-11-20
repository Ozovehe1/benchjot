-- Each code block keeps its latest run (browser or server) so output survives
-- reloads and navigation: { outcome, stdout, stderr, error_line, line, ms,
-- where, code_hash, ran_at }. The client caps stdout and stderr at 64 KB each;
-- the check below is a backstop. Owner-only RLS on snippets already covers it.

alter table public.snippets
  add column if not exists last_run jsonb
  check (last_run is null or (jsonb_typeof(last_run) = 'object' and octet_length(last_run::text) <= 600000));

-- Saving a run is not editing the note: only real edits bump the parent
-- entry's updated_at (which orders the list).
drop trigger if exists snippets_touch_entry on public.snippets;
create trigger snippets_touch_entry
  after insert or delete or update of entry_id, filename, language, content, position
  on public.snippets
  for each row execute function public.touch_parent_entry();
