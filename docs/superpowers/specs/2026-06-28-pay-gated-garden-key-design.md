# Pay-Gated Garden Key — Design

**Date:** 2026-06-28
**Status:** Approved (pending spec review)

## Problem

The garden-key flow is incomplete and contradicts the intended product behavior:

- `submit_reading` creates the reading **and mints the garden key before payment**. A user
  who never pays still gets a reading row and a garden key.
- The `/auth` paywall is half-migrated: the page still does **screenshot upload + manual
  admin verify**, while Dodo `create_checkout` and the `pending_payment → awaiting_response`
  infrastructure exist but are not wired in. No Dodo webhook exists.
- There is no on-screen garden-key reveal and no "email me the code" option.
- Returning users cannot attach a new reading to their existing garden from a fresh device
  before paying.

## Goals

1. Payment is via **Dodo checkout (redirect)**. Remove the screenshot/manual-verify path
   from the seeker flow.
2. **No payment → session lost.** The pending reading never enters the device garden, never
   gets a garden key, and auto-expires server-side. The user sees a disclaimer.
3. **Garden key is minted only after payment is confirmed.**
4. After payment, the garden key is **shown on screen** (saved to device) with an optional
   **"email me the code"** box.
5. No auth. Any user can visit their garden (past readings + flowers) by entering the
   garden key (existing `/recover`).
6. The garden home already has the record button that starts the ritual. Returning users
   can **enter a garden key before payment** so the new reading attaches to their existing
   garden.

## Flow

```
garden(home) → record → /deck → /pay → [Dodo checkout] → /key/[readingId] → garden
                                  │                              │
                     optional: "I have a garden key"   show key + "email me the code"
                     optional: notify email            then "enter your garden"
```

## Decisions

- **Payment provider:** Dodo checkout (redirect). Screenshot UI removed from seeker flow.
- **No-pay semantics:** Reading is created server-side as `pending_payment` at pay-time, but
  is **never** stored in the device garden and **never** minted a key until paid. Abandoned
  rows auto-expire via the existing cron (`pending_payment` + `paid_at is null` + expired).
- **Key delivery:** Shown on screen + saved to device + optional email.
- **Key storage:** Plaintext code stored on `readings.garden_code` (session-token-gated).
  `seekers` keeps the **hash only** (for rate-limited restore). The code is the user's own
  credential in an anonymous app, so plaintext-on-a-gated-row is acceptable and enables
  re-show / email-anytime.
- **Route rename:** `/auth` → `/pay`.

## Architecture

### Database (new migration)

- `alter table public.readings add column if not exists garden_code text;`
  - Plaintext garden key, set by `claim_garden` at mint. Readable only via session-token-gated
    edge functions.
- No `seekers` change (table already exists with `garden_code_hash`, `restore_attempts`).
- Cron already only expires unpaid `pending_payment` (from `20260628000001_dodo_single_button.sql`).
  No change needed — abandoned sessions vanish automatically.

### Edge functions

**`submit_reading` (modify)**
- Remove `payment_screenshot_path` requirement and validation.
- Remove garden-key minting and `garden_code` / seeker-creation logic.
- Accept optional `seeker_id` (returning user who entered a key on `/pay`); attach if valid.
- Create the reading as `pending_payment`, seal cards, compute `species`.
- Return `{ reading_id, session_token, species }`. **No `garden_code`, no `seeker_id` mint.**

**`get_upload_urls` (modify)**
- Drop the `payment_screenshot` signed URL; return only `question_audio`.

**`create_checkout` (keep, minor)**
- Already validates reading + token + `pending_payment`.
- Set `return_url` to `${appUrl}/key/${reading_id}?token=${session_token}`.

**`dodo_webhook` (new) — trusted payment confirmation**
- Verify Dodo webhook signature using `DODO_WEBHOOK_SECRET`.
- On payment-succeeded: look up reading by `metadata.reading_id` (fallback `dodo_session_id`),
  flip `pending_payment → awaiting_response`, set `paid_at`, `dodo_payment_id`,
  `payment_amount`, `payment_currency`. Reset `expires_at` to now + 24h (reader window).
- Idempotent: ignore if already paid.

