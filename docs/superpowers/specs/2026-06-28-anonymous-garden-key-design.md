# Iris Luna — Anonymous Garden Key (Design)

**Date:** 2026-06-28
**Status:** Approved design, pre-implementation
**Scope:** Give seekers durable, cross-device access to all their past readings **without any signup**. Replace the current per-reading `recovery_code` with a single per-garden key that owns every reading a seeker makes. Orthogonal to the Dodo Payments paywall spec; the two compose but ship independently.

---

## 1. Problem

Today a seeker's identity is the per-reading `session_token` in localStorage. Access is fragile and reading-scoped:

- Clear localStorage / new device / new browser → garden gone.
- The per-reading `recovery_code` restores **one** reading at a time, not the whole garden.
- Email deep links rescue a single reading, not a portfolio.

Goal: one anonymous key that restores the **entire** garden, no account, no password.

---

## 2. Decisions (locked)

| # | Decision | Resolution |
|---|---|---|
| 1 | Identity model | **Anonymous garden key.** No Supabase Auth for seekers; edge-function/service-role seal model preserved. |
| 2 | Granularity | **Per-garden, not per-reading.** One key owns all readings. |
| 3 | Per-reading recovery_code | **Removed.** Superseded by the garden code to avoid two competing restore paths. |
| 4 | Build order | **Garden key first**, then Dodo Payments. |

---

## 3. Identity model

Two values, minted once on a seeker's first reading:

- **`seeker_id`** (UUID) — the owner key. Stored in localStorage. Convenience credential ("this device's garden"). Bearer-style, same trust level as today's `session_token`.
- **`garden_code`** (`XXXX-XXXX-XXXX`, 32^12 ≈ 2^60, unambiguous charset) — the human restore credential. Shown once, **hashed (SHA-256) at rest**. Restores the whole garden on any device. Same format/entropy as the current recovery code.

`seeker_id` alone lets a device keep using its garden. `garden_code` is what you type to bring the garden to a new device.

---

## 4. Data model migration

New migration `supabase/migrations/20260628000002_garden_key.sql`
(ordered after the Dodo migration `…0001` if both land; independent otherwise):

```sql
create table seekers (
  id               uuid primary key default gen_random_uuid(),
  garden_code_hash text not null unique,
  restore_attempts int  not null default 0,   -- lockout after 10, mirrors recovery_attempts
  created_at       timestamptz default now()
);

alter table readings
  add column seeker_id uuid references seekers(id) on delete set null;

create index on readings (seeker_id);

-- Retire the per-reading recovery mechanism (superseded by the garden code)
alter table readings
  drop column recovery_code,
  drop column recovery_attempts;
```

RLS: `seekers` gets RLS enabled with **no anon policies** (seekers never touch it directly — all access is service-role via edge functions), consistent with `readings`.

---

## 5. Edge functions

### 5.1 Changed: `submit_reading`

- Accept optional `seeker_id` in the body.
- **First reading** (`seeker_id` absent): generate `garden_code`, insert a `seekers` row with its hash, use the new `seeker_id`. Return it.
- **Subsequent readings** (`seeker_id` present): validate the row exists; link `readings.seeker_id`. (Unknown/garbage `seeker_id` → treat as first reading: mint a fresh seeker rather than erroring, so a wiped client self-heals.)
- Remove all `recovery_code` generation/hashing (moved to `seekers`).
- **Response gains `seeker_id` + `garden_code`** (garden_code only returned when a new seeker was just minted): `{ reading_id, session_token, seeker_id, garden_code?, species }`.

### 5.2 New: `restore_garden` (no auth)

Input: `{ garden_code }`.

1. Validate format (`/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/`, uppercased).
2. Hash → look up `seekers` by `garden_code_hash`.
3. Lockout: `restore_attempts >= 10` → 429. Increment on each lookup (mirrors `recover_reading`).
4. Return `seeker_id` + the garden's readings:
   ```json
   {
     "seeker_id": "…",
     "readings": [
       { "reading_id": "…", "session_token": "…", "status": "…",
         "spread_type": "single|three", "species": "…", "created_at": "…" }
     ]
   }
   ```
   No card identities, no audio paths — same seal rules as `get_reading_status`.

### 5.3 Removed: `recover_reading`

Superseded by `restore_garden`. Delete the function and its `/recover` single-reading path.

### 5.4 Unchanged: `get_reading_status`, `reveal_reading`, `get_upload_urls`, `submit_response`

---

## 6. Client changes (`src/lib/session.ts` + pages)

### 6.1 `session.ts`

- New seeker store: `il_seeker = { seekerId: string, gardenCode?: string }` (single object, separate key from `il_readings`).
- `getSeeker()` / `setSeeker()`.
- `storeReading(...)` signature: drop the per-reading `recoveryCode` param; readings no longer carry a code.
- New `restoreGarden(seekerId, readings[])` — overwrites/merges `il_readings` from a `restore_garden` response and sets `il_seeker.seekerId`.

### 6.2 Paywall commit (`app/(seeker)/auth/page.tsx`)

- Read `getSeeker()?.seekerId`; pass it to `submit_reading`.
- On response, persist returned `seeker_id` (and `garden_code` if first reading) via `setSeeker`.

### 6.3 `/recover` page

- Reframe "restore a reading" → **"restore your garden."**
- Calls `restore_garden` (not `recover_reading`); on success `restoreGarden(...)` then route to `/` (the garden) instead of a single `/wait/[id]`.
- Same code input UX (already `XXXX-XXXX-XXXX`, dash auto-format, 10-attempt lockout messaging).

### 6.4 Wait screen (`app/(seeker)/wait/[readingId]/page.tsx`)

- The per-reading "recovery code" block is removed (readings no longer hold one).
- The garden code is surfaced elsewhere (Settings, §6.5) — shown once at mint time and any time after.

### 6.5 Settings (`app/(seeker)/settings/page.tsx`)

- Add a "your garden key" section: shows `il_seeker.gardenCode` with copy "save this to restore your garden on another device." Primary place the code lives after first mint.

---

## 7. Access model (after this change)

| Situation | Outcome |
|---|---|
| Same device | localStorage `il_seeker` + `il_readings` — zero friction, unchanged. |
| New device / cleared storage, has garden code | `/recover` → `restore_garden` → whole garden rebuilt. |
| Email deep link to one reading | Still works (`/wait/[id]?token=…`) — rescues that reading and re-seeds localStorage. |
| Lost garden code **and** cleared storage | Lost — irreducible cost of no accounts. Readings still exist server-side until expiry but are unreachable by the seeker. |

---

## 8. Out of scope

- Multi-seeker merge (importing two gardens into one).
- Re-issuing / rotating a lost garden code (no email-of-record to send it to; deferred).
- Email-based restore (separate "email soft-identity" option, not chosen).
- Server-side garden sync of flower layout (layout stays deterministic from reading id, per existing design).

---

## 9. Acceptance criteria

1. First-ever reading mints a `seekers` row + `garden_code`; response carries `seeker_id` + `garden_code`; both land in `il_seeker`.
2. Second reading from the same device passes `seeker_id`; its `readings.seeker_id` matches the first; no new seeker row; no new code shown.
3. `/recover` with a valid garden code rebuilds the full garden on a fresh browser; invalid → friendly error; 10 failed attempts → locked (429).
4. No `recovery_code` / `recovery_attempts` references remain in code or schema; `recover_reading` function deleted.
5. Card identities / audio never appear in `restore_garden` output before `responded`.
6. `npm run build` passes.
