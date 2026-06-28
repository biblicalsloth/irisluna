# Dodo-Gated Single-Button Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the screenshot/QR/manual-verify paywall with Dodo Payments; a paid reading auto-enters the admin queue (no manual payment gate), the reader records a voicenote and presses one button to deliver + reveal. Unpaid readings never reach the admin console and expire after 24h.

**Architecture:** Payment confirmed by the Dodo `payment.succeeded` webhook (Supabase Edge Function), which sets `paid_at` and flips `pending_payment → awaiting_response` and nulls `expires_at`. The seeker paywall calls a new `create_checkout` edge function and redirects to Dodo hosted checkout. The single admin "Deliver" action is the existing `submit_response` (`awaiting_response → responded`), which already unseals cards + emails the seeker; the seeker's wait page auto-advances to reveal. `verify_payment` and the admin "payments" tab are removed.

**Tech Stack:** Next.js (App Router; see `AGENTS.md` — this is a non-standard Next.js, read `node_modules/next/dist/docs/` before touching framework APIs), Supabase (Postgres + Edge Functions on Deno), `npm:dodopayments` TypeScript SDK, framer-motion, Tailwind.

## Global Constraints

- **No test framework exists** in this repo. Verification = `npm run build` (Next), `deno check <file>` (edge fns), `supabase db reset` (migrations apply cleanly), and the manual checks named per task. Do **not** introduce a test runner (YAGNI).
- **Seal invariant:** card identities are assigned + sealed in `submit_reading` and must never be returned to the seeker until status is `responded`/`revealed`. No task may weaken this.
- **Status enum is unchanged:** `pending_payment | awaiting_response | responded | revealed | expired`.
- **Edge function conventions (match existing files):** `import { createClient } from "jsr:@supabase/supabase-js@2";`, the shared `corsHeaders` object, the `json(body, status)` helper, `Deno.serve(async (req) => { if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders }); ... })`. Service-role client uses `Deno.env.get("SUPABASE_URL")!` + `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!` with `{ auth: { autoRefreshToken: false, persistSession: false } }`.
- **Dodo SDK (verified shape):** `import DodoPayments from "npm:dodopayments";` → `new DodoPayments({ bearerToken, webhookKey, environment })`; `client.checkoutSessions.create({ product_cart, customer, return_url, metadata })` returns `{ checkout_url, session_id }`; `client.webhooks.unwrap(rawBodyString, { headers })` returns `{ type, data }` where `payment.succeeded` carries `data.payment_id`, `data.total_amount`, `data.currency`, `data.metadata`.
- **Pricing:** $3 USD, one-time product.
- **Branch:** all work on `feat/dodo-single-button-delivery` (already created).
- **Spec:** `docs/superpowers/specs/2026-06-28-dodo-gated-single-button-delivery-design.md`.

---

### Task 1: DB migration — Dodo columns + cron change

**Files:**
- Create: `supabase/migrations/20260628000001_dodo_single_button.sql`

**Interfaces:**
- Produces: `readings.paid_at timestamptz`, `readings.dodo_session_id text`, `readings.dodo_payment_id text`, `readings.payment_amount int`, `readings.payment_currency text`; `readings.payment_screenshot_path` becomes nullable; cron `expire-readings` only expires unpaid `pending_payment`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260628000001_dodo_single_button.sql`:

```sql
-- Dodo Payments + single-button delivery.
-- payment_screenshot_path is now legacy/optional; payment proven by webhook.
alter table public.readings
  alter column payment_screenshot_path drop not null,
  add column if not exists dodo_session_id  text,
  add column if not exists dodo_payment_id  text,
  add column if not exists paid_at          timestamptz,
  add column if not exists payment_amount   int,        -- minor units (cents)
  add column if not exists payment_currency text;        -- e.g. 'USD'

-- Admin queries paid-but-not-yet-flipped rows by (status, paid_at).
create index if not exists readings_pending_paid_idx
  on public.readings (status, paid_at)
  where status = 'pending_payment';

-- Cron change: only expire UNPAID pending_payment. Paid readings NEVER auto-expire.
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
    where status = 'pending_payment'
      and paid_at is null
      and expires_at < now();
  $$
);
```

- [ ] **Step 2: Apply the migration locally**

Run: `npm run db:reset`
Expected: completes without error; all migrations (including `20260628000001_dodo_single_button`) apply. (Requires local Supabase via `npm run db:start`.)

- [ ] **Step 3: Verify columns + cron exist**

Run:
```bash
supabase db reset >/dev/null 2>&1; \
psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" -c "\d public.readings" -c "select jobname, command from cron.job where jobname='expire-readings';"
```
Expected: `readings` lists `paid_at`, `dodo_session_id`, `dodo_payment_id`, `payment_amount`, `payment_currency`, and `payment_screenshot_path` shown nullable; the cron command contains `paid_at is null`.

(If `psql`/`supabase status` is unavailable locally, instead confirm `npm run db:reset` succeeded and visually inspect the migration file — the SQL is authoritative.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260628000001_dodo_single_button.sql
git commit -m "feat(db): Dodo payment columns; cron only expires unpaid readings"
```

