-- The Android app is out (the landing page links its download), so the waitlist that collected
-- emails to announce it goes: its table, its rate-limit log and the function that joined it.
drop function if exists public.join_android_waitlist(text);
drop table if exists private.android_waitlist;
drop table if exists private.waitlist_calls;
