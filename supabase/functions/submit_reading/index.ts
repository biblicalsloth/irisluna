import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Paths must be UUID.ext — the exact shape get_upload_urls generates.
// Prevents callers from injecting arbitrary storage paths.
const VALID_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webm|mp4|png|jpg|jpeg)$/;

// Cryptographically secure random number in [0, 1)
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
      payment_screenshot_path: string;
      email?: string;
      is_first_reading?: boolean;
    };

    const {
      spread_type,
      positions,
      question_audio_path,
      question_duration_ms,
      payment_screenshot_path,
      email,
      is_first_reading,
    } = body;

    if (!spread_type || !question_audio_path || !payment_screenshot_path || !positions?.length) {
      return json({ error: "Missing required fields" }, 400);
    }

    // Validate paths match the UUID.ext pattern from get_upload_urls
    if (!VALID_PATH.test(question_audio_path)) {
      return json({ error: "Invalid audio path" }, 400);
    }
    if (!VALID_PATH.test(payment_screenshot_path)) {
      return json({ error: "Invalid screenshot path" }, 400);
    }

    // Validate positions are non-negative integers
    if (!positions.every((p) => Number.isInteger(p) && p >= 0 && p < 20)) {
      return json({ error: "Invalid positions" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const sessionToken = crypto.randomUUID();
    const recoveryCode = generateRecoveryCode();
    const pickCount = spread_type === "single" ? 1 : 3;

    // Create reading row
    const { data: reading, error: readingErr } = await admin
      .from("readings")
      .insert({
        session_token: sessionToken,
        recovery_code: recoveryCode,
        spread_type,
        question_audio_path,
        question_duration_ms: question_duration_ms ?? null,
        payment_screenshot_path,
        email: email || null,
        status: "pending_payment",
      })
      .select("id")
      .single();

    if (readingErr || !reading) {
      console.error("insert reading error:", readingErr);
      return json({ error: "Failed to create reading" }, 500);
    }

    // Fetch all cards (id + flower_species for the primary card)
    const { data: allCards, error: cardsErr } = await admin
      .from("cards")
      .select("id, flower_species");

    if (cardsErr || !allCards) {
      return json({ error: "Failed to load deck" }, 500);
    }

    // Build id→species map before shuffling
    const speciesMap: Record<number, string | null> = {};
    for (const c of allCards as { id: number; flower_species: string | null }[]) {
      speciesMap[c.id] = c.flower_species;
    }

    // Fisher-Yates shuffle using CSPRNG
    const deck: number[] = allCards.map((c: { id: number }) => c.id);
    for (let i = deck.length - 1; i > 0; i--) {
      // Rejection-sample to avoid modulo bias
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

    // Insert sealed reading_cards — 50/50 orientation per spec
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

    // Species from primary card's flower_species (position 0).
    // First reading is always iris — the namesake flower.
    const primaryCardId = chosen[0];
    const species = is_first_reading ? "iris" : (speciesMap[primaryCardId] ?? "iris");

    return json({
      reading_id: reading.id,
      session_token: sessionToken,
      recovery_code: recoveryCode,
      species,
    });
  } catch (err) {
    console.error("submit_reading error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});

// XXXX-XXXX-XXXX from unambiguous chars — 32^12 ≈ 2^60, no modulo bias
function generateRecoveryCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const raw = Array.from(bytes).map((b) => chars[b % chars.length]).join("");
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
