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
