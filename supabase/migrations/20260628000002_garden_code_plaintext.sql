-- Plaintext garden key, set by claim_garden after payment. Readable only via
-- session-token-gated edge functions. seekers keeps the hash for restore.
alter table public.readings
  add column if not exists garden_code text;
