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

    // Verify reader is authenticated
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
      response_audio_path: string;
      response_duration_ms?: number;
    };

    const { reading_id, response_audio_path, response_duration_ms } = body;

    // Path must match {reading_id}-response.{webm|mp4} — scoped to this reading
    const VALID_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-response\.(webm|mp4)$/;
    if (!response_audio_path || !VALID_PATH.test(response_audio_path)) {
      return json({ error: "Invalid response audio path" }, 400);
    }
    if (!response_audio_path.startsWith(`${reading_id}-response.`)) {
      return json({ error: "Invalid response audio path" }, 400);
    }

    const { data: reading, error: readErr } = await admin
      .from("readings")
      .select("id, email, status, session_token, claimed_by")
      .eq("id", reading_id)
      .single();

    if (readErr || !reading) return json({ error: "Reading not found" }, 404);
    if (reading.status !== "awaiting_response") return json({ error: "Wrong status" }, 409);

    // Prevent response hijack: only the claiming reader may submit
    const rc = reading as { claimed_by: string | null } & typeof reading;
    if (rc.claimed_by && rc.claimed_by !== user.id) {
      return json({ error: "Reading is claimed by another reader" }, 403);
    }

    const { error: updateErr } = await admin
      .from("readings")
      .update({
        response_audio_path,
        response_duration_ms: response_duration_ms ?? null,
        responded_at: new Date().toISOString(),
        status: "responded",
        claimed_by: user.id,
      })
      .eq("id", reading_id)
      .or(`claimed_by.is.null,claimed_by.eq.${user.id}`);

    if (updateErr) return json({ error: "Update failed" }, 500);

    // Notify seeker by email if provided
    if (reading.email) {
      const appUrl = Deno.env.get("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000";
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Iris Luna <readings@irisluna.app>",
          to: reading.email,
          subject: "The human has answered — your reading is ready.",
          html: `
            <div style="background:#0A0A12;color:#ECE9F5;font-family:sans-serif;padding:40px;max-width:480px;margin:auto;border-radius:12px;">
              <h1 style="font-size:24px;margin-bottom:16px;">Your reading is ready.</h1>
              <p style="color:#6C6A82;line-height:1.6;margin-bottom:32px;">
                A human reader has listened to your question and recorded a response. Flip your cards when you're ready.
              </p>
              <a href="${appUrl}/wait/${reading_id}?token=${(reading as { session_token: string }).session_token}"
                 style="background:#7C6FCB;color:#ECE9F5;padding:14px 28px;border-radius:8px;text-decoration:none;display:inline-block;">
                Reveal your reading →
              </a>
            </div>
          `,
        }),
      }).catch((e) => console.error("resend error:", e));
    }

    return json({ ok: true });
  } catch (err) {
    console.error("submit_response error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
