-- ─── Drop old schema (safe for early-dev reset) ─────────────────────────────
drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists trg_bump_voice_notes on public.readings;
drop function if exists public.handle_new_user() cascade;
drop function if exists public.bump_voice_notes() cascade;
drop table if exists public.reading_cards cascade;
drop table if exists public.readings cascade;
drop table if exists public.profiles cascade;

-- ─── Extensions ──────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";
create extension if not exists "pg_cron" schema "extensions";

-- ─── Profiles (authenticated readers / admins only) ───────────────────────────
-- Seekers are anonymous; no profile row for them.
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  email        text,
  role         text not null default 'pending'
               check (role in ('pending', 'reader', 'admin')),
  created_at   timestamptz default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- New users start as 'pending'; an admin must manually promote to 'reader'.
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'pending');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── Cards (78-card RWS deck, seeded once) ───────────────────────────────────
create table if not exists public.cards (
  id               int primary key,
  name             text not null,
  arcana           text not null check (arcana in ('major', 'minor')),
  suit             text check (suit in ('wands', 'cups', 'swords', 'pentacles') or suit is null),
  number           int,
  image_path       text not null,
  upright_meaning  text not null,
  reversed_meaning text not null,
  keywords         text[],
  flower_species   text
);

alter table public.cards enable row level security;
drop policy if exists "cards public read" on public.cards;
create policy "cards public read" on public.cards for select using (true);

-- ─── Readings (anonymous — identified by session_token) ───────────────────────
create table public.readings (
  id                      uuid primary key default gen_random_uuid(),
  session_token           uuid not null default gen_random_uuid(),
  spread_type             text not null check (spread_type in ('single', 'three')),
  question_audio_path     text not null,
  question_duration_ms    int,
  email                   text,
  status                  text not null default 'pending_payment'
                          check (status in (
                            'pending_payment',
                            'awaiting_response',
                            'responded',
                            'revealed',
                            'expired'
                          )),
  payment_screenshot_path text,
  payment_verified_at     timestamptz,
  verified_by             uuid references public.profiles(id),
  claimed_by              uuid references public.profiles(id),
  claimed_at              timestamptz,
  response_audio_path     text,
  response_duration_ms    int,
  created_at              timestamptz default now(),
  expires_at              timestamptz default (now() + interval '24 hours'),
  responded_at            timestamptz,
  revealed_at             timestamptz
);

create index on public.readings (session_token);
create index on public.readings (status) where status in ('pending_payment', 'awaiting_response');
create index on public.readings (claimed_by) where claimed_by is not null;
create index on public.readings (created_at desc);

-- ─── Reading cards (sealed until reader responds) ────────────────────────────
create table public.reading_cards (
  id          uuid primary key default gen_random_uuid(),
  reading_id  uuid not null references public.readings(id) on delete cascade,
  card_id     int not null references public.cards(id),
  position    int not null,
  is_reversed boolean not null default false,
  unique (reading_id, position)
);

create index on public.reading_cards (reading_id);

-- ─── Expire stale readings (cron every 15 min) ───────────────────────────────
-- Unschedule if exists (idempotent re-run)
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
    where status in ('pending_payment', 'awaiting_response')
      and expires_at < now();
  $$
);
