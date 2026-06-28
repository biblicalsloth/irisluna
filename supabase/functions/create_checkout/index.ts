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
