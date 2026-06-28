# Pay-Gated Garden Key Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mint the garden key only after a Dodo payment is confirmed; abandoned sessions leave no key and no garden entry; the key is shown on screen and optionally emailed.

**Architecture:** Seeker pays via Dodo checkout (redirect). A signed Dodo webhook flips the reading `pending_payment → awaiting_response` and stamps `paid_at`. A `claim_garden` edge function, gated on `paid_at`, mints the seeker + garden key (plaintext on the session-token-gated reading row, hash in `seekers`) and returns it to the new `/key/[readingId]` page, which is the only place a reading enters the device garden.

**Tech Stack:** Next.js 16 (App Router, `src/app`), React 19, Zustand, Framer Motion, Supabase (Postgres + Deno edge functions), Dodo Payments, Resend.

## Global Constraints

- This is Next.js 16 — middleware is `proxy.ts`; consult `node_modules/next/dist/docs/` before using unfamiliar APIs.
- Package manager is **pnpm**. Build = `pnpm build`. Lint = `pnpm lint` (via `next lint`).
- Edge functions are **Deno** (`Deno.serve`, `jsr:`/`npm:` imports). Type-check with `deno check <path>`.
- No unit-test harness exists. Verify edge functions with `deno check` + local `supabase functions serve` + `curl`; verify frontend with `pnpm build` + manual browser walkthrough.
- Garden code format: `XXXX-XXXX-XXXX` from chars `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. `seekers` stores SHA-256 hash only; plaintext lives on `readings.garden_code`.
- All edge functions keep the existing `corsHeaders` block and `json()` helper pattern verbatim.
- Reading statuses: `pending_payment | awaiting_response | responded | revealed | expired`.
- Do all work on branch `feat/pay-gated-garden-key` (branch off `main` before Task 1).

---

### Task 1: DB migration — `readings.garden_code` + type update

**Files:**
- Create: `supabase/migrations/20260628000002_garden_code_plaintext.sql`
- Modify: `src/lib/supabase/types.ts:50-54` (readings Row — add `garden_code`)

**Interfaces:**
- Produces: `readings.garden_code text null` column; `Database["public"]["Tables"]["readings"]["Row"].garden_code: string | null`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260628000002_garden_code_plaintext.sql`:

```sql
-- Plaintext garden key, set by claim_garden after payment. Readable only via
-- session-token-gated edge functions. seekers keeps the hash for restore.
alter table public.readings
  add column if not exists garden_code text;
```

- [ ] **Step 2: Add the column to the TS Row type**

In `src/lib/supabase/types.ts`, inside the `readings.Row` block, add after `payment_currency: number | null;` / `payment_currency: string | null;` line (after line 54):

```ts
          garden_code: string | null;
```

- [ ] **Step 3: Apply locally and verify**

Run: `pnpm db:reset`
Expected: completes without error; all migrations apply including `20260628000002_garden_code_plaintext`.

Run: `psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '\"')" -c "\d public.readings" | grep garden_code`
Expected: a row showing `garden_code | text`.

