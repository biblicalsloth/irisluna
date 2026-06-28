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

    const secret = Deno.env.get("DODO_WEBHOOK_SECRET");
    if (!secret) {
      console.error("DODO_WEBHOOK_SECRET not set");
      return json({ error: "Webhook not configured" }, 500);
    }

    const wh = new Webhook(secret);
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

    const { data: reading, error: readErr } = await admin
      .from("readings")
      .select("id, status, paid_at")
      .eq("id", readingId)
      .single();

    if (readErr && readErr.code !== "PGRST116") {
      console.error("webhook reading lookup failed:", readErr);
      return json({ error: "Lookup failed" }, 500);
    }
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
