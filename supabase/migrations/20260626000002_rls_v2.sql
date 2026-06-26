-- ─── Profiles RLS ────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;

create policy "profiles: own row read"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles: own row update"
  on public.profiles for update
  using (auth.uid() = id);

-- ─── Readings RLS ────────────────────────────────────────────────────────────
-- Seeker access to readings is ONLY through edge functions (service role).
-- Authenticated readers/admins can see the full queue.
alter table public.readings enable row level security;

create policy "readings: reader sees full queue"
  on public.readings for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('reader', 'admin')
    )
  );

-- Readers can claim and update status (response submission goes through edge fn)
create policy "readings: reader update claimed"
  on public.readings for update
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('reader', 'admin')
    )
  );

-- ─── Reading cards RLS ───────────────────────────────────────────────────────
-- Seeker sees their cards only through reveal edge function (service role).
-- Readers see cards for readings they're working on.
alter table public.reading_cards enable row level security;

create policy "reading_cards: reader select"
  on public.reading_cards for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('reader', 'admin')
    )
  );

-- ─── Storage buckets ─────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public) values
  ('question-audio',      'question-audio',      false),
  ('payment-screenshots', 'payment-screenshots', false),
  ('response-audio',      'response-audio',      false),
  ('card-art',            'card-art',            true)  -- public-domain RWS scans
on conflict (id) do nothing;

-- question-audio: readers can read (to play seeker's question in admin)
create policy "qa: reader read"
  on storage.objects for select
  using (
    bucket_id = 'question-audio'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('reader', 'admin')
    )
  );

-- payment-screenshots: readers can read (to verify payment in admin)
create policy "ps: reader read"
  on storage.objects for select
  using (
    bucket_id = 'payment-screenshots'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('reader', 'admin')
    )
  );

-- response-audio: readers upload (they're authenticated)
create policy "ra: reader upload"
  on storage.objects for insert
  with check (
    bucket_id = 'response-audio'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('reader', 'admin')
    )
  );

-- response-audio: readers can read (to review their own submissions)
create policy "ra: reader read"
  on storage.objects for select
  using (
    bucket_id = 'response-audio'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('reader', 'admin')
    )
  );
-- Seekers get a signed URL from reveal edge function after verifying session_token.
