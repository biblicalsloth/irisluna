import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CODE_RE = /^[A-Z2-9]{3}-[A-Z2-9]{3}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { recovery_code } = await req.json() as { recovery_code?: string };

    if (!recovery_code || !CODE_RE.test(recovery_code.toUpperCase())) {
      return json({ error: "Invalid code format" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: reading, error } = await admin
      .from("readings")
      .select("id, session_token, spread_type, status")
      .eq("recovery_code", recovery_code.toUpperCase())
      .single();

    if (error || !reading) {
      return json({ error: "No reading found for that code" }, 404);
    }

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
