-- Add recovery_code to readings for cross-device session restore
alter table public.readings
  add column if not exists recovery_code text unique;

create index if not exists readings_recovery_code_idx
  on public.readings (recovery_code)
  where recovery_code is not null;
