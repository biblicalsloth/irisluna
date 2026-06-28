# Iris Luna — Dodo Payments Paywall (Design)

**Date:** 2026-06-28
**Status:** Approved design, pre-implementation
**Scope:** Replace the screenshot + manual-verify paywall with Dodo Payments (Merchant of Record) hosted checkout. Payment is confirmed by webhook; admin keeps a manual sanity-check gate before a reading enters the reader queue.

---

## 1. Decisions (locked)

| # | Decision | Resolution |
|---|---|---|
| 1 | Payment flow | **Dodo only.** Screenshot upload removed. Webhook confirms payment. |
| 2 | Admin gate | **Dropped.** Dodo is MoR — webhook payment is cryptographically verified, so no manual sanity check. `payment.succeeded` webhook auto-flips `pending_payment → awaiting_response`. Admin payment-verify queue removed. |
| 3 | Checkout type | **Hosted redirect.** Server creates a Dodo checkout session; seeker is redirected to `checkout_url`. |
| 4 | Server placement | **Supabase Edge Functions** (matches existing arch — all seeker server ops are edge functions). |
| 5 | Price / currency | **$3 USD**, one-time product. |

---

## 2. State machine (changed)

```
record → pick → PAYWALL ──submit──► pending_payment (paid_at = null)
                                          │ redirect to Dodo checkout
                                          ▼
                                    [Dodo hosted checkout]
                                          │ payment.succeeded webhook
                                          ▼ (auto: set paid_at, expires_at +24h)
                                   awaiting_response → responded → revealed
```

- The `status` enum is **unchanged** (`pending_payment | awaiting_response | responded | revealed | expired`).
- `pending_payment` now means **unpaid only** — the seeker has been redirected to Dodo but not paid yet. No admin acts on it.
- `paid_at` records when Dodo confirmed payment (stamped at the same instant the webhook flips to `awaiting_response`). It travels with the reading for admin display + audit.
- **Abandonment:** if the seeker leaves Dodo without paying, the row stays `pending_payment, paid_at = null` and the existing 24h `expire-readings` cron clears it. No new cron needed.
- **Seal invariant preserved:** cards are still assigned and sealed server-side in `submit_reading` and never returned to the seeker until `responded`. Dodo changes *how payment is proven*, not the seal.

---

## 3. Data model migration

New migration `supabase/migrations/20260628000001_dodo_payments.sql`:

```sql
alter table readings
  alter column payment_screenshot_path drop not null,  -- legacy, now optional
  add column dodo_session_id  text,
  add column dodo_payment_id  text,
  add column paid_at          timestamptz,
  add column payment_amount   int,        -- minor units (cents)
  add column payment_currency text;       -- e.g. 'USD'
```

(No new index — admin reads the `awaiting_response` queue, already indexed by the original schema.)

No change to `reading_cards`, `cards`, or `profiles`. RLS unchanged (admin/reader policies already cover the new columns via `select` on `readings`).

---

## 4. Edge Functions

### 4.1 New: `create_checkout` (no auth)

Input: `{ reading_id, session_token }`.

1. Validate the row exists, `session_token` matches, `status = 'pending_payment'`, `paid_at IS NULL`.
2. Create Dodo session via `npm:dodopayments`:
   ```ts
   const session = await client.checkoutSessions.create({
     product_cart: [{ product_id: DODO_PRODUCT_ID, quantity: 1 }],
     customer: email ? { email } : undefined,
     return_url: `${APP_URL}/wait/${reading_id}?token=${session_token}`,
     metadata: { reading_id },
   });
   ```
3. Persist `dodo_session_id = session.session_id`.
4. Return `{ checkout_url }`.

Failure → `{ error }` with 4xx/5xx; seeker stays on paywall with a retry.

### 4.2 New: `dodo_webhook` (no auth, signature-gated)

- Read the **raw** request body (needed for signature verification).
- `client.webhooks.unwrap(rawBody, { headers: { 'webhook-id', 'webhook-signature', 'webhook-timestamp' } })` using `DODO_PAYMENTS_WEBHOOK_KEY`. Invalid signature → 401.
- Respond 200 quickly; then process.
- `payment.succeeded`:
  - `reading_id = event.data.metadata.reading_id`.
  - **Idempotent + auto-queue:** update only `where id = reading_id and status = 'pending_payment'`. Set `status = 'awaiting_response'`, `paid_at = now()`, `expires_at = now() + interval '24 hours'`, `dodo_payment_id`, `payment_amount`, `payment_currency`.
  - The status guard makes duplicate deliveries no-ops (second delivery matches no `pending_payment` row).
- `payment.failed` → log only (row left for cron expiry).
- Unknown events → 200, ignored.

> Idempotency uses the `paid_at IS NULL` guard plus Dodo's `webhook-id`; duplicate deliveries are no-ops.

### 4.3 Changed: `get_upload_urls`

