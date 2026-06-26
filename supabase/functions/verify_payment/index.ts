import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Verify reader/admin is authenticated
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const { data: profile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile || !["reader", "admin"].includes(profile.role)) {
      return json({ error: "Forbidden" }, 403);
    }

    const body = await req.json() as {
      reading_id: string;
      action: "verify" | "reject";
    };

    const { reading_id, action } = body;

    if (!reading_id || !["verify", "reject"].includes(action)) {
      return json({ error: "Invalid request" }, 400);
    }

    // Confirm reading is still pending_payment
    const { data: reading, error: readErr } = await admin
      .from("readings")
      .select("id, status")
      .eq("id", reading_id)
      .single();

    if (readErr || !reading) return json({ error: "Reading not found" }, 404);
    if (reading.status !== "pending_payment") {
      return json({ error: "Reading is not pending payment" }, 409);
    }

    const newStatus = action === "verify" ? "awaiting_response" : "expired";

    // On verify: reset expires_at to now + 24h (fresh window for reader)
    const update =
      action === "verify"
        ? {
            status: newStatus,
            payment_verified_at: new Date().toISOString(),
            verified_by: user.id,
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          }
        : { status: newStatus };

    const { error: updateErr } = await admin
      .from("readings")
      .update(update)
      .eq("id", reading_id);

    if (updateErr) return json({ error: "Update failed" }, 500);

    return json({ ok: true, status: newStatus });
  } catch (err) {
    console.error("verify_payment error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
