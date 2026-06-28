# Iris Luna — Dodo-Gated Single-Button Delivery (Design)

**Date:** 2026-06-28
**Status:** Approved design, pre-implementation
**Supersedes:** `2026-06-28-dodo-payments-paywall-design.md` decision #2 (manual admin payment gate). All other parts of that spec (Dodo checkout + webhook mechanics, env, migration columns) are inherited.

**Scope:** Remove the payment-screenshot/QR/upload module entirely. Payment is confirmed by the Dodo webhook; a paid reading auto-enters the admin queue (no manual payment-verify gate). The human reader checks the cards, records a voicenote, and presses a single button that delivers the message and reveals the cards to the seeker. Unpaid readings never reach the admin console.

---

## 1. Decisions (locked)

| # | Decision | Resolution |
|---|---|---|
| 1 | Payment flow | **Dodo only.** Screenshot/QR/upload removed. Webhook confirms payment. |
| 2 | Admin payment gate | **Removed.** Webhook flips `pending_payment → awaiting_response` automatically. No manual verify step. |
| 3 | Admin action | **Single button.** Reader records voicenote → one click (`submit_response`) delivers + reveals. |
| 4 | Payment window | **24h from reading creation.** Unpaid after 24h → `expired`, never shown in admin. |
| 5 | Paid readings | **Never auto-expire.** Cron only expires unpaid `pending_payment` (`paid_at IS NULL`). No "took money, delivered nothing." |
| 6 | Reject / refund | **Out of scope.** No reject button, no refund handling. |
| 7 | Gateway | **Dodo hosted checkout**, $3 USD one-time, Supabase Edge Functions. (Inherited.) |

---

## 2. State machine

```
record → pick → PAYWALL ──submit_reading──► pending_payment   (paid_at=null, expires_at=created+24h)
                                                  │ create_checkout → Dodo hosted checkout
                                                  ▼ payment.succeeded webhook  [within 24h]
                                      pending_payment → awaiting_response       [AUTO via webhook]
                                                  │ paid_at set, expires_at=null (no longer expires)
                                                  │ now visible in admin queue
                                                  ▼ reader records voicenote + clicks Deliver
                                            responded   (message delivered, cards unsealed)
                                                  │ seeker wait page auto-advances
                                                  ▼ reveal_reading (seeker opens)
                                            revealed
```

- Enum **unchanged**: `pending_payment | awaiting_response | responded | revealed | expired`.
- `paid_at` is the discriminator inside `pending_payment`: NULL = not paid (will expire), NOT NULL = paid (already flipped to `awaiting_response` by webhook, so transient).
- **Seal invariant preserved:** cards assigned + sealed in `submit_reading`, never returned to seeker until `responded`.

### Why the "single button" is just `submit_response`
There is no separate reader-controlled reveal step. `submit_response` (`awaiting_response → responded`) already (a) stores the voicenote and (b) unseals cards for the seeker. The seeker's wait page polls `get_reading_status`, sees `responded`, and auto-advances to the reveal page, which calls `reveal_reading` to play the animation + voicenote seeker-side. So the reader's one click = record voicenote → `submit_response`. The `responded → revealed` transition stays and tracks the seeker actually opening the reading.

---

## 3. Data model migration

New migration `supabase/migrations/20260628000001_dodo_single_button.sql`:

```sql
alter table readings
  alter column payment_screenshot_path drop not null,  -- legacy, now always null
  add column dodo_session_id  text,
  add column dodo_payment_id  text,
  add column paid_at          timestamptz,
  add column payment_amount   int,        -- minor units (cents)
  add column payment_currency text;       -- e.g. 'USD'

create index on readings (status, paid_at) where status = 'pending_payment';

-- Cron change: only expire UNPAID pending_payment. Paid readings never expire.
select cron.unschedule('expire-readings');
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
```

No change to `reading_cards`, `cards`, `profiles`. RLS unchanged (admin/reader `select` policies cover new columns).

---

## 4. Edge Functions

### 4.1 New: `create_checkout` (no auth)
Input `{ reading_id, session_token }`. Validate row exists, token matches, `status = 'pending_payment'`, `paid_at IS NULL`. Create Dodo session (`npm:dodopayments`), persist `dodo_session_id`, return `{ checkout_url }`. (Per inherited spec §4.1.)