Drop the `payment_screenshot` signed URL. Return only `question_audio`. Input no longer needs `payment_screenshot_ext`.

### 4.4 Changed: `submit_reading`

- `payment_screenshot_path` becomes optional; remove it from required-field validation and the `VALID_PATH` screenshot check.
- Insert with `payment_screenshot_path: null`.
- Card sealing, recovery code, species, first-reading=iris logic **unchanged**.
- Response unchanged: `{ reading_id, session_token, recovery_code, species }`.

### 4.5 Unchanged: `get_reading_status`, `submit_response`, `reveal_reading`, `recover_reading`

### 4.6 Deprecated: `verify_payment`

With auto-queue, nothing reaches the admin in a paid-but-unqueued state, so the manual verify/reject step is gone. Leave the `verify_payment` function deployed but unreferenced (out of scope to delete); the admin UI no longer calls it.

---

## 5. Seeker paywall page (rewrite `app/(seeker)/auth/page.tsx`)

Remove: QR code block, screenshot upload, `payment_screenshot` plumbing.

Keep: wordmark, ritual framing, optional email, error states, motion.

New copy (currency): "$3 — a secure card payment." Amount from `NEXT_PUBLIC_PAYMENT_AMOUNT` (= `$3`). Remove GCash / "scan, send, screenshot" line.

Submit handler ("continue to the offering"):
1. `get_upload_urls` (audio only) → upload blob via signed URL.
2. `submit_reading({ spread_type, positions, question_audio_path, question_duration_ms, email, is_first_reading })` → `{ reading_id, session_token, recovery_code, species }`.
3. `storeReading(...)` in localStorage **immediately** (so the garden tracks the reading even if the seeker abandons checkout) and `clear()` the flow store.
4. `create_checkout({ reading_id, session_token })` → `window.location.href = checkout_url`.

Dev fallback (no `NEXT_PUBLIC_SUPABASE_URL`) unchanged behavior: store placeholder reading, go to `/wait`.

### Wait screen

- Phase-1 (`pending_payment`) copy → "Payment confirming…" (covers both pre-pay redirect-back and post-webhook admin-gate wait).
- Polling via `get_reading_status` unchanged.
- Dodo `return_url` deep-links to `/wait/[readingId]?token=…`; this is UX only — the webhook is the source of truth, never the redirect query params.

---

## 6. Admin (change)

`app/admin/page.tsx` + `app/admin/[readingId]/page.tsx`:

- **Remove the payment-verification queue / `pending_payment` tab** — readings now land directly in `awaiting_response` (the reader queue). No manual verify/reject step.
- Replace the payment-screenshot thumbnail/viewer with read-only Dodo payment info on each reader-queue row: amount + currency, `dodo_payment_id`, `paid_at` ("paid 2h ago").
- Reader queue behavior (claim, listen, respond) unchanged.

---

## 7. Environment & external setup

Edge Function secrets (`supabase secrets set`):
- `DODO_PAYMENTS_API_KEY`
- `DODO_PAYMENTS_WEBHOOK_KEY`
- `DODO_PAYMENTS_ENVIRONMENT` (`test_mode` | `live_mode`)
- `DODO_PRODUCT_ID`
- `APP_URL` (for `return_url`)

Client env (`.env.local` / Vercel):
- `NEXT_PUBLIC_PAYMENT_AMOUNT=$3`
- (Remove reliance on `NEXT_PUBLIC_PAYMENT_QR_URL`, `NEXT_PUBLIC_PAYMENT_METHOD`.)

Dodo dashboard (manual, one-time):
1. Create a **one-time product** priced **$3 USD**; copy its `product_id` → `DODO_PRODUCT_ID`.
2. Register webhook endpoint → the deployed `dodo_webhook` function URL; subscribe `payment.succeeded` and `payment.failed`; copy signing key → `DODO_PAYMENTS_WEBHOOK_KEY`.
3. Copy API key → `DODO_PAYMENTS_API_KEY`.

---

## 8. Out of scope (this spec)

- Refunds / disputes handling.
- Subscriptions (one-time only).
- Removing legacy `payment-screenshots` storage bucket (left in place, unused).
- Customer portal.

---

## 9. Acceptance criteria

1. Seeker completes record → pick → paywall → Dodo checkout → returns to `/wait`, no screenshot step anywhere.
2. A reading row exists in `pending_payment` with `paid_at = null` between `submit_reading` and payment completion; never exposes card identities.
3. `payment.succeeded` webhook (valid signature) flips the reading to `awaiting_response`, sets `paid_at` + `expires_at +24h`; duplicate deliveries are no-ops; invalid signature → 401.
4. The paid reading appears directly in the admin reader queue (`awaiting_response`) with Dodo payment info; no manual verify step exists.
5. Abandoned checkout leaves a `pending_payment, paid_at=null` row that the 24h cron expires.
6. `npm run build` passes; no references to screenshot upload remain in the seeker paywall path.
