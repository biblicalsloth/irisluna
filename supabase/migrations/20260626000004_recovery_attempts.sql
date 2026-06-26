-- Track failed recovery lookups per code; lock after 10 attempts
alter table public.readings
  add column if not exists recovery_attempts int not null default 0;
