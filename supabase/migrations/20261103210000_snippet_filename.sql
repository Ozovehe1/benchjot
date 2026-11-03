-- Uploaded files keep their name; uploads can be up to 1 MB of text.
alter table public.snippets
  add column filename text not null default '' check (char_length(filename) <= 200);
alter table public.snippets drop constraint snippets_content_check;
alter table public.snippets add constraint snippets_content_check check (char_length(content) <= 1048576);
