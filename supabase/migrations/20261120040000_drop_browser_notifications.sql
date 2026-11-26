-- Browser notifications are gone (Web Push): invitations show on the invited person's Benchjot home,
-- and the Android app alerts for them on the phone by itself (it reads shared_with_me(), unchanged).
-- What only the browser notifications used goes: the browsers' push addresses, the server's lookup of
-- whom to push to (share_notice) and its clean-up (push_gone), and the key that let the server call them.
drop function if exists public.share_notice(uuid, uuid, text);
drop function if exists public.push_gone(text, text);
drop table if exists public.push_subscriptions;
delete from private.server_keys where name = 'notify';
