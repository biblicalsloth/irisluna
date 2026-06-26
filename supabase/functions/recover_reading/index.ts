import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CODE_RE = /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/;
const MAX_ATTEMPTS = 10;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { recovery_code } = await req.json() as { recovery_code?: string };

    if (!recovery_code || !CODE_RE.test(recovery_code.toUpperCase())) {
      return json({ error: "Invalid code format" }, 400);
    }

    const normalised = recovery_code.toUpperCase();

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: reading, error } = await admin
      .from("readings")
      .select("id, session_token, spread_type, status, recovery_attempts")
      .eq("recovery_code", normalised)
      .single();

    if (error || !reading) {
      return json({ error: "No reading found for that code" }, 404);
    }

    if (reading.recovery_attempts >= MAX_ATTEMPTS) {
      return json({ error: "Code is locked after too many failed attempts" }, 429);
    }

    // Increment attempt counter (reset on success by NOT resetting — attempts only go up)
    await admin
      .from("readings")
      .update({ recovery_attempts: reading.recovery_attempts + 1 })
      .eq("id", reading.id);

    return json({
      reading_id: reading.id,
      session_token: reading.session_token,
      spread_type: reading.spread_type,
      status: reading.status,
    });
  } catch (err) {
    console.error("recover_reading error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
