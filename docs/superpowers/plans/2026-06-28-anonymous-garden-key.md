# Anonymous Garden Key Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give seekers durable, cross-device access to all past readings via one anonymous garden key, with no signup.

**Architecture:** A `seekers` table owns readings via `readings.seeker_id`. A `seeker_id` (localStorage) is the device credential; a hashed `garden_code` is the human restore credential. `submit_reading` mints/links the seeker; new `restore_garden` rebuilds the whole garden from a code. Replaces the per-reading `recovery_code` mechanism. All seeker DB access stays in service-role edge functions (no seeker JWT/RLS).

**Tech Stack:** Next.js 16 (App Router, TS), Supabase (Postgres + Edge Functions/Deno), Zustand, localStorage, Tailwind v4, Framer Motion.

## Global Constraints

- Next.js 16 — read `node_modules/next/dist/docs/` before writing app code; middleware is `proxy.ts`; heed deprecations (per `iris-luna/AGENTS.md`).
- Seekers have NO Supabase Auth session/JWT/RLS. All seeker DB ops go through service-role edge functions.
- Card identities and audio paths must NEVER be returned to the seeker before `status = 'responded'`.
- Garden code format: `XXXX-XXXX-XXXX`, charset `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (32 chars, ~2^60), SHA-256 hashed at rest. Regex: `/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/`.
- Restore lockout: 10 failed attempts → 429.
- Pre-launch: no production readings to preserve — dropping `recovery_code` is acceptable.
- Verification gates: `deno check <fn>/index.ts` for edge functions; `pnpm build` (which type-checks) for the app. Commit after each green task.

---

### Task 1: DB migration — seekers table + seeker_id, retire recovery_code

**Files:**
- Create: `supabase/migrations/20260628000001_garden_key.sql`

**Interfaces:**
- Produces: table `seekers(id uuid pk, garden_code_hash text unique not null, restore_attempts int default 0, created_at timestamptz)`; column `readings.seeker_id uuid references seekers(id)`; removes `readings.recovery_code`, `readings.recovery_attempts`.

- [ ] **Step 1: Write the migration**

```sql
-- Anonymous garden key: one seeker owns all their readings.
create table if not exists public.seekers (
  id               uuid primary key default gen_random_uuid(),
  garden_code_hash text not null unique,
  restore_attempts int  not null default 0,
  created_at       timestamptz default now()
);

alter table public.seekers enable row level security;
-- No anon/seeker policies: access is service-role only via edge functions.

alter table public.readings
  add column if not exists seeker_id uuid references public.seekers(id) on delete set null;

create index if not exists readings_seeker_id_idx on public.readings (seeker_id);

-- Retire the per-reading recovery mechanism (superseded by the garden code).
alter table public.readings drop column if exists recovery_code;
alter table public.readings drop column if exists recovery_attempts;
```

- [ ] **Step 2: Verify it applies on a clean local DB**

Run: `pnpm db:reset`
Expected: reset completes, all migrations apply with no error; output lists `20260628000001_garden_key`.
(If local Supabase/Docker is unavailable, instead run `supabase db lint` or visually confirm SQL parity; note in commit.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260628000001_garden_key.sql
git commit -m "feat(db): seekers table + readings.seeker_id, retire recovery_code"
```

---

### Task 2: `submit_reading` — mint/link seeker, return garden key

**Files:**
- Modify: `supabase/functions/submit_reading/index.ts`

**Interfaces:**
- Consumes: `seekers`, `readings.seeker_id` from Task 1.
- Produces: request body now accepts optional `seeker_id?: string`; response shape `{ reading_id, session_token, seeker_id, garden_code?, species }` (`garden_code` present only when a new seeker was minted). Removes `recovery_code` from response.

- [ ] **Step 1: Replace recovery-code logic with seeker logic**

In `index.ts`, extend the body type and destructure to add `seeker_id`:

```ts
const body = await req.json() as {
  spread_type: "single" | "three";
  positions: number[];
  question_audio_path: string;
  question_duration_ms?: number;
  payment_screenshot_path?: string;
  email?: string;
  is_first_reading?: boolean;
  seeker_id?: string;
};
```

Remove the `recoveryCode`/`recoveryCodeHash` lines. After creating the admin client and before inserting the reading, resolve the seeker:

```ts
// Resolve or mint the seeker (anonymous garden owner).
let seekerId: string | null = null;
let gardenCode: string | undefined;

if (body.seeker_id) {
  const { data: existing } = await admin
    .from("seekers").select("id").eq("id", body.seeker_id).single();
  if (existing) seekerId = existing.id;
}

if (!seekerId) {
  gardenCode = generateGardenCode();
  const gardenCodeHash = await hashCode(gardenCode);
  const { data: seeker, error: seekerErr } = await admin
    .from("seekers").insert({ garden_code_hash: gardenCodeHash }).select("id").single();
  if (seekerErr || !seeker) {
    console.error("insert seeker error:", seekerErr);
    return json({ error: "Failed to create seeker" }, 500);
  }
  seekerId = seeker.id;
}
```