**`claim_garden` (new) — mint/reveal key, gated on payment**
- Input `{ reading_id, session_token, email? }`.
- Verify reading exists, token matches, `paid_at` is set (else `409 not_paid`).
- Always return `spread_type` and `species` (the `/key` page needs them for `storeReading`;
  the client flow store is gone after the Dodo redirect). `species` is derived server-side
  from the primary card (`reading_cards` at `position = 0` → `cards.flower_species`), with
  `iris` for a brand-new garden (`is_new_garden`). No extra column needed.
- If `reading.seeker_id` is null (first reading): generate code, store hash in `seekers`,
  attach `seeker_id` to the reading, store plaintext in `readings.garden_code`.
  Return `{ paid: true, is_new_garden: true, garden_code, species, spread_type, seeker_id, status }`.
- If `reading.seeker_id` is set (returning user): return
  `{ paid: true, is_new_garden: false, garden_code: reading.garden_code, species, spread_type, seeker_id, status }`.
- If `email` provided: send the garden code via Resend (Deno fetch to Resend REST API).
- Idempotent: repeated calls return the same stored `garden_code`.

**`verify_payment` (deprecate)**
- Remove from seeker/admin UI. Function may remain for emergency manual override but is no
  longer part of the happy path.

### Frontend

**`/deck` (modify)**
- `handleConfirm` pushes to `/pay` instead of `/auth`.

**`/pay` (rename from `/auth`, rewrite)**
- Remove QR-as-proof block and screenshot upload entirely.
- Show offering + amount + **disclaimer**:
  *"If you leave without paying, this reading is released — nothing is saved until payment
  completes."*
- Optional collapsible **"I have a garden key"**: input → `restore_garden` → on success
  `setSeeker(seekerId, code)` (so `submit_reading` attaches this reading to the existing
  garden). Show inline validation.
- Optional email box (notify-when-answered) — passed to `submit_reading` as before.
- **"Pay"** → `submit_reading` (with `seeker_id` from `getSeeker()` if set) → `create_checkout`
  → `window.location.href = checkout_url`. **Do NOT `storeReading` here.**

**`/key/[readingId]` (new) — Dodo return_url target**
- Read `?token=` from query (the session token) + `readingId`.
- Poll `claim_garden` until `paid: true` (handle the race where the user is redirected back
  before the webhook lands; show "confirming payment…").
- On paid:
  - Call `storeReading(reading_id, token, spreadType, species)` — the reading enters the
    device garden **only now**.
  - If `is_new_garden`: prominently show the garden key + copy button + **"email me the
    code"** box (calls `claim_garden` again with `email`). `setSeeker` with returned data.
  - If returning user: confirm "added to your garden".
  - Primary CTA: "enter your garden" → `/`.
- If not confirmed after a reasonable timeout: show disclaimer — if you didn't complete
  payment, nothing was saved.

**`/recover` (no change)** — already restores a garden from its code.

**`session.ts` (no change)** — `storeReading` already takes species; `setSeeker` already
merges a known code.

**Admin UI (modify)** — remove screenshot-display and manual verify controls tied to the
seeker payment path. (Scope: only the bits that reference `payment_screenshot_path` /
`verify_payment` in the seeker happy path.)

### Environment variables

Already referenced or required:
- `DODO_PAYMENTS_API_KEY`, `DODO_PAYMENTS_ENVIRONMENT`, `DODO_PRODUCT_ID` (create_checkout)
- `DODO_WEBHOOK_SECRET` (new — dodo_webhook)
- `RESEND_API_KEY` (claim_garden email)
- `APP_URL` / `NEXT_PUBLIC_APP_URL`

## Error handling

- `submit_reading` failure on `/pay`: show error, do not redirect, nothing stored.
- `create_checkout` failure: show error, reading remains `pending_payment` and will expire.
- `/key` page, `claim_garden` returns `not_paid`: keep polling with backoff; after timeout
  show the disclaimer.
- Webhook signature failure: 401, do not flip status.
- Duplicate webhook / double claim: idempotent (guarded by `paid_at` and `seeker_id`).

## Testing

- `submit_reading` no longer requires screenshot and never returns a garden code.
- `claim_garden` returns `not_paid` before webhook; mints exactly one seeker after; idempotent.
- Returning-user path: entering a valid key on `/pay` attaches the reading to the existing
  seeker; `claim_garden` returns `is_new_garden: false`.
- No-pay path: reading exists as `pending_payment`, never in device garden, expires via cron.
- Email path: `claim_garden` with `email` sends the code.

## Out of scope

- Reader/admin response flow (unchanged).
- Reveal flow (unchanged).
- Migrating historical screenshot-based readings.