(If `psql` is unavailable, instead run `supabase db diff` and confirm no pending diff for the column.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260628000002_garden_code_plaintext.sql src/lib/supabase/types.ts
git commit -m "feat(db): add readings.garden_code for post-payment key reveal"
```

---

### Task 2: `get_upload_urls` — audio only (drop screenshot)

**Files:**
- Modify: `supabase/functions/get_upload_urls/index.ts`

**Interfaces:**
- Produces: response `{ question_audio: { upload_url, path } }` (no `payment_screenshot`).

- [ ] **Step 1: Replace the function body**

Replace the entire contents of `supabase/functions/get_upload_urls/index.ts` with:

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

- [ ] **Step 2: Type-check**

Run: `deno check supabase/functions/get_upload_urls/index.ts`
Expected: no errors. (If `deno` is not installed: `npx supabase functions serve get_upload_urls --no-verify-jwt` then Ctrl-C after it loads without a syntax error.)

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/get_upload_urls/index.ts
git commit -m "feat(fn): get_upload_urls returns audio URL only"
```

---

### Task 3: `submit_reading` — no screenshot, no key minting, attach optional seeker

**Files:**
- Modify: `supabase/functions/submit_reading/index.ts`

**Interfaces:**
- Consumes: body `{ spread_type, positions, question_audio_path, question_duration_ms?, email?, seeker_id? }`.
- Produces: response `{ reading_id, session_token, species }`. Creates a `pending_payment` reading with `seeker_id` attached only if a valid one was passed. No garden code is created here.

- [ ] **Step 1: Replace the function body**

Replace the entire contents of `supabase/functions/submit_reading/index.ts` with:

```ts
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Audio path must be UUID.ext — the exact shape get_upload_urls generates.
const VALID_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webm|mp4)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function cryptoRand(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 0x100000000;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json() as {
      spread_type: "single" | "three";
      positions: number[];
      question_audio_path: string;
      question_duration_ms?: number;
      email?: string;
      seeker_id?: string;
    };

    const { spread_type, positions, question_audio_path, question_duration_ms, email } = body;

    if (!spread_type || !question_audio_path || !positions?.length) {
      return json({ error: "Missing required fields" }, 400);
    }
    if (!VALID_PATH.test(question_audio_path)) {
      return json({ error: "Invalid audio path" }, 400);
    }
    if (!positions.every((p) => Number.isInteger(p) && p >= 0 && p < 20)) {
      return json({ error: "Invalid positions" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const sessionToken = crypto.randomUUID();
    const pickCount = spread_type === "single" ? 1 : 3;

    // Attach an existing seeker only if a valid id was passed (returning user
    // who entered their garden key on /pay). Never mint a seeker here.
    let seekerId: string | null = null;
    if (body.seeker_id && UUID.test(body.seeker_id)) {
      const { data: existing } = await admin
        .from("seekers").select("id").eq("id", body.seeker_id).single();
      if (existing) seekerId = existing.id;
    }

    const { data: reading, error: readingErr } = await admin
      .from("readings")
      .insert({
        session_token: sessionToken,
        seeker_id: seekerId,
        spread_type,
        question_audio_path,
        question_duration_ms: question_duration_ms ?? null,
        email: email || null,
        status: "pending_payment",
      })
      .select("id")
      .single();

    if (readingErr || !reading) {
      console.error("insert reading error:", readingErr);
      return json({ error: "Failed to create reading" }, 500);
    }

    const { data: allCards, error: cardsErr } = await admin
      .from("cards").select("id, flower_species");
    if (cardsErr || !allCards) {
      return json({ error: "Failed to load deck" }, 500);
    }

    const speciesMap: Record<number, string | null> = {};
    for (const c of allCards as { id: number; flower_species: string | null }[]) {
      speciesMap[c.id] = c.flower_species;
    }

    // Fisher-Yates shuffle using CSPRNG (rejection-sampled, no modulo bias)
    const deck: number[] = allCards.map((c: { id: number }) => c.id);
    for (let i = deck.length - 1; i > 0; i--) {
      const range = i + 1;
      const limit = Math.floor(0x100000000 / range) * range;
      let rand: number;
      do {
        const buf = new Uint32Array(1);
        crypto.getRandomValues(buf);
        rand = buf[0];
      } while (rand >= limit);
      const j = rand % range;
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    const chosen = deck.slice(0, pickCount);

    const cardRows = chosen.map((cardId: number, idx: number) => ({
      reading_id: reading.id,
      card_id: cardId,
      position: positions[idx] ?? idx,
      is_reversed: cryptoRand() < 0.5,
    }));

    const { error: rcErr } = await admin.from("reading_cards").insert(cardRows);
    if (rcErr) {
      console.error("insert reading_cards error:", rcErr);
      return json({ error: "Failed to seal cards" }, 500);
    }

    // Species from primary card; iris fallback. (Final species, incl. iris for a
    // brand-new garden, is decided by claim_garden after payment.)
    const species = speciesMap[chosen[0]] ?? "iris";

    return json({ reading_id: reading.id, session_token: sessionToken, species });
  } catch (err) {
    console.error("submit_reading error:", err);
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

- [ ] **Step 2: Type-check**

Run: `deno check supabase/functions/submit_reading/index.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/submit_reading/index.ts
git commit -m "feat(fn): submit_reading drops screenshot + defers key minting"
```

---

### Task 4: `create_checkout` — return to `/key`

**Files:**
- Modify: `supabase/functions/create_checkout/index.ts:53`

**Interfaces:**
- Produces: Dodo session whose `return_url` is `${appUrl}/key/${reading_id}?token=${session_token}`.

- [ ] **Step 1: Update the return_url**

In `supabase/functions/create_checkout/index.ts`, change line 53 from:

```ts
      return_url: `${appUrl}/wait/${reading_id}?token=${session_token}`,
```

to:

```ts
      return_url: `${appUrl}/key/${reading_id}?token=${session_token}`,
```

- [ ] **Step 2: Type-check**

Run: `deno check supabase/functions/create_checkout/index.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/create_checkout/index.ts
git commit -m "feat(fn): create_checkout returns to /key page"
```

---

### Task 5: `dodo_webhook` — trusted payment confirmation

**Files:**
- Create: `supabase/functions/dodo_webhook/index.ts`

**Interfaces:**
- Consumes: Dodo webhook POST with headers `webhook-id`, `webhook-timestamp`, `webhook-signature` and JSON body `{ type, data: { payment_id, total_amount?, currency?, metadata?: { reading_id? } } }`.
- Produces: on a payment-success event, sets the matching reading to `awaiting_response`, `paid_at = now()`, `dodo_payment_id`, `payment_amount`, `payment_currency`, and resets `expires_at` to now + 24h. Idempotent.

- [ ] **Step 1: Write the function**

Create `supabase/functions/dodo_webhook/index.ts`:

```ts
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Webhook } from "npm:standardwebhooks";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "webhook-id, webhook-timestamp, webhook-signature, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const raw = await req.text();

    const wh = new Webhook(Deno.env.get("DODO_WEBHOOK_SECRET")!);
    try {
      wh.verify(raw, {
        "webhook-id": req.headers.get("webhook-id") ?? "",
        "webhook-timestamp": req.headers.get("webhook-timestamp") ?? "",
        "webhook-signature": req.headers.get("webhook-signature") ?? "",
      });
    } catch (verifyErr) {
      console.error("webhook signature verify failed:", verifyErr);
      return json({ error: "Invalid signature" }, 401);
    }

    const event = JSON.parse(raw) as {
      type?: string;
      data?: {
        payment_id?: string;
        total_amount?: number;
        currency?: string;
        metadata?: { reading_id?: string };
      };
    };

    // Only act on a successful payment.
    if (event.type !== "payment.succeeded") {
      return json({ ok: true, ignored: event.type ?? "unknown" });
    }

    const readingId = event.data?.metadata?.reading_id;
    if (!readingId) {
      console.error("payment.succeeded missing metadata.reading_id");
      return json({ ok: true, ignored: "no_reading_id" });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: reading } = await admin
      .from("readings")
      .select("id, status, paid_at")
      .eq("id", readingId)
      .single();

    if (!reading) return json({ ok: true, ignored: "reading_not_found" });
    if (reading.paid_at) return json({ ok: true, ignored: "already_paid" });

    const { error: updErr } = await admin
      .from("readings")
      .update({
        status: "awaiting_response",
        paid_at: new Date().toISOString(),
        dodo_payment_id: event.data?.payment_id ?? null,
        payment_amount: event.data?.total_amount ?? null,
        payment_currency: event.data?.currency ?? null,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      .eq("id", readingId)
      .eq("status", "pending_payment");

    if (updErr) {
      console.error("webhook update failed:", updErr);
      return json({ error: "Update failed" }, 500);
    }

    return json({ ok: true });
  } catch (err) {
    console.error("dodo_webhook error:", err);
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

- [ ] **Step 2: Type-check**

Run: `deno check supabase/functions/dodo_webhook/index.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/dodo_webhook/index.ts
git commit -m "feat(fn): dodo_webhook flips reading to paid on payment success"
```

---

### Task 6: `claim_garden` — mint/reveal the key, gated on payment

**Files:**
- Create: `supabase/functions/claim_garden/index.ts`

**Interfaces:**
- Consumes: body `{ reading_id, session_token, email? }`.
- Produces:
  - `409 { error: "not_paid" }` if `paid_at` is null.
  - `200 { paid: true, is_new_garden, garden_code, species, spread_type, seeker_id, status }`.
  - Mints exactly one seeker on first paid call (when `reading.seeker_id` is null); idempotent thereafter. Sends the code via Resend when `email` is present.

- [ ] **Step 1: Write the function**

Create `supabase/functions/claim_garden/index.ts`:

```ts
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json() as {
      reading_id?: string;
      session_token?: string;
      email?: string;
    };
    const { reading_id, session_token, email } = body;

    if (!reading_id || !session_token || !UUID.test(reading_id) || !UUID.test(session_token)) {
      return json({ error: "Invalid request" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: reading, error: readErr } = await admin
      .from("readings")
      .select("id, session_token, status, paid_at, seeker_id, spread_type, garden_code")
      .eq("id", reading_id)
      .single();

    if (readErr || !reading) return json({ error: "Reading not found" }, 404);
    if (reading.session_token !== session_token) return json({ error: "Forbidden" }, 403);
    if (!reading.paid_at) return json({ error: "not_paid" }, 409);

    // Derive species from the primary card (position 0).
    const { data: primaryCard } = await admin
      .from("reading_cards")
      .select("card_id")
      .eq("reading_id", reading.id)
      .eq("position", 0)
      .single();
    let species = "iris";
    if (primaryCard) {
      const { data: card } = await admin
        .from("cards").select("flower_species").eq("id", primaryCard.card_id).single();
      species = card?.flower_species ?? "iris";
    }

    let seekerId = reading.seeker_id as string | null;
    let gardenCode = reading.garden_code as string | null;
    let isNewGarden = false;

    if (!seekerId) {
      // First reading for this seeker: mint the garden + key now (post-payment).
      gardenCode = generateGardenCode();
      const gardenCodeHash = await hashCode(gardenCode);
      const { data: seeker, error: seekerErr } = await admin
        .from("seekers").insert({ garden_code_hash: gardenCodeHash }).select("id").single();
      if (seekerErr || !seeker) {
        console.error("insert seeker error:", seekerErr);
        return json({ error: "Failed to create garden" }, 500);
      }
      seekerId = seeker.id;
      isNewGarden = true;
      species = "iris"; // namesake flower for a brand-new garden

      const { error: updErr } = await admin
        .from("readings")
        .update({ seeker_id: seekerId, garden_code: gardenCode })
        .eq("id", reading.id);
      if (updErr) {
        console.error("attach seeker error:", updErr);
        return json({ error: "Failed to bind garden" }, 500);
      }
    }

    if (email && EMAIL_RE.test(email) && gardenCode) {
      await sendCodeEmail(email, gardenCode).catch((e) =>
        console.error("email send failed:", e)
      );
    }

    return json({
      paid: true,
      is_new_garden: isNewGarden,
      garden_code: gardenCode,
      species,
      spread_type: reading.spread_type,
      seeker_id: seekerId,
      status: reading.status,
    });
  } catch (err) {
    console.error("claim_garden error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});

async function hashCode(code: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateGardenCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const raw = Array.from(bytes).map((b) => chars[b % chars.length]).join("");
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

async function sendCodeEmail(to: string, code: string): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.error("RESEND_API_KEY missing; skipping email");
    return;
  }
  const appUrl = Deno.env.get("APP_URL") ?? Deno.env.get("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Iris Luna <readings@irisluna.app>",
      to,
      subject: "Your garden key",
      html: `
        <div style="background:#0A0A12;color:#ECE9F5;font-family:sans-serif;padding:40px;max-width:480px;margin:auto;border-radius:12px;">
          <h1 style="font-size:22px;margin-bottom:16px;">Your garden key</h1>
          <p style="color:#6C6A82;line-height:1.6;margin-bottom:24px;">
            Keep this safe. Enter it any time to return to your garden and your past readings.
          </p>
          <p style="font-size:28px;letter-spacing:6px;font-family:monospace;color:#B7AEEA;margin-bottom:28px;">
            ${code}
          </p>
          <a href="${appUrl}/recover"
             style="background:#7C6FCB;color:#ECE9F5;padding:14px 28px;border-radius:8px;text-decoration:none;display:inline-block;">
            Open my garden →
          </a>
        </div>
      `,
    }),
  });
  if (!res.ok) {
    console.error("resend error:", res.status, await res.text());
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
```

- [ ] **Step 2: Type-check**

Run: `deno check supabase/functions/claim_garden/index.ts`
Expected: no errors.

- [ ] **Step 3: Integration check (local)**

Run (in one terminal): `pnpm db:start` then `supabase functions serve --no-verify-jwt`

In another terminal, simulate the full server path against the local stack:

```bash
# 1. Insert a paid reading + a primary card directly (service role), capture ids
# Replace <DB_URL> with: supabase status -o env | grep DB_URL
psql "<DB_URL>" <<'SQL'
insert into readings (session_token, spread_type, question_audio_path, status, paid_at)
values (gen_random_uuid(), 'single', '00000000-0000-4000-8000-000000000000.webm', 'awaiting_response', now())
returning id, session_token;
SQL
```

Take the returned `id` + `session_token`, insert one reading_card at position 0, then:

```bash
curl -s -X POST http://localhost:54321/functions/v1/claim_garden \
  -H "Content-Type: application/json" \
  -d '{"reading_id":"<ID>","session_token":"<TOKEN>"}' | jq
```

Expected: `{ "paid": true, "is_new_garden": true, "garden_code": "XXXX-XXXX-XXXX", ... }`.
Run the same curl again — expect `is_new_garden: false` and the same `garden_code` (idempotent).
Insert an unpaid reading and curl it — expect `{ "error": "not_paid" }` with HTTP 409.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/claim_garden/index.ts
git commit -m "feat(fn): claim_garden mints+reveals garden key after payment"
```

---

### Task 7: `/deck` navigates to `/pay`

**Files:**
- Modify: `src/app/(seeker)/deck/page.tsx:31`

**Interfaces:**
- Produces: deck confirm routes to `/pay`.

- [ ] **Step 1: Update the route**

In `src/app/(seeker)/deck/page.tsx`, change line 31 from:

```ts
    router.push("/auth");
```

to:

```ts
    router.push("/pay");
```

- [ ] **Step 2: Commit** (build is verified in Task 8 once `/pay` exists)

```bash
git add src/app/(seeker)/deck/page.tsx
git commit -m "feat(ui): deck routes to /pay"
```

---

### Task 8: Rename `/auth` → `/pay` and rewrite as Dodo paywall

**Files:**
- Create: `src/app/(seeker)/pay/page.tsx`
- Delete: `src/app/(seeker)/auth/page.tsx`

**Interfaces:**
- Consumes: flow store (`blob`, `mimeType`, `durationMs`, `spreadType`, `positions`), `getSeeker`/`setSeeker` from `@/lib/session`, edge functions `get_upload_urls`, `submit_reading`, `create_checkout`, `restore_garden`.
- Produces: on "pay", creates a `pending_payment` reading then redirects to the Dodo checkout URL. Never calls `storeReading`. Optional garden-key entry attaches an existing seeker.

- [ ] **Step 1: Create the new page**

Create `src/app/(seeker)/pay/page.tsx`:

```tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useFlowStore } from "@/lib/flow/store";
import { getSeeker, setSeeker } from "@/lib/session";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const AMOUNT = process.env.NEXT_PUBLIC_PAYMENT_AMOUNT ?? "₱150";

function formatCode(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 12);
  if (clean.length > 8) return `${clean.slice(0, 4)}-${clean.slice(4, 8)}-${clean.slice(8)}`;
  if (clean.length > 4) return `${clean.slice(0, 4)}-${clean.slice(4)}`;
  return clean;
}

