-- Dodo Payments + single-button delivery.
-- payment_screenshot_path is now legacy/optional; payment proven by webhook.
alter table public.readings
  alter column payment_screenshot_path drop not null,
  add column if not exists dodo_session_id  text,
  add column if not exists dodo_payment_id  text,
  add column if not exists paid_at          timestamptz,
  add column if not exists payment_amount   int,        -- minor units (cents)
  add column if not exists payment_currency text;        -- e.g. 'USD'

-- Admin queries paid-but-not-yet-flipped rows by (status, paid_at).
create index if not exists readings_pending_paid_idx
  on public.readings (status, paid_at)
  where status = 'pending_payment';

-- Cron change: only expire UNPAID pending_payment. Paid readings NEVER auto-expire.
do $$
begin
  perform cron.unschedule('expire-readings');
exception when others then null;
end;
$$;

select cron.schedule(
  'expire-readings',
  '*/15 * * * *',
  $$
    update public.readings
    set status = 'expired'
    where status = 'pending_payment'
      and paid_at is null
      and expires_at < now();
  $$
);