---

### Task 2: TypeScript Database types

**Files:**
- Modify: `src/lib/supabase/types.ts` (the `readings.Row` block, ~lines 47-72)

**Interfaces:**
- Consumes: migration columns from Task 1.
- Produces: `Database["public"]["Tables"]["readings"]["Row"]` with nullable `payment_screenshot_path` and the five new Dodo fields. All app/admin code reads these types.

- [ ] **Step 1: Update the `readings.Row` type**

In `src/lib/supabase/types.ts`, replace the `readings: { Row: {...} }` field list so that `payment_screenshot_path` is nullable and the Dodo fields are added. The full new `Row` block:

```ts
      readings: {
        Row: {
          id: string;
          session_token: string;
          spread_type: SpreadType;
          question_audio_path: string;
          question_duration_ms: number | null;
          email: string | null;
          status: ReadingStatus;
          payment_screenshot_path: string | null;
          payment_verified_at: string | null;
          verified_by: string | null;
          dodo_session_id: string | null;
          dodo_payment_id: string | null;
          paid_at: string | null;
          payment_amount: number | null;
          payment_currency: string | null;
          claimed_by: string | null;
          claimed_at: string | null;
          response_audio_path: string | null;
          response_duration_ms: number | null;
          created_at: string;
          expires_at: string;
          responded_at: string | null;
          revealed_at: string | null;
        };
        Insert: Omit<Database["public"]["Tables"]["readings"]["Row"], "id" | "created_at" | "expires_at"> & Partial<Pick<Database["public"]["Tables"]["readings"]["Row"], "id" | "created_at" | "expires_at">>;
        Update: Partial<Database["public"]["Tables"]["readings"]["Row"]>;
      };
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `readings` columns. (Pre-existing unrelated errors, if any, are out of scope — note them but do not fix.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase/types.ts
git commit -m "feat(types): nullable screenshot path + Dodo reading columns"
```

---

### Task 3: New edge function `create_checkout`

**Files:**
- Create: `supabase/functions/create_checkout/index.ts`

**Interfaces:**
- Consumes: reading row created by `submit_reading` (`status='pending_payment'`, `paid_at IS NULL`).
- Produces: HTTP `POST` accepting `{ reading_id: string, session_token: string }`, returning `{ checkout_url: string }`. Persists `dodo_session_id` on the row.

- [ ] **Step 1: Write the function**

Create `supabase/functions/create_checkout/index.ts`:

```ts
import { createClient } from "jsr:@supabase/supabase-js@2";
import DodoPayments from "npm:dodopayments";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json() as { reading_id?: string; session_token?: string };
    const { reading_id, session_token } = body;

    if (!reading_id || !session_token || !UUID.test(reading_id) || !UUID.test(session_token)) {
      return json({ error: "Invalid request" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Validate the reading: exists, token matches, still awaiting payment.
    const { data: reading, error: readErr } = await admin
      .from("readings")
      .select("id, session_token, status, paid_at, email")
      .eq("id", reading_id)
      .single();

    if (readErr || !reading) return json({ error: "Reading not found" }, 404);
    if (reading.session_token !== session_token) return json({ error: "Forbidden" }, 403);
    if (reading.status !== "pending_payment" || reading.paid_at) {
      return json({ error: "Reading is not awaiting payment" }, 409);
    }

    const client = new DodoPayments({
      bearerToken: Deno.env.get("DODO_PAYMENTS_API_KEY")!,
      environment: (Deno.env.get("DODO_PAYMENTS_ENVIRONMENT") ?? "test_mode") as "test_mode" | "live_mode",
    });

    const appUrl = Deno.env.get("APP_URL") ?? Deno.env.get("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000";

    const session = await client.checkoutSessions.create({
      product_cart: [{ product_id: Deno.env.get("DODO_PRODUCT_ID")!, quantity: 1 }],
      customer: reading.email ? { email: reading.email } : undefined,
      return_url: `${appUrl}/wait/${reading_id}?token=${session_token}`,
      metadata: { reading_id },
    });

    const { error: updErr } = await admin
      .from("readings")
      .update({ dodo_session_id: session.session_id })
      .eq("id", reading_id);

    if (updErr) console.error("persist dodo_session_id failed:", updErr);

    return json({ checkout_url: session.checkout_url });
  } catch (err) {
    console.error("create_checkout error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
```

