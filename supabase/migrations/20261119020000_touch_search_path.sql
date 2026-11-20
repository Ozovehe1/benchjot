-- touch_updated_at() (the trigger that stamps updated_at on every edit) gets a fixed, empty
-- search_path, as every other function here has: it only calls now(), which is always found, and
-- no one can make it run something else by putting an object earlier on the path (Supabase's
-- security advisor: function_search_path_mutable).
alter function public.touch_updated_at() set search_path = '';