In the `readings` insert object, replace `recovery_code: recoveryCodeHash,` with `seeker_id: seekerId,`.

- [ ] **Step 2: Update the response and helper**

Change the success return to:

```ts
return json({
  reading_id: reading.id,
  session_token: sessionToken,
  seeker_id: seekerId,
  garden_code: gardenCode,
  species,
});
```

Rename the code generator to `generateGardenCode` (body unchanged — same charset/entropy):

```ts
// XXXX-XXXX-XXXX from unambiguous chars — 32^12 ≈ 2^60, no modulo bias
function generateGardenCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const raw = Array.from(bytes).map((b) => chars[b % chars.length]).join("");
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}
```

Keep `hashCode` as-is.

- [ ] **Step 3: Type-check the function**

Run: `deno check supabase/functions/submit_reading/index.ts`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/submit_reading/index.ts
git commit -m "feat(fn): submit_reading mints/links seeker, returns garden_code"
```

---

### Task 3: New `restore_garden` function, delete `recover_reading`

**Files:**
- Create: `supabase/functions/restore_garden/index.ts`
- Delete: `supabase/functions/recover_reading/index.ts`

**Interfaces:**
- Consumes: `seekers`, `readings.seeker_id` from Task 1.
- Produces: POST `restore_garden` with `{ recovery_code }` (the garden code) → `{ seeker_id, readings: Array<{ reading_id, session_token, status, spread_type, species, created_at }> }`; 400 bad format, 404 not found, 429 locked.

- [ ] **Step 1: Write `restore_garden/index.ts`**

```ts
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CODE_RE = /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/;
const MAX_ATTEMPTS = 10;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { garden_code } = await req.json() as { garden_code?: string };
    if (!garden_code || !CODE_RE.test(garden_code.toUpperCase())) {
      return json({ error: "Invalid code format" }, 400);
    }

    const codeHash = await hashCode(garden_code.toUpperCase());
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: seeker, error } = await admin
      .from("seekers").select("id, restore_attempts").eq("garden_code_hash", codeHash).single();

    if (error || !seeker) return json({ error: "No garden found for that code" }, 404);
    if (seeker.restore_attempts >= MAX_ATTEMPTS) {
      return json({ error: "Code is locked after too many failed attempts" }, 429);
    }

    await admin.from("seekers")
      .update({ restore_attempts: seeker.restore_attempts + 1 }).eq("id", seeker.id);

    const { data: readings } = await admin
      .from("readings")
      .select("id, session_token, status, spread_type, created_at")
      .eq("seeker_id", seeker.id)
      .order("created_at", { ascending: true });

    return json({
      seeker_id: seeker.id,
      readings: (readings ?? []).map((r) => ({
        reading_id: r.id,
        session_token: r.session_token,
        status: r.status,
        spread_type: r.spread_type,
        created_at: r.created_at,
      })),
    });
  } catch (err) {
    console.error("restore_garden error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});

async function hashCode(code: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
```

> Note: `species` is not stored on `readings` (it is derived client-side / from the primary card). `restore_garden` omits it; the client recomputes species deterministically in `session.ts` (Task 4) when rebuilding.

- [ ] **Step 2: Delete the superseded function**

```bash
git rm -r supabase/functions/recover_reading
```

- [ ] **Step 3: Type-check**

Run: `deno check supabase/functions/restore_garden/index.ts`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/restore_garden/index.ts
git commit -m "feat(fn): restore_garden returns whole garden; remove recover_reading"
```

---

### Task 4: `session.ts` — seeker store + restoreGarden, drop per-reading code

**Files:**
- Modify: `src/lib/session.ts`

**Interfaces:**
- Consumes: `restore_garden` response shape from Task 3.
- Produces: `getSeeker(): { seekerId: string; gardenCode?: string } | null`; `setSeeker(seekerId: string, gardenCode?: string): void`; `restoreGarden(readings: Array<{ readingId: string; sessionToken: string; status: ReadingStatus; spreadType: "single"|"three"; createdAt: number }>): void`. `storeReading` loses its `recoveryCode` param; `StoredReading` loses `recoveryCode`.

- [ ] **Step 1: Remove `recoveryCode` from the model**

In `StoredReading` interface, delete the `recoveryCode?: string;` line. In `storeReading`, remove the `recoveryCode?: string` parameter and the `recoveryCode,` field in the constructed object.

- [ ] **Step 2: Add the seeker store**

Add near the top constants:

```ts
const SEEKER_KEY = "il_seeker";

export interface SeekerIdentity {
  seekerId: string;
  gardenCode?: string;
}

export function getSeeker(): SeekerIdentity | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SEEKER_KEY);
    return raw ? (JSON.parse(raw) as SeekerIdentity) : null;
  } catch {
    return null;
  }
}

export function setSeeker(seekerId: string, gardenCode?: string): void {
  if (typeof window === "undefined") return;
  const existing = getSeeker();
  // Keep an already-known gardenCode if this call doesn't carry one.
  const next: SeekerIdentity = { seekerId, gardenCode: gardenCode ?? existing?.gardenCode };
  localStorage.setItem(SEEKER_KEY, JSON.stringify(next));
}
```

- [ ] **Step 3: Add `restoreGarden`**

Append:

```ts
export function restoreGarden(
  readings: Array<{
    readingId: string;
    sessionToken: string;
    status: ReadingStatus;
    spreadType: "single" | "three";
    createdAt: number;
  }>,
): void {
  if (typeof window === "undefined") return;
  const existing = getStoredReadings();
  const byId = new Map(existing.map((r) => [r.readingId, r]));

  for (const r of readings) {
    const h = hash(r.readingId);
    const prior = byId.get(r.readingId);
    const species: FlowerSpecies =
      prior?.species ?? (byId.size === 0 ? "iris" : SPECIES[1 + (h % (SPECIES.length - 1))]);
    byId.set(r.readingId, {
      readingId: r.readingId,
      sessionToken: r.sessionToken,
      species,
      stage: readingStageFor(r.status),
      status: r.status,
      spreadType: r.spreadType,
      xNorm: 0.1 + ((h >>> 8) & 0xffff) / 0xffff * 0.8,
      yNorm: 0.2 + ((h >>> 16) & 0xffff) / 0xffff * 0.6,
      lean: ((h % 200) - 100) / 1000,
      scale: 0.85 + (h % 30) / 100,
      createdAt: r.createdAt,
    });
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...byId.values()]));
}

function readingStageFor(status: ReadingStatus): FlowerStage {
  if (status === "revealed") return "bloom";
  if (status === "responded") return "bud";
  if (status === "expired") return "expired";
  return "bud";
}
```

Add `readingStatusToStage` is already in `@/types/garden`; if it covers these, import and use it instead of `readingStageFor`. Verify in Step 4; prefer the existing helper to stay DRY.

- [ ] **Step 4: Reconcile stage helper (DRY)**

Run: `grep -n "readingStatusToStage" src/types/garden.ts`
If it exists and maps status→stage, delete the local `readingStageFor` and use `readingStatusToStage(r.status)` (already imported in wait page; import it here too). Expected: one stage-mapping helper in the codebase.

- [ ] **Step 5: Type-check via build of the lib (fast tsc)**

Run: `pnpm exec tsc --noEmit`
Expected: no errors referencing `session.ts`. (Callers using the old `recoveryCode` param will error here — that's expected and fixed in Tasks 5–6; if running standalone, scope expectation to session.ts diagnostics.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/session.ts
git commit -m "feat(session): seeker identity store + restoreGarden, drop per-reading code"
```

---

### Task 5: Paywall commit — pass + persist seeker identity

**Files:**
- Modify: `src/app/(seeker)/auth/page.tsx`

**Interfaces:**
- Consumes: `getSeeker`, `setSeeker` from Task 4; `submit_reading` response `{ reading_id, session_token, seeker_id, garden_code?, species }` from Task 2.

- [ ] **Step 1: Import the seeker helpers**

Change the session import line to:

```ts
import { storeReading, getStoredReadings, getSeeker, setSeeker } from "@/lib/session";
```

- [ ] **Step 2: Send `seeker_id` in the submit body**

In `handleSubmit`, add to the `submit_reading` request body (after `is_first_reading: isFirstReading,`):

```ts
          seeker_id: getSeeker()?.seekerId,
```

- [ ] **Step 3: Persist returned identity, drop recovery_code from storeReading**

Replace the response destructure + store block with:

```ts
      const { reading_id, session_token, seeker_id, garden_code, species } = await submitRes.json() as {
        reading_id: string;
        session_token: string;
        seeker_id: string;
        garden_code?: string;
        species?: string;
      };

      setSeeker(seeker_id, garden_code);
      storeReading(reading_id, session_token, spreadType ?? "three", species as import("@/types/garden").FlowerSpecies | undefined);
      clear();
      router.push(`/wait/${reading_id}`);
```

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: compiles; `/auth` route builds. (Wait/recover/settings may still error until Task 6 — acceptable mid-task; if so, confirm the only errors are in those three files.)

- [ ] **Step 5: Commit**

```bash
git add "src/app/(seeker)/auth/page.tsx"
git commit -m "feat(paywall): thread seeker_id + garden_code through commit"
```

---

### Task 6: Recover → restore garden; wait + settings garden-key UI

**Files:**
- Modify: `src/app/(seeker)/recover/page.tsx`
- Modify: `src/app/(seeker)/wait/[readingId]/page.tsx`
- Modify: `src/app/(seeker)/settings/page.tsx`

**Interfaces:**
- Consumes: `restore_garden` (Task 3); `restoreGarden`, `getSeeker` (Task 4).

- [ ] **Step 1: Rewrite `/recover` to restore the whole garden**

In `recover/page.tsx`, import `restoreGarden` instead of `storeReading`:

```ts
import { restoreGarden } from "@/lib/session";
```

Replace the fetch + success block in `handleSubmit` with:

```ts
      const res = await fetch(`${SUPABASE_URL}/functions/v1/restore_garden`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON_KEY}` },
        body: JSON.stringify({ garden_code: code }),
      });

      const data = await res.json() as {
        seeker_id?: string;
        readings?: Array<{ reading_id: string; session_token: string; status: string; spread_type: "single" | "three"; created_at: string }>;
        error?: string;
      };

      if (!res.ok || !data.seeker_id) {
        setError(data.error ?? "No garden found for that code.");
        setLoading(false);
        return;
      }

      setSeeker(data.seeker_id, code);
      restoreGarden((data.readings ?? []).map((r) => ({
        readingId: r.reading_id,
        sessionToken: r.session_token,
        status: r.status as import("@/lib/supabase/types").ReadingStatus,
        spreadType: r.spread_type,
        createdAt: new Date(r.created_at).getTime(),
      })));

      router.replace(`/`);
```

Add `setSeeker` to the import. Update the two copy lines: heading `restore your garden`, and the paragraph to `Enter your garden code to bring back every reading on this device.`

- [ ] **Step 2: Remove the per-reading recovery block from the wait screen**

In `wait/[readingId]/page.tsx`, delete the entire `{reading.recoveryCode && reading.status === "pending_payment" && ( … )}` motion block (the "recovery code" display). Remove now-unused references; `storeReading` import stays (used by the deep-link path).

- [ ] **Step 3: Add a garden-key section to Settings**

In `settings/page.tsx`, import and surface the garden code:

```ts
import { getSeeker } from "@/lib/session";
```

Render (inside the settings list, client-side; guard for SSR by reading in `useEffect` into state):

```tsx
{gardenCode && (
  <section className="w-full flex flex-col items-center gap-1 mt-8">
    <p className="text-[9px] uppercase tracking-[0.18em]" style={{ color: "rgba(108,106,130,0.5)" }}>
      your garden key
    </p>
    <p className="font-mono text-base tracking-[0.22em]" style={{ color: "rgba(183,174,234,0.6)" }}>
      {gardenCode}
    </p>
    <p className="text-[9px] text-center max-w-[220px] leading-relaxed mt-1" style={{ color: "rgba(108,106,130,0.4)" }}>
      save this to restore your garden on another device
    </p>
  </section>
)}
```

with:

```tsx
const [gardenCode, setGardenCode] = useState<string | null>(null);
useEffect(() => { setGardenCode(getSeeker()?.gardenCode ?? null); }, []);
```

(Match the existing Settings file's component style; if it is a server component, add `"use client"` only if not already present — check first.)

- [ ] **Step 4: Full build**

Run: `pnpm build`
Expected: clean compile, no type errors, all seeker routes build.

- [ ] **Step 5: Grep for dead references**

Run: `grep -rni "recovery_code\|recoveryCode\|recover_reading\|recovery_attempts" src supabase`
Expected: no matches.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(seeker)/recover/page.tsx" "src/app/(seeker)/wait/[readingId]/page.tsx" "src/app/(seeker)/settings/page.tsx"
git commit -m "feat(ui): garden-key restore flow + settings key, drop per-reading recovery"
```

---

### Task 7: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Build is green**

Run: `pnpm build`
Expected: success, no errors/warnings about the changed files.

- [ ] **Step 2: Edge functions type-check**

Run: `deno check supabase/functions/submit_reading/index.ts supabase/functions/restore_garden/index.ts`
Expected: no errors.

- [ ] **Step 3: (If local Supabase available) functional smoke**

Run: `pnpm db:reset && pnpm functions:serve` (in one shell), then in another:
- `curl` `submit_reading` with no `seeker_id` → response includes `seeker_id` + `garden_code`.
- `curl` `submit_reading` again with that `seeker_id` → links, no new `garden_code`.
- `curl` `restore_garden` with the `garden_code` → returns both readings.
Expected: behaviors match; card identities absent from both responses.
(If Docker/local stack unavailable, note as deferred to deploy verification.)

- [ ] **Step 4: Final commit (if any verification fixups)**

```bash
git add -A && git commit -m "chore: garden-key e2e verification fixups" || echo "nothing to commit"
```