- [ ] **Step 2: Typecheck the function**

Run: `deno check supabase/functions/create_checkout/index.ts`
Expected: passes (remote deps download on first run; allow network).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/create_checkout/index.ts
git commit -m "feat(fn): create_checkout — Dodo hosted checkout session"
```

---

### Task 4: New edge function `dodo_webhook`

**Files:**
- Create: `supabase/functions/dodo_webhook/index.ts`
- Modify: `supabase/config.toml` (disable JWT verification for this function — webhook is signature-gated, not JWT)

**Interfaces:**
- Consumes: Dodo `payment.succeeded` events carrying `data.metadata.reading_id`.
- Produces: on valid `payment.succeeded`, sets `paid_at`, `dodo_payment_id`, `payment_amount`, `payment_currency`, flips `status='awaiting_response'`, sets `expires_at = null`. Idempotent. Invalid signature → 401.

- [ ] **Step 1: Write the function**

Create `supabase/functions/dodo_webhook/index.ts`:

```ts
import { createClient } from "jsr:@supabase/supabase-js@2";
import DodoPayments from "npm:dodopayments";

// No CORS needed — this is a server-to-server webhook, not a browser caller.

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const client = new DodoPayments({
    bearerToken: Deno.env.get("DODO_PAYMENTS_API_KEY")!,
    webhookKey: Deno.env.get("DODO_PAYMENTS_WEBHOOK_KEY")!,
    environment: (Deno.env.get("DODO_PAYMENTS_ENVIRONMENT") ?? "test_mode") as "test_mode" | "live_mode",
  });

  // Raw body is required for signature verification.
  const rawBody = await req.text();

  let event: { type: string; data: Record<string, unknown> };
  try {
    event = client.webhooks.unwrap(rawBody, {
      headers: {
        "webhook-id": req.headers.get("webhook-id") ?? "",
        "webhook-signature": req.headers.get("webhook-signature") ?? "",
        "webhook-timestamp": req.headers.get("webhook-timestamp") ?? "",
      },
    }) as { type: string; data: Record<string, unknown> };
  } catch (err) {
    console.error("dodo_webhook signature verification failed:", err);
    return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 401 });
  }

  try {
    if (event.type === "payment.succeeded") {
      const data = event.data as {
        payment_id?: string;
        total_amount?: number;
        currency?: string;
        metadata?: Record<string, string>;
      };
      const readingId = data.metadata?.reading_id;
      if (!readingId) {
        console.error("payment.succeeded missing metadata.reading_id");
        return new Response(JSON.stringify({ received: true }), { status: 200 });
      }

      const admin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );

      // Idempotent: only the first delivery (paid_at still null) flips the row.
      const { error } = await admin
        .from("readings")
        .update({
          paid_at: new Date().toISOString(),
          dodo_payment_id: data.payment_id ?? null,
          payment_amount: data.total_amount ?? null,
          payment_currency: data.currency ?? null,
          status: "awaiting_response",
          expires_at: null,
        })
        .eq("id", readingId)
        .eq("status", "pending_payment")
        .is("paid_at", null);

      if (error) console.error("dodo_webhook update failed:", error);
    } else if (event.type === "payment.failed") {
      console.log("payment.failed:", (event.data as { payment_id?: string }).payment_id);
    }
    // Unknown events: acknowledged, ignored.

    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (err) {
    console.error("dodo_webhook processing error:", err);
    // Already signature-verified; 200 so Dodo doesn't infinitely retry a bug.
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  }
});
```

- [ ] **Step 2: Allow unauthenticated invocation (signature-gated, not JWT)**

In `supabase/config.toml`, add (or confirm) a stanza so Supabase does not require a JWT for this endpoint:

```toml
[functions.dodo_webhook]
verify_jwt = false
```

Also confirm `create_checkout` is reachable without a logged-in user (seekers have no auth). If other no-auth seeker functions (e.g. `submit_reading`) are listed with `verify_jwt = false`, add the same for `create_checkout`:

```toml
[functions.create_checkout]
verify_jwt = false
```

(If the project relies on the platform default and existing seeker functions have no stanza, match that — do not add stanzas the other seeker functions don't have. Inspect the file first.)

- [ ] **Step 3: Typecheck the function**

Run: `deno check supabase/functions/dodo_webhook/index.ts`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/dodo_webhook/index.ts supabase/config.toml
git commit -m "feat(fn): dodo_webhook — confirm payment, auto-flip to awaiting_response"
```

