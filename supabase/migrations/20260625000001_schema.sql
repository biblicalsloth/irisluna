-- ─── Extensions ───────────────────────────────────────────
create extension if not exists "pgcrypto";
create extension if not exists "pg_cron" schema "extensions";

-- ─── Profiles ─────────────────────────────────────────────
create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  display_name    text,
  email           text,
  role            text not null default 'seeker' check (role in ('seeker','reader')),
  voice_notes_sent int not null default 0,
  garden_seed     int default (floor(random()*100000))::int,
  created_at      timestamptz default now()
);

-- Mirror email from auth on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── Cards (78-card RWS deck, seeded) ─────────────────────
create table public.cards (
  id               int primary key,
  name             text not null,
  arcana           text not null check (arcana in ('major','minor')),
  suit             text check (suit in ('wands','cups','swords','pentacles') or suit is null),
  number           int,
  image_path       text not null,
  upright_meaning  text not null,
  reversed_meaning text not null,
  keywords         text[],
  flower_species   text
);

-- cards is read-only via RLS (seeded at deploy time)
alter table public.cards enable row level security;
create policy "cards public read" on public.cards for select using (true);

-- ─── Readings ─────────────────────────────────────────────
create table public.readings (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references public.profiles(id) on delete cascade,
  spread_type               text not null check (spread_type in ('single','three')),
  question_audio_path       text not null,
  question_duration_ms      int,
  status                    text not null default 'awaiting_response'
                            check (status in ('awaiting_response','responded','revealed','expired')),
  created_in_signup_session boolean not null default false,
  reader_id                 uuid references public.profiles(id),
  claimed_by                uuid references public.profiles(id),
  claimed_at                timestamptz,
  response_audio_path       text,
  response_duration_ms      int,
  created_at                timestamptz default now(),
  expires_at                timestamptz default (now() + interval '24 hours'),
  responded_at              timestamptz,
  revealed_at               timestamptz
);

create index on public.readings (user_id, created_at desc);
create index on public.readings (status) where status = 'awaiting_response';

-- ─── Reading cards ─────────────────────────────────────────
create table public.reading_cards (
  id          uuid primary key default gen_random_uuid(),
  reading_id  uuid not null references public.readings(id) on delete cascade,
  card_id     int not null references public.cards(id),
  position    int not null,
  orientation text not null check (orientation in ('upright','reversed')),
  unique (reading_id, position)
);

create index on public.reading_cards (reading_id);

-- ─── Garden: bump voice_notes_sent on reading insert ───────
create or replace function public.bump_voice_notes()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  update public.profiles
  set voice_notes_sent = voice_notes_sent + 1
  where id = new.user_id;
  return new;
end;
$$;

create trigger trg_bump_voice_notes
  after insert on public.readings
  for each row execute function public.bump_voice_notes();

-- ─── 24h expiry (every 15 min) ────────────────────────────
select cron.schedule(
  'expire-readings',
  '*/15 * * * *',
  $$
    update public.readings
    set status = 'expired'
    where status = 'awaiting_response'
      and expires_at < now();
  $$
);
