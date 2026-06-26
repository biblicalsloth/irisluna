-- ─── Profiles RLS ─────────────────────────────────────────
alter table public.profiles enable row level security;

create policy "profiles: own row read"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles: own row update"
  on public.profiles for update
  using (auth.uid() = id);

-- ─── Readings RLS ─────────────────────────────────────────
alter table public.readings enable row level security;

-- Seeker reads/updates own readings
create policy "readings: seeker select"
  on public.readings for select
  using (auth.uid() = user_id);

-- Reader reads queue (awaiting + responded only)
create policy "readings: reader select queue"
  on public.readings for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'reader'
    )
    and status in ('awaiting_response', 'responded')
  );

-- Reader claims + sends response (update only via edge functions using service role)
-- Direct client updates blocked by default; edge functions bypass via service role

-- ─── Reading cards RLS ────────────────────────────────────
alter table public.reading_cards enable row level security;

-- Seeker reads cards only AFTER human has responded (the seal)
create policy "reading_cards: seeker reads after response"
  on public.reading_cards for select
  using (
    exists (
      select 1 from public.readings r
      where r.id = reading_cards.reading_id
        and r.user_id = auth.uid()
        and r.status in ('responded', 'revealed')
    )
  );

-- Reader reads queue cards
create policy "reading_cards: reader reads queue"
  on public.reading_cards for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'reader'
    )
    and exists (
      select 1 from public.readings r
      where r.id = reading_cards.reading_id
        and r.status in ('awaiting_response', 'responded')
    )
  );

-- ─── Storage bucket policies ──────────────────────────────
-- Run after buckets are created via dashboard or Supabase CLI

-- question-audio: seeker uploads own after auth; reader downloads for their queue
insert into storage.buckets (id, name, public) values
  ('question-audio', 'question-audio', false),
  ('response-audio', 'response-audio', false),
  ('card-art', 'card-art', true)
on conflict (id) do nothing;

-- question-audio: seeker can upload/read their own
create policy "qa: seeker upload"
  on storage.objects for insert
  with check (
    bucket_id = 'question-audio'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "qa: seeker read own"
  on storage.objects for select
  using (
    bucket_id = 'question-audio'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "qa: reader read queue"
  on storage.objects for select
  using (
    bucket_id = 'question-audio'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'reader'
    )
  );

-- response-audio: reader uploads; seeker reads after responded
create policy "ra: reader upload"
  on storage.objects for insert
  with check (
    bucket_id = 'response-audio'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'reader'
    )
  );

create policy "ra: seeker read after response"
  on storage.objects for select
  using (
    bucket_id = 'response-audio'
    and exists (
      select 1 from public.readings r
      where r.response_audio_path like '%' || name || '%'
        and r.user_id = auth.uid()
        and r.status in ('responded', 'revealed')
    )
  );

-- card-art: public read (bucket is public, no policy needed for select)
