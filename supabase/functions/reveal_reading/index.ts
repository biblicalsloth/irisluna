import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Called by the reveal page to:
// 1. Verify session_token ownership
// 2. Mark reading as revealed
// 3. Return card assignments + signed response audio URL

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json() as {
      reading_id: string;
      session_token: string;
    };

    const { reading_id, session_token } = body;

    if (!reading_id || !session_token) {
      return json({ error: "Missing reading_id or session_token" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Fetch reading and verify ownership
    const { data: reading, error: readErr } = await admin
      .from("readings")
      .select("id, session_token, status, response_audio_path, spread_type")
      .eq("id", reading_id)
      .eq("session_token", session_token)
      .single();

    if (readErr || !reading) return json({ error: "Not found" }, 404);
    if (!["responded", "revealed"].includes(reading.status)) {
      return json({ error: "Reading is not ready to reveal" }, 409);
    }

    // Mark as revealed (idempotent)
    if (reading.status === "responded") {
      await admin
        .from("readings")
        .update({ status: "revealed", revealed_at: new Date().toISOString() })
        .eq("id", reading_id);
    }

    // Fetch assigned cards
    const { data: cards, error: cardsErr } = await admin
      .from("reading_cards")
      .select("position, is_reversed, cards(id, name, arcana, suit, number, upright_meaning, reversed_meaning, keywords, image_path)")
      .eq("reading_id", reading_id)
      .order("position");

    if (cardsErr) {
      console.error("fetch cards error:", cardsErr);
      return json({ error: "Failed to load cards" }, 500);
    }

    // Generate signed URL for response audio (valid 1 hour)
    let responseAudioUrl: string | null = null;
    if (reading.response_audio_path) {
      const { data: signedData } = await admin.storage
        .from("response-audio")
        .createSignedUrl(reading.response_audio_path, 3600);
      responseAudioUrl = signedData?.signedUrl ?? null;
    }

    return json({
      spread_type: reading.spread_type,
      cards: (cards ?? []).map((rc) => ({
        position: rc.position,
        is_reversed: rc.is_reversed,
        ...(rc.cards as object),
      })),
      response_audio_url: responseAudioUrl,
    });
  } catch (err) {
    console.error("reveal_reading error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