---

### Task 5: Strip screenshot from seeker server path; delete `verify_payment`

**Files:**
- Modify: `supabase/functions/get_upload_urls/index.ts`
- Modify: `supabase/functions/submit_reading/index.ts`
- Delete: `supabase/functions/verify_payment/index.ts` (and its directory)

**Interfaces:**
- Produces: `get_upload_urls` returns only `{ question_audio: { upload_url, path } }`; `submit_reading` accepts no `payment_screenshot_path` and inserts it as `null`. `verify_payment` no longer exists (webhook does the flip).

- [ ] **Step 1: Rewrite `get_upload_urls` (audio only)**

Replace the body of `supabase/functions/get_upload_urls/index.ts` with:

```ts
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_AUDIO_EXT = new Set(["webm", "mp4"]);

function isCleanExt(ext: unknown): ext is string {
  return typeof ext === "string" && /^[a-z0-9]{1,10}$/.test(ext);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json() as { question_audio_ext?: unknown };
    const rawAudioExt = body.question_audio_ext ?? "webm";

    if (!isCleanExt(rawAudioExt) || !ALLOWED_AUDIO_EXT.has(rawAudioExt)) {
      return json({ error: "Invalid audio extension" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const audioPath = `${crypto.randomUUID()}.${rawAudioExt}`;
    const audioResult = await admin.storage
      .from("question-audio")
      .createSignedUploadUrl(audioPath);

    if (audioResult.error) {
      console.error("upload URL error:", audioResult.error);
      return json({ error: "Failed to create upload URL" }, 500);
    }

    return json({
      question_audio: { upload_url: audioResult.data.signedUrl, path: audioPath },
    });
  } catch (err) {
    console.error("get_upload_urls error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
```

- [ ] **Step 2: Make `payment_screenshot_path` optional in `submit_reading`**

In `supabase/functions/submit_reading/index.ts`:

(a) Remove `payment_screenshot_path` from the request body type and destructuring (lines 30 and 41 in the current file).

(b) Replace the `VALID_PATH` constant (line 10) so it no longer accepts image extensions:

```ts
const VALID_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webm|mp4)$/;
```

(c) Replace the required-fields guard (current lines 45-47) with:

```ts
    if (!spread_type || !question_audio_path || !positions?.length) {
      return json({ error: "Missing required fields" }, 400);
    }
```

(d) Delete the screenshot path validation block (current lines 53-55):

```ts
    if (!VALID_PATH.test(payment_screenshot_path)) {
      return json({ error: "Invalid screenshot path" }, 400);
    }
```

(e) In the `.insert({...})` call (current lines 76-85), replace `payment_screenshot_path,` with `payment_screenshot_path: null,`.

Leave card sealing, recovery code, species, and the response shape `{ reading_id, session_token, recovery_code, species }` unchanged.

- [ ] **Step 3: Delete `verify_payment`**

Run:
```bash
git rm -r supabase/functions/verify_payment
```
Expected: directory removed.

- [ ] **Step 4: Typecheck the changed functions**

Run:
```bash
deno check supabase/functions/get_upload_urls/index.ts supabase/functions/submit_reading/index.ts
```
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/get_upload_urls/index.ts supabase/functions/submit_reading/index.ts
git commit -m "feat(fn): drop screenshot from upload+submit; remove verify_payment"
```

---

### Task 6: Seeker paywall page — remove screenshot/QR, redirect to Dodo

**Files:**
- Modify: `src/app/(seeker)/auth/page.tsx` (full rewrite)

**Interfaces:**
- Consumes: `get_upload_urls` (audio only), `submit_reading` (no screenshot), `create_checkout`.
- Produces: paywall with no QR/upload; submit → upload audio → `submit_reading` → `storeReading` → `create_checkout` → `window.location.href = checkout_url`.

- [ ] **Step 1: Rewrite the page**

Replace the entire contents of `src/app/(seeker)/auth/page.tsx` with:

```tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useFlowStore } from "@/lib/flow/store";
import { storeReading, getStoredReadings } from "@/lib/session";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const AMOUNT = process.env.NEXT_PUBLIC_PAYMENT_AMOUNT ?? "$3";