### 4.2 New: `dodo_webhook` (no auth, signature-gated)
- Read **raw** body; verify signature with `DODO_PAYMENTS_WEBHOOK_KEY` (`client.webhooks.unwrap`). Invalid → 401.
- `payment.succeeded`: `reading_id = event.data.metadata.reading_id`. **Idempotent** update `where id = reading_id and paid_at is null`:
  - set `paid_at = now()`, `dodo_payment_id`, `payment_amount`, `payment_currency`
  - **flip `status = 'awaiting_response'`** (the removed admin gate)
  - set `expires_at = null` (paid readings no longer expire)
- `payment.failed` → log only (row left for cron). Unknown events → 200, ignored.

### 4.3 Changed: `get_upload_urls`
Drop the `payment_screenshot` signed URL. Return only `question_audio`. Input no longer needs `payment_screenshot_ext`.

### 4.4 Changed: `submit_reading`
`payment_screenshot_path` optional → insert `null`. Remove from required-field validation and `VALID_PATH` screenshot check. Card sealing, recovery code, species, first-reading=iris logic unchanged. Response unchanged.

### 4.5 Deleted: `verify_payment`
Removed entirely. The webhook performs the `pending_payment → awaiting_response` flip. No `reject_payment`.

### 4.6 Unchanged: `submit_response`, `reveal_reading`, `get_reading_status`, `recover_reading`
`submit_response` remains the single delivery action (`awaiting_response → responded`).

---

## 5. Seeker paywall page (`app/(seeker)/auth/page.tsx`)
Remove QR block, screenshot upload, `payment_screenshot` plumbing. Keep wordmark, ritual framing, optional email, error states, motion. Copy: "$3 — a secure card payment" from `NEXT_PUBLIC_PAYMENT_AMOUNT`. Submit handler:
1. `get_upload_urls` (audio only) → upload blob.
2. `submit_reading(...)` → `{ reading_id, session_token, recovery_code, species }`.
3. `storeReading(...)` in localStorage immediately, `clear()` flow store.
4. `create_checkout({ reading_id, session_token })` → `window.location.href = checkout_url`.

Wait screen: `pending_payment` copy → "Payment confirming…"; polling unchanged; webhook is source of truth, not redirect params.

---

## 6. Admin console
- `app/admin/page.tsx`: **remove the "payments" tab and the verify-payment UI.** Single queue: paid readings (`awaiting_response`) first, then `responded`/`revealed` history. Each row shows Dodo payment info (amount + currency, `paid_at` as "paid 2h ago") instead of a screenshot thumbnail.
- `app/admin/[readingId]/page.tsx`: remove payment-screenshot viewer; show Dodo payment info. Keep question-audio playback (`WavePlayer`) + voicenote recording (`HoldToRecord`). **Single "Deliver" button** → `submit_response`. No verify/reject buttons.

---

## 7. Environment & external setup
Edge Function secrets: `DODO_PAYMENTS_API_KEY`, `DODO_PAYMENTS_WEBHOOK_KEY`, `DODO_PAYMENTS_ENVIRONMENT`, `DODO_PRODUCT_ID`, `APP_URL`.
Client env: `NEXT_PUBLIC_PAYMENT_AMOUNT=$3`. Remove `NEXT_PUBLIC_PAYMENT_QR_URL`, `NEXT_PUBLIC_PAYMENT_METHOD`.
Dodo dashboard (one-time): create $3 one-time product → `DODO_PRODUCT_ID`; register webhook → deployed `dodo_webhook` URL, subscribe `payment.succeeded`/`payment.failed` → `DODO_PAYMENTS_WEBHOOK_KEY`; copy API key → `DODO_PAYMENTS_API_KEY`.

---

## 8. Out of scope
- Refunds / disputes / reject button.
- Subscriptions (one-time only).
- Removing the legacy `payment-screenshots` storage bucket (left in place, unused).
- Customer portal.

---

## 9. Acceptance criteria
1. Seeker flow record → pick → paywall → Dodo checkout → `/wait`, with **no screenshot/QR/upload step anywhere**.
2. Between `submit_reading` and payment, row is `pending_payment, paid_at=null`; never exposes card identities.
3. Valid `payment.succeeded` webhook sets `paid_at` **and** flips status to `awaiting_response` and nulls `expires_at`; duplicates are no-ops; invalid signature → 401.
4. A paid reading appears in the admin queue **without any manual payment-verify step**.
5. Reader records voicenote and presses one Deliver button → status `responded`, message + cards delivered; seeker wait page auto-advances to reveal.
6. Unpaid reading after 24h → `expired` by cron and never appears in admin. A **paid** reading is never auto-expired.
7. No `verify_payment` function or payments tab remain. `npm run build` passes; no screenshot-upload references in the seeker paywall path.