export default function PayPage() {
  const router = useRouter();
  const blob = useFlowStore((s) => s.blob);
  const mimeType = useFlowStore((s) => s.mimeType);
  const durationMs = useFlowStore((s) => s.durationMs);
  const spreadType = useFlowStore((s) => s.spreadType);
  const positions = useFlowStore((s) => s.positions);

  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Garden-key entry (returning users)
  const [showKeyEntry, setShowKeyEntry] = useState(false);
  const [code, setCode] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyOk, setKeyOk] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) router.replace("/ask");
  }, [blob, router]);

  async function attachKey() {
    if (code.length !== 14) return;
    setKeyBusy(true);
    setKeyError(null);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/restore_garden`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON_KEY}` },
        body: JSON.stringify({ garden_code: code }),
      });
      const data = await res.json() as { seeker_id?: string; error?: string };
      if (!res.ok || !data.seeker_id) {
        setKeyError(data.error ?? "No garden found for that code.");
        return;
      }
      setSeeker(data.seeker_id, code);
      setKeyOk(true);
    } catch {
      setKeyError("Something went wrong. Try again.");
    } finally {
      setKeyBusy(false);
    }
  }

  async function handlePay() {
    if (!blob) return;
    setSubmitting(true);
    setError(null);
    try {
      const edgeFn = (name: string) => `${SUPABASE_URL}/functions/v1/${name}`;
      const fnHeaders = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ANON_KEY}`,
      };

      // 1. signed upload URL (audio only)
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

      // 2. upload audio
      const audioUpload = await fetch(question_audio.upload_url, {
        method: "PUT",
        headers: { "Content-Type": mimeType },
        body: blob,
      });
      if (!audioUpload.ok) throw new Error("Upload failed");

      // 3. create the pending reading (attach seeker if a key was entered)
      const submitRes = await fetch(edgeFn("submit_reading"), {
        method: "POST",
        headers: fnHeaders,
        body: JSON.stringify({
          spread_type: spreadType ?? "three",
          positions,
          question_audio_path: question_audio.path,
          question_duration_ms: durationMs || null,
          email: email || undefined,
          seeker_id: getSeeker()?.seekerId,
        }),
      });
      if (!submitRes.ok) {
        const err = await submitRes.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Submission failed");
      }
      const { reading_id, session_token } = await submitRes.json() as {
        reading_id: string;
        session_token: string;
      };

      // 4. create Dodo checkout and redirect
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
      console.error("pay error:", err);
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  if (!blob) return null;

  return (
    <main className="flex flex-col items-center min-h-dvh px-6 pt-10 pb-20">
      <div className="w-full max-w-sm flex flex-col items-center">
        <motion.div
          className="w-full mb-10"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          <span className="font-display italic text-moonlight/70 tracking-tight leading-none" style={{ fontSize: 20 }}>
            iris luna
          </span>
        </motion.div>

        <motion.div
          className="text-center mb-8 w-full"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15, duration: 0.9, ease: "easeOut" }}
        >
          <p className="text-muted text-[10px] uppercase tracking-[0.2em] mb-3">an offering</p>
          <p className="font-display italic text-moonlight/80 text-xl leading-snug">
            The ritual asks for {AMOUNT}.
          </p>
          <p className="text-muted text-sm mt-2 leading-relaxed">
            A human will hear your question. This is how you reach them.
          </p>
        </motion.div>

        <Divider delay={0.3} />

        {/* Optional email — notify when answered */}
        <motion.div
          className="w-full mb-6"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.7 }}
        >
          <label htmlFor="pay-email" className="block text-muted text-[10px] uppercase tracking-[0.15em] mb-2">
            notify me when the human answers
          </label>
          <input
            id="pay-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com (optional)"
            className="w-full bg-transparent text-moonlight/80 text-sm px-3 py-2.5 rounded-md outline-none transition-colors placeholder:text-muted/40"
            style={{ border: "1px solid oklch(0.94 0.018 301 / 0.12)" }}
            autoComplete="email"
            inputMode="email"
          />
        </motion.div>

        {/* Returning user: attach existing garden */}
        <motion.div
          className="w-full mb-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.7 }}
        >
          {keyOk ? (
            <p className="text-[11px] uppercase tracking-[0.15em] text-center" style={{ color: "oklch(0.72 0.078 283)" }}>
              this reading will join your garden
            </p>
          ) : !showKeyEntry ? (
            <button
              type="button"
              onClick={() => setShowKeyEntry(true)}
              className="w-full text-muted/60 text-[11px] uppercase tracking-[0.15em] hover:text-muted transition-colors"
            >
              I already have a garden key
            </button>
          ) : (
            <div className="flex flex-col gap-3">
              <input
                type="text"
                inputMode="text"
                autoCapitalize="characters"
                spellCheck={false}
                value={code}
                onChange={(e) => { setKeyError(null); setCode(formatCode(e.target.value)); }}
                placeholder="ABCD-EFGH-JKLM"
                maxLength={14}
                className="w-full text-center bg-transparent text-moonlight/80 text-base font-mono tracking-[0.25em] px-3 py-2.5 rounded-md outline-none placeholder:text-muted/30"
                style={{ border: "1px solid oklch(0.94 0.018 301 / 0.14)" }}
                aria-label="Garden key"
              />
              {keyError && (
                <p className="text-xs text-center" style={{ color: "oklch(0.65 0.14 20)" }}>{keyError}</p>
              )}
              <button
                type="button"
                onClick={() => void attachKey()}
                disabled={code.length !== 14 || keyBusy}
                className="text-[11px] uppercase tracking-[0.15em] transition-colors"
                style={{ color: code.length === 14 && !keyBusy ? "oklch(0.72 0.078 283)" : "oklch(0.72 0.078 283 / 0.35)" }}
              >
                {keyBusy ? "checking…" : "attach garden"}
              </button>
            </div>
          )}
        </motion.div>

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

        <motion.button
          type="button"
          onClick={() => void handlePay()}
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
          {submitting ? "opening payment…" : `pay ${AMOUNT}`}
        </motion.button>

        <motion.p
          className="text-muted/50 text-[10px] text-center mt-4 leading-relaxed"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7, duration: 0.7 }}
        >
          If you leave without paying, this reading is released — nothing is saved until payment completes.
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
        background: "linear-gradient(to right, transparent, oklch(0.94 0.018 301 / 0.07), transparent)",
      }}
    />
  );
}
```

- [ ] **Step 2: Delete the old paywall**

```bash
git rm src/app/\(seeker\)/auth/page.tsx
```

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: build succeeds; `/pay` route compiles; no reference errors to the deleted `/auth`.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(seeker\)/pay/page.tsx
git commit -m "feat(ui): replace /auth screenshot paywall with /pay Dodo checkout"
```

---

### Task 9: `/key/[readingId]` — post-payment key reveal

**Files:**
- Create: `src/app/(seeker)/key/[readingId]/page.tsx`

**Interfaces:**
- Consumes: route param `readingId`, query `?token=`, edge function `claim_garden`, `storeReading`/`setSeeker` from `@/lib/session`, `FlowerSpecies` from `@/types/garden`.
- Produces: polls `claim_garden` until paid; on success calls `storeReading` (first device-garden entry) and shows the garden key + "email me the code"; routes to `/`.

- [ ] **Step 1: Create the page**

Create `src/app/(seeker)/key/[readingId]/page.tsx`:

```tsx
"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { storeReading, setSeeker } from "@/lib/session";
import type { FlowerSpecies } from "@/types/garden";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const POLL_MS = 3000;
const MAX_POLLS = 40; // ~2 minutes

interface ClaimResult {
  paid: boolean;
  is_new_garden: boolean;
  garden_code: string | null;
  species: string;
  spread_type: "single" | "three";
  seeker_id: string;
  status: string;
}

function KeyPageInner() {
  const { readingId } = useParams<{ readingId: string }>();
  const token = useSearchParams().get("token") ?? "";
  const router = useRouter();

  const [result, setResult] = useState<ClaimResult | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const pollsRef = useRef(0);
  const storedRef = useRef(false);

  const [emailInput, setEmailInput] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [copied, setCopied] = useState(false);

  const claim = useCallback(async (email?: string): Promise<ClaimResult | null> => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/claim_garden`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON_KEY}` },
      body: JSON.stringify({ reading_id: readingId, session_token: token, email }),
    });
    if (res.status === 409) return null; // not paid yet
    if (!res.ok) return null;
    return await res.json() as ClaimResult;
  }, [readingId, token]);

  // Poll until paid
  useEffect(() => {
    if (!token || !SUPABASE_URL) { setTimedOut(true); return; }
    let active = true;
    const tick = async () => {
      if (!active) return;
      const r = await claim();
      if (!active) return;
      if (r) { setResult(r); return; }
      pollsRef.current += 1;
      if (pollsRef.current >= MAX_POLLS) { setTimedOut(true); return; }
      setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => { active = false; };
  }, [claim, token]);

  // On first paid result, persist to device garden exactly once
  useEffect(() => {
    if (!result || storedRef.current) return;
    storedRef.current = true;
    setSeeker(result.seeker_id, result.garden_code ?? undefined);
    storeReading(readingId, token, result.spread_type, result.species as FlowerSpecies);
  }, [result, readingId, token]);

  async function handleEmail() {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailInput)) return;
    await claim(emailInput);
    setEmailSent(true);
  }

  async function handleCopy() {
    if (!result?.garden_code) return;
    await navigator.clipboard.writeText(result.garden_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Returning user (no new key): straight to the garden
  useEffect(() => {
    if (result && !result.is_new_garden) {
      const t = setTimeout(() => router.replace("/"), 1800);
      return () => clearTimeout(t);
    }
  }, [result, router]);

  if (timedOut && !result) {
    return (
      <main className="flex flex-col items-center justify-center min-h-dvh p-8 text-center">
        <p className="font-display italic text-moonlight/50 text-lg mb-3">payment not confirmed</p>
        <p className="text-muted text-sm mb-8 max-w-[280px] leading-relaxed">
          If you didn&apos;t complete payment, nothing was saved. If you did, give it a moment and refresh.
        </p>
        <Link href="/" className="text-muted/60 text-xs uppercase tracking-[0.18em] hover:text-muted transition-colors">
          ← return
        </Link>
      </main>
    );
  }

  if (!result) {
    return (
      <main className="flex flex-col items-center justify-center min-h-dvh p-8 text-center">
        <motion.div
          style={{ width: 8, height: 8, borderRadius: "50%", background: "#7C6FCB", boxShadow: "0 0 12px 3px #7C6FCB55" }}
          animate={{ opacity: [0.4, 1, 0.4], scale: [0.9, 1.1, 0.9] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        />
        <p className="font-display italic text-moonlight/60 text-lg mt-6">confirming payment…</p>
      </main>
    );
  }

  if (!result.is_new_garden) {
    return (
      <main className="flex flex-col items-center justify-center min-h-dvh p-8 text-center">
        <p className="font-display italic text-moonlight/70 text-lg mb-2">added to your garden</p>
        <p className="text-muted text-sm">taking you home…</p>
      </main>
    );
  }

  return (
    <main className="flex flex-col items-center justify-center min-h-dvh px-8 pb-16">
      <motion.div
        className="w-full max-w-xs flex flex-col items-center gap-7 text-center"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: "easeOut" }}
      >
        <div className="flex flex-col items-center gap-1">
          <span className="font-display italic text-moonlight/70 tracking-tight" style={{ fontSize: 22 }}>
            iris luna
          </span>
          <p className="text-muted text-[10px] uppercase tracking-[0.2em]">your garden key</p>
        </div>

        <p className="text-sm leading-relaxed" style={{ color: "rgba(183,174,234,0.55)" }}>
          Keep this safe. It is the only way back to your garden and your readings.
        </p>

        <button
          type="button"
          onClick={() => void handleCopy()}
          className="w-full font-mono text-xl tracking-[0.28em] text-moonlight/90 px-4 py-4 rounded-lg transition-colors"
          style={{ border: "1px solid rgba(124,111,203,0.4)", background: "rgba(124,111,203,0.06)" }}
          aria-label="Copy garden key"
        >
          {result.garden_code}
        </button>
        <p className="text-muted/50 text-[10px] uppercase tracking-[0.16em] -mt-4">
          {copied ? "copied" : "tap to copy"}
        </p>

        {/* Email me the code */}
        <div className="w-full flex flex-col gap-3">
          {emailSent ? (
            <p className="text-[11px] uppercase tracking-[0.15em]" style={{ color: "oklch(0.72 0.078 283)" }}>
              sent — check your inbox
            </p>
          ) : (
            <>
              <input
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="email me the code"
                className="w-full text-center bg-transparent text-moonlight/80 text-sm px-3 py-2.5 rounded-md outline-none placeholder:text-muted/40"
                style={{ border: "1px solid oklch(0.94 0.018 301 / 0.12)" }}
                autoComplete="email"
                inputMode="email"
              />
              <button
                type="button"
                onClick={() => void handleEmail()}
                className="text-[11px] uppercase tracking-[0.15em] text-muted/70 hover:text-muted transition-colors"
              >
                send it to me
              </button>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => router.replace("/")}
          className="w-full py-3 rounded-lg text-sm uppercase tracking-[0.18em] transition-all duration-300"
          style={{ background: "oklch(0.52 0.118 283)", color: "oklch(0.94 0.018 301)" }}
        >
          enter your garden
        </button>
      </motion.div>
    </main>
  );
}

export default function KeyPage() {
  return (
    <Suspense>
      <KeyPageInner />
    </Suspense>
  );
}
```

- [ ] **Step 2: Build**

Run: `pnpm build`
Expected: build succeeds; `/key/[readingId]` route compiles.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(seeker\)/key/\[readingId\]/page.tsx
git commit -m "feat(ui): /key reveals garden key after payment + email option"
```

---

### Task 10: Admin reading detail — Dodo status panel (drop screenshot + manual verify)

**Files:**
- Modify: `src/app/admin/[readingId]/page.tsx`

**Interfaces:**
- Consumes: `readings` row fields `paid_at`, `dodo_payment_id`, `payment_amount`, `payment_currency` (already in `types.ts`).
- Produces: admin detail shows payment status from Dodo fields; removes the screenshot image, its signed-URL fetch, and the verify/reject buttons.

- [ ] **Step 1: Read the current file to locate the exact regions**

Run: `sed -n '1,200p' src/app/admin/\[readingId\]/page.tsx`
Then read the rest to see the verify/reject handlers and the screenshot render block (~lines 285–375).

- [ ] **Step 2: Remove the screenshot signed-URL fetch**

In the `Promise.all` (around line 96), delete the `payment-screenshots` `createSignedUrl` call and the `screenshotUrl` field it feeds (around line 138). Replace `payment_screenshot_path` in the `.select(...)` string (line 83) with `paid_at, dodo_payment_id, payment_amount, payment_currency`. Remove `payment_screenshot_path` and `screenshotUrl` from the local view types (lines 19, 48).

Concretely, the select string becomes:

```ts
        "id, status, spread_type, created_at, email, question_audio_path, question_duration_ms, paid_at, dodo_payment_id, payment_amount, payment_currency, payment_verified_at, response_audio_path, claimed_by, claimed_at"
```

- [ ] **Step 3: Remove the verify/reject action and its fetch**

Delete the handler that POSTs to `verify_payment` (around line 161) and the buttons that call it. Payment is now confirmed by the Dodo webhook, so no manual verify control is needed.

- [ ] **Step 4: Replace the screenshot render block with a payment-status panel**

Replace the `{screenshotUrl ? (...) : (...)}` block (around lines 358–372) with:

```tsx
        <div className="rounded-lg p-4" style={{ border: "1px solid rgba(124,111,203,0.2)" }}>
          <p className="text-muted/60 text-[10px] uppercase tracking-[0.15em] mb-2">payment</p>
          {reading.paid_at ? (
            <div className="text-sm text-moonlight/80 space-y-1">
              <p>Paid {new Date(reading.paid_at).toLocaleString()}</p>
              {reading.payment_amount != null && (
                <p className="text-muted">
                  {(reading.payment_amount / 100).toFixed(2)} {reading.payment_currency ?? ""}
                </p>
              )}
              {reading.dodo_payment_id && (
                <p className="text-muted/50 text-xs font-mono break-all">{reading.dodo_payment_id}</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted/60">Awaiting payment.</p>
          )}
        </div>
```

Add the corresponding fields to the local `reading` view type (where `payment_screenshot_path` was, around line 19):

```ts
  paid_at: string | null;
  dodo_payment_id: string | null;
  payment_amount: number | null;
  payment_currency: string | null;
```

And in the object built around line 138 (where `screenshotUrl` was), map them through from the fetched row:

```ts
      paid_at: reading.paid_at,
      dodo_payment_id: reading.dodo_payment_id,
      payment_amount: reading.payment_amount,
      payment_currency: reading.payment_currency,
```

Finally update the destructure around line 285 from `{ reading, screenshotUrl, questionAudioUrl }` to `{ reading, questionAudioUrl }`.

- [ ] **Step 5: Build**

Run: `pnpm build`
Expected: build succeeds; no remaining references to `screenshotUrl`, `payment_screenshot_path`, or `verify_payment` in `src/app/admin/[readingId]/page.tsx`.

Run: `grep -n "screenshot\|verify_payment" src/app/admin/\[readingId\]/page.tsx`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/\[readingId\]/page.tsx
git commit -m "feat(admin): show Dodo payment status, drop screenshot+manual verify"
```

---

### Task 11: Env docs + full integration walkthrough

**Files:**
- Modify: `.env.example`

**Interfaces:**
- Produces: documented env vars for the Dodo + key flow.

- [ ] **Step 1: Update `.env.example`**

Replace `.env.example` contents with:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
RESEND_API_KEY=
NEXT_PUBLIC_APP_URL=http://localhost:3000
APP_URL=http://localhost:3000

# Payment display
NEXT_PUBLIC_PAYMENT_AMOUNT=₱150

# Dodo Payments (server-side edge function secrets)
DODO_PAYMENTS_API_KEY=
DODO_PAYMENTS_ENVIRONMENT=test_mode
DODO_PRODUCT_ID=
DODO_WEBHOOK_SECRET=
```

- [ ] **Step 2: Manual end-to-end walkthrough (local)**

Start the app and stack, then walk the happy path and the abandon path.

```bash
pnpm db:reset
supabase functions serve --no-verify-jwt
pnpm dev
```

Happy path (first-time seeker):
1. Visit `/`, complete onboarding if prompted, record a question, pick a spread, draw cards → lands on `/pay`.
2. On `/pay`, click "pay …" → redirected to Dodo test checkout. Complete the test payment.
   - Trigger the webhook (Dodo test dashboard "send test event" or `curl` a signed `payment.succeeded` to `/functions/v1/dodo_webhook` with `metadata.reading_id` set to the reading you just created).
3. Dodo returns to `/key/<id>?token=<token>` → "confirming payment…" → garden key appears.
4. Tap the key (copies), enter an email and "send it to me" (check the Resend dashboard/log), then "enter your garden".
5. On `/` the new flower (iris) is present. Note the garden key.

Abandon path:
6. Start a new reading, reach `/pay`, then navigate away without paying. Confirm: `/` shows no new flower, and the reading row stays `pending_payment` (it will be expired by cron). The disclaimer was visible on `/pay`.

Returning-user path:
7. Start a third reading; on `/pay` choose "I already have a garden key", enter the key from step 5, "attach garden", then pay. After the webhook, `/key` shows "added to your garden" and routes home; the flower joins the existing garden.

Expected: all three paths behave as described; no garden key is ever shown before payment.

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "docs(env): add Dodo + key flow environment variables"
```

---

## Notes for the implementer

- Deploy the new/changed edge functions before testing against a remote project:
  `supabase functions deploy submit_reading get_upload_urls create_checkout dodo_webhook claim_garden`
- Register the Dodo webhook endpoint (`/functions/v1/dodo_webhook`) in the Dodo dashboard and set `DODO_WEBHOOK_SECRET` to the signing secret it issues.
- `verify_payment` edge function is left in place for emergency manual override but is no longer in the seeker happy path; it can be removed in a later cleanup.
- The `payment-screenshots` storage bucket is now unused by the seeker flow; leave it for historical rows.