export default function PaywallPage() {
  const router = useRouter();
  const blob = useFlowStore((s) => s.blob);
  const mimeType = useFlowStore((s) => s.mimeType);
  const durationMs = useFlowStore((s) => s.durationMs);
  const spreadType = useFlowStore((s) => s.spreadType);
  const positions = useFlowStore((s) => s.positions);
  const clear = useFlowStore((s) => s.clear);

  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) router.replace("/ask");
  }, [blob, router]);

  async function handleSubmit() {
    if (!blob) return;

    if (!SUPABASE_URL) {
      // Dev fallback: store a placeholder reading and navigate.
      const readingId = crypto.randomUUID();
      const sessionToken = crypto.randomUUID();
      storeReading(readingId, sessionToken, spreadType ?? "three");
      clear();
      router.push(`/wait/${readingId}`);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const edgeFn = (name: string) => `${SUPABASE_URL}/functions/v1/${name}`;
      const fnHeaders = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""}`,
      };

      // Step 1: signed upload URL for audio.
      const audioExt = mimeType.includes("mp4") ? "mp4" : "webm";
      const urlsRes = await fetch(edgeFn("get_upload_urls"), {
        method: "POST",
        headers: fnHeaders,
        body: JSON.stringify({ question_audio_ext: audioExt }),
      });
      if (!urlsRes.ok) throw new Error("Failed to get upload URL");
      const { question_audio } = await urlsRes.json() as {
        question_audio: { upload_url: string; path: string };
      };

      // Step 2: upload audio via signed URL.
      const audioUpload = await fetch(question_audio.upload_url, {
        method: "PUT",
        headers: { "Content-Type": mimeType },
        body: blob,
      });
      if (!audioUpload.ok) throw new Error("Upload failed");

      // Step 3: create the reading (cards sealed server-side).
      const isFirstReading = getStoredReadings().length === 0;
      const submitRes = await fetch(edgeFn("submit_reading"), {
        method: "POST",
        headers: fnHeaders,
        body: JSON.stringify({
          spread_type: spreadType ?? "three",
          positions,
          question_audio_path: question_audio.path,
          question_duration_ms: durationMs || null,
          email: email || undefined,
          is_first_reading: isFirstReading,
        }),
      });
      if (!submitRes.ok) {
        const err = await submitRes.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Submission failed");
      }
      const { reading_id, session_token, recovery_code, species } = await submitRes.json() as {
        reading_id: string;
        session_token: string;
        recovery_code?: string;
        species?: string;
      };

      // Step 4: persist locally NOW (garden tracks it even if checkout is abandoned).
      storeReading(
        reading_id,
        session_token,
        spreadType ?? "three",
        species as import("@/types/garden").FlowerSpecies | undefined,
        recovery_code,
      );
      clear();

      // Step 5: create the Dodo checkout session and redirect.
      const checkoutRes = await fetch(edgeFn("create_checkout"), {
        method: "POST",
        headers: fnHeaders,
        body: JSON.stringify({ reading_id, session_token }),
      });
      if (!checkoutRes.ok) {
        const err = await checkoutRes.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Could not start checkout");
      }
      const { checkout_url } = await checkoutRes.json() as { checkout_url: string };
      window.location.href = checkout_url;
    } catch (err) {
      console.error("submit error:", err);
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  if (!blob) return null;

  return (
    <main className="flex flex-col items-center min-h-dvh px-6 pt-10 pb-20">
      <div className="w-full max-w-sm flex flex-col items-center">
        {/* Wordmark */}
        <motion.div
          className="w-full mb-10"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          <span
            className="font-display italic text-moonlight/70 tracking-tight leading-none"
            style={{ fontSize: 20 }}
          >
            iris luna
          </span>
        </motion.div>

        {/* Ritual framing */}
        <motion.div
          className="text-center mb-8 w-full"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15, duration: 0.9, ease: "easeOut" }}
        >
          <p className="text-muted text-[10px] uppercase tracking-[0.2em] mb-3">
            an offering
          </p>
          <p className="font-display italic text-moonlight/80 text-xl leading-snug">
            The ritual asks for {AMOUNT}.
          </p>
          <p className="text-muted text-sm mt-2 leading-relaxed">
            A human will hear your question. This is how you reach them.
          </p>
        </motion.div>

        <Divider delay={0.4} />

        {/* Email (optional) */}
        <motion.div
          className="w-full mb-8"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.7 }}
        >
          <label
            htmlFor="paywall-email"
            className="block text-muted text-[10px] uppercase tracking-[0.15em] mb-2"
          >
            notify me when the human answers
          </label>
          <input
            id="paywall-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com (optional)"
            className="w-full bg-transparent text-moonlight/80 text-sm px-3 py-2.5 rounded-md outline-none transition-colors placeholder:text-muted/40"
            style={{ border: "1px solid oklch(0.94 0.018 301 / 0.12)" }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "oklch(0.72 0.078 283 / 0.35)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "oklch(0.94 0.018 301 / 0.12)")}
            autoComplete="email"
            inputMode="email"
          />
        </motion.div>

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.p
              className="text-sm text-center mb-4 w-full"
              style={{ color: "oklch(0.65 0.14 20)" }}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        {/* Submit */}
        <motion.button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full py-3.5 rounded-lg text-sm uppercase tracking-[0.18em] transition-all duration-300"
          style={{
            background: submitting ? "oklch(0.52 0.118 283 / 0.22)" : "oklch(0.52 0.118 283)",
            color: submitting ? "oklch(0.94 0.018 301 / 0.3)" : "oklch(0.94 0.018 301)",
            cursor: submitting ? "not-allowed" : "pointer",
          }}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.7 }}
          whileTap={submitting ? {} : { scale: 0.98 }}
        >
          {submitting ? "preparing…" : "continue to the offering"}
        </motion.button>

        <motion.p
          className="text-muted/50 text-[10px] text-center mt-4 leading-relaxed"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7, duration: 0.7 }}
        >
          {AMOUNT} · a secure card payment · your reading is held for 24 hours
        </motion.p>
      </div>
    </main>
  );
}

function Divider({ delay }: { delay: number }) {
  return (
    <motion.div
      className="w-full mb-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay, duration: 0.7 }}
      aria-hidden
      style={{
        height: 1,
        background:
          "linear-gradient(to right, transparent, oklch(0.94 0.018 301 / 0.07), transparent)",
      }}
    />
  );
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: compiles; no references to `screenshot`, `QR_URL`, `payment_screenshot` remain in this file.

- [ ] **Step 3: Verify no lingering screenshot refs in the seeker path**

Run: `grep -rn "payment_screenshot\|QR_URL\|screenshot" "src/app/(seeker)"`
Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(seeker)/auth/page.tsx"
git commit -m "feat(seeker): Dodo checkout paywall; remove QR + screenshot upload"
```

---

### Task 7: Admin queue page — remove payments tab

**Files:**
- Modify: `src/app/admin/page.tsx`

**Interfaces:**
- Consumes: `readings` rows with `status='awaiting_response'` plus `paid_at`, `payment_amount`, `payment_currency`.
- Produces: a single queue (no tabs) of paid readings awaiting a reader response, oldest first.

- [ ] **Step 1: Replace the tab/state logic and render**

In `src/app/admin/page.tsx`:

(a) Delete the `type Tab = "payments" | "queue";` line.

(b) Add `paid_at` to `QueueRow`:

```ts
interface QueueRow {
  id: string;
  spread_type: "single" | "three";
  status: ReadingStatus;
  created_at: string;
  email: string | null;
  paid_at: string | null;
}
```

(c) Replace the component state + `load` (current lines 20-50) with:

```tsx
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const supabase = createClient();
    const queueRes = await supabase
      .from("readings")
      .select("id, spread_type, status, created_at, email, paid_at")
      .eq("status", "awaiting_response")
      .order("created_at", { ascending: true }); // oldest first
    setQueue((queueRes.data ?? []) as QueueRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 30_000);
    return () => clearInterval(interval);
  }, [load]);
```

(d) Replace the tab bar + `AnimatePresence` body (current lines 76-106) with a single list:

```tsx
      <div className="flex-1">
        {loading ? (
          <Skeleton />
        ) : (
          <ReadingList rows={queue} emptyHint="Queue is clear." />
        )}
      </div>
```

(e) Delete the now-unused `TabButton` component (current lines 111-152).

(f) In `ReadingList`, show "paid Xm ago" when present — change the secondary line (current lines 187-197) to append paid time:

```tsx
              <span
                className="text-xs"
                style={{ color: "oklch(0.94 0.018 301 / 0.55)" }}
              >
                {row.spread_type === "single" ? "1-card" : "3-card"} · {timeAgo(row.created_at)}
                {row.paid_at && (
                  <span style={{ color: "oklch(0.62 0.104 163 / 0.7)" }}>
                    {" · "}paid {timeAgo(row.paid_at)}
                  </span>
                )}
                {row.email && (
                  <span style={{ color: "oklch(0.44 0.024 283 / 0.6)" }}>
                    {" · "}{row.email}
                  </span>
                )}
              </span>
```

Keep `ReadingList`, `Skeleton`, `timeAgo`, and the header/refresh button as-is.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: compiles; no unused-variable errors for `tab`/`setTab`/`payments`/`TabButton`.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/page.tsx
git commit -m "feat(admin): single paid-reading queue; remove payments tab"
```

---

### Task 8: Admin reading detail — remove screenshot/verify, show Dodo info, single Deliver

**Files:**
- Modify: `src/app/admin/[readingId]/page.tsx`

**Interfaces:**
- Consumes: reading row with Dodo fields; `submit_response` edge function (unchanged).
- Produces: detail page with a "payment" section showing Dodo info (no screenshot, no verify/reject buttons). Flow for `awaiting_response`: question audio → cards → claim → record → single Deliver (`submit_response`). The `handleVerify` function and `verify_payment` call are removed.

- [ ] **Step 1: Update the `Reading` interface and `load` select**

(a) In the `Reading` interface (current lines 11-24), replace `payment_screenshot_path: string;` and `payment_verified_at: string | null;` with the Dodo fields:

```ts
  payment_screenshot_path: string | null;
  paid_at: string | null;
  payment_amount: number | null;
  payment_currency: string | null;
```

(b) In `ViewState` (current lines 43-52), remove `screenshotUrl: string | null;` from the `"ready"` variant.

(c) In `load` (current lines 79-142): change the `.select(...)` string to drop `payment_screenshot_path, payment_verified_at` and add the Dodo fields:

```ts
      .select(
        "id, status, spread_type, created_at, email, question_audio_path, question_duration_ms, paid_at, payment_amount, payment_currency, response_audio_path, claimed_by, claimed_at"
      )
```

(d) In the same `load`, remove the `payment-screenshots` signed-URL call from the `Promise.all` (current lines 96-104) so it becomes:

```ts
    const [audioResult, rcResult] = await Promise.all([
      supabase.storage.from("question-audio").createSignedUrl(reading.question_audio_path, 3600),
      supabase
        .from("reading_cards")
        .select("*")
        .eq("reading_id", readingId)
        .order("position"),
    ]);
```

(e) In the final `setView({ phase: "ready", ... })` (current lines 135-141), remove the `screenshotUrl: ...` property.

- [ ] **Step 2: Remove `handleVerify` and the screenshot destructure**

(a) Delete the entire `handleVerify` function (current lines 146-181).

(b) In the render, change `const { reading, screenshotUrl, questionAudioUrl } = view;` (current line 285) to:

```ts
  const { reading, questionAudioUrl } = view;
```

- [ ] **Step 3: Replace the payment section**

Replace the entire `{/* ── Payment section ── */}` block (current lines 356-401) with a Dodo info section:

```tsx
      {/* ── Payment ───────────────────────────────────────── */}
      <Section title="payment" delay={0.1}>
        {reading.paid_at ? (
          <div className="flex flex-col gap-1">
            <p className="text-sm" style={{ color: "oklch(0.94 0.018 301 / 0.8)" }}>
              {formatAmount(reading.payment_amount, reading.payment_currency)}
            </p>
            <p className="text-[10px] uppercase tracking-[0.14em]" style={{ color: "oklch(0.62 0.104 163 / 0.7)" }}>
              ✓ paid {new Date(reading.paid_at).toLocaleString()}
            </p>
          </div>
        ) : (
          <p className="text-[10px] uppercase tracking-[0.14em]" style={{ color: "oklch(0.44 0.024 283 / 0.6)" }}>
            Awaiting payment confirmation
          </p>
        )}
      </Section>
```

- [ ] **Step 4: Add the `formatAmount` helper**

Add near the other helpers (e.g. after the `Section` function):

```tsx
function formatAmount(amount: number | null, currency: string | null): string {
  if (amount == null) return "Paid";
  const major = (amount / 100).toFixed(2);
  return `${currency ?? ""} ${major}`.trim();
}
```

- [ ] **Step 5: Relabel the deliver button copy (optional clarity)**

In the response-recording block, the submit button text (current line 550) reads `"send response"`. Change it to convey delivery + reveal:

```tsx
                    {submittingResponse ? "delivering…" : "deliver reading"}
```

Leave the `handleSubmitResponse` logic, claim flow, cards section, and "response sent" section unchanged — `submit_response` already sets `responded`, unseals cards, and emails the seeker.

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: compiles; no references to `screenshotUrl`, `handleVerify`, `payment_screenshot`, `payment_verified_at`, `verify_payment` remain in the file.

- [ ] **Step 7: Verify no lingering refs**

Run: `grep -nE "screenshotUrl|handleVerify|payment_screenshot|payment_verified_at|verify_payment" "src/app/admin/[readingId]/page.tsx"`
Expected: no matches.

- [ ] **Step 8: Commit**

```bash
git add "src/app/admin/[readingId]/page.tsx"
git commit -m "feat(admin): Dodo payment info + single deliver button; drop verify gate"
```

---

### Task 9: Env, wait-page copy, final verification

**Files:**
- Modify: `src/app/(seeker)/wait/[readingId]/page.tsx` (copy on line ~258)
- Modify: `.env.local` (add client payment var; document edge secrets)
- Reference: `docs/superpowers/specs/2026-06-28-dodo-gated-single-button-delivery-design.md` §7 for the Dodo dashboard steps

**Interfaces:**
- Consumes: everything above.
- Produces: correct wait-screen copy for the confirming state; documented env.

- [ ] **Step 1: Update wait-screen `pending_payment` copy**

In `src/app/(seeker)/wait/[readingId]/page.tsx`, the `status === "pending_payment"` block (current line ~258) reads `"Payment received — verifying."`. Change it to:

```tsx
          <p className="font-display italic text-moonlight/60 text-lg mt-5 mb-2">
            Payment confirming…
          </p>
```

(Leave the subtext "Usually within a few hours." as-is.)

- [ ] **Step 2: Add client env var**

In `.env.local`, add:

```
NEXT_PUBLIC_PAYMENT_AMOUNT=$3
```

(`NEXT_PUBLIC_PAYMENT_QR_URL` and `NEXT_PUBLIC_PAYMENT_METHOD` are no longer read; remove them if present.)

- [ ] **Step 3: Document the edge-function secrets (do not commit real keys)**

Confirm these are set for local/prod via `supabase secrets set` (names only — values come from the Dodo dashboard per spec §7):
`DODO_PAYMENTS_API_KEY`, `DODO_PAYMENTS_WEBHOOK_KEY`, `DODO_PAYMENTS_ENVIRONMENT`, `DODO_PRODUCT_ID`, `APP_URL`.

Run (lists configured secret names, no values): `supabase secrets list`
Expected: the five names appear (or note which are missing for the deployer to set).

- [ ] **Step 4: Full build + full grep sweep**

Run:
```bash
npm run build && grep -rn "verify_payment\|payment_screenshot_ext\|QR_URL" src supabase/functions || echo "CLEAN"
```
Expected: build passes; grep prints `CLEAN` (no functional references; the legacy nullable `payment_screenshot_path` column reference in types is acceptable and not matched here).

- [ ] **Step 5: Manual end-to-end smoke (documented, run when Dodo test keys are available)**

Confirm in order (test_mode):
1. Seeker: record → pick → paywall → "continue to the offering" → redirected to Dodo checkout. No screenshot/QR anywhere.
2. Complete Dodo test payment → returns to `/wait/[id]`.
3. DB: row flips `pending_payment → awaiting_response`, `paid_at` set, `expires_at` null (webhook fired).
4. Admin `/admin`: the reading appears in the single queue (no payments tab). Detail page shows "✓ paid …", no screenshot, no verify/reject.
5. Admin: claim → record voicenote → "deliver reading" → status `responded`; seeker wait page auto-advances to reveal; cards + voicenote shown.
6. Abandon a checkout → row stays `pending_payment, paid_at=null`; after `expires_at`, cron marks it `expired`; it never appears in admin.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(seeker)/wait/[readingId]/page.tsx" .env.local
git commit -m "chore: wait-screen copy + payment env for Dodo flow"
```

---

## Self-Review

**Spec coverage:**
- Spec §1 decisions 1-7 → Tasks 1 (cron/columns), 3-4 (Dodo build), 5 (screenshot removal + verify_payment delete), 7-8 (admin single button, no gate). ✓
- §2 state machine → Task 1 (cron), Task 4 (webhook flip + expires_at null). ✓
- §3 migration → Task 1. ✓
- §4 edge functions (create_checkout, dodo_webhook, get_upload_urls, submit_reading, delete verify_payment) → Tasks 3, 4, 5. ✓ submit_response/reveal_reading unchanged (no task needed). ✓
- §5 seeker paywall → Task 6; wait screen copy → Task 9. ✓
- §6 admin → Tasks 7-8. ✓
- §7 env → Task 9. ✓
- §9 acceptance criteria → Task 9 Step 5 smoke list mirrors them. ✓

**Placeholder scan:** No "TBD"/"handle errors appropriately"; all code blocks concrete. Verification uses real commands (no fabricated test runner). ✓

**Type consistency:** `paid_at`, `payment_amount`, `payment_currency`, `dodo_session_id`, `dodo_payment_id` named identically across Task 1 (SQL), Task 2 (types), Task 4 (webhook update), Task 8 (admin select/render). `checkout_url`/`session_id` match the verified SDK shape. `submit_response` request body unchanged from the existing function. ✓
