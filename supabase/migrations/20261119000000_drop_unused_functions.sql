-- Functions nothing calls any more (2026-11-19):
--  * fix_take / fix_refund counted Fix and Helper requests against Benchjot's own shared model.
--    That model is gone: every AI request runs on the user's own connected account (ai_own_used counts it).
--  * data_tokens_status said whether a Hugging Face token was saved; the app reads that through
--    /api/data-keys (lib/server/hf-grant.ts, hfStatus) instead.
-- The tables they wrote (private.fix_calls) keep their history for usage counts.
drop function if exists public.fix_take(int, int);
drop function if exists public.fix_refund(text);
drop function if exists public.data_tokens_status();
