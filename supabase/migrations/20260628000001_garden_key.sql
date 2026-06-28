-- Anonymous garden key: one seeker owns all their readings.
create table if not exists public.seekers (
  id               uuid primary key default gen_random_uuid(),
  garden_code_hash text not null unique,
  restore_attempts int  not null default 0,
  created_at       timestamptz default now()
);

alter table public.seekers enable row level security;
-- No anon/seeker policies: access is service-role only via edge functions.

alter table public.readings
  add column if not exists seeker_id uuid references public.seekers(id) on delete set null;

create index if not exists readings_seeker_id_idx on public.readings (seeker_id);

-- Retire the per-reading recovery mechanism (superseded by the garden code).
alter table public.readings drop column if exists recovery_code;
alter table public.readings drop column if exists recovery_attempts;
