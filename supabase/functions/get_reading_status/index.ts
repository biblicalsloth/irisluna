import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Seeker-facing polling endpoint — no auth required.
// Validates ownership via session_token and returns only what the seeker needs.
// Card identities are NEVER returned until status = 'responded' or 'revealed'.

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

    // Validate ownership
    const { data: reading, error } = await admin
      .from("readings")
      .select("id, status, responded_at, expires_at")
      .eq("id", reading_id)
      .eq("session_token", session_token)
      .single();

    if (error || !reading) {
      // Return 404 without revealing whether the reading exists
      return json({ error: "Not found" }, 404);
    }

    // Build response — no card identities, no audio until responded
    const payload: Record<string, unknown> = {
      status: reading.status,
      expires_at: reading.expires_at,
    };

    if (reading.responded_at) {
      payload.responded_at = reading.responded_at;
    }

    return json(payload);
  } catch (err) {
    console.error("get_reading_status error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
