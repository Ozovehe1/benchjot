-- Connect Hugging Face stores its sealed grant (access token, refresh token, expiry, username) in
-- private.data_tokens.hf_token. Hugging Face's OAuth tokens are much longer than a pasted hf_ token,
-- so the stored size limit goes from 600 to 16000 characters.
alter table private.data_tokens drop constraint if exists data_tokens_sealed_sizes;
alter table private.data_tokens add constraint data_tokens_sealed_sizes check (coalesce(length(hf_token), 0) <= 16000);
